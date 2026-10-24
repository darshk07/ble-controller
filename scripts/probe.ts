// Phase 1: prove the connection with a bare Node script.
//
//   npm run probe -- scan [seconds]
//   npm run probe -- inspect <device>
//   npm run probe -- color <device> <rrggbb>
//   npm run probe -- brightness <device> <0-100>
//   npm run probe -- raw <device> "<hex bytes>"
//   npm run probe -- power <device> on|off
//   npm run probe -- effect <device> <code 0-255>
//   npm run probe -- speed <device> <0-100>
//   npm run probe -- sweep <device> [from] [to] [seconds]   walk the strip's built-in effects
//   npm run probe -- listen <device> [seconds]              print what the strip reports on FFF4
//
// <device> is an id, MAC address, or part of the advertised name, as shown by `scan`.

import noble, { type Characteristic, type Peripheral } from '@stoprocent/noble';
import {
  NOTIFY_CHAR_UUID,
  SERVICE_UUID,
  STRIP_EFFECTS,
  WRITE_CHAR_UUID,
  parseBytes,
  parseHex,
  queryState,
  setBrightness,
  setColor,
  setPower,
  setStripEffect,
  setStripSpeed,
  toHex,
} from '../src/shared/protocol.ts';

const usage = `Usage:
  npm run probe -- scan [seconds]
  npm run probe -- inspect <device>
  npm run probe -- color <device> <rrggbb>
  npm run probe -- brightness <device> <0-100>
  npm run probe -- raw <device> "<hex bytes>"
  npm run probe -- power <device> on|off
  npm run probe -- effect <device> <code 0-255>
  npm run probe -- speed <device> <0-100>
  npm run probe -- sweep <device> [from=0] [to=255] [seconds=4]
  npm run probe -- listen <device> [seconds=10]`;

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withWriter(query: string, fn: (send: (bytes: Uint8Array) => Promise<void>, p: Peripheral) => Promise<void>): Promise<void> {
  const p = await connect(query);
  try {
    const { characteristics } = await p.discoverSomeServicesAndCharacteristicsAsync([SERVICE_UUID], [WRITE_CHAR_UUID]);
    const ch: Characteristic | undefined = characteristics[0];
    if (!ch) throw new Error(`Service ${SERVICE_UUID} / characteristic ${WRITE_CHAR_UUID} not found. Run "inspect" to see what the strip exposes.`);
    const withoutResponse = !ch.properties.includes('write');
    console.log(`Using ${ch.uuid} (${withoutResponse ? 'without' : 'with'} response, props: ${ch.properties.join(', ')})`);
    await fn(async (bytes) => {
      console.log(`→ ${toHex(bytes)}`);
      await ch.writeAsync(Buffer.from(bytes), withoutResponse);
    }, p);
    // Give a write-without-response time to leave the radio before disconnecting.
    await sleep(500);
  } finally {
    await p.disconnectAsync();
  }
}

async function write(query: string, bytes: Uint8Array): Promise<void> {
  await withWriter(query, async (send) => {
    await send(bytes);
    console.log('Write OK. Did the strip change?');
  });
}

// Walks effect codes one by one so unnamed ones can be identified by eye.
async function sweep(query: string, from: number, to: number, seconds: number): Promise<void> {
  const names = new Map(STRIP_EFFECTS.map((e) => [e.code, e.name]));
  await withWriter(query, async (send) => {
    await send(setStripSpeed(50));
    for (let code = from; code <= to; code++) {
      const name = names.get(code);
      console.log(`
Effect ${code} (0x${code.toString(16).padStart(2, '0')})${name ? ` "${name}"` : ''}`);
      await send(setStripEffect(code));
      await sleep(seconds * 1000);
    }
  });
}

// Subscribes to the notify characteristic, asks for state, and prints replies.
async function listen(query: string, seconds: number): Promise<void> {
  const p = await connect(query);
  try {
    const { characteristics } = await p.discoverSomeServicesAndCharacteristicsAsync([SERVICE_UUID], [WRITE_CHAR_UUID, NOTIFY_CHAR_UUID]);
    const writer = characteristics.find((c) => c.uuid === WRITE_CHAR_UUID);
    const notifier = characteristics.find((c) => c.uuid === NOTIFY_CHAR_UUID);
    if (!notifier) throw new Error(`No ${NOTIFY_CHAR_UUID} characteristic. Run "inspect" to see what the strip exposes.`);
    notifier.on('data', (data: Buffer) => console.log(`← ${toHex(data)}`));
    await notifier.subscribeAsync();
    console.log(`Listening on ${NOTIFY_CHAR_UUID} for ${seconds}s. Change things with the remote or buttons to see more.`);
    if (writer) {
      console.log(`→ ${toHex(queryState())} (state query)`);
      await writer.writeAsync(Buffer.from(queryState()), !writer.properties.includes('write'));
    }
    await sleep(seconds * 1000);
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
    case 'power':
      if (!device || (arg !== 'on' && arg !== 'off')) break;
      return write(device, setPower(arg === 'on'));
    case 'effect':
      if (!device || !arg) break;
      return write(device, setStripEffect(Number(arg)));
    case 'speed':
      if (!device || !arg) break;
      return write(device, setStripSpeed(Number(arg)));
    case 'sweep': {
      if (!device) break;
      const [from = 0, to = 255, seconds = 4] = process.argv.slice(4).map(Number);
      return sweep(device, from, to, seconds);
    }
    case 'listen':
      if (!device) break;
      return listen(device, Number(arg) || 10);
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
