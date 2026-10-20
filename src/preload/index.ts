import { contextBridge, ipcRenderer } from 'electron';
import { Channels, type BleSnapshot, type LedApi } from '../shared/ipc.ts';

const api: LedApi = {
  getSnapshot: () => ipcRenderer.invoke(Channels.getSnapshot),
  onSnapshot: (listener) => {
    const handler = (_e: unknown, snapshot: BleSnapshot) => listener(snapshot);
    ipcRenderer.on(Channels.snapshot, handler);
    return () => ipcRenderer.removeListener(Channels.snapshot, handler);
  },
  startScan: () => ipcRenderer.invoke(Channels.startScan),
  stopScan: () => ipcRenderer.invoke(Channels.stopScan),
  connect: (id) => ipcRenderer.invoke(Channels.connect, id),
  disconnect: () => ipcRenderer.invoke(Channels.disconnect),
  setColor: (rgb) => ipcRenderer.invoke(Channels.setColor, rgb),
  setBrightness: (percent) => ipcRenderer.invoke(Channels.setBrightness, percent),
};

contextBridge.exposeInMainWorld('led', api);
