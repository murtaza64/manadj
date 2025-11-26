import { getBpmColor } from '../utils/displayColors';
import './BPMDisplay.css';

interface BPMDisplayProps {
  bpm: number | null | undefined;
}

/**
 * Display BPM with color coding from cyan (60) to magenta (200)
 */
export default function BPMDisplay({ bpm }: BPMDisplayProps) {
  if (!bpm) {
    return <span style={{ color: 'var(--overlay0)' }}>-</span>;
  }

  const color = getBpmColor(bpm);

  return (
    <span
      className="bpm-display"
      style={{ color: color || 'var(--text)' }}
    >
      {bpm}
    </span>
  );
}
