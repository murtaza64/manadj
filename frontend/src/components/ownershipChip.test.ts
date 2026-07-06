/**
 * Face selection for the TopBar audio-ownership chip (sets 40).
 *
 * Pure seam: (audibleHolder, ConductorState) → which face the chip wears,
 * and (face, context) → the next-gesture tooltip. Tooltip copy follows
 * issue 34's DECIDED transport semantics (space drives the Conductor when
 * a Set is selected; the mounted editor keeps space = audition).
 */
import { describe, expect, it } from 'vitest';
import { resolveChipFace, chipTooltip, type ChipFace } from './ownershipChip';

const idle = { setId: null, status: 'idle' } as const;

describe('resolveChipFace', () => {
  it('shows muted DECKS while the shared surface holds (the default)', () => {
    expect(resolveChipFace('shared', idle)).toEqual<ChipFace>({ kind: 'decks' });
  });

  it('shows a playing SET face while the Conductor conducts', () => {
    expect(resolveChipFace('conductor', { setId: 7, status: 'playing' })).toEqual<ChipFace>({
      kind: 'set',
      setId: 7,
      playing: true,
    });
  });

  it('keeps the SET face while the Conductor is paused — a paused claim is still a claim (ADR 0024)', () => {
    expect(resolveChipFace('conductor', { setId: 7, status: 'paused' })).toEqual<ChipFace>({
      kind: 'set',
      setId: 7,
      playing: false,
    });
  });

  it('shows AUDITION while the editor holds the decks', () => {
    expect(resolveChipFace('editor', idle)).toEqual<ChipFace>({ kind: 'audition' });
  });

  it('AUDITION wins even while a displaced Conductor still reports a set (stand-down without release)', () => {
    // ADR 0024: an editor claim stands the Conductor down without the
    // Conductor releasing — holder is the truth, not conductor state.
    expect(resolveChipFace('editor', { setId: 7, status: 'paused' })).toEqual<ChipFace>({
      kind: 'audition',
    });
  });

  it('falls back to DECKS on an inconsistent conductor holder (defensive)', () => {
    // Transient ordering edge: holder says conductor but the store has
    // already gone idle. Never render a nameless SET face.
    expect(resolveChipFace('conductor', idle)).toEqual<ChipFace>({ kind: 'decks' });
  });

  it('after takeover the Conductor releases — shared face returns', () => {
    expect(resolveChipFace('shared', { setId: 7, status: 'idle' })).toEqual<ChipFace>({
      kind: 'decks',
    });
  });
});

describe('chipTooltip', () => {
  const set: ChipFace = { kind: 'set', setId: 7, playing: true };
  const pausedSet: ChipFace = { kind: 'set', setId: 7, playing: false };

  it('playing set + editor mounted: warns that editor play silences the set', () => {
    const tip = chipTooltip(set, { setName: 'post-forest', editorMounted: true, setSelected: false });
    expect(tip).toContain('post-forest');
    expect(tip).toContain('Play in the editor will silence this set');
  });

  it('playing set + a set selected in the browse view: space pauses (34 semantics)', () => {
    const tip = chipTooltip(set, { setName: 'post-forest', editorMounted: false, setSelected: true });
    expect(tip).toContain('Space pauses this set');
  });

  it('playing set + no set selected: a transport gesture is a deck takeover', () => {
    const tip = chipTooltip(set, { setName: 'post-forest', editorMounted: false, setSelected: false });
    expect(tip).toContain('take over the decks');
  });

  it('paused set: says the claim is still held and how it resumes', () => {
    const tip = chipTooltip(pausedSet, {
      setName: 'post-forest',
      editorMounted: false,
      setSelected: true,
    });
    expect(tip).toContain('still holds the decks');
    expect(tip).toContain('Space resumes this set');
  });

  it('audition face: space toggles the audition', () => {
    const tip = chipTooltip(
      { kind: 'audition' },
      { setName: null, editorMounted: true, setSelected: false }
    );
    expect(tip).toContain('Space toggles the audition');
  });

  it('decks face + set selected: space starts the set', () => {
    const tip = chipTooltip(
      { kind: 'decks' },
      { setName: null, editorMounted: false, setSelected: true }
    );
    expect(tip).toContain('Space starts the selected set');
  });

  it('decks face + editor mounted: space auditions', () => {
    const tip = chipTooltip(
      { kind: 'decks' },
      { setName: null, editorMounted: true, setSelected: false }
    );
    expect(tip).toContain('Space plays the editor audition');
  });

  it('decks face, plain browse: space drives the decks', () => {
    const tip = chipTooltip(
      { kind: 'decks' },
      { setName: null, editorMounted: false, setSelected: false }
    );
    expect(tip).toContain('deck');
  });
});
