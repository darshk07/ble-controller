import { useCallback, useEffect, useState } from 'react';
import { ColorPanel } from './components/ColorPanel.tsx';
import { DeviceSheet, displayName } from './components/DeviceSheet.tsx';
import { EffectsPanel } from './components/EffectsPanel.tsx';
import { MusicPanel } from './components/MusicPanel.tsx';
import { Orb } from './components/Orb.tsx';
import { ScreenPanel } from './components/ScreenPanel.tsx';
import { Segmented } from './components/Segmented.tsx';
import { Slider } from './components/Slider.tsx';
import { engine, type Mode } from './engine/engine.ts';
import { useEngine, useLedSnapshot } from './hooks.ts';

const MODES: { value: Mode; label: string }[] = [
  { value: 'color', label: 'Color' },
  { value: 'effect', label: 'Effects' },
  { value: 'screen', label: 'Screen' },
  { value: 'music', label: 'Music' },
];

export function App() {
  const snap = useLedSnapshot();
  const { settings } = useEngine();
  const [sheet, setSheet] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const connected = snap.status === 'connected';
  const searching = snap.status === 'disconnected' && snap.autoConnecting;
  const name = displayName(snap);
  const error = actionError ?? snap.error;

  useEffect(() => {
    if (connected) engine.resync();
  }, [connected]);

  const run = useCallback((fn: () => Promise<void>) => {
    setActionError(null);
    fn().catch((err: Error) => setActionError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));
  }, []);
  const closeSheet = useCallback(() => setSheet(false), []);

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">Lantern</span>
      </header>

      <section className="hero">
        <Orb dim={settings.brightness / 100} />
        <button className={`status ${searching ? 'connecting' : snap.status}`} onClick={() => setSheet(true)}>
          <span className="dot" />
          <span className="status-text">
            {connected
              ? name
              : snap.status === 'connecting'
                ? `Connecting to ${name}…`
                : searching
                  ? `Looking for ${name}…`
                  : snap.saved
                    ? `${name} · not connected`
                    : 'Connect strip'}
          </span>
        </button>
      </section>

      <nav className="modes">
        <Segmented value={settings.mode} options={MODES} onChange={(mode) => engine.update({ mode })} size="large" />
      </nav>

      <main key={settings.mode} className="content">
        {settings.mode === 'color' && <ColorPanel />}
        {settings.mode === 'effect' && <EffectsPanel />}
        {settings.mode === 'screen' && <ScreenPanel />}
        {settings.mode === 'music' && <MusicPanel />}
      </main>

      <footer className="footer">
        <Slider label="Brightness" min={1} max={100} value={settings.brightness} format={(v) => `${v}%`} onChange={(brightness) => engine.update({ brightness })} />
        {error && <p className="error">{error}</p>}
      </footer>

      {sheet && <DeviceSheet snap={snap} onClose={closeSheet} run={run} />}
    </div>
  );
}
