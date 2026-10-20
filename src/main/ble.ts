// Owns the Bluetooth adapter. The renderer never touches noble directly;
// it sends commands over IPC and receives BleSnapshot updates.

import { EventEmitter } from 'node:events';
import noble, { type Characteristic, type Peripheral } from '@stoprocent/noble';
import type { AdapterState, BleSnapshot, DeviceInfo } from '../shared/ipc.ts';
import { SERVICE_UUID, WRITE_CHAR_UUID } from '../shared/protocol.ts';

const SCAN_MS = 15_000;

type CommandKind = 'color' | 'brightness';

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
  private scanTimer: NodeJS.Timeout | null = null;

  // Latest-wins write queue: while one write is in flight, newer commands of
  // the same kind replace older ones, so dragging a slider never backs up.
  private pending = new Map<CommandKind, Uint8Array>();
  private writing = false;

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
    try {
      await p.connectAsync();
      const { characteristics } = await p.discoverSomeServicesAndCharacteristicsAsync([SERVICE_UUID], [WRITE_CHAR_UUID]);
      const ch = characteristics[0];
      if (!ch) throw new Error('This device has no FFF3 characteristic. Is it the strip?');

      this.peripheral = p;
      this.characteristic = ch;
      this.withoutResponse = ch.properties.includes('writeWithoutResponse');
      p.once('disconnect', () => this.onDisconnected(p));
      this.update({ status: 'connected' });
    } catch (err) {
      await p.disconnectAsync().catch(() => {});
      this.update({ status: 'disconnected', connectedId: null, error: message(err) });
      throw err;
    }
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

  private async flush(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      for (const [kind, bytes] of this.pending) {
        this.pending.delete(kind);
        if (!this.characteristic) break;
        await this.characteristic.writeAsync(Buffer.from(bytes), this.withoutResponse);
      }
    } catch (err) {
      this.update({ error: message(err) });
    } finally {
      this.writing = false;
    }
    if (this.pending.size && this.characteristic) void this.flush();
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
