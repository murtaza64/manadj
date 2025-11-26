import { formatKeyDisplay } from '../utils/keyUtils';
import './KeyDisplay.css';

interface KeyDisplayProps {
  keyValue: string | number | null | undefined;
}

/**
 * Display musical key with color coding based on circle of fifths position.
 * Uses full HSL spectrum (0-360°) mapped to 12 positions.
 * Major keys (d) are brighter, minor keys (m) are darker.
 */
export default function KeyDisplay({ keyValue }: KeyDisplayProps) {
  // Handle null/undefined (but not 0, which is a valid key)
  if (keyValue === null || keyValue === undefined) {
    return <span style={{ color: 'var(--overlay0)' }}>-</span>;
  }

  // Normalize to OpenKey format using existing utilities
  const openKey = formatKeyDisplay(keyValue);
  if (!openKey || openKey === '-') {
    return <span style={{ color: 'var(--overlay0)' }}>-</span>;
  }

  // Extract position (1-12) and mode (m/d)
  const match = openKey.match(/^(\d+)(m|d)$/);
  if (!match) {
    return <span>{openKey}</span>;
  }

  const position = parseInt(match[1]);
  const mode = match[2];

  // Calculate color
  // Map 1-12 to 0-360° hue (full color wheel, 30° per step)
  const hue = ((position - 1) * 30) % 360;
  // Minor keys darker (60%), major keys brighter (75%)
  const lightness = mode === 'm' ? 60 : 75;

  return (
    <span
      className="key-display"
      style={{ color: `hsl(${hue}, 100%, ${lightness}%)` }}
    >
      {openKey}
    </span>
  );
}
