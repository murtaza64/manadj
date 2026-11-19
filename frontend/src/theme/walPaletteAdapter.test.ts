import { describe, expect, it } from 'vitest';
import { adaptPywalColors } from './walPaletteAdapter';
import { mapWalPalette } from './walPalette';
import pywalColors from './__fixtures__/pywal-colors.json';

function load(): unknown {
  return JSON.parse(JSON.stringify(pywalColors));
}

describe('adaptPywalColors', () => {
  it('converts a real-shape pywal colors.json to wal-palette/1', () => {
    const r = adaptPywalColors(load());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.palette.version).toBe('wal-palette/1');
    expect(r.palette.colors.background).toBe('#1a1b26');
    expect(r.palette.colors.ansi).toHaveLength(16);
    expect(r.palette.colors.ansi[4]).toBe('#7aa2f7');
  });
  it('ignores non-theme pywal fields (wallpaper, alpha, extras)', () => {
    const doc = load() as Record<string, unknown>;
    doc.wallpaper = '/somewhere/else.png';
    doc.future_field = { nested: true };
    expect(adaptPywalColors(doc).ok).toBe(true);
  });
  it('refuses a missing special block', () => {
    const doc = load() as Record<string, unknown>;
    delete doc.special;
    expect(adaptPywalColors(doc)).toMatchObject({ ok: false, reason: 'missing-special' });
  });
  it('refuses when any colorN is missing', () => {
    const doc = load() as { colors: Record<string, string> };
    delete doc.colors.color15;
    expect(adaptPywalColors(doc)).toMatchObject({ ok: false, reason: 'missing-colorN' });
  });
  it('refuses malformed hex in the pywal shape', () => {
    const doc = load() as { colors: Record<string, string> };
    doc.colors.color3 = 'orange';
    expect(adaptPywalColors(doc)).toMatchObject({ ok: false, reason: 'missing-colorN' });
  });
  it('refuses non-objects', () => {
    for (const bad of [null, 'x', 7, []]) {
      expect(adaptPywalColors(bad)).toMatchObject({ ok: false, reason: 'not-an-object' });
    }
  });
  it('feeds the mapper end-to-end: adapted palette maps like a native one', () => {
    const r = adaptPywalColors(load());
    if (!r.ok) throw new Error('fixture must adapt');
    const { cssOverrides } = mapWalPalette(r.palette);
    expect(cssOverrides['--accent']).toBe('#7aa2f7');
    expect(cssOverrides['--base']).toMatch(/^#[0-9a-f]{6}$/);
    expect(cssOverrides['--deck-a']).toBeUndefined();
  });
});
