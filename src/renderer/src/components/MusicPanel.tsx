import { useEffect, useRef } from 'react';
import { css, hsv, toHsv } from '../../../shared/color.ts';
import { engine, type AudioSource, type MusicStyle } from '../engine/engine.ts';
import { useEngine, useFrame } from '../hooks.ts';
import { CaptureStatus } from './CaptureStatus.tsx';
import { Segmented } from './Segmented.tsx';
import { Slider } from './Slider.tsx';
import { Swatches } from './Swatches.tsx';

const BARS = 32;

export function MusicPanel() {
  const { settings } = useEngine();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
  }, []);

  // Log-spaced spectrum bars tinted with the live output color.
  useFrame(({ spectrum, output, audio }) => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!spectrum) return;
    const w = c.width / BARS;
    // Full-value tint so bars stay visible while the strip is dim between beats.
    const { h, s } = toHsv(output);
    ctx.fillStyle = css(hsv(h, s * 0.85, 1));
    for (let i = 0; i < BARS; i++) {
      const a = Math.floor(Math.pow(spectrum.length * 0.45, i / BARS));
      const b = Math.max(a + 1, Math.floor(Math.pow(spectrum.length * 0.45, (i + 1) / BARS)));
      let peak = 0;
      for (let j = a; j < b; j++) peak = Math.max(peak, spectrum[j]);
      const h = Math.max(2, (peak / 255) * c.height);
      ctx.globalAlpha = audio?.beat ? 1 : 0.85;
      ctx.beginPath();
      ctx.roundRect(i * w + w * 0.18, c.height - h, w * 0.64, h, w * 0.32);
      ctx.fill();
    }
  });

  return (
    <div className="panel">
      <canvas ref={canvas} className="spectrum" />
      <CaptureStatus />
      <Segmented<MusicStyle>
        value={settings.musicStyle}
        options={[
          { value: 'beat', label: 'Beat' },
          { value: 'spectrum', label: 'Spectrum' },
          { value: 'pulse', label: 'Pulse' },
        ]}
        onChange={(musicStyle) => engine.update({ musicStyle })}
      />
      <p className="hint">
        {settings.musicStyle === 'beat' && 'Jumps to a new color on every beat.'}
        {settings.musicStyle === 'spectrum' && 'Bass glows warm, vocals and highs glow cool.'}
        {settings.musicStyle === 'pulse' && 'Your color, breathing with the loudness.'}
      </p>
      {settings.musicStyle === 'pulse' && <Swatches color={settings.color} onChange={(color) => engine.update({ color })} />}
      <Slider label="Sensitivity" min={0} max={1} step={0.05} value={settings.sensitivity} format={(v) => `${Math.round(v * 100)}%`} onChange={(sensitivity) => engine.update({ sensitivity })} />
      <AudioSourcePicker />
    </div>
  );
}

export function AudioSourcePicker() {
  const { settings } = useEngine();
  return (
    <Segmented<AudioSource>
      value={settings.audioSource}
      options={[
        { value: 'system', label: 'System audio' },
        { value: 'mic', label: 'Microphone' },
      ]}
      onChange={(audioSource) => engine.update({ audioSource })}
    />
  );
}
