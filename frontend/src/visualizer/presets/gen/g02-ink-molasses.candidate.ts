/** ink-vortex settings mutant: thick slow molasses.
 * Settings mutant: identical engine, different defaults — explores the
 * tuning space the param sliders exposed. */
import parent from './g01-ink-vortex.candidate';
import type { VisualizerPreset } from '../types';

const OVERRIDES: Record<string, number> = {"viscosity": 1.7, "swirl": 0.55, "trail": 1.3};

const candidate: VisualizerPreset = {
  ...parent,
  id: 'g02-ink-molasses',
  name: 'g02 ink-molasses',
  params: (parent.params ?? []).map((p) =>
    p.id in OVERRIDES ? { ...p, default: OVERRIDES[p.id] } : p
  ),
};
export default candidate;
