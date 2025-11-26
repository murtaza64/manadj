/**
 * Utility functions for calculating display colors for BPM and keys
 */

/**
 * Calculate BPM color from cyan (60 BPM) to magenta (200 BPM)
 * @param bpm - BPM value (will be clamped between 60-200)
 * @returns HSL color string
 */
export function getBpmColor(bpm: number | null | undefined): string | null {
  if (!bpm) return null;

  // Clamp BPM between 60 and 200
  const clampedBpm = Math.max(60, Math.min(200, bpm));

  // Calculate position on scale (0 = cyan/60, 1 = magenta/200)
  const position = (clampedBpm - 60) / (200 - 60);

  // Interpolate between cyan and magenta in HSL
  // Cyan: hsl(180, 100%, 50%)
  // Magenta: hsl(300, 100%, 50%)
  const hue = 180 + (position * 120); // 180 to 300 degrees

  return `hsl(${hue}, 100%, 75%)`;
}

/**
 * Calculate key color based on circle of fifths position
 * Uses full HSL spectrum (0-360°) mapped to 12 positions
 * @param keyOpenKey - Key in OpenKey notation (e.g., '1d', '5m')
 * @returns HSL color string or null if invalid
 */
export function getKeyColor(keyOpenKey: string | null | undefined): string | null {
  if (!keyOpenKey || keyOpenKey === '-') return null;

  // Extract position (1-12) and mode (m/d)
  const match = keyOpenKey.match(/^(\d+)(m|d)$/);
  if (!match) return null;

  const position = parseInt(match[1]);
  const mode = match[2];

  // Map 1-12 to 0-360° hue (full color wheel, 30° per step)
  const hue = ((position - 1) * 30) % 360;
  // Minor keys darker (60%), major keys brighter (75%)
  const lightness = mode === 'm' ? 60 : 75;

  return `hsl(${hue}, 100%, ${lightness}%)`;
}

/**
 * Calculate average color of multiple keys
 * @param keyOpenKeys - Array of keys in OpenKey notation
 * @returns HSL color string or null if no valid keys
 */
export function getAverageKeyColor(keyOpenKeys: string[]): string | null {
  if (!keyOpenKeys || keyOpenKeys.length === 0) return null;

  const colors = keyOpenKeys.map(getKeyColor).filter((c): c is string => c !== null);
  if (colors.length === 0) return null;

  // Parse HSL values
  const hslValues = colors.map(color => {
    const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!match) return null;
    return {
      h: parseInt(match[1]),
      s: parseInt(match[2]),
      l: parseInt(match[3])
    };
  }).filter((v): v is { h: number; s: number; l: number } => v !== null);

  if (hslValues.length === 0) return null;

  // Average hue (handling circular averaging)
  // Convert to unit circle coordinates, average, convert back
  const sinSum = hslValues.reduce((sum, v) => sum + Math.sin(v.h * Math.PI / 180), 0);
  const cosSum = hslValues.reduce((sum, v) => sum + Math.cos(v.h * Math.PI / 180), 0);
  let avgHue = Math.atan2(sinSum, cosSum) * 180 / Math.PI;
  if (avgHue < 0) avgHue += 360;

  // Average saturation and lightness
  const avgS = Math.round(hslValues.reduce((sum, v) => sum + v.s, 0) / hslValues.length);
  const avgL = Math.round(hslValues.reduce((sum, v) => sum + v.l, 0) / hslValues.length);

  return `hsl(${Math.round(avgHue)}, ${avgS}%, ${avgL}%)`;
}
