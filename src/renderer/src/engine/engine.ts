// The light engine: turns the current mode into a stream of colors at 60 fps
// and sends them to the strip (the BLE layer forwards at most ~30/s, newest
// first), or hands animation over to the strip's own effects. Lives in the renderer because that is where the
// screen and audio capture APIs are.

import { AudioAnalyser, type AudioFrame } from '../../../shared/analysis.ts';
import { BLACK, blend, clamp01, easeInOut, hsv, round, same, saturate, scale } from '../../../shared/color.ts';
import { getEffect } from '../../../shared/effects.ts';
import type { Rgb } from '../../../shared/protocol.ts';
import { AudioTap, ScreenCapture, captureMicrophone, captureSystemAudio } from './capture.ts';

export type Mode = 'color' | 'effect' | 'screen' | 'music';
export type MusicStyle = 'pulse' | 'spectrum' | 'beat' | 'strip';
export type EffectSource = 'app' | 'strip';
export type AudioSource = 'system' | 'mic';

export interface Settings {
  mode: Mode;
  color: Rgb;
  brightness: number; // 1..100, sent as the strip's own brightness command
  effectId: string;
  speed: number; // 0.25..3
  effectSource: EffectSource; // app-rendered effects, or the strip's own
  stripEffect: number; // 0..255 code for the strip's own animation
  stripSpeed: number; // 0..100
  screenId: string | null;
  vividness: number; // 1..2, saturation boost for screen colors
  smoothing: number; // 0..1
  screenAudio: boolean; // modulate screen colors with the music
  musicStyle: MusicStyle;
  audioSource: AudioSource;
  sensitivity: number; // 0..1
}

export interface CaptureStatus {
  state: 'idle' | 'starting' | 'running' | 'error';
  error: string | null;
}

export interface EngineState {
  settings: Settings;
  capture: CaptureStatus;
}

export interface Frame {
  output: Rgb;
  audio: AudioFrame | null;
  spectrum: Uint8Array | null;
}

const DEFAULTS: Settings = {
  mode: 'color',
  color: { r: 255, g: 120, b: 30 },
  brightness: 100,
  effectId: 'rainbow',
  speed: 1,
  effectSource: 'app',
  stripEffect: 16,
  stripSpeed: 50,
  screenId: null,
  vividness: 1.4,
  smoothing: 0.6,
  screenAudio: false,
  musicStyle: 'beat',
  audioSource: 'system',
  sensitivity: 0.5,
};

const STORAGE_KEY = 'lantern.settings';
const TICK_MS = 1000 / 60;
// Smoothing constants below were tuned per frame at this rate; tick() rescales
// them to the real frame time so the feel doesn't change with the tick rate.
const TUNED_FPS = 30;
const COLOR_FADE_MS = 450;

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

export class Engine {
  state: EngineState = { settings: load(), capture: { state: 'idle', error: null } };
  frame: Frame = { output: BLACK, audio: null, spectrum: null };

  private listeners = new Set<() => void>();
  private frameListeners = new Set<(f: Frame) => void>();

  private screen: ScreenCapture | null = null;
  private audio: AudioTap | null = null;
  private analyser = new AudioAnalyser(0.5, 40, 1000 / TICK_MS);
  private captureKey = 'none';
  private captureRun = 0;

  private effectTime = 0;
  private last = performance.now();
  private sent: Rgb | null = null;
  private beatHue = Math.random();
  private beatEnv = 0;
  private fade: { from: Rgb; to: Rgb; start: number } | null = null;
  private stripKey: string | null = null;
  private sentBrightness: number | null = null;

  constructor() {
    setInterval(() => this.tick(), TICK_MS);
    void this.reconcile();
  }

  // React subscription (settings and capture status).
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = () => this.state;

  // Per-frame subscription for previews; does not re-render React.
  onFrame(listener: (f: Frame) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  get screenStream(): MediaStream | null {
    return this.screen?.stream ?? null;
  }

  update(patch: Partial<Settings>): void {
    const prev = this.state.settings;
    const settings = { ...prev, ...patch };
    this.setState({ settings });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Settings just won't persist.
    }
    if (patch.sensitivity !== undefined) this.analyser.sensitivity = settings.sensitivity;
    void this.reconcile();
  }

  // Re-send everything after (re)connecting.
  resync(): void {
    this.sent = null;
    this.stripKey = null;
    this.sentBrightness = null;
  }

  retryCapture(): void {
    this.captureKey = 'retry';
    void this.reconcile();
  }

