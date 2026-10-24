import { join } from 'node:path';
import { app, BrowserWindow, desktopCapturer, ipcMain, powerSaveBlocker, screen, session } from 'electron';
import { Channels, type ScreenInfo } from '../shared/ipc.ts';
import { setBrightness, setColor, setStripEffect, setStripSpeed, type Rgb } from '../shared/protocol.ts';
import { LedService } from './ble.ts';

const led = new LedService();
let captureScreenId: string | null = null;
let liveBlocker: number | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 460,
    height: 820,
    minWidth: 380,
    minHeight: 640,
    show: false,
    backgroundColor: '#09090d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? false : { color: '#09090d', symbolColor: '#c9c9d6', height: 40 },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      // An ES module preload cannot run in a sandbox; context isolation stays on.
      sandbox: false,
      // Live modes must keep running while the window is hidden or minimised.
      backgroundThrottling: false,
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

async function listScreens(): Promise<ScreenInfo[]> {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  return sources.map((s, i) => ({ id: s.id, name: s.name || `Screen ${i + 1}` }));
}

// getDisplayMedia in the renderer lands here: capture the chosen screen without
// a picker, plus system audio when asked (Windows, and macOS 14.2+).
function handleDisplayMedia(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    const primary = String(screen.getPrimaryDisplay().id);
    const source =
      sources.find((s) => s.id === captureScreenId) ?? sources.find((s) => s.display_id === primary) ?? sources[0];
    if (!source) return callback({});
    callback({ video: source, ...(request.audioRequested ? { audio: 'loopback' as const } : {}) });
  });
}

ipcMain.handle(Channels.getSnapshot, () => led.getSnapshot());
ipcMain.handle(Channels.startScan, () => led.startScan());
ipcMain.handle(Channels.stopScan, () => led.stopScan());
ipcMain.handle(Channels.connect, (_e, id: string) => led.connect(id));
ipcMain.handle(Channels.disconnect, () => led.disconnect());
ipcMain.handle(Channels.setColor, (_e, rgb: Rgb) => led.write('color', setColor(rgb)));
ipcMain.handle(Channels.setBrightness, (_e, percent: number) => led.write('brightness', setBrightness(percent)));
ipcMain.handle(Channels.setStripEffect, (_e, code: number, speed: number) => {
  led.write('speed', setStripSpeed(speed));
  led.write('effect', setStripEffect(code));
});
ipcMain.on(Channels.frame, (_e, rgb: Rgb) => led.frame(setColor(rgb)));
ipcMain.handle(Channels.listScreens, () => listScreens());
ipcMain.handle(Channels.setCaptureScreen, (_e, id: string | null) => {
  captureScreenId = id;
});
ipcMain.handle(Channels.setLive, (_e, live: boolean) => {
  if (live && liveBlocker === null) liveBlocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!live && liveBlocker !== null) {
    powerSaveBlocker.stop(liveBlocker);
    liveBlocker = null;
  }
});

app.whenReady().then(() => {
  handleDisplayMedia();
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
