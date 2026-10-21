import { useRef } from 'react';
import { css } from '../../../shared/color.ts';
import { useFrame } from '../hooks.ts';

// Live preview of exactly what is being sent to the strip.
export function Orb({ dim }: { dim: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useFrame(({ output }) => {
    ref.current?.style.setProperty('--out', css(output));
    document.documentElement.style.setProperty('--out', css(output));
  });
  return (
    <div className="orb-wrap" style={{ opacity: 0.3 + dim * 0.7 }}>
      <div ref={ref} className="orb" />
      <div className="orb-core" />
    </div>
  );
}