  private setState(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private wantedCapture(s: Settings): string {
    if (s.mode === 'screen') return `screen:${s.screenId}:${s.screenAudio ? s.audioSource : 'none'}`;
    if (s.mode === 'music') return `music:${s.audioSource}`;
    return 'none';
  }

  // Starts or stops capture to match the current settings.
  private async reconcile(): Promise<void> {
    const s = this.state.settings;
    const key = this.wantedCapture(s);
    if (key === this.captureKey) return;
    this.captureKey = key;
    const run = ++this.captureRun;

    this.stopCapture();
    void window.led.setLive(s.mode !== 'color');
    if (key === 'none') return this.setState({ capture: { state: 'idle', error: null } });

    this.setState({ capture: { state: 'starting', error: null } });
    let screen: ScreenCapture | null = null;
    let audio: AudioTap | null = null;
    try {
      await window.led.setCaptureScreen(s.screenId);
      if (s.mode === 'screen') {
        screen = await ScreenCapture.start(s.screenAudio && s.audioSource === 'system');
        if (s.screenAudio) audio = new AudioTap(s.audioSource === 'system' ? screen.stream : await captureMicrophone());
      } else {
        audio = new AudioTap(s.audioSource === 'system' ? await captureSystemAudio() : await captureMicrophone());
      }
      if (run !== this.captureRun) throw new Error('superseded');
      this.screen = screen;
      this.audio = audio;
      this.analyser = new AudioAnalyser(s.sensitivity, 40, 1000 / TICK_MS);
      this.setState({ capture: { state: 'running', error: null } });
    } catch (err) {
      screen?.stop();
      audio?.stream.getTracks().forEach((t) => t.stop());
      audio?.stop();
      if (run !== this.captureRun) return;
      this.setState({ capture: { state: 'error', error: describe(err) } });
    }
  }

  private stopCapture(): void {
    this.screen?.stop();
    this.audio?.stream.getTracks().forEach((t) => t.stop());
    this.audio?.stop();
    this.screen = null;
    this.audio = null;
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const s = this.state.settings;

    const audio = this.audio ? this.analyser.update(this.audio.bands(), now) : null;
    let target: Rgb = this.frame.output;
    let alpha = 1;

    switch (s.mode) {
      case 'color': {
        // Timed, eased crossfade. A new color mid-fade starts from wherever
        // the light is right now, so dragging the wheel stays continuous.
        if (!this.fade || !same(this.fade.to, s.color)) {
          this.fade = { from: this.frame.output, to: s.color, start: now };
        }
        const t = easeInOut((now - this.fade.start) / COLOR_FADE_MS);
        target = blend(this.fade.from, this.fade.to, t);
        break;
      }
      case 'effect':
        if (s.effectSource === 'strip') break; // the strip animates itself
        this.effectTime += dt * s.speed;
        target = getEffect(s.effectId).render({ t: this.effectTime, color: s.color });
        break;
      case 'screen': {
        const sample = this.screen?.sample();
        if (sample) {
          const value = clamp01(Math.pow(sample.luminance, 0.7) * 1.6);
          target = scale(saturate(sample.color, s.vividness), value);
          if (audio) target = scale(target, 0.3 + 0.7 * Math.max(audio.level, audio.beat ? 1 : 0));
        }
        alpha = 1 - s.smoothing * 0.9;
        break;
      }
      case 'music':
        if (audio) target = this.musicColor(s, audio, dt, now);
        // Fast attack, slower release, like a VU meter.
        alpha = brightness(target) > brightness(this.frame.output) ? 0.75 : 0.25;
        break;
    }

    if (s.mode !== 'color') this.fade = null;
    const k = alpha >= 1 ? 1 : 1 - Math.pow(1 - alpha, dt * TUNED_FPS);
    const output = blend(this.frame.output, target, k);
    this.frame = { output, audio, spectrum: this.audio?.spectrum ?? null };
    this.frameListeners.forEach((l) => l(this.frame));

    // The strip's own animation: start it once, and stop streaming colors
    // over it. Leaving it re-sends the current color.
    const strip = (s.mode === 'effect' && s.effectSource === 'strip') || (s.mode === 'music' && s.musicStyle === 'strip');
    if (strip) {
      const key = `${s.stripEffect}:${s.stripSpeed}`;
      if (key !== this.stripKey) {
        this.stripKey = key;
        void window.led.setStripEffect(s.stripEffect, s.stripSpeed).catch(() => {});
      }
    } else if (this.stripKey !== null) {
      this.stripKey = null;
      this.sent = null;
    }

    // Hardware brightness. In strip-music mode it follows the music while the
    // strip animates by itself, so the animation stays smooth at any BLE rate.
    let percent = s.brightness;
    if (s.mode === 'music' && s.musicStyle === 'strip') {
      percent = Math.max(1, Math.round(s.brightness * (0.08 + 0.92 * (brightness(output) / 255))));
    }
    if (percent !== this.sentBrightness) {
      this.sentBrightness = percent;
      void window.led.setBrightness(percent).catch(() => {});
    }

    const rounded = round(output);
    if (!strip && (!this.sent || !same(rounded, this.sent))) {
      this.sent = rounded;
      window.led.sendFrame(rounded);
    }
  }

  private musicColor(s: Settings, a: AudioFrame, dt: number, now: number): Rgb {
    switch (s.musicStyle) {
      case 'strip':
        // Only the envelope matters (it drives brightness); the hue just
        // gives the preview some motion.
        if (a.beat) this.beatEnv = 1;
        else this.beatEnv *= Math.pow(0.9, dt * TUNED_FPS);
        return hsv(now / 6000, 0.8, 0.1 + 0.9 * Math.max(this.beatEnv, a.level));
      case 'pulse':
        return scale(s.color, 0.04 + 0.96 * Math.max(a.level, a.beat ? 1 : 0));
      case 'spectrum':
        // Bass-heavy sound reads warm, bright sound reads cool.
        return hsv(a.brightness * 0.75, 1, 0.04 + 0.96 * a.level);
      case 'beat':
        if (a.beat) {
          this.beatHue = (this.beatHue + 0.618) % 1;
          this.beatEnv = 1;
        } else {
          this.beatEnv *= Math.pow(0.9, dt * TUNED_FPS);
        }
        return hsv(this.beatHue, 1, Math.max(this.beatEnv, 0.25 * a.level));
    }
  }
}

function brightness(c: Rgb): number {
  return Math.max(c.r, c.g, c.b);
}

function describe(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return window.led.platform === 'darwin'
      ? 'Permission denied. Allow Electron (or your terminal) under System Settings → Privacy & Security → Screen & System Audio Recording, then retry.'
      : 'Permission denied by the system.';
  }
  return err instanceof Error ? err.message : String(err);
}

export const engine = new Engine();
