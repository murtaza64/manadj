/** odyssey settings mutant: rare mutations, deep and slow.
 * Settings mutant: identical engine, different defaults — explores the
 * tuning space the param sliders exposed. */
import { odysseyPreset as parent } from '../odyssey';
import type { VisualizerPreset } from '../types';

const OVERRIDES: Record<string, number> = {"chaos": 0.4, "speed": 0.6, "dust": 0.8};

const candidate: VisualizerPreset = {
  ...parent,
  id: 'g02-odyssey-deep',
  name: 'g02 odyssey-deep',
  params: (parent.params ?? []).map((p) =>
    p.id in OVERRIDES ? { ...p, default: OVERRIDES[p.id] } : p
  ),
};
export default candidate;
