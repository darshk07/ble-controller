// Browser capture APIs: screen frames, system audio and the microphone.
// The main process answers getDisplayMedia without a picker (see handleDisplayMedia).

import { screenColor, type ScreenColor } from '../../../shared/analysis.ts';

const SAMPLE_W = 64;
const SAMPLE_H = 36;

export class ScreenCapture {
  private canvas = new OffscreenCanvas(SAMPLE_W, SAMPLE_H);
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  readonly video = document.createElement('video');

  private constructor(readonly stream: MediaStream) {
    this.video.muted = true;
    this.video.srcObject = stream;
    void this.video.play();
  }

  static async start(withAudio: boolean): Promise<ScreenCapture> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30, width: { ideal: 640 } },
      audio: withAudio,
    });
    if (withAudio) assertAudio(stream);
    return new ScreenCapture(stream);
  }

  sample(): ScreenColor | null {
    if (this.video.readyState < 2) return null;
    this.ctx.drawImage(this.video, 0, 0, SAMPLE_W, SAMPLE_H);
    return screenColor(this.ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data);
  }

  stop(): void {
    this.stream.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
  }
}

// System audio needs a display capture; the video track is kept at a trickle
// because stopping it can end the audio capture on some platforms.
export async function captureSystemAudio(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 1, width: { ideal: 64 } },
    audio: true,
  });
  assertAudio(stream);
  return stream;
}

export function captureMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
}

function assertAudio(stream: MediaStream): void {
  const track = stream.getAudioTracks()[0];
  if (!track || track.readyState === 'ended') {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(
      'System audio is not available. On macOS 14.2+ allow it under Privacy & Security → Screen & System Audio Recording, or switch to Microphone.',
    );
  }
}

export interface Bands {
  bass: number;
  mid: number;
  treble: number;
}

export class AudioTap {
  private ctx = new AudioContext();
  private analyser = this.ctx.createAnalyser();
  readonly spectrum: Uint8Array<ArrayBuffer>;

  constructor(readonly stream: MediaStream) {
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.55;
    this.ctx.createMediaStreamSource(stream).connect(this.analyser);
    this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);
  }

  bands(): Bands {
    this.analyser.getByteFrequencyData(this.spectrum);
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    const band = (lo: number, hi: number) => {
      const a = Math.max(1, Math.floor(lo / hz));
      const b = Math.min(this.spectrum.length, Math.ceil(hi / hz));
      let sum = 0;
      for (let i = a; i < b; i++) sum += this.spectrum[i];
      return b > a ? sum / (b - a) / 255 : 0;
    };
    return { bass: band(30, 160), mid: band(160, 2000), treble: band(2000, 10000) };
  }

  stop(): void {
    void this.ctx.close();
  }
}
