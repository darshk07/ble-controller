import { engine } from '../engine/engine.ts';
import { useEngine } from '../hooks.ts';

export function CaptureStatus() {
  const { capture } = useEngine();
  if (capture.state === 'starting') return <p className="hint">Starting capture…</p>;
  if (capture.state !== 'error') return null;
  return (
    <div className="error">
      <p>{capture.error}</p>
      <button className="link" onClick={() => engine.retryCapture()}>
        Retry
      </button>
    </div>
  );
}
