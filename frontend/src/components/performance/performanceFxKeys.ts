import type { Mixer } from '../../playback/mixer';
import { BEAT_FX_EFFECTS, type BeatFxTarget } from '../../playback/beatFx';

/** Performance Beat FX number row (#285 review). '0' is the LEVEL/DEPTH
 * knob as a held key + mouse (BeatFxKeys); '=' stays Quantize. */
export const PERFORMANCE_FX_KEYS = {
  targets: { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'master' },
  beatHalve: '6',
  beatDouble: '7',
  effectPrevious: '8',
  effectNext: '9',
  depth: '0',
  toggle: '-',
} as const satisfies {
  targets: Record<string, BeatFxTarget>;
  beatHalve: string;
  beatDouble: string;
  effectPrevious: string;
  effectNext: string;
  depth: string;
  toggle: string;
};

/** Key for a CH SELECT target (on-control hints + keyboard map). */
export function performanceFxTargetKey(target: BeatFxTarget): string | null {
  const entry = Object.entries(PERFORMANCE_FX_KEYS.targets).find(([, value]) => value === target);
  return entry ? entry[0] : null;
}

type FxKeyMixer = Pick<Mixer,
  'toggleBeatFxOn' | 'stepBeatFxBeats' | 'selectBeatFxTarget' | 'selectBeatFx' | 'getBeatFxSection'>;

/** Would dispatchPerformanceFxKey handle this key (repeat suppression)? */
export function isPerformanceFxKey(key: string, deckCount: 2 | 4): boolean {
  const noop: FxKeyMixer = {
    toggleBeatFxOn() {}, stepBeatFxBeats() {}, selectBeatFxTarget() {}, selectBeatFx() {},
    getBeatFxSection: () => ({ selected: null, target: 'A', on: false, depth: 0, beats: 1 }),
  };
  return dispatchPerformanceFxKey(key, noop, deckCount);
}

/** Handle one tap-style Beat FX key; false = not handled here (do not claim). */
export function dispatchPerformanceFxKey(key: string, mixer: FxKeyMixer, deckCount: 2 | 4): boolean {
  const target = PERFORMANCE_FX_KEYS.targets[key as keyof typeof PERFORMANCE_FX_KEYS.targets];
  if (target) {
    // C/D are not displayed in the 2-deck layout.
    if (deckCount === 2 && (target === 'C' || target === 'D')) return false;
    mixer.selectBeatFxTarget(target);
  } else if (key === PERFORMANCE_FX_KEYS.toggle) mixer.toggleBeatFxOn();
  else if (key === PERFORMANCE_FX_KEYS.beatHalve) mixer.stepBeatFxBeats('halve');
  else if (key === PERFORMANCE_FX_KEYS.beatDouble) mixer.stepBeatFxBeats('double');
  else if (key === PERFORMANCE_FX_KEYS.effectPrevious || key === PERFORMANCE_FX_KEYS.effectNext) {
    const next = key === PERFORMANCE_FX_KEYS.effectNext;
    const current = mixer.getBeatFxSection().selected;
    const count = BEAT_FX_EFFECTS.length;
    const index = current === null
      ? (next ? 0 : count - 1)
      : (BEAT_FX_EFFECTS.indexOf(current) + (next ? 1 : -1) + count) % count;
    mixer.selectBeatFx(BEAT_FX_EFFECTS[index]);
  } else return false;
  return true;
}
