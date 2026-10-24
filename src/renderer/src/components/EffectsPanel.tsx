import { useRef } from 'react';
import { css } from '../../../shared/color.ts';
import { EFFECTS, getEffect } from '../../../shared/effects.ts';
import { engine, type EffectSource } from '../engine/engine.ts';
import { useEngine, useFrame } from '../hooks.ts';
import { Segmented } from './Segmented.tsx';
import { Slider } from './Slider.tsx';
import { StripEffectPicker } from './StripEffectPicker.tsx';
import { Swatches } from './Swatches.tsx';

export function EffectsPanel() {
  const { settings } = useEngine();
  const tiles = useRef(new Map<string, HTMLButtonElement>());

  // Every tile previews its own effect live.
  useFrame(() => {
    const t = (performance.now() / 1000) * settings.speed;
    for (const [id, el] of tiles.current) {
      el.style.setProperty('--fx', css(getEffect(id).render({ t, color: settings.color })));
    }
  });

  const source = (
    <Segmented<EffectSource>
      value={settings.effectSource}
      options={[
        { value: 'app', label: 'From the app' },
        { value: 'strip', label: 'Built into strip' },
      ]}
      onChange={(effectSource) => engine.update({ effectSource })}
    />
  );

  if (settings.effectSource === 'strip') {
    return (
      <div className="panel">
        {source}
        <p className="hint">Runs on the strip itself: perfectly smooth, and multi-color along the strip. Slide the effect code to discover more.</p>
        <StripEffectPicker />
      </div>
    );
  }

  return (
    <div className="panel">
      {source}
      <div className="effects">
        {EFFECTS.map((e) => (
          <button
            key={e.id}
            ref={(el) => {
              if (el) tiles.current.set(e.id, el);
              else tiles.current.delete(e.id);
            }}
            className={`effect ${settings.effectId === e.id ? 'selected' : ''}`}
            onClick={() => engine.update({ effectId: e.id })}
          >
            <span>{e.name}</span>
          </button>
        ))}
      </div>
      <Slider label="Speed" min={0.25} max={3} step={0.05} value={settings.speed} format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => engine.update({ speed })} />
      {getEffect(settings.effectId).usesColor && <Swatches color={settings.color} onChange={(color) => engine.update({ color })} />}
    </div>
  );
}
