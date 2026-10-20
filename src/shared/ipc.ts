// Types and channel names shared by the main process, preload and renderer.

import type { Rgb } from './protocol.ts';

export type AdapterState = 'poweredOn' | 'poweredOff' | 'unauthorized' | 'unsupported' | 'unknown' | 'resetting';

export interface DeviceInfo {
  id: string;
  name: string;
  rssi: number;
  // True when the device advertises the Magic Lantern service FFF0.
  likelyStrip: boolean;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface BleSnapshot {
  adapter: AdapterState;
  scanning: boolean;
  devices: DeviceInfo[];
  status: ConnectionStatus;
  connectedId: string | null;
  error: string | null;
}

export interface LedApi {
  getSnapshot(): Promise<BleSnapshot>;
  onSnapshot(listener: (snapshot: BleSnapshot) => void): () => void;
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  connect(id: string): Promise<void>;
  disconnect(): Promise<void>;
  setColor(rgb: Rgb): Promise<void>;
  setBrightness(percent: number): Promise<void>;
}

export const Channels = {
  snapshot: 'ble:snapshot',
  getSnapshot: 'ble:get-snapshot',
  startScan: 'ble:start-scan',
  stopScan: 'ble:stop-scan',
  connect: 'ble:connect',
  disconnect: 'ble:disconnect',
  setColor: 'led:set-color',
  setBrightness: 'led:set-brightness',
} as const;
