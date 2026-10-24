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

// The strip this app remembers. The strip's own name can't be changed over
// BLE (no rename command is known), so the nickname lives in the app.
export interface SavedDevice {
  id: string;
  name: string; // advertised name, used as a fallback match if the id changes
  nickname: string | null;
  autoConnect: boolean;
}

export interface BleSnapshot {
  adapter: AdapterState;
  scanning: boolean;
  devices: DeviceInfo[];
  status: ConnectionStatus;
  connectedId: string | null;
  error: string | null;
  saved: SavedDevice | null;
  // Looking for the saved strip in the background.
  autoConnecting: boolean;
}

export interface ScreenInfo {
  id: string;
  name: string;
}

export interface LedApi {
  getSnapshot(): Promise<BleSnapshot>;
  onSnapshot(listener: (snapshot: BleSnapshot) => void): () => void;
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  connect(id: string): Promise<void>;
  disconnect(): Promise<void>;
  renameDevice(nickname: string): Promise<void>;
  setAutoConnect(enabled: boolean): Promise<void>;
  forgetDevice(): Promise<void>;
  setColor(rgb: Rgb): Promise<void>;
  setBrightness(percent: number): Promise<void>;
  // Starts one of the strip's own animations (code 0..255, speed 0..100).
  setStripEffect(code: number, speed: number): Promise<void>;
  // Fire-and-forget animation frame; ignored while disconnected.
  sendFrame(rgb: Rgb): void;
  // Keeps the app from being suspended while a live mode runs in the background.
  setLive(live: boolean): Promise<void>;
  listScreens(): Promise<ScreenInfo[]>;
  // Which screen getDisplayMedia captures; null means the primary display.
  setCaptureScreen(id: string | null): Promise<void>;
  platform: NodeJS.Platform;
}

export const Channels = {
  snapshot: 'ble:snapshot',
  getSnapshot: 'ble:get-snapshot',
  startScan: 'ble:start-scan',
  stopScan: 'ble:stop-scan',
  connect: 'ble:connect',
  disconnect: 'ble:disconnect',
  renameDevice: 'ble:rename-device',
  setAutoConnect: 'ble:set-auto-connect',
  forgetDevice: 'ble:forget-device',
  setColor: 'led:set-color',
  setBrightness: 'led:set-brightness',
  setStripEffect: 'led:set-strip-effect',
  frame: 'led:frame',
  setLive: 'app:set-live',
  listScreens: 'capture:list-screens',
  setCaptureScreen: 'capture:set-screen',
} as const;
