/** The visualizer preset on screen at clip second `s` (#401 rating target):
 * a running blast's preset, else the scene in force. */
import { overlayAt, sortedCues, type ClipSpec } from './clipSpec';

export function presetOnScreen(spec: ClipSpec, s: number): { presetId: string; params?: Record<string, number> } | null {
  const overlay = overlayAt(spec, s);
  if (overlay?.kind === 'blast' && overlay.presetId) return { presetId: overlay.presetId };
  let cur: ReturnType<typeof sortedCues>[number] | null = null;
  for (const c of sortedCues(spec)) {
    if (c.atSec <= s + 1e-3) cur = c;
    else break;
  }
  cur ??= sortedCues(spec)[0] ?? null;
  return cur ? { presetId: cur.presetId, params: cur.params } : null;
}
