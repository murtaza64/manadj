import { writeSetting } from '../settings/persistedSettings';

export const FILTER_MODELS = [
  {
    id: 'current',
    name: 'Original 12 dB',
    description:
      'The original manadj response: fixed resonance, 80 Hz / 8 kHz endpoints and an open low-pass at center.',
  },
  {
    id: 'res12',
    name: 'Resonant 12 dB',
    description: 'One resonant stage. A broad, open sweep.',
  },
  {
    id: 'res24',
    name: 'Resonant 24 dB',
    description: 'Two stages with resonance on the sharper stage.',
  },
  {
    id: 'res48',
    name: 'Steep 48 dB',
    description: 'Four stages for a steeper cutoff and a sharper edge.',
  },
  {
    id: 'dual',
    name: 'Twin peak 24 dB',
    description:
      'Two resonant stages with separated cutoffs. Spread sets their distance.',
  },
] as const;
export type FilterModel = (typeof FILTER_MODELS)[number]['id'];
export interface FilterSettings {
  model: FilterModel;
  resonance: number;
  compensation: number;
  curve: number;
  deadzone: number;
  lpMin: number;
  hpMax: number;
  spread: number;
  drive: number;
  trim: number;
  smoothing: number;
}

export const DEFAULT_FILTER_SETTINGS: Readonly<FilterSettings> = Object.freeze({
  model: 'res24',
  resonance: 17,
  compensation: 0.15,
  curve: 1,
  deadzone: 0.03,
  lpMin: 40,
  hpMax: 16000,
  spread: 0.8,
  drive: 0,
  trim: 0,
  smoothing: 20,
});
export const FILTER_PARAMETER_RANGES = {
  resonance: [0, 24, 0.1],
  compensation: [0, 1, 0.01],
  curve: [0.35, 2.5, 0.05],
  deadzone: [0, 0.12, 0.005],
  lpMin: [20, 300, 5],
  hpMax: [2000, 20000, 100],
  spread: [0, 2, 0.1],
  drive: [0, 18, 0.5],
  trim: [-18, 12, 0.5],
  smoothing: [5, 100, 5],
} as const;
export const FILTER_SETTINGS_KEY = 'manadj-filter-settings';

export function sanitizeFilterSettings(
  value: unknown,
): Readonly<FilterSettings> {
  const next = { ...DEFAULT_FILTER_SETTINGS };
  if (!value || typeof value !== 'object') return Object.freeze(next);
  const input = value as Record<string, unknown>;
  if (FILTER_MODELS.some((model) => model.id === input.model))
    next.model = input.model as FilterModel;
  for (const key of Object.keys(
    FILTER_PARAMETER_RANGES,
  ) as (keyof typeof FILTER_PARAMETER_RANGES)[]) {
    const v = input[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [min, max] = FILTER_PARAMETER_RANGES[key];
    next[key] = Math.max(min, Math.min(max, v));
  }
  return Object.freeze(next);
}

export function loadFilterSettings(): Readonly<FilterSettings> {
  try {
    return sanitizeFilterSettings(
      JSON.parse(localStorage.getItem(FILTER_SETTINGS_KEY) ?? 'null'),
    );
  } catch {
    return DEFAULT_FILTER_SETTINGS;
  }
}

export function saveFilterSettings(settings: Readonly<FilterSettings>): void {
  writeSetting(FILTER_SETTINGS_KEY, JSON.stringify(settings));
}
