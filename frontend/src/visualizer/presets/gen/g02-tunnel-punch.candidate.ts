/** tunnel settings mutant: short trails, hard zoom (aggressive).
 * Settings mutant: identical engine, different defaults — explores the
 * tuning space the param sliders exposed. */
import { tunnelPreset as parent } from '../tunnel';
import type { VisualizerPreset } from '../types';

const OVERRIDES: Record<string, number> = {"trail": 0.42, "zoom": 1.8};

const candidate: VisualizerPreset = {
  ...parent,
  id: 'g02-tunnel-punch',
  name: 'g02 tunnel-punch',
  params: (parent.params ?? []).map((p) =>
    p.id in OVERRIDES ? { ...p, default: OVERRIDES[p.id] } : p
  ),
};
export default candidate;
