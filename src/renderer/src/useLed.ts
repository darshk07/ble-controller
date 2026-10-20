import { useEffect, useState } from 'react';
import type { BleSnapshot } from '../../shared/ipc.ts';

const initial: BleSnapshot = {
  adapter: 'unknown',
  scanning: false,
  devices: [],
  status: 'disconnected',
  connectedId: null,
  error: null,
};

export function useLedSnapshot(): BleSnapshot {
  const [snapshot, setSnapshot] = useState(initial);
  useEffect(() => {
    void window.led.getSnapshot().then(setSnapshot);
    return window.led.onSnapshot(setSnapshot);
  }, []);
  return snapshot;
}
