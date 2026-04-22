// Tag color palette and generators

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;

  const c = (1 - Math.abs((2 * l) - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (channel: number) => {
    const value = Math.round((channel + m) * 255);
    return value.toString(16).padStart(2, '0');
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export const COLOR_PALETTE = Array.from({ length: 16 }, (_, i) => {
  const hue = Math.round((i * 360) / 16) % 360;
  return {
    name: `hue-${hue}`,
    hex: hslToHex(hue, 68, 62),
  };
});

export const NEUTRAL_COLOR_PALETTE = [
  { name: 'grey', hex: '#9ca3af' },
  { name: 'white', hex: '#ffffff' },
];

/**
 * Generate a random colorful tag color.
 */
export function getNextColor(): string {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 56 + Math.floor(Math.random() * 21); // 56-76
  const lightness = 56 + Math.floor(Math.random() * 13); // 56-68
  return hslToHex(hue, saturation, lightness);
}

/**
 * Kept for compatibility with older imports.
 */
export function resetColorGenerator() {
  return;
}

/**
 * Get display color for tag - use tag.color or fallback to category.color or default
 */
export function getTagColor(tag: { color?: string; category?: { color?: string } }): string {
  return tag.color || tag.category?.color || 'var(--surface0)';
}

/**
 * Validate hex color format
 */
export function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}
