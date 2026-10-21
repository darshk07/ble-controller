import { useEffect, useRef } from 'react';
import { css, hsv, toHsv } from '../../../shared/color.ts';
import type { Rgb } from '../../../shared/protocol.ts';

const SIZE = 220;

// Hue around the rim, saturation towards the centre. Value stays at full
// because the strip's brightness slider handles that.
export function ColorWheel({ color, onChange }: { color: Rgb; onChange(c: Rgb): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = SIZE * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const r = SIZE / 2;
    const hue = ctx.createConicGradient(-Math.PI / 2, r, r);
    for (let i = 0; i <= 12; i++) hue.addColorStop(i / 12, css(hsv(i / 12, 1, 1)));
    ctx.fillStyle = hue;
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.fill();
    const white = ctx.createRadialGradient(r, r, 0, r, r, r);
    white.addColorStop(0, 'rgba(255,255,255,1)');
    white.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = white;
    ctx.fill();
  }, []);

  const pick = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const s = Math.min(1, Math.hypot(x, y) / (rect.width / 2));
    const h = (Math.atan2(x, -y) / (Math.PI * 2) + 1) % 1;
    onChange(hsv(h, s, 1));
  };

  const { h, s } = toHsv(color);
  const angle = h * Math.PI * 2;
  const knob = { left: `${50 + Math.sin(angle) * s * 50}%`, top: `${50 - Math.cos(angle) * s * 50}%` };

  return (
    <div
      className="wheel"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => e.buttons && pick(e)}
    >
      <canvas ref={canvas} />
      <div className="wheel-knob" style={{ ...knob, background: css(hsv(h, s, 1)) }} />
    </div>
  );
}
