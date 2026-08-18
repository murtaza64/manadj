/** tunnel settings mutant: very long trails, gentle zoom (dreamy).
 * Settings mutant: identical engine, different defaults — explores the
 * tuning space the param sliders exposed. */
import { tunnelPreset as parent } from '../tunnel';
import type { VisualizerPreset } from '../types';

const OVERRIDES: Record<string, number> = {"trail": 0.92, "zoom": 0.65};

const candidate: VisualizerPreset = {
  ...parent,
  id: 'g02-tunnel-dream',
  name: 'g02 tunnel-dream',
  params: (parent.params ?? []).map((p) =>
    p.id in OVERRIDES ? { ...p, default: OVERRIDES[p.id] } : p
  ),
};
export default candidate;
