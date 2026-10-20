import { useState } from 'react';
import { parseHex, type Rgb } from '../../shared/protocol.ts';
import { useLedSnapshot } from './useLed.ts';

const SWATCHES = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff2d55', '#ffffff'];

function toCss({ r, g, b }: Rgb): string {
  return `rgb(${r} ${g} ${b})`;
}

export function App() {
  const snap = useLedSnapshot();
  const [color, setColor] = useState<Rgb>({ r: 255, g: 149, b: 0 });
  const [brightness, setBrightness] = useState(100);
  const [actionError, setActionError] = useState<string | null>(null);

  const connected = snap.status === 'connected';
  const device = snap.devices.find((d) => d.id === snap.connectedId);
  const error = actionError ?? snap.error;

  const run = (fn: () => Promise<void>) => {
    setActionError(null);
    fn().catch((err: Error) => setActionError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));
  };

  const pickColor = (hex: string) => {
    const rgb = parseHex(hex);
    setColor(rgb);
    if (connected) run(() => window.led.setColor(rgb));
  };

  const pickBrightness = (value: number) => {
    setBrightness(value);
    if (connected) run(() => window.led.setBrightness(value));
  };

  return (
    <div className="app" style={{ '--glow': toCss(color) } as React.CSSProperties}>
      <header className="titlebar">
        <span className="brand">Lantern</span>
      </header>

      <main>
        <section className="hero">
          <div className={`orb ${connected ? 'on' : ''}`} style={{ opacity: connected ? 0.35 + (brightness / 100) * 0.65 : 0.15 }} />
          <div className="status">
            <span className={`dot ${snap.status}`} />
            {connected ? device?.name ?? 'Connected' : snap.status === 'connecting' ? 'Connecting…' : 'Not connected'}
          </div>
        </section>

        {connected ? (
          <section className="card">
            <h2>Color</h2>
            <div className="swatches">
              {SWATCHES.map((hex) => (
                <button key={hex} className="swatch" style={{ background: hex }} onClick={() => pickColor(hex)} aria-label={hex} />
              ))}
              <label className="swatch custom" aria-label="Custom color">
                <input type="color" onChange={(e) => pickColor(e.target.value)} />
              </label>
            </div>

            <h2>
              Brightness <span className="value">{brightness}%</span>
            </h2>
            <input
              className="slider"
              type="range"
              min={1}
              max={100}
              value={brightness}
              onChange={(e) => pickBrightness(Number(e.target.value))}
            />

            <button className="ghost" onClick={() => run(() => window.led.disconnect())}>
              Disconnect
            </button>
          </section>
        ) : (
          <section className="card">
            <div className="row">
              <h2>Devices</h2>
              <button
                className="primary"
                disabled={snap.status === 'connecting'}
                onClick={() => run(() => (snap.scanning ? window.led.stopScan() : window.led.startScan()))}
              >
                {snap.scanning ? 'Stop' : 'Scan'}
              </button>
            </div>
            {snap.adapter !== 'poweredOn' && snap.adapter !== 'unknown' && (
              <p className="hint">Bluetooth is {snap.adapter === 'poweredOff' ? 'off' : snap.adapter}.</p>
            )}
            <ul className="devices">
              {snap.devices.length === 0 && <li className="hint">{snap.scanning ? 'Searching…' : 'Press Scan to find your strip.'}</li>}
              {snap.devices.map((d) => (
                <li key={d.id}>
                  <button className="device" disabled={snap.status === 'connecting'} onClick={() => run(() => window.led.connect(d.id))}>
                    <span className="name">
                      {d.name}
                      {d.likelyStrip && <span className="tag">LED</span>}
                    </span>
                    <span className="rssi">{d.rssi} dBm</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {error && <p className="error">{error}</p>}
      </main>
    </div>
  );
}
