// Owns the Bluetooth adapter. The renderer never touches noble directly;
// it sends commands over IPC and receives BleSnapshot updates.

import { EventEmitter } from 'node:events';
import noble, { type Characteristic, type Peripheral } from '@stoprocent/noble';
import type { AdapterState, BleSnapshot, DeviceInfo } from '../shared/ipc.ts';
import { SERVICE_UUID, WRITE_CHAR_UUID } from '../shared/protocol.ts';

const SCAN_MS = 15_000;
const CONNECT_ATTEMPTS = 3;

// Write pacing. The link to MELK controllers carries about 30 frames/s;
// faster sends queue up inside Windows and the strip falls seconds behind
// (measured by the neon-lights project on a MELK-OA10: 40/s ≈ 1.3 s lag,
// 50/s ≈ 2.5 s). With-response writes can't build that queue because each
// waits for the strip, so they only need the firmware's ~30/s cap.
// Without-response writes get a little more headroom.
const MIN_INTERVAL_WITH_RESPONSE_MS = 33;
const MIN_INTERVAL_WITHOUT_RESPONSE_MS = 40;

type CommandKind = 'color' | 'brightness' | 'effect' | 'speed';

export class LedService extends EventEmitter<{ change: [BleSnapshot] }> {
  private peripherals = new Map<string, Peripheral>();
  private snapshot: BleSnapshot = {
    adapter: noble.state as AdapterState,
    scanning: false,
    devices: [],
    status: 'disconnected',
    connectedId: null,
    error: null,
  };
  private peripheral: Peripheral | null = null;
  private characteristic: Characteristic | null = null;
  private withoutResponse = false;
  private minInterval = MIN_INTERVAL_WITH_RESPONSE_MS;
  private scanTimer: NodeJS.Timeout | null = null;

  // Latest-wins write queue: while one write is in flight, newer commands of
  // the same kind replace older ones, so dragging a slider never backs up.
  private pending = new Map<CommandKind, Uint8Array>();
  private writing = false;
  private lastWrite = 0;

  constructor() {
    super();
    noble.on('stateChange', (state: AdapterState) => this.update({ adapter: state }));
    noble.on('scanStart', () => this.update({ scanning: true }));
    noble.on('scanStop', () => this.update({ scanning: false }));
    noble.on('discover', (p: Peripheral) => this.onDiscover(p));
  }

  getSnapshot(): BleSnapshot {
    return this.snapshot;
  }

