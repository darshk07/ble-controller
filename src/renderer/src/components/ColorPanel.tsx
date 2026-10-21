import { engine } from '../engine/engine.ts';
import { useEngine } from '../hooks.ts';
import { ColorWheel } from './ColorWheel.tsx';
import { Swatches } from './Swatches.tsx';

export function ColorPanel() {
  const { settings } = useEngine();
  const set = (color: typeof settings.color) => engine.update({ color });
  return (
    <div className="panel">
      <ColorWheel color={settings.color} onChange={set} />
      <Swatches color={settings.color} onChange={set} />
    </div>
  );
}
