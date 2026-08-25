/** voyage settings mutant: solar palette, fast flight, dense stars.
 * Settings mutant: identical engine, different defaults — explores the
 * tuning space the param sliders exposed. */
import { voyagePreset as parent } from '../voyage';
import type { VisualizerPreset } from '../types';

const OVERRIDES: Record<string, number> = {"palette": 3, "speed": 1.5, "stars": 1.4, "dust": 0.8};

const candidate: VisualizerPreset = {
  ...parent,
  id: 'g02-voyage-solarhot',
  name: 'g02 voyage-solarhot',
  params: (parent.params ?? []).map((p) =>
    p.id in OVERRIDES ? { ...p, default: OVERRIDES[p.id] } : p
  ),
};
export default candidate;
