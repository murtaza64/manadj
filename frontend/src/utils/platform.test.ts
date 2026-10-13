import { afterEach, describe, expect, it } from 'vitest';
import { isPrimaryChord, primaryChordLabel, primaryModGlyph, primaryModName, setPlatformOverride } from './platform';
import { fileBasename } from './pathDisplay';

afterEach(() => setPlatformOverride('mac'));

describe('platform primary modifier', () => {
  it('is Cmd-only on macOS', () => {
    setPlatformOverride('mac');
    expect(isPrimaryChord({ metaKey: true, ctrlKey: false, altKey: false })).toBe(true);
    expect(isPrimaryChord({ metaKey: false, ctrlKey: true, altKey: false })).toBe(false);
    expect(isPrimaryChord({ metaKey: true, ctrlKey: true, altKey: false })).toBe(false);
    expect([primaryModName(), primaryModGlyph(), primaryChordLabel('Z', { shift: true })])
      .toEqual(['Cmd', '\u2318', '\u2318\u21e7Z']);
  });

  it('is Ctrl-only elsewhere', () => {
    setPlatformOverride('other');
    expect(isPrimaryChord({ metaKey: false, ctrlKey: true, altKey: false })).toBe(true);
    expect(isPrimaryChord({ metaKey: true, ctrlKey: false, altKey: false })).toBe(false);
    expect(isPrimaryChord({ metaKey: false, ctrlKey: true, altKey: true })).toBe(false);
    expect([primaryModName(), primaryModGlyph(), primaryChordLabel('Z'), primaryChordLabel('Z', { shift: true })])
      .toEqual(['Ctrl', '\u2303', 'Ctrl+Z', 'Ctrl+Shift+Z']);
  });
});

describe('fileBasename', () => {
  it('splits on both separators', () => {
    expect(fileBasename('/Users/x/Music/a.mp3')).toBe('a.mp3');
    expect(fileBasename('C:\\Music\\Crate\\b.flac')).toBe('b.flac');
    expect(fileBasename('c.wav')).toBe('c.wav');
  });
});
