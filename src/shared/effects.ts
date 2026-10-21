// App-driven animations. Each effect is a pure function of time, so the same
// definitions can drive the desktop app, the Android app and the UI previews.

import { clamp01, hsv, palette, scale } from './color.ts';
import type { Rgb } from './protocol.ts';

export interface EffectInput {
  t: number; // seconds, already multiplied by the speed setting
  color: Rgb; // the user's chosen color, for effects that use one
}

export interface Effect {
  id: string;
  name: string;
  usesColor: boolean;
  render(input: EffectInput): Rgb;
}

const rgb = (hex: number): Rgb => ({ r: hex >> 16, g: (hex >> 8) & 0xff, b: hex & 0xff });

const SUNSET = [0xff3d00, 0xff006e, 0x8338ec, 0xff7b00].map(rgb);
const OCEAN = [0x00b4d8, 0x0047ff, 0x3a0ca3, 0x00f5d4].map(rgb);
const AURORA = [0x00ff87, 0x00c2ff, 0x7b2ff7, 0x19ff6a].map(rgb);

// Smooth deterministic noise in 0..1, so flicker effects are pure functions of time.
function noise(t: number): number {
  const hash = (n: number) => {
    const x = Math.sin(n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  };
  const i = Math.floor(t);
  const f = t - i;
  return hash(i) + (hash(i + 1) - hash(i)) * f * f * (3 - 2 * f);
}

export const EFFECTS: Effect[] = [
  {
    id: 'rainbow',
    name: 'Rainbow',
    usesColor: false,
    render: ({ t }) => hsv(t * 0.08, 1, 1),
  },
  {
    id: 'breathe',
    name: 'Breathe',
    usesColor: true,
    render: ({ t, color }) => scale(color, 0.06 + 0.94 * Math.pow(0.5 - 0.5 * Math.cos(t * Math.PI * 0.5), 1.8)),
  },
  {
    id: 'heartbeat',
    name: 'Heartbeat',
    usesColor: true,
    render: ({ t, color }) => {
      const p = (t * 0.9) % 1;
      const beat = (at: number, size: number) => size * Math.exp(-Math.pow((p - at) * 22, 2));
      return scale(color, 0.12 + 0.88 * clamp01(beat(0.1, 1) + beat(0.3, 0.7)));
    },
  },
  {
    id: 'candle',
    name: 'Candle',
    usesColor: false,
    render: ({ t }) => {
      const flicker = 0.55 * noise(t * 7) + 0.3 * noise(t * 17 + 40) + 0.15 * noise(t * 2 + 90);
      return hsv(0.07 + 0.02 * noise(t * 3), 0.92, 0.35 + 0.65 * flicker);
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    usesColor: false,
    render: ({ t }) => palette(SUNSET, t * 0.15),
  },
  {
    id: 'ocean',
    name: 'Ocean',
    usesColor: false,
    render: ({ t }) => scale(palette(OCEAN, t * 0.12), 0.75 + 0.25 * noise(t * 1.3)),
  },
  {
    id: 'aurora',
    name: 'Aurora',
    usesColor: false,
    render: ({ t }) => scale(palette(AURORA, t * 0.1 + 0.6 * noise(t * 0.4)), 0.6 + 0.4 * noise(t * 0.9 + 7)),
  },
  {
    id: 'strobe',
    name: 'Strobe',
    usesColor: true,
    render: ({ t, color }) => ((t * 4) % 1 < 0.5 ? color : { r: 0, g: 0, b: 0 }),
  },
];

export function getEffect(id: string): Effect {
  return EFFECTS.find((e) => e.id === id) ?? EFFECTS[0];
}
