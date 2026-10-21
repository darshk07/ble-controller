import { useEffect, useRef, useState } from 'react';
import type { ScreenInfo } from '../../../shared/ipc.ts';
import { engine } from '../engine/engine.ts';
import { useEngine } from '../hooks.ts';
import { CaptureStatus } from './CaptureStatus.tsx';
import { Segmented } from './Segmented.tsx';
import { Slider, Toggle } from './Slider.tsx';

export function ScreenPanel() {
  const { settings, capture } = useEngine();
  const video = useRef<HTMLVideoElement>(null);
  const [screens, setScreens] = useState<ScreenInfo[]>([]);

  useEffect(() => {
    void window.led.listScreens().then(setScreens).catch(() => {});
  }, []);

  useEffect(() => {
    if (video.current) video.current.srcObject = capture.state === 'running' ? engine.screenStream : null;
  }, [capture.state]);

  return (
    <div className="panel">
      <div className="screen-preview">
        <video ref={video} autoPlay muted playsInline />
        {capture.state !== 'running' && <span className="hint">Screen preview</span>}
      </div>
      <CaptureStatus />
      {screens.length > 1 && (
        <Segmented
          value={settings.screenId ?? screens[0].id}
          options={screens.map((s) => ({ value: s.id, label: s.name }))}
          onChange={(screenId) => engine.update({ screenId })}
        />
      )}
      <Slider label="Vividness" min={1} max={2} step={0.05} value={settings.vividness} format={(v) => `${Math.round((v - 1) * 100)}%`} onChange={(vividness) => engine.update({ vividness })} />
      <Slider label="Smoothing" min={0} max={1} step={0.05} value={settings.smoothing} format={(v) => `${Math.round(v * 100)}%`} onChange={(smoothing) => engine.update({ smoothing })} />
      <Toggle
        label="React to audio"
        hint="Brightness follows the sound, for films and music videos"
        checked={settings.screenAudio}
        onChange={(screenAudio) => engine.update({ screenAudio })}
      />
    </div>
  );
}
