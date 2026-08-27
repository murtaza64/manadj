/** Design tokens (gh#199): installTheme projects every token onto :root,
 * and the no-visual-change guarantee — every var the retired
 * styles/variables.css defined is still installed with the same value. */
import { describe, expect, it } from 'vitest';

import { DECK_COLORS } from './deckColors';
import { CSS_VARS, hexToGlFloats, installTheme } from './tokens';

/** styles/variables.css at its retirement (gh#199) — the regression
 * baseline. Retunes are step-2 work (gh#200) and must update this test
 * deliberately. */
const RETIRED_VARIABLES_CSS: Record<string, string> = {
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
  '--blue': '#4a9eff',
  '--sapphire': '#00b8d4',
  '--green': '#5ed75e',
  '--teal': '#26c6b8',
  '--yellow': '#f9e2af',
  '--red': '#ff4466',
  '--mauve': '#b366ff',
  '--lavender': '#7a7aff',
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
  '--space-xs': '4px',
  '--space-sm': '8px',
  '--space-md': '12px',
  '--space-lg': '16px',
  '--space-xl': '24px',
  '--font-xs': '13px',
  '--font-sm': '14px',
  '--font-md': '16px',
  '--font-lg': '20px',
  '--font-xl': '24px',
  '--radius': '0',
  '--transition-fast': '0.15s ease',
  '--transition-normal': '0.2s ease',
};

describe('tokens', () => {
  it('still installs every retired variables.css var with the same value', () => {
    for (const [name, value] of Object.entries(RETIRED_VARIABLES_CSS)) {
      expect(CSS_VARS[name], name).toBe(value);
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
