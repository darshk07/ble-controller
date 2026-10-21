// Turns captured screen pixels and audio spectra into light. Pure functions and
// small state machines, no browser APIs, so they are testable and portable.

import { clamp01, hsv, toHsv } from './color.ts';
import type { Rgb } from './protocol.ts';

export interface ScreenColor {
  color: Rgb; // vivid color that represents the frame, at full value
  luminance: number; // 0..1 average brightness of the frame
}

// Weighted average that favours saturated, bright pixels, so a mostly grey
// frame with a red car reads as red rather than muddy grey. Near-black pixels
// (letterboxing, dark UI) are ignored for hue but still count for luminance.
export function screenColor(pixels: Uint8ClampedArray): ScreenColor {
  let wr = 0;
  let wg = 0;
  let wb = 0;
  let wsum = 0;
  let lum = 0;
  const count = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const max = Math.max(r, g, b);
    const v = max / 255;
    lum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (v < 0.06) continue;
    const s = (max - Math.min(r, g, b)) / max;
    const w = s * s * v + 0.03 * v;
    wr += r * w;
    wg += g * w;
    wb += b * w;
    wsum += w;
  }
  const luminance = count ? lum / count : 0;
  if (!wsum) return { color: { r: 0, g: 0, b: 0 }, luminance };
  const { h, s } = toHsv({ r: wr / wsum, g: wg / wsum, b: wb / wsum });
  return { color: hsv(h, s, 1), luminance };
}

export interface AudioFrame {
  level: number; // 0..1, loudness relative to the recent peak
  bass: number; // 0..1, relative to its recent peak
  brightness: number; // 0..1, spectral centroid: 0 = bass heavy, 1 = bright
  beat: boolean;
}

// Converts raw band energies into normalised levels and beats. Feed it once
// per frame with the time in milliseconds.
export class AudioAnalyser {
  private peak = 1e-3;
  private bassPeak = 1e-3;
  private history: number[] = [];
  private lastBeat = -Infinity;

  constructor(
    public sensitivity = 0.5, // 0..1
    private historySize = 40,
  ) {}

  update(bands: { bass: number; mid: number; treble: number }, now: number): AudioFrame {
    const energy = bands.bass + bands.mid + bands.treble;

    // Automatic gain: peaks decay slowly so quiet songs still fill the range.
    this.peak = Math.max(energy, this.peak * 0.996, 0.02);
    this.bassPeak = Math.max(bands.bass, this.bassPeak * 0.996, 0.01);

    const avg = this.history.length ? this.history.reduce((a, b) => a + b, 0) / this.history.length : bands.bass;
    this.history.push(bands.bass);
    if (this.history.length > this.historySize) this.history.shift();

    const threshold = 1.5 - this.sensitivity * 0.4; // 1.1 .. 1.5 times the recent average
    const beat =
      this.history.length >= this.historySize / 2 &&
      bands.bass > avg * threshold &&
      bands.bass > this.bassPeak * 0.3 &&
      now - this.lastBeat > 180;
    if (beat) this.lastBeat = now;

    const silent = energy < 0.01;
    return {
      level: silent ? 0 : clamp01(Math.pow(energy / this.peak, 1.4 - this.sensitivity * 0.8)),
      bass: silent ? 0 : clamp01(bands.bass / this.bassPeak),
      brightness: energy ? clamp01((bands.mid * 0.5 + bands.treble) / energy) : 0,
      beat: beat && !silent,
    };
  }
}