  async startScan(): Promise<void> {
    this.update({ error: null });
    await noble.waitForPoweredOnAsync(10_000);
    await noble.startScanningAsync([], false);
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => void this.stopScan(), SCAN_MS);
  }

  async stopScan(): Promise<void> {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null;
    await noble.stopScanningAsync();
  }

  async connect(id: string): Promise<void> {
    const p = this.peripherals.get(id);
    if (!p) throw new Error('Device not found. Scan again.');
    if (this.peripheral) await this.disconnect();

    await this.stopScan();
    this.update({ status: 'connecting', connectedId: id, error: null });

    // Windows often drops the link mid-discovery on the first try, especially
    // right after scanning stops, so give the adapter a moment and retry.
    let lastErr: unknown;
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
      await delay(attempt === 1 ? 300 : 1000);
      try {
        const ch = await this.tryConnect(p);
        this.peripheral = p;
        this.characteristic = ch;
        // Prefer acknowledged writes: they can't pile up in the OS queue.
        this.withoutResponse = !ch.properties.includes('write');
        this.minInterval = this.withoutResponse ? MIN_INTERVAL_WITHOUT_RESPONSE_MS : MIN_INTERVAL_WITH_RESPONSE_MS;
        console.log(`[ble] ${ch.uuid} properties: ${ch.properties.join(', ')}; using write ${this.withoutResponse ? 'without' : 'with'} response`);
        p.once('disconnect', () => this.onDisconnected(p));
        this.update({ status: 'connected' });
        return;
      } catch (err) {
        lastErr = err;
        await p.disconnectAsync().catch(() => {});
        if (err instanceof NotAStripError) break;
      }
    }

    const error = connectErrorMessage(lastErr);
    this.update({ status: 'disconnected', connectedId: null, error });
    throw new Error(error);
  }

  private async tryConnect(p: Peripheral): Promise<Characteristic> {
    await p.connectAsync();
    const { characteristics } = await p.discoverSomeServicesAndCharacteristicsAsync([SERVICE_UUID], [WRITE_CHAR_UUID]);
    const ch = characteristics[0];
    if (!ch) throw new NotAStripError();
    return ch;
  }

  async disconnect(): Promise<void> {
    const p = this.peripheral;
    if (!p) return;
    await p.disconnectAsync();
    this.onDisconnected(p);
  }

  write(kind: CommandKind, bytes: Uint8Array): void {
    if (!this.characteristic) throw new Error('Not connected');
    this.pending.set(kind, bytes);
    void this.flush();
  }

  // Animation frames: dropped silently while disconnected.
  frame(bytes: Uint8Array): void {
    if (this.characteristic) this.write('color', bytes);
  }

  // Sends pending commands one at a time. Each loop takes whatever is newest
  // right before writing, so stale colors are skipped rather than queued.
  private async flush(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.pending.size && this.characteristic) {
        const wait = this.lastWrite + this.minInterval - Date.now();
        if (wait > 0) await delay(wait);
        const next = this.pending.entries().next();
        if (next.done || !this.characteristic) break;
        const [kind, bytes] = next.value;
        this.pending.delete(kind);
        this.lastWrite = Date.now();
        await this.characteristic.writeAsync(Buffer.from(bytes), this.withoutResponse);
        this.trackLatency(Date.now() - this.lastWrite);
      }
    } catch (err) {
      this.update({ error: message(err) });
    } finally {
      this.writing = false;
    }
  }

  // Logs the average write round trip every 50 writes, to tune the intervals.
  private latencySum = 0;
  private latencyCount = 0;
  private trackLatency(ms: number): void {
    this.latencySum += ms;
    if (++this.latencyCount < 50) return;
    console.log(`[ble] avg write ${(this.latencySum / this.latencyCount).toFixed(1)} ms`);
    this.latencySum = 0;
    this.latencyCount = 0;
  }

  private onDiscover(p: Peripheral): void {
    this.peripherals.set(p.id, p);
    const device: DeviceInfo = {
      id: p.id,
      name: p.advertisement.localName || 'Unnamed device',
      rssi: p.rssi,
      likelyStrip: (p.advertisement.serviceUuids ?? []).some((u) => u.toLowerCase().includes(SERVICE_UUID)),
    };
    const devices = this.snapshot.devices.filter((d) => d.id !== p.id).concat(device);
    // Likely strips first, then named devices, then by signal strength.
    devices.sort(
      (a, b) =>
        Number(b.likelyStrip) - Number(a.likelyStrip) ||
        Number(b.name !== 'Unnamed device') - Number(a.name !== 'Unnamed device') ||
        b.rssi - a.rssi,
    );
    this.update({ devices });
  }

  private onDisconnected(p: Peripheral): void {
    if (this.peripheral !== p) return;
    this.peripheral = null;
    this.characteristic = null;
    this.pending.clear();
    this.update({ status: 'disconnected', connectedId: null });
  }

  private update(patch: Partial<BleSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit('change', this.snapshot);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class NotAStripError extends Error {
  constructor() {
    super('This device has no FFF3 characteristic. Is it the strip?');
  }
}

function connectErrorMessage(err: unknown): string {
  if (err instanceof NotAStripError) return err.message;
  const raw = message(err);
  if (/unreachable|disconnected/i.test(raw)) {
    return `Couldn't stay connected to the strip (${raw}). Close the strip's phone app or turn off your phone's Bluetooth, move closer, and try again.`;
  }
  return raw;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
