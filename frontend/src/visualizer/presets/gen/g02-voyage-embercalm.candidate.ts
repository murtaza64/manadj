/** voyage settings mutant: ember palette, low dust, calm speed, long trails.
 * Settings mutant: identical engine, different defaults — explores the
 * tuning space the param sliders exposed. */
import { voyagePreset as parent } from '../voyage';
import type { VisualizerPreset } from '../types';

const OVERRIDES: Record<string, number> = {"palette": 0, "dust": 0.55, "speed": 0.75, "persistence": 1.3};

const candidate: VisualizerPreset = {
  ...parent,
  id: 'g02-voyage-embercalm',
  name: 'g02 voyage-embercalm',
  params: (parent.params ?? []).map((p) =>
    p.id in OVERRIDES ? { ...p, default: OVERRIDES[p.id] } : p
  ),
};
export default candidate;
