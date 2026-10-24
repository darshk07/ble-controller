import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs LedService against a fake noble and a fake strip.
const userData = mkdtempSync(join(tmpdir(), 'lantern-test-'));

const noble: any = new EventEmitter();
noble.state = 'poweredOn';
noble.waitForPoweredOnAsync = async () => {};
noble.scanning = false;
noble.startScanningAsync = async () => { noble.scanning = true; noble.scans = (noble.scans ?? 0) + 1; };
noble.stopScanningAsync = async () => { noble.scanning = false; };
mock.module('@stoprocent/noble', { defaultExport: noble });
mock.module('electron', { namedExports: { app: { getPath: () => userData } } });
writeFileSync(join(userData, 'device.json'), JSON.stringify({ id: 'abc', name: 'MELK-OA21', nickname: 'Desk', autoConnect: true }));

function strip(id = 'abc') {
  const p: any = new EventEmitter();
  Object.assign(p, { id, rssi: -50, advertisement: { localName: 'MELK-OA21', serviceUuids: ['fff0'] } });
  p.connectAsync = async () => {};
  p.disconnectAsync = async () => { p.emit('disconnect'); };
  p.discoverSomeServicesAndCharacteristicsAsync = async () => ({ characteristics: [{ uuid: 'fff3', properties: ['write'], writeAsync: async () => {} }] });
  return p;
}
const wait = (_ms: number) => new Promise((r) => setImmediate(r));

test('auto-connect flow', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { LedService } = await import('./ble.ts');
  const led = new LedService();
  assert.equal(led.getSnapshot().saved?.nickname, 'Desk');

  led.startAutoConnect();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(led.getSnapshot().autoConnecting, true);
  assert.equal(noble.scanning, true);

  // Strip shows up (twice, to check no double connect).
  const p = strip();
  let connects = 0; const orig = p.connectAsync; p.connectAsync = async () => { connects++; return orig(); };
  noble.emit('discover', p); noble.emit('discover', p);
  for (let i = 0; i < 20; i++) { mock.timers.tick(500); await wait(0); }
  assert.equal(led.getSnapshot().status, 'connected');
  assert.equal(led.getSnapshot().autoConnecting, false);
  assert.equal(connects, 1);

  // Strip switched off: link drops, app scans, doesn't find it, retries.
  const scansBefore = noble.scans;
  p.emit('disconnect');
  assert.equal(led.getSnapshot().status, 'disconnected');
  mock.timers.tick(2000); await wait(0); await wait(0);
  assert.equal(led.getSnapshot().autoConnecting, true);
  assert.equal(noble.scans, scansBefore + 1);
  mock.timers.tick(12_000); await wait(0);
  mock.timers.tick(20_000); await wait(0); await wait(0);
  assert.equal(noble.scans, scansBefore + 2, 'rescans after resting');

  // Strip switched back on with a new id (e.g. cache reset): matched by name.
  const p2 = strip('new-id');
  noble.emit('discover', p2);
  for (let i = 0; i < 20; i++) { mock.timers.tick(500); await wait(0); }
  assert.equal(led.getSnapshot().status, 'connected');
  assert.equal(led.getSnapshot().saved?.id, 'new-id');
  assert.equal(led.getSnapshot().saved?.nickname, 'Desk', 'nickname kept');

  // Manual disconnect: no reconnect.
  await led.disconnect();
  mock.timers.tick(60_000); await wait(0);
  assert.equal(led.getSnapshot().autoConnecting, false);
  noble.emit('discover', p2);
  await wait(0);
  assert.equal(led.getSnapshot().status, 'disconnected');

  led.renameDevice('  Bedroom  ');
  assert.equal(led.getSnapshot().saved?.nickname, 'Bedroom');
  led.forgetDevice();
  assert.equal(led.getSnapshot().saved, null);
  mock.timers.reset();
});
