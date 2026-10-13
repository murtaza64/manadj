/** Stored/default hot-cue palette behavior. The palette VALUES live in
 * theme/tokens.ts (single source; --hc-1..8 installed at boot; mirrored by
 * backend/hotcue_palette.py under test guard). This module owns the
 * stored-color validation rule. */
import { HOT_CUE_CSS_COLORS } from '../theme/tokens';
import { CUE_COLOR_RE } from '../theme/markers';

export { HOT_CUE_CSS_COLORS };

export function cueCssColor(slot: number, stored?: string | null): string {
  return stored && CUE_COLOR_RE.test(stored) ? stored : (HOT_CUE_CSS_COLORS[slot] ?? '#ffffff');
}
