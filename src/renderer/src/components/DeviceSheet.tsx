import { useEffect } from 'react';
import type { BleSnapshot } from '../../../shared/ipc.ts';

interface Props {
  snap: BleSnapshot;
  onClose(): void;
  run(fn: () => Promise<void>): void;
}

export function DeviceSheet({ snap, onClose, run }: Props) {
  useEffect(() => {
    if (snap.status === 'disconnected' && !snap.scanning) run(() => window.led.startScan());
    // Scan once when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (snap.status === 'connected') onClose();
  }, [snap.status, onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2>Devices</h2>
          <button className="pill-button" disabled={snap.status === 'connecting'} onClick={() => run(() => (snap.scanning ? window.led.stopScan() : window.led.startScan()))}>
            {snap.scanning ? 'Stop' : 'Scan'}
          </button>
        </div>
        {snap.adapter !== 'poweredOn' && snap.adapter !== 'unknown' && <p className="hint">Bluetooth is {snap.adapter === 'poweredOff' ? 'off' : snap.adapter}.</p>}
        <ul className="devices">
          {snap.devices.length === 0 && <li className="hint">{snap.scanning ? 'Searching…' : 'Press Scan to find your strip.'}</li>}
          {snap.devices.map((d) => (
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
      </div>
    </div>
  );
}
