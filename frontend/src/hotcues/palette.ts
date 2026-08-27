/** Stored/default hot-cue palette behavior. The palette VALUES live in
 * theme/tokens.ts (single source; --hc-1..8 installed at boot; mirrored by
 * backend/hotcue_palette.py under test guard). This module owns the
 * stored-color validation rule. */
import { HOT_CUE_CSS_COLORS } from '../theme/tokens';

export { HOT_CUE_CSS_COLORS };

const CUE_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function cueCssColor(slot: number, stored?: string | null): string {
  return stored && CUE_COLOR_RE.test(stored) ? stored : (HOT_CUE_CSS_COLORS[slot] ?? '#ffffff');
}
