/** odyssey settings mutant: high mutation chaos, energetic.
 * Settings mutant: identical engine, different defaults — explores the
 * tuning space the param sliders exposed. */
import { odysseyPreset as parent } from '../odyssey';
import type { VisualizerPreset } from '../types';

const OVERRIDES: Record<string, number> = {"chaos": 1.6, "dust": 1.15, "speed": 1.25};

const candidate: VisualizerPreset = {
  ...parent,
  id: 'g02-odyssey-wild',
  name: 'g02 odyssey-wild',
  params: (parent.params ?? []).map((p) =>
    p.id in OVERRIDES ? { ...p, default: OVERRIDES[p.id] } : p
  ),
};
export default candidate;
