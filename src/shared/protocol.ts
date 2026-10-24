// Magic Lantern / MELK BLE protocol.
// Plain TypeScript, no Node or Electron imports, so the Android app can reuse it.
//
// Source: Home Assistant community reverse engineering. Commands marked
// VERIFIED have been tested on Darsh's strip; anything else has not.

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

// VERIFIED (macOS): 7E 07 05 03 RR GG BB 10 EF
export function setColor({ r, g, b }: Rgb): Uint8Array {
  return Uint8Array.of(START, 0x07, 0x05, 0x03, byte(r), byte(g), byte(b), 0x10, END);
}

// VERIFIED (macOS): 7E 04 01 BB 01 FF FF 00 EF, BB = 0..100
export function setBrightness(percent: number): Uint8Array {
  return Uint8Array.of(START, 0x04, 0x01, byte(percent, 100), 0x01, 0xff, 0xff, 0x00, END);
}

// The commands below are UNVERIFIED on this strip. They come from the MELK-Ox
// profile (MELK-OA10/OC10/OF10/OG10) in the elkbledom Home Assistant
// integration and the neon-lights project, whose brightness frame matches the
// verified one above. Test with `npm run probe` before relying on them.

export const NOTIFY_CHAR_UUID = 'fff4';

export function setPower(on: boolean): Uint8Array {
  return on
    ? Uint8Array.of(START, 0x04, 0x04, 0xf0, 0x00, 0x01, 0xff, 0x00, END)
    : Uint8Array.of(START, 0x04, 0x04, 0x00, 0x00, 0x00, 0xff, 0x00, END);
}

// Starts an animation that runs inside the strip's controller. These are
// rendered per LED at the controller's own frame rate, so they are perfectly
// smooth and can show several colors along the strip at once, which streamed
// color commands cannot. Codes are one byte; see STRIP_EFFECTS.
export function setStripEffect(code: number): Uint8Array {
  return Uint8Array.of(START, 0x05, 0x03, byte(code), 0x06, 0xff, 0xff, 0x00, END);
}

// Speed of the strip's own animations, 0..100.
export function setStripSpeed(percent: number): Uint8Array {
  return Uint8Array.of(START, 0x04, 0x02, byte(percent, 100), 0xff, 0xff, 0xff, 0x00, END);
}

// Music modes driven by a microphone on the controller (if it has one), 0x80..0x87.
export function setMicEffect(code: number): Uint8Array {
  return Uint8Array.of(START, 0x05, 0x03, byte(code), 0x04, 0xff, 0xff, 0x00, END);
}

export function setMicSensitivity(percent: number): Uint8Array {
  return Uint8Array.of(START, 0x04, 0x06, byte(percent, 100), 0xff, 0xff, 0xff, 0x00, END);
}

// Asks the controller to report its state on NOTIFY_CHAR_UUID.
export function queryState(): Uint8Array {
  return Uint8Array.of(START, 0x00, 0x01, 0xfa, 0x00, 0x00, 0x00, 0x00, END);
}

// Named codes known for MELK-Ox controllers. The byte has 256 values and the
// Magic Lantern app lists far more modes; `npm run probe -- sweep` walks them
// so new ones can be named here.
export const STRIP_EFFECTS: { code: number; name: string }[] = [
  { code: 0, name: 'Auto play' },
  { code: 1, name: 'Magic back' },
  { code: 2, name: 'Effect 2' },
  { code: 3, name: 'Effect 3' },
  { code: 4, name: 'Effect 4' },
  { code: 5, name: 'Effect 5' },
  { code: 16, name: 'Rainbow cycle' },
  { code: 32, name: 'Color wave' },
  { code: 48, name: 'Breathing' },
  { code: 64, name: 'Strobe' },
  { code: 128, name: 'Jump RGB' },
  { code: 144, name: 'Fade RGB' },
  { code: 207, name: 'Blue scroll' },
];

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
