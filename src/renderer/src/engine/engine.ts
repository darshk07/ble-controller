// The light engine: turns the current mode into a stream of colors at 30 fps
// and sends them to the strip. Lives in the renderer because that is where the
// screen and audio capture APIs are.

import { AudioAnalyser, type AudioFrame } from '../../../shared/analysis.ts';
import { BLACK, clamp01, hsv, mix, round, same, saturate, scale } from '../../../shared/color.ts';
import { getEffect } from '../../../shared/effects.ts';
import type { Rgb } from '../../../shared/protocol.ts';
import { AudioTap, ScreenCapture, captureMicrophone, captureSystemAudio } from './capture.ts';

export type Mode = 'color' | 'effect' | 'screen' | 'music';
export type MusicStyle = 'pulse' | 'spectrum' | 'beat';
export type AudioSource = 'system' | 'mic';

export interface Settings {
  mode: Mode;
  color: Rgb;
  brightness: number; // 1..100, sent as the strip's own brightness command
  effectId: string;
  speed: number; // 0.25..3
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
  screenId: null,
  vividness: 1.4,
  smoothing: 0.6,
  screenAudio: false,
  musicStyle: 'beat',
  audioSource: 'system',
  sensitivity: 0.5,
};

const STORAGE_KEY = 'lantern.settings';
const TICK_MS = 33;

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
  private analyser = new AudioAnalyser();
  private captureKey = 'none';
  private captureRun = 0;

  private effectTime = 0;
  private last = performance.now();
  private sent: Rgb | null = null;
  private beatHue = Math.random();
  private beatEnv = 0;

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
    if (patch.brightness !== undefined && patch.brightness !== prev.brightness) {
      void window.led.setBrightness(settings.brightness).catch(() => {});
    }
    if (patch.sensitivity !== undefined) this.analyser.sensitivity = settings.sensitivity;
    void this.reconcile();
  }

  // Re-send everything after (re)connecting.
  resync(): void {
    this.sent = null;
    void window.led.setBrightness(this.state.settings.brightness).catch(() => {});
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
      this.analyser = new AudioAnalyser(s.sensitivity);
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
      case 'color':
        target = s.color;
        alpha = 0.18; // fade between colors instead of jumping
        break;
      case 'effect':
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
        if (audio) target = this.musicColor(s, audio);
        // Fast attack, slower release, like a VU meter.
        alpha = brightness(target) > brightness(this.frame.output) ? 0.75 : 0.25;
        break;
    }

    const output = mix(this.frame.output, target, alpha);
    this.frame = { output, audio, spectrum: this.audio?.spectrum ?? null };
    this.frameListeners.forEach((l) => l(this.frame));

    const rounded = round(output);
    if (!this.sent || !same(rounded, this.sent)) {
      this.sent = rounded;
      window.led.sendFrame(rounded);
    }
  }

  private musicColor(s: Settings, a: AudioFrame): Rgb {
    switch (s.musicStyle) {
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
          this.beatEnv *= 0.9;
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
