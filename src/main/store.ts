// The remembered strip, kept in the app's user data folder so the main
// process can reconnect on launch before the UI has loaded.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { SavedDevice } from '../shared/ipc.ts';

const file = () => join(app.getPath('userData'), 'device.json');

export function loadSavedDevice(): SavedDevice | null {
  try {
    const d = JSON.parse(readFileSync(file(), 'utf8'));
    return typeof d?.id === 'string' ? { autoConnect: true, nickname: null, ...d } : null;
  } catch {
    return null;
  }
}

export function storeSavedDevice(device: SavedDevice | null): void {
  try {
    writeFileSync(file(), JSON.stringify(device ?? {}, null, 2));
  } catch (err) {
    console.error('[store] could not save device', err);
  }
}
