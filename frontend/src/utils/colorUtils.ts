// Color palette from user preferences - bright, fully saturated colors
export const COLOR_PALETTE = [
  { name: 'mauve', hex: '#cba6f7' },
  { name: 'lavender', hex: '#b4befe' },
  { name: 'red', hex: '#f38ba8' },
  { name: 'maroon', hex: '#eba0ac' },
  { name: 'peach', hex: '#fab387' },
  { name: 'yellow', hex: '#f9e2af' },
  { name: 'green', hex: '#a6e3a1' },
  { name: 'blue', hex: '#89b4fa' },
  { name: 'sapphire', hex: '#74c7ec' },
  { name: 'pink', hex: '#f5c2e7' },
  { name: 'sky', hex: '#89dceb' },
  { name: 'teal', hex: '#94e2d5' },
];

let colorIndex = 0;

/**
 * Generate next color from palette in round-robin fashion
 */
export function getNextColor(): string {
  const color = COLOR_PALETTE[colorIndex % COLOR_PALETTE.length];
  colorIndex++;
  return color.hex;
}

/**
 * Reset color generator (useful for testing)
 */
export function resetColorGenerator() {
  colorIndex = 0;
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
