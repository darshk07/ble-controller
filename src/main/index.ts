import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { Channels } from '../shared/ipc.ts';
import { setBrightness, setColor, type Rgb } from '../shared/protocol.ts';
import { LedService } from './ble.ts';

const led = new LedService();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 420,
    height: 720,
    minWidth: 360,
    minHeight: 560,
    show: false,
    backgroundColor: '#0b0b10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? false : { color: '#0b0b10', symbolColor: '#c9c9d6', height: 36 },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      // An ES module preload cannot run in a sandbox; context isolation stays on.
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  const send = (snapshot: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(Channels.snapshot, snapshot);
  };
  led.on('change', send);
  win.on('closed', () => led.off('change', send));

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

ipcMain.handle(Channels.getSnapshot, () => led.getSnapshot());
ipcMain.handle(Channels.startScan, () => led.startScan());
ipcMain.handle(Channels.stopScan, () => led.stopScan());
ipcMain.handle(Channels.connect, (_e, id: string) => led.connect(id));
ipcMain.handle(Channels.disconnect, () => led.disconnect());
ipcMain.handle(Channels.setColor, (_e, rgb: Rgb) => led.write('color', setColor(rgb)));
ipcMain.handle(Channels.setBrightness, (_e, percent: number) => led.write('brightness', setBrightness(percent)));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void led.disconnect().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});

app.on('before-quit', () => void led.disconnect());
