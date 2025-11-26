import { formatKeyDisplay } from '../utils/keyUtils';
import { getKeyColor } from '../utils/displayColors';
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

  const color = getKeyColor(openKey);

  return (
    <span
      className="key-display"
      style={{ color: color || 'var(--text)' }}
    >
      {openKey}
    </span>
  );
}
