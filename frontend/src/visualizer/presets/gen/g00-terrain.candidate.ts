/** gen-0 seed: curated terrain enters the pool as a rated baseline. */
import { terrainPreset } from '../terrain';
import type { VisualizerPreset } from '../types';

const candidate: VisualizerPreset = { ...terrainPreset, name: 'g00 terrain' };
export default candidate;
