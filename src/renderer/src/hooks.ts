import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BleSnapshot } from '../../shared/ipc.ts';
import { engine, type EngineState, type Frame } from './engine/engine.ts';

const initialSnapshot: BleSnapshot = {
  adapter: 'unknown',
  scanning: false,
  devices: [],
  status: 'disconnected',
  connectedId: null,
  error: null,
  saved: null,
  autoConnecting: false,
};

export function useLedSnapshot(): BleSnapshot {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  useEffect(() => {
    void window.led.getSnapshot().then(setSnapshot);
    return window.led.onSnapshot(setSnapshot);
  }, []);
  return snapshot;
}

export function useEngine(): EngineState {
  return useSyncExternalStore(engine.subscribe, engine.getState);
}

// Runs a callback on every engine frame without re-rendering React.
export function useFrame(callback: (frame: Frame) => void): void {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => engine.onFrame((f) => ref.current(f)), []);
}
