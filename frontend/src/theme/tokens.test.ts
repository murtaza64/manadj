/** Design tokens (gh#199): installTheme projects every token onto :root.
 * The gh#199 no-visual-change baseline was retired by the gh#200 sweep:
 * legacy aliases (--font-xs..xl, --space-xs..xl, deprecated accents) are
 * deleted and motion tokens retuned to their D8/D9 values. This test now
 * guards the surviving var values and the retirement itself. */
import { describe, expect, it } from 'vitest';

import { DECK_COLORS } from './deckColors';
import { CSS_VARS, hexToGlFloats, installTheme } from './tokens';

/** Vars that survived the gh#200 sweep, at their post-sweep values.
 * Retunes must update this test deliberately. */
const STABLE_VARS: Record<string, string> = {
  '--base': '#1e1e1e',
  '--mantle': '#181818',
  '--crust': '#111111',
  '--surface0': '#313136',
  '--surface1': '#45454f',
  '--surface2': '#58585b',
  '--text': '#cdd6f4',
  '--subtext1': '#bac2de',
  '--subtext0': '#a6adc8',
  '--overlay0': '#6c7086',
  '--overlay1': '#7f849c',
  '--overlay2': '#9399b2',
  '--hc-1': '#1e90ff',
  '--hc-2': '#ffd400',
  '--hc-3': '#ff8800',
  '--hc-4': '#ff4455',
  '--hc-5': '#2ed573',
  '--hc-6': '#ff5cc8',
  '--hc-7': '#a855f7',
  '--hc-8': '#00cec9',
  '--energy-1': '#ffffcc',
  '--energy-2': '#ffcc66',
  '--energy-3': '#ff9933',
  '--energy-4': '#ff4444',
  '--energy-5': '#ff0000',
  '--radius': '0',
  // D8/D9 durations (retuned from the pre-sweep 0.15s/0.2s in gh#200)
  '--transition-fast': '0.1s ease',
  '--transition-normal': '0.15s ease',
};

/** Deleted by the gh#200 sweep (DESIGN.md kill list). Installing any of
 * these again is a regression — consumers must use semantic tokens. */
const RETIRED_VARS = [
  '--blue',
  '--sapphire',
  '--green',
  '--teal',
  '--yellow',
  '--red',
  '--mauve',
  '--lavender',
  '--space-xs',
  '--space-sm',
  '--space-md',
  '--space-lg',
  '--space-xl',
  '--font-xs',
  '--font-sm',
  '--font-md',
  '--font-lg',
  '--font-xl',
];

describe('tokens', () => {
  it('installs every surviving var with its post-sweep value', () => {
    for (const [name, value] of Object.entries(STABLE_VARS)) {
      expect(CSS_VARS[name], name).toBe(value);
    }
  });

  it('no longer installs the retired legacy aliases (gh#200)', () => {
    for (const name of RETIRED_VARS) {
      expect(CSS_VARS[name], name).toBeUndefined();
    }
  });

  it('installs the boot-installed vars the old ad-hoc installers owned', () => {
    expect(CSS_VARS['--deck-a']).toBe(DECK_COLORS.A);
    expect(CSS_VARS['--deck-b-rgb']).toBe('255, 45, 149');
    expect(CSS_VARS['--routine-accent']).toBe('#a8ff00');
    expect(CSS_VARS['--routine-accent-ink']).toBe('#101400');
  });

  it('installs the new semantic tokens', () => {
    for (const name of [
      '--accent',
      '--success',
      '--danger',
      '--warning',
      '--orange',
      '--playhead',
      '--void',
      '--font-micro',
      '--font-body',
      '--space-2',
      '--space-6',
      '--z-modal',
    ]) {
      expect(CSS_VARS[name], name).toBeDefined();
    }
    // The perf-knob ghost's formerly-phantom token (PerformanceView.css)
    expect(CSS_VARS['--orange']).toBe('#ff9500');
  });

  it('projects the full map onto the given root', () => {
    const seen: Record<string, string> = {};
    installTheme({ style: { setProperty: (n, v) => void (seen[n] = v) } });
    expect(seen).toEqual(CSS_VARS);
  });

  it('derives GL floats from hex', () => {
    expect(hexToGlFloats('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToGlFloats('#000000')).toEqual([0, 0, 0]);
  });
});
