/**
 * Picker chip-fill requests (#221 quick fix): browse-table rows populate
 * the Mix picker's track chips instead of loading decks — ⋈ fills and
 * opens when the pair completes, ⌕ fills only (navigation), double-click
 * = ⌕. Fill rule: first empty chip; the SECOND chip when both are full
 * (the outgoing anchors, the incoming churns).
 *
 * Module-level emitter (the browse table and the picker share no React
 * ancestry below App).
 */

export interface ChipFillRequest {
  trackId: number;
  /** 'edit' opens a seeded pair draft when the fill completes a pair;
   * 'search' only navigates the picker pages. */
  intent: 'edit' | 'search';
}

type Listener = (req: ChipFillRequest) => void;
const listeners = new Set<Listener>();

export function fillPickerChip(req: ChipFillRequest): void {
  for (const l of [...listeners]) l(req);
}

export function subscribeChipFills(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
