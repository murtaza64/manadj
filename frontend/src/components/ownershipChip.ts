/**
 * Face selection for the TopBar audio-ownership chip (sets 40): who owns
 * the decks/audio right now, and what the next transport gesture drives.
 *
 * Pure seam — the component feeds it live inputs (audibleHolder(),
 * useConductorState()) and renders the result. Three faces, learnable
 * (grilled 2026-07-06): the Conductor's set (playing OR paused — a paused
 * claim is still a claim, ADR 0024), the editor's audition, or the muted
 * shared decks. Holder is the truth for ownership: a Conductor displaced
 * by an editor claim stands down without releasing, so 'editor' wins
 * regardless of what the conductor store still reports.
 *
 * Tooltips follow issue 34's DECIDED transport semantics: the mounted
 * editor keeps space = audition toggle; otherwise a selected Set routes
 * space to the Conductor; otherwise space/play is a deck gesture — which,
 * during conduction, is a takeover.
 */
import type { AudibleSurfaceId } from '../playback/audibleSurface';

export type ChipFace =
  | { kind: 'set'; setId: number; playing: boolean }
  | { kind: 'audition' }
  | { kind: 'decks' };

export interface ConductorSnapshot {
  setId: number | null;
  status: 'idle' | 'playing' | 'paused';
}

export function resolveChipFace(
  holder: AudibleSurfaceId,
  conductor: ConductorSnapshot
): ChipFace {
  if (holder === 'editor') return { kind: 'audition' };
  if (holder === 'conductor' && conductor.setId !== null && conductor.status !== 'idle') {
    return { kind: 'set', setId: conductor.setId, playing: conductor.status === 'playing' };
  }
  // 'shared' — or a transiently inconsistent conductor holder: never
  // render a nameless SET face.
  return { kind: 'decks' };
}

export interface ChipContext {
  /** The conducting set's name (null while the ['sets'] query loads). */
  setName: string | null;
  /** Editor view mounted → space is the audition toggle (34). */
  editorMounted: boolean;
  /** A Set selected in the browse view → space drives the Conductor (34). */
  setSelected: boolean;
}

/** The next-gesture consequence, per face and context. */
export function chipTooltip(face: ChipFace, ctx: ChipContext): string {
  const name = ctx.setName ?? 'set';
  switch (face.kind) {
    case 'set': {
      const owner = face.playing
        ? `Conducting “${name}”.`
        : `“${name}” is paused — it still holds the decks (capture stays off until stop or takeover).`;
      const gesture = ctx.editorMounted
        ? 'Play in the editor will silence this set.'
        : ctx.setSelected
          ? face.playing
            ? 'Space pauses this set.'
            : 'Space resumes this set.'
          : 'Space or deck play will take over the decks (the set stands down, audio keeps running).'
      return `${owner} ${gesture} Click to go to the set.`;
    }
    case 'audition':
      return 'Editor audition owns the decks. Space toggles the audition. Click to open the editor.';
    case 'decks':
      if (ctx.editorMounted) {
        return 'Manual decks. Space plays the editor audition (it will claim the decks).';
      }
      if (ctx.setSelected) {
        return 'Manual decks. Space starts the selected set (pickup when lit).';
      }
      return 'Manual decks. Space and play drive the deck transport.';
  }
}
