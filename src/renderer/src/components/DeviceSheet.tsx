import { useEffect, useRef, useState } from 'react';
import type { BleSnapshot, SavedDevice } from '../../../shared/ipc.ts';
import { Toggle } from './Slider.tsx';

interface Props {
  snap: BleSnapshot;
  onClose(): void;
  run(fn: () => Promise<void>): void;
}

export function displayName(snap: BleSnapshot): string {
  const saved = snap.saved;
  const device = snap.devices.find((d) => d.id === snap.connectedId);
  if (saved && (!snap.connectedId || saved.id === snap.connectedId)) return saved.nickname || saved.name || 'LED strip';
  return device?.name ?? 'LED strip';
}

export function DeviceSheet({ snap, onClose, run }: Props) {
  const connected = snap.status === 'connected';

  useEffect(() => {
    // Scan once when the sheet opens, unless already connected or searching.
    if (snap.status === 'disconnected' && !snap.scanning && !snap.autoConnecting) run(() => window.led.startScan());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close once a connection made from this sheet succeeds.
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) onClose();
    wasConnected.current = connected;
  }, [connected, onClose]);

  const others = snap.devices.filter((d) => d.id !== snap.saved?.id);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {snap.saved && <SavedStrip saved={snap.saved} snap={snap} run={run} />}

        {!connected && (
          <>
            <div className="row">
              <h2>{snap.saved ? 'Other devices' : 'Devices'}</h2>
              <button className="pill-button" disabled={snap.status === 'connecting'} onClick={() => run(() => (snap.scanning ? window.led.stopScan() : window.led.startScan()))}>
                {snap.scanning ? 'Stop' : 'Scan'}
              </button>
            </div>
            {snap.adapter !== 'poweredOn' && snap.adapter !== 'unknown' && <p className="hint">Bluetooth is {snap.adapter === 'poweredOff' ? 'off' : snap.adapter}.</p>}
            <ul className="devices">
              {others.length === 0 && <li className="hint">{snap.scanning ? 'Searching…' : 'Press Scan to find your strip.'}</li>}
              {others.map((d) => (
                <li key={d.id}>
                  <button className="device" disabled={snap.status === 'connecting'} onClick={() => run(() => window.led.connect(d.id))}>
                    <span className="name">
                      {d.name}
                      {d.likelyStrip && <span className="tag">LED</span>}
                    </span>
                    <span className="rssi">{snap.status === 'connecting' && snap.connectedId === d.id ? 'Connecting…' : `${d.rssi} dBm`}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="hint">Close Magic Lantern on your phone first; the strip accepts one connection.</p>
          </>
        )}
      </div>
    </div>
  );
}

function SavedStrip({ saved, snap, run }: { saved: SavedDevice; snap: BleSnapshot; run: Props['run'] }) {
  const [nickname, setNickname] = useState(saved.nickname ?? '');
  useEffect(() => setNickname(saved.nickname ?? ''), [saved.nickname]);

  const connected = snap.status === 'connected' && snap.connectedId === saved.id;
  const busy = snap.status === 'connecting';
  const found = snap.devices.find((d) => d.id === saved.id || (saved.name && d.name === saved.name));
  const commit = () => {
    if (nickname.trim() !== (saved.nickname ?? '')) run(() => window.led.renameDevice(nickname));
  };

  let state = 'Not nearby';
  if (connected) state = 'Connected';
  else if (busy) state = 'Connecting…';
  else if (snap.autoConnecting) state = 'Looking for it…';
  else if (found) state = 'Nearby';

  return (
    <div className="saved">
      <div className="row">
        <h2>Your strip</h2>
        <span className={`saved-state ${connected ? 'on' : ''}`}>{state}</span>
      </div>
      <label className="nickname">
        <input
          value={nickname}
          placeholder={saved.name || 'LED strip'}
          maxLength={32}
          spellCheck={false}
          onChange={(e) => setNickname(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <small>{saved.name ? `Shown instead of “${saved.name}”. Only this app sees the nickname.` : 'Only this app sees the nickname.'}</small>
      </label>
      <Toggle
        label="Connect automatically"
        hint="On launch, and again if the strip is switched off and on"
        checked={saved.autoConnect}
        onChange={(enabled) => run(() => window.led.setAutoConnect(enabled))}
      />
      <div className="saved-actions">
        {connected ? (
          <button className="ghost" onClick={() => run(() => window.led.disconnect())}>
            Disconnect
          </button>
        ) : (
          <button className="ghost primary" disabled={busy || !found} onClick={() => found && run(() => window.led.connect(found.id))}>
            Connect
          </button>
        )}
        <button className="ghost danger" disabled={busy} onClick={() => run(async () => {
          if (connected) await window.led.disconnect();
          await window.led.forgetDevice();
        })}>
          Forget
        </button>
      </div>
    </div>
  );
}
