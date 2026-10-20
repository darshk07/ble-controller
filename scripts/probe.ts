// Phase 1: prove the connection with a bare Node script.
//
//   npm run probe -- scan [seconds]
//   npm run probe -- inspect <device>
//   npm run probe -- color <device> <rrggbb>
//   npm run probe -- brightness <device> <0-100>
//   npm run probe -- raw <device> "<hex bytes>"
//
// <device> is an id, MAC address, or part of the advertised name, as shown by `scan`.

import noble, { type Characteristic, type Peripheral } from '@stoprocent/noble';
import {
  SERVICE_UUID,
  WRITE_CHAR_UUID,
  parseBytes,
  parseHex,
  setBrightness,
  setColor,
  toHex,
} from '../src/shared/protocol.ts';

const usage = `Usage:
  npm run probe -- scan [seconds]
  npm run probe -- inspect <device>
  npm run probe -- color <device> <rrggbb>
  npm run probe -- brightness <device> <0-100>
  npm run probe -- raw <device> "<hex bytes>"`;

function label(p: Peripheral): string {
  const name = p.advertisement.localName || '(no name)';
  const addr = p.address && p.address !== 'unknown' ? p.address : '';
  return `${name.padEnd(20)} id=${p.id}${addr ? ` addr=${addr}` : ''} rssi=${p.rssi}`;
}

function advertisesFff0(p: Peripheral): boolean {
  return (p.advertisement.serviceUuids ?? []).some((u) => u.toLowerCase().includes(SERVICE_UUID));
}

function matches(p: Peripheral, query: string): boolean {
  const q = query.toLowerCase();
  return (
    p.id.toLowerCase() === q ||
    (p.address ?? '').toLowerCase() === q ||
    (p.advertisement.localName ?? '').toLowerCase().includes(q)
  );
}

async function powerOn(): Promise<void> {
  process.stdout.write('Waiting for Bluetooth adapter... ');
  await noble.waitForPoweredOnAsync(10_000);
  console.log('on');
}

async function scan(seconds: number): Promise<void> {
  await powerOn();
  const seen = new Map<string, Peripheral>();
  noble.on('discover', (p: Peripheral) => {
    if (seen.has(p.id)) return;
    seen.set(p.id, p);
    console.log(`${advertisesFff0(p) ? '★' : ' '} ${label(p)}`);
  });
  console.log(`Scanning for ${seconds}s (★ = advertises service FFF0)\n`);
  await noble.startScanningAsync([], false);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await noble.stopScanningAsync();
  console.log(`\n${seen.size} device(s). The strip may not advertise FFF0, so also look for its name.`);
}

async function find(query: string, timeoutMs = 15_000): Promise<Peripheral> {
  await powerOn();
  console.log(`Looking for "${query}"...`);
  const found = new Promise<Peripheral>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No device matching "${query}" within ${timeoutMs / 1000}s`)), timeoutMs);
    noble.on('discover', (p: Peripheral) => {
      if (!matches(p, query)) return;
      clearTimeout(timer);
      resolve(p);
    });
  });
  await noble.startScanningAsync([], false);
  try {
    return await found;
  } finally {
    await noble.stopScanningAsync();
  }
}

async function connect(query: string): Promise<Peripheral> {
  const p = await find(query);
  console.log(`Found ${label(p)}`);
  p.once('disconnect', (reason: unknown) => console.log(`Disconnected (${String(reason ?? 'no reason')})`));
  await p.connectAsync();
  console.log('Connected');
  return p;
}

async function inspect(query: string): Promise<void> {
  const p = await connect(query);
  try {
    const { services } = await p.discoverAllServicesAndCharacteristicsAsync();
    for (const s of services) {
      console.log(`\nService ${s.uuid}`);
      for (const c of s.characteristics ?? []) {
        console.log(`  Characteristic ${c.uuid}  [${c.properties.join(', ')}]`);
      }
    }
  } finally {
    await p.disconnectAsync();
  }
}

async function write(query: string, bytes: Uint8Array): Promise<void> {
  const p = await connect(query);
  try {
    const { characteristics } = await p.discoverSomeServicesAndCharacteristicsAsync([SERVICE_UUID], [WRITE_CHAR_UUID]);
    const ch: Characteristic | undefined = characteristics[0];
    if (!ch) throw new Error(`Service ${SERVICE_UUID} / characteristic ${WRITE_CHAR_UUID} not found. Run "inspect" to see what the strip exposes.`);
    const withoutResponse = ch.properties.includes('writeWithoutResponse');
    console.log(`Writing ${toHex(bytes)} to ${ch.uuid} (${withoutResponse ? 'without' : 'with'} response, props: ${ch.properties.join(', ')})`);
    await ch.writeAsync(Buffer.from(bytes), withoutResponse);
    console.log('Write OK. Did the strip change?');
    // Give a write-without-response time to leave the radio before disconnecting.
    await new Promise((r) => setTimeout(r, 500));
  } finally {
    await p.disconnectAsync();
  }
}

async function main(): Promise<void> {
  const [cmd, device, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'scan':
      return scan(Number(device) || 10);
    case 'inspect':
      if (!device) break;
      return inspect(device);
    case 'color':
      if (!device || !arg) break;
      return write(device, setColor(parseHex(arg)));
    case 'brightness':
      if (!device || !arg) break;
      return write(device, setBrightness(Number(arg)));
    case 'raw':
      if (!device || !arg) break;
      return write(device, parseBytes(arg));
  }
  console.log(usage);
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`\nError: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
