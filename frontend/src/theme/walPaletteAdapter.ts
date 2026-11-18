/**
 * Adapter: pywal's real output (~/.cache/wal/colors.json) -> wal-palette/1.
 *
 * pywal writes { wallpaper, alpha, special: {background, foreground,
 * cursor}, colors: {color0..color15} } with NO version discriminator, so
 * this adapter is the trust boundary: it validates the pywal shape strictly
 * and emits the versioned internal contract that walPalette.ts consumes.
 * Pure module — the caller owns reading the file.
 *
 * Refuses (never partially converts): non-object, missing/incomplete
 * special or colors blocks, any missing colorN, any malformed '#rrggbb'.
 * Extra pywal fields (wallpaper, alpha, and any future keys) are ignored by
 * design — they are not theme inputs.
 */
import { validateWalPalette, WAL_PALETTE_VERSION, type WalPalette, type WalPaletteRefusal } from './walPalette';

export type PywalRefusal = WalPaletteRefusal | 'missing-special' | 'missing-colorN';

export type PywalAdaptation =
  | { ok: true; palette: WalPalette }
  | { ok: false; reason: PywalRefusal; detail: string };

const HEX = /^#[0-9a-fA-F]{6}$/;

export function adaptPywalColors(input: unknown): PywalAdaptation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'not-an-object', detail: 'pywal colors.json must be a JSON object' };
  }
  const doc = input as Record<string, unknown>;
  const special = doc.special;
  if (typeof special !== 'object' || special === null || Array.isArray(special)) {
    return { ok: false, reason: 'missing-special', detail: 'special {background, foreground, cursor} required' };
  }
  const s = special as Record<string, unknown>;
  for (const key of ['background', 'foreground', 'cursor'] as const) {
    if (typeof s[key] !== 'string' || !HEX.test(s[key] as string)) {
      return { ok: false, reason: 'invalid-color', detail: `special.${key} must be '#rrggbb'` };
    }
  }
  const colors = doc.colors;
  if (typeof colors !== 'object' || colors === null || Array.isArray(colors)) {
    return { ok: false, reason: 'missing-colors', detail: 'colors {color0..color15} required' };
  }
  const c = colors as Record<string, unknown>;
  const ansi: string[] = [];
  for (let i = 0; i < 16; i++) {
    const v = c[`color${i}`];
    if (typeof v !== 'string' || !HEX.test(v)) {
      return { ok: false, reason: 'missing-colorN', detail: `colors.color${i} missing or not '#rrggbb'` };
    }
    ansi.push(v);
  }
  // Belt and suspenders: the emitted document must pass the strict internal
  // contract before anyone consumes it.
  const check = validateWalPalette({
    version: WAL_PALETTE_VERSION,
    colors: { background: s.background, foreground: s.foreground, cursor: s.cursor, ansi },
  });
  if (!check.ok) return check;
  return { ok: true, palette: check.palette };
}
