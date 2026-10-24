// Owns the Bluetooth adapter. The renderer never touches noble directly;
// it sends commands over IPC and receives BleSnapshot updates.

import { EventEmitter } from 'node:events';
import noble, { type Characteristic, type Peripheral } from '@stoprocent/noble';
import type { AdapterState, BleSnapshot, DeviceInfo, SavedDevice } from '../shared/ipc.ts';
import { SERVICE_UUID, WRITE_CHAR_UUID } from '../shared/protocol.ts';
import { loadSavedDevice, storeSavedDevice } from './store.ts';

const SCAN_MS = 15_000;
const CONNECT_ATTEMPTS = 3;

// Auto-connect: scan this long for the saved strip, then rest before trying
// again, so a strip switched off at the wall is picked up when it returns.
const AUTO_SCAN_MS = 12_000;
const AUTO_RETRY_MS = 20_000;

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
    saved: loadSavedDevice(),
    autoConnecting: false,
  };
  private peripheral: Peripheral | null = null;
  private characteristic: Characteristic | null = null;
  private withoutResponse = false;
  private minInterval = MIN_INTERVAL_WITH_RESPONSE_MS;
  private scanTimer: NodeJS.Timeout | null = null;
  private autoTimer: NodeJS.Timeout | null = null;

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

  // Connects to the saved strip without a click: now, and again whenever the
  // link drops on its own. A manual disconnect stops it until next launch.
  startAutoConnect(): void {
    const { saved, status } = this.snapshot;
    if (!saved?.autoConnect || status !== 'disconnected' || this.peripheral) return;
    this.clearAutoTimer();
    this.update({ autoConnecting: true });

    // Always scan rather than reuse a cached peripheral: seeing a fresh
    // advertisement proves the strip is powered and in range.
    void (async () => {
      try {
        await noble.waitForPoweredOnAsync(15_000);
        if (!this.snapshot.autoConnecting) return;
        await noble.startScanningAsync([], false);
        this.autoTimer = setTimeout(() => {
          void this.stopScan().catch(() => {});
          this.retryAutoConnect();
        }, AUTO_SCAN_MS);
      } catch {
        this.retryAutoConnect();
      }
    })();
  }

  stopAutoConnect(): void {
    this.clearAutoTimer();
    if (this.snapshot.autoConnecting) this.update({ autoConnecting: false });
  }

  renameDevice(nickname: string): void {
    const saved = this.snapshot.saved;
    if (saved) this.save({ ...saved, nickname: nickname.trim() || null });
  }

  setAutoConnect(enabled: boolean): void {
    const saved = this.snapshot.saved;
    if (!saved) return;
    this.save({ ...saved, autoConnect: enabled });
    if (enabled) this.startAutoConnect();
    else this.stopAutoConnect();
  }

  forgetDevice(): void {
    this.stopAutoConnect();
    this.save(null);
  }

  private isSaved(p: Peripheral): boolean {
    const saved = this.snapshot.saved;
    if (!saved) return false;
    // The id is exact; the advertised name covers the id changing, e.g. after
    // macOS resets its Bluetooth cache.
    return p.id === saved.id || (!!saved.name && p.advertisement.localName === saved.name);
  }

  private autoBusy = false;

  private async autoConnectTo(p: Peripheral): Promise<void> {
    if (this.autoBusy || this.snapshot.status !== 'disconnected') return;
    this.autoBusy = true;
    this.clearAutoTimer();
    try {
      await this.connect(p.id);
    } catch {
      this.retryAutoConnect();
    } finally {
      this.autoBusy = false;
    }
  }

  private retryAutoConnect(): void {
    if (!this.snapshot.autoConnecting) return;
    this.clearAutoTimer();
    this.autoTimer = setTimeout(() => {
      this.update({ autoConnecting: false });
      this.startAutoConnect();
    }, AUTO_RETRY_MS);
  }

  private clearAutoTimer(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
  }

  private save(saved: SavedDevice | null): void {
    storeSavedDevice(saved);
    this.update({ saved });
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
        this.clearAutoTimer();
        this.update({ status: 'connected', autoConnecting: false });
        this.remember(p);
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

  private remember(p: Peripheral): void {
    const prev = this.snapshot.saved;
    const name = p.advertisement.localName || prev?.name || '';
    const same = prev && (prev.id === p.id || (!!prev.name && prev.name === name));
    this.save({ id: p.id, name, nickname: same ? prev.nickname : null, autoConnect: same ? prev.autoConnect : true });
  }

  private async tryConnect(p: Peripheral): Promise<Characteristic> {
    await p.connectAsync();
    const { characteristics } = await p.discoverSomeServicesAndCharacteristicsAsync([SERVICE_UUID], [WRITE_CHAR_UUID]);
    const ch = characteristics[0];
    if (!ch) throw new NotAStripError();
    return ch;
  }

  // A disconnect the user asked for: don't reconnect until next launch.
  async disconnect(): Promise<void> {
    this.stopAutoConnect();
    const p = this.peripheral;
    if (!p) return;
    this.peripheral = null;
    await p.disconnectAsync();
    this.dropConnection();
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
    if (this.snapshot.autoConnecting && this.isSaved(p)) void this.autoConnectTo(p);
  }

  // The link dropped on its own (strip switched off, out of range).
  private onDisconnected(p: Peripheral): void {
    if (this.peripheral !== p) return;
    this.peripheral = null;
    this.dropConnection();
    setTimeout(() => this.startAutoConnect(), 2000);
  }

  private dropConnection(): void {
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
