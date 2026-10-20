// macOS kills any app that uses Bluetooth without NSBluetoothAlwaysUsageDescription
// in its Info.plist. The dev Electron.app in node_modules doesn't have it, so add it.
// Packaged builds get the key from the electron-builder config instead.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url);
  let binary = '';
  try {
    binary = require('electron'); // .../Electron.app/Contents/MacOS/Electron
  } catch {
    console.warn('Electron is not installed yet; skipping the Bluetooth plist patch.');
  }
  const plist = join(dirname(dirname(binary)), 'Info.plist');
  const key = 'NSBluetoothAlwaysUsageDescription';
  const buddy = (cmd) => execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist], { stdio: 'pipe' });

  if (binary && existsSync(plist)) {
    try {
      buddy(`Print :${key}`);
    } catch {
      buddy(`Add :${key} string "Lantern uses Bluetooth to control your LED strip."`);
      console.log('Added Bluetooth permission to dev Electron.app');
    }
  }
}
