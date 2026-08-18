import { barsPreset } from './bars';
import { nebulaPreset } from './nebula';
import { spectrumPreset } from './spectrum';
import type { VisualizerPreset } from './types';

/** Preset registry (realtime-visualization 01). Order = switcher order. */
export const PRESETS: VisualizerPreset[] = [barsPreset, spectrumPreset, nebulaPreset];

export const DEFAULT_PRESET_ID = barsPreset.id;

export function presetById(id: string): VisualizerPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}
