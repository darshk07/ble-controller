import { useRef } from 'react';
import { css } from '../../../shared/color.ts';
import { EFFECTS, getEffect } from '../../../shared/effects.ts';
import { engine } from '../engine/engine.ts';
import { useEngine, useFrame } from '../hooks.ts';
import { Slider } from './Slider.tsx';
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

  return (
    <div className="panel">
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
