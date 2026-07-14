/** Stored/default hot-cue palette. Mirrors backend/hotcue_palette.py and
 * --hc-1..--hc-8; the WebGL renderer cannot read CSS custom properties. */
export const HOT_CUE_CSS_COLORS: Record<number, string> = {
  1: '#1e90ff',
  2: '#ffd400',
  3: '#ff8800',
  4: '#ff4455',
  5: '#2ed573',
  6: '#ff5cc8',
  7: '#a855f7',
  8: '#00cec9',
};

const CUE_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function cueCssColor(slot: number, stored?: string | null): string {
  return stored && CUE_COLOR_RE.test(stored) ? stored : (HOT_CUE_CSS_COLORS[slot] ?? '#ffffff');
}
