import { css, hex, same } from '../../../shared/color.ts';
import { parseHex, type Rgb } from '../../../shared/protocol.ts';

export const PRESETS = ['#ff2a1f', '#ff7a1a', '#ffd60a', '#2bff6a', '#00e5d4', '#0a84ff', '#6b4dff', '#d24dff', '#ff2d78', '#fff1e0'].map(parseHex);

export function Swatches({ color, onChange }: { color: Rgb; onChange(c: Rgb): void }) {
  return (
    <div className="swatches">
      {PRESETS.map((c) => (
        <button
          key={hex(c)}
          className={`swatch ${same(c, color) ? 'selected' : ''}`}
          style={{ background: css(c), color: css(c) }}
          onClick={() => onChange(c)}
          aria-label={hex(c)}
        />
      ))}
    </div>
  );
}
