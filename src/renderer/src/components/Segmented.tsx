interface Props<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
  size?: 'large' | 'small';
}

export function Segmented<T extends string>({ value, options, onChange, size = 'small' }: Props<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={`segmented ${size}`} style={{ '--count': options.length, '--index': index } as React.CSSProperties}>
      <div className="segmented-thumb" />
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
