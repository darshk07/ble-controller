import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioAnalyser, screenColor } from './analysis.ts';
import { toHsv } from './color.ts';
import { EFFECTS } from './effects.ts';

function frame(pixels: [number, number, number][]): Uint8ClampedArray {
  return Uint8ClampedArray.from(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));
}

test('screenColor picks the saturated color over grey and black', () => {
  const pixels: [number, number, number][] = [
    ...Array(80).fill([120, 120, 120]),
    ...Array(40).fill([0, 0, 0]),
    ...Array(10).fill([220, 30, 30]),
  ];
  const { color, luminance } = screenColor(frame(pixels));
  const { h, s, v } = toHsv(color);
  assert.ok(h < 0.03 || h > 0.97, `expected red, got hue ${h}`);
  assert.ok(s > 0.6);
  assert.equal(v, 1);
  assert.ok(luminance > 0.2 && luminance < 0.5);
});

test('screenColor returns black for a black frame', () => {
  const { color, luminance } = screenColor(frame(Array(20).fill([2, 2, 2])));
  assert.deepEqual(color, { r: 0, g: 0, b: 0 });
  assert.ok(luminance < 0.01);
});

test('AudioAnalyser finds beats on bass spikes and stays quiet in silence', () => {
  const a = new AudioAnalyser(0.5);
  let beats = 0;
  for (let i = 0; i < 300; i++) {
    const kick = i % 15 === 0; // a kick every 500 ms at 30 fps
    const f = a.update({ bass: kick ? 0.8 : 0.2, mid: 0.2, treble: 0.1 }, i * 33);
    if (f.beat) beats++;
  }
  assert.ok(beats >= 15 && beats <= 20, `expected ~19 beats, got ${beats}`);

  const quiet = new AudioAnalyser();
  for (let i = 0; i < 100; i++) {
    const f = quiet.update({ bass: 0, mid: 0, treble: 0 }, i * 33);
    assert.equal(f.beat, false);
    assert.equal(f.level, 0);
  }
});

test('every effect returns valid channels over time', () => {
  for (const e of EFFECTS) {
    for (let t = 0; t < 30; t += 0.37) {
      const c = e.render({ t, color: { r: 255, g: 100, b: 0 } });
      for (const v of [c.r, c.g, c.b]) assert.ok(v >= 0 && v <= 255.0001 && Number.isFinite(v), `${e.id} at ${t}: ${v}`);
    }
  }
});
