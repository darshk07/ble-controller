// macOS kills any app that uses Bluetooth, the microphone or system audio without
// a usage description in its Info.plist. The dev Electron.app in node_modules
// doesn't have them, so add them.
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
    console.warn('Electron is not installed yet; skipping the permissions plist patch.');
  }
  const plist = join(dirname(dirname(binary)), 'Info.plist');
  const keys = {
    NSBluetoothAlwaysUsageDescription: 'Lantern uses Bluetooth to control your LED strip.',
    NSMicrophoneUsageDescription: 'Lantern listens to music to drive your LED strip.',
    NSAudioCaptureUsageDescription: 'Lantern listens to system audio to drive your LED strip.',
  };
  const buddy = (cmd) => execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist], { stdio: 'pipe' });

  if (binary && existsSync(plist)) {
    for (const [key, text] of Object.entries(keys)) {
      try {
        buddy(`Print :${key}`);
      } catch {
        buddy(`Add :${key} string "${text}"`);
        console.log(`Added ${key} to dev Electron.app`);
      }
    }
  }
}
