interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?(value: number): string;
  onChange(value: number): void;
}

export function Slider({ label, value, min, max, step = 1, format = String, onChange }: Props) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider-field">
      <span className="slider-label">
        {label}
        <span className="value">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <button className="toggle-field" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className={`toggle ${checked ? 'on' : ''}`} />
    </button>
  );
}
