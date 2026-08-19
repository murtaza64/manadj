/** strobe-lattice settings mutant: dense grid, long ghosts, softer strobe.
 * Settings mutant: identical engine, different defaults — explores the
 * tuning space the param sliders exposed. */
import parent from './g01-strobe-lattice.candidate';
import type { VisualizerPreset } from '../types';

const OVERRIDES: Record<string, number> = {"density": 11, "trails": 1.5, "strobe": 0.7};

const candidate: VisualizerPreset = {
  ...parent,
  id: 'g02-lattice-dense',
  name: 'g02 lattice-dense',
  params: (parent.params ?? []).map((p) =>
    p.id in OVERRIDES ? { ...p, default: OVERRIDES[p.id] } : p
  ),
};
export default candidate;
