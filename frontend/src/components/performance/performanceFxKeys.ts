import type { Mixer } from '../../playback/mixer';
import type { BeatFxEffectId, BeatFxTarget } from '../../playback/beatFx';

export const PERFORMANCE_FX_KEYS = {
  effects: { '1': 'echo', '2': 'reverb', '3': 'flanger' },
  toggle: '4',
  beatHalve: '5',
  beatDouble: '6',
  depthDown: '7',
  depthUp: '8',
  targetPrevious: '9',
  targetNext: '0',
} as const satisfies {
  effects: Record<string, BeatFxEffectId>;
  toggle: string;
  beatHalve: string;
  beatDouble: string;
  depthDown: string;
  depthUp: string;
  targetPrevious: string;
  targetNext: string;
};

const clampDepth = (value: number) => Math.max(-1, Math.min(1, value));

export function dispatchPerformanceFxKey(
  key: string,
  mixer: Pick<Mixer,
    'selectBeatFx' | 'toggleBeatFxOn' | 'stepBeatFxBeats' |
    'getBeatFxSection' | 'setBeatFxDepth' | 'selectBeatFxTarget'>,
  deckCount: 2 | 4,
): boolean {
  const effect = PERFORMANCE_FX_KEYS.effects[key as keyof typeof PERFORMANCE_FX_KEYS.effects];
  if (effect) mixer.selectBeatFx(effect);
  else if (key === PERFORMANCE_FX_KEYS.toggle) mixer.toggleBeatFxOn();
  else if (key === PERFORMANCE_FX_KEYS.beatHalve) mixer.stepBeatFxBeats('halve');
  else if (key === PERFORMANCE_FX_KEYS.beatDouble) mixer.stepBeatFxBeats('double');
  else if (key === PERFORMANCE_FX_KEYS.depthDown) {
    mixer.setBeatFxDepth(clampDepth(mixer.getBeatFxSection().depth - 0.1));
  } else if (key === PERFORMANCE_FX_KEYS.depthUp) {
    mixer.setBeatFxDepth(clampDepth(mixer.getBeatFxSection().depth + 0.1));
  } else if (key === PERFORMANCE_FX_KEYS.targetPrevious || key === PERFORMANCE_FX_KEYS.targetNext) {
    const targets: BeatFxTarget[] = deckCount === 4
      ? ['A', 'B', 'C', 'D', 'master']
      : ['A', 'B', 'master'];
    const current = targets.indexOf(mixer.getBeatFxSection().target);
    const direction = key === PERFORMANCE_FX_KEYS.targetNext ? 1 : -1;
    mixer.selectBeatFxTarget(targets[(current + direction + targets.length) % targets.length]);
  } else return false;
  return true;
}
