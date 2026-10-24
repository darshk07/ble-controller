// Color math shared by effects, screen sync and music sync. Channels are 0..255,
// hue/saturation/value are 0..1.

import type { Rgb } from './protocol.ts';

export const BLACK: Rgb = { r: 0, g: 0, b: 0 };

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function hsv(h: number, s: number, v: number): Rgb {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6];
  return { r: r * 255, g: g * 255, b: b * 255 };
}

export function toHsv({ r, g, b }: Rgb): { h: number; s: number; v: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: h / 6, s: max ? d / max : 0, v: max };
}

export function scale(c: Rgb, k: number): Rgb {
  return { r: c.r * k, g: c.g * k, b: c.b * k };
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

// Like mix, but keeps brightness (the max channel) moving linearly too, so
// red→blue passes through a full purple instead of dipping to a dim one.
export function blend(a: Rgb, b: Rgb, t: number): Rgb {
  const m = mix(a, b, t);
  const peak = Math.max(m.r, m.g, m.b);
  if (!peak) return m;
  const want = Math.max(a.r, a.g, a.b) + (Math.max(b.r, b.g, b.b) - Math.max(a.r, a.g, a.b)) * t;
  return scale(m, want / peak);
}

export function easeInOut(t: number): number {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
}

// Cosine-eased walk through a looping palette; t in palette steps.
export function palette(colors: Rgb[], t: number): Rgb {
  const n = colors.length;
  const i = ((Math.floor(t) % n) + n) % n;
  const f = t - Math.floor(t);
  return mix(colors[i], colors[(i + 1) % n], 0.5 - 0.5 * Math.cos(f * Math.PI));
}

export function saturate(c: Rgb, amount: number): Rgb {
  const { h, s, v } = toHsv(c);
  return hsv(h, clamp01(s * amount), v);
}

export function round(c: Rgb): Rgb {
  return { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) };
}

export function same(a: Rgb, b: Rgb): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

export function css(c: Rgb): string {
  return `rgb(${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)})`;
}

export function hex(c: Rgb): string {
  return '#' + [c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}
