import { barsPreset } from './bars';
import { spectrumPreset } from './spectrum';
import { ledPreset } from './led';
import { mirrorPreset } from './mirror';
import { wavesPreset } from './waves';
import { radialPreset } from './radial';
import { terrainPreset } from './terrain';
import { fracturePreset } from './fracture';
import { trigonPreset } from './trigon';
import { siphonPreset } from './siphon';
import { tunnelPreset } from './tunnel';
import { plasmaPreset } from './plasma';
import { pulsePreset } from './pulse';
import { silkPreset } from './silk';
import { nebulaPreset } from './nebula';
import { scopePreset } from './scope';
import { gonioPreset } from './gonio';
import type { VisualizerPreset } from './types';

/** Preset registry (realtime-visualization 01/02). Order = switcher order:
 * bar family, scenes, then instruments (scope/goniometer). */
export const PRESETS: VisualizerPreset[] = [
  barsPreset,
  spectrumPreset,
  ledPreset,
  mirrorPreset,
  wavesPreset,
  radialPreset,
  terrainPreset,
  fracturePreset,
  trigonPreset,
  siphonPreset,
  tunnelPreset,
  plasmaPreset,
  pulsePreset,
  silkPreset,
  nebulaPreset,
  scopePreset,
  gonioPreset,
];

export const DEFAULT_PRESET_ID = barsPreset.id;

export function presetById(id: string): VisualizerPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}
