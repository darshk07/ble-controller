// Magic Lantern / MELK BLE protocol.
// Plain TypeScript, no Node or Electron imports, so the Android app can reuse it.
//
// Source: Home Assistant community reverse engineering. Verify each command
// against the real strip before trusting it; anything marked UNVERIFIED below
// has not been tested yet.

export const SERVICE_UUID = 'fff0';
export const WRITE_CHAR_UUID = 'fff3';

const START = 0x7e;
const END = 0xef;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

function byte(value: number, max = 255): number {
  if (!Number.isFinite(value)) throw new RangeError(`Not a number: ${value}`);
  return Math.max(0, Math.min(max, Math.round(value)));
}

// UNVERIFIED: 7E 07 05 03 RR GG BB 10 EF
export function setColor({ r, g, b }: Rgb): Uint8Array {
  return Uint8Array.of(START, 0x07, 0x05, 0x03, byte(r), byte(g), byte(b), 0x10, END);
}

// UNVERIFIED: 7E 04 01 BB 01 FF FF 00 EF, BB = 0..100
export function setBrightness(percent: number): Uint8Array {
  return Uint8Array.of(START, 0x04, 0x01, byte(percent, 100), 0x01, 0xff, 0xff, 0x00, END);
}

// Power, mode and speed bytes are not documented yet. Capture them from the
// stock app before adding them here.

export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`Expected a colour like ff8800, got "${hex}"`);
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

// Parses raw bytes like "7e 07 05 03 ff 00 00 10 ef" or "7e070503ff000010ef".
export function parseBytes(text: string): Uint8Array {
  const clean = text.replace(/0x/gi, '').replace(/[\s,:-]/g, '');
  if (!/^([0-9a-f]{2})+$/i.test(clean)) throw new Error(`Not a hex byte string: "${text}"`);
  return Uint8Array.from(clean.match(/../g)!, (h) => parseInt(h, 16));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
