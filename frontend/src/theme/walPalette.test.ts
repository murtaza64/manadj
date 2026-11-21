import { describe, expect, it } from 'vitest';
import {
  mapWalPalette,
  validateWalPalette,
  WAL_PALETTE_VERSION,
  NEUTRAL_CHROMA_MAX,
} from './walPalette';
import validDark from './__fixtures__/wal-dark.json';

const HEX = /^#[0-9a-f]{6}$/;

function load(): ReturnType<typeof validateWalPalette> {
  return validateWalPalette(JSON.parse(JSON.stringify(validDark)));
}

describe('validateWalPalette', () => {
  it('accepts a complete wal-palette/1 document', () => {
    const r = load();
    expect(r.ok).toBe(true);
  });
  it('refuses a wrong schema version (never falls back to guessing)', () => {
    const doc = JSON.parse(JSON.stringify(validDark));
    doc.version = 'wal-palette/0';
    const r = validateWalPalette(doc);
    expect(r).toMatchObject({ ok: false, reason: 'bad-version' });
  });
  it('refuses a missing version discriminator', () => {
    const doc = JSON.parse(JSON.stringify(validDark));
    delete doc.version;
    expect(validateWalPalette(doc)).toMatchObject({ ok: false, reason: 'bad-version' });
  });
  it('refuses incomplete ANSI input (15 colors) wholesale', () => {
    const doc = JSON.parse(JSON.stringify(validDark));
    doc.colors.ansi.pop();
    expect(validateWalPalette(doc)).toMatchObject({ ok: false, reason: 'incomplete-ansi' });
  });
  it('refuses malformed hex colors', () => {
    const doc = JSON.parse(JSON.stringify(validDark));
    doc.colors.ansi[4] = 'blue';
    expect(validateWalPalette(doc)).toMatchObject({ ok: false, reason: 'invalid-color' });
    doc.colors.ansi[4] = '#7aa2f7';
    doc.colors.background = '#1a1b2'; // 5 digits
    expect(validateWalPalette(doc)).toMatchObject({ ok: false, reason: 'invalid-color' });
  });
  it('refuses non-objects', () => {
    for (const bad of [null, 42, 'palette', []]) {
      expect(validateWalPalette(bad)).toMatchObject({ ok: false, reason: 'not-an-object' });
    }
  });
});

describe('mapWalPalette', () => {
  it('overrides only wallpaper-owned vars: neutrals + accent, never semantics or decks', () => {
    const r = load();
    if (!r.ok) throw new Error('fixture must validate');
    const { cssOverrides } = mapWalPalette(r.palette);
    const keys = Object.keys(cssOverrides).sort();
    expect(keys).toEqual([
      '--accent', '--accent-rgb', '--base', '--crust', '--mantle',
      '--overlay0', '--overlay1', '--overlay2', '--subtext0', '--subtext1',
      '--surface0', '--surface1', '--surface2', '--text', '--void',
    ].sort());
    // Fixed semantics (gh#470): success/warning/danger/playhead/hotcue/deck
    // vars are never produced by the mapper.
    for (const banned of ['--success', '--danger', '--warning', '--playhead', '--deck-a', '--hc-1']) {
      expect(cssOverrides[banned]).toBeUndefined();
    }
  });
  it('keeps the accent fully saturated (no chroma clamp on accents)', () => {
    const r = load();
    if (!r.ok) throw new Error('fixture must validate');
    const { cssOverrides } = mapWalPalette(r.palette);
    expect(cssOverrides['--accent']).toBe('#7aa2f7'); // ansi[4] verbatim
    expect(cssOverrides['--accent-rgb']).toBe('122, 162, 247');
  });
  it('produces valid hex for every override', () => {
    const r = load();
    if (!r.ok) throw new Error('fixture must validate');
    const { cssOverrides } = mapWalPalette(r.palette);
    for (const [k, v] of Object.entries(cssOverrides)) {
      if (k.endsWith('-rgb')) expect(v).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
      else expect(v).toMatch(HEX);
    }
  });
  it('clamps neutral chroma at the DESIGN.md near-neutral bound', () => {
    // A loud magenta wallpaper background must collapse toward neutral.
    const r = load();
    if (!r.ok) throw new Error('fixture must validate');
    const loud = {
      ...r.palette,
      colors: { ...r.palette.colors, background: '#ff00ff' },
    };
    const { cssOverrides } = mapWalPalette(loud);
    expect(cssOverrides['--base']).toMatch(HEX);
    expect(cssOverrides['--base']).not.toBe('#ff00ff');
    // Round-trip through the module's own clamp bound: re-clamping the
    // result is a no-op, i.e. it is already at or under NEUTRAL_CHROMA_MAX.
    const again = mapWalPalette({ ...loud, colors: { ...loud.colors, background: cssOverrides['--base'] } });
    expect(again.cssOverrides['--base']).toBe(cssOverrides['--base']);
    expect(NEUTRAL_CHROMA_MAX).toBeCloseTo(0.02);
  });
  it('keeps deck identities fixed by default; proposal only on request', () => {
    const r = load();
    if (!r.ok) throw new Error('fixture must validate');
    expect(mapWalPalette(r.palette).deckProposal).toBeUndefined();
    const withDecks = mapWalPalette(r.palette, { withDeckProposal: true });
    expect(withDecks.deckProposal).toBeDefined();
    expect(Object.keys(withDecks.deckProposal!)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('returns detached data: mutating the result cannot affect later calls', () => {
    const r = load();
    if (!r.ok) throw new Error('fixture must validate');
    const first = mapWalPalette(r.palette);
    first.cssOverrides['--base'] = '#000000';
    const second = mapWalPalette(r.palette);
    expect(second.cssOverrides['--base']).not.toBe('#000000');
  });
  it(`documents the schema version it implements (${WAL_PALETTE_VERSION})`, () => {
    expect(WAL_PALETTE_VERSION).toBe('wal-palette/1');
  });
});
