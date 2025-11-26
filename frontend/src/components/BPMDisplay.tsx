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

  // Clamp BPM between 60 and 200
  const clampedBpm = Math.max(60, Math.min(200, bpm));

  // Calculate position on scale (0 = cyan/60, 1 = magenta/200)
  const position = (clampedBpm - 60) / (200 - 60);

  // Interpolate between cyan and magenta in HSL
  // Cyan: hsl(180, 100%, 50%)
  // Magenta: hsl(300, 100%, 50%)
  const hue = 180 + (position * 120); // 180 to 300 degrees

  return (
    <span
      className="bpm-display"
      style={{ color: `hsl(${hue}, 100%, 75%)` }}
    >
      {bpm}
    </span>
  );
}
