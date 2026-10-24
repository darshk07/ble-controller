import { STRIP_EFFECTS } from '../../../shared/protocol.ts';
import { engine } from '../engine/engine.ts';
import { useEngine } from '../hooks.ts';
import { Slider } from './Slider.tsx';

// Animations that run inside the strip's controller: smooth at any Bluetooth
// rate and able to put different colors on different LEDs.
export function StripEffectPicker() {
  const { settings } = useEngine();
  const named = STRIP_EFFECTS.find((e) => e.code === settings.stripEffect);
  return (
    <>
      <div className="strip-effects">
        {STRIP_EFFECTS.map((e) => (
          <button
            key={e.code}
            className={`chip ${settings.stripEffect === e.code ? 'selected' : ''}`}
            onClick={() => engine.update({ stripEffect: e.code })}
          >
            {e.name}
          </button>
        ))}
      </div>
      <Slider
        label="Effect code"
        min={0}
        max={255}
        value={settings.stripEffect}
        format={(v) => `${v}${named ? ` · ${named.name}` : ''}`}
        onChange={(stripEffect) => engine.update({ stripEffect })}
      />
      <Slider label="Strip speed" min={0} max={100} value={settings.stripSpeed} format={(v) => `${v}%`} onChange={(stripSpeed) => engine.update({ stripSpeed })} />
    </>
  );
}
