import { writeSetting } from '../settings/persistedSettings';

export interface BeatFxSettings {
  echoFeedback: number;
  echoSaturation: number;
  reverbDecay: number;
  reverbDampingHz: number;
  reverbStereoWidth: number;
  flangerDelayMs: number;
  flangerWidthMs: number;
  flangerFeedback: number;
}

export const DEFAULT_BEAT_FX_SETTINGS: Readonly<BeatFxSettings> = Object.freeze({
  echoFeedback: 0.5,
  echoSaturation: 1,
  reverbDecay: 2.5,
  reverbDampingHz: 12000,
  reverbStereoWidth: 1,
  flangerDelayMs: 3,
  flangerWidthMs: 2,
  flangerFeedback: 0.35,
});

export const BEAT_FX_PARAMETER_RANGES = {
  echoFeedback: [0, 0.9, 0.01],
  echoSaturation: [0, 4, 0.1],
  reverbDecay: [0.5, 8, 0.1],
  reverbDampingHz: [1000, 20000, 100],
  reverbStereoWidth: [0, 1, 0.01],
  flangerDelayMs: [1, 10, 0.1],
  flangerWidthMs: [0, 5, 0.1],
  flangerFeedback: [0, 0.9, 0.01],
} as const;

export const BEAT_FX_SETTINGS_KEY = 'manadj-beat-fx-settings';

export function sanitizeBeatFxSettings(value: unknown): Readonly<BeatFxSettings> {
  const next = { ...DEFAULT_BEAT_FX_SETTINGS };
  if (!value || typeof value !== 'object') return Object.freeze(next);
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(BEAT_FX_PARAMETER_RANGES) as (keyof BeatFxSettings)[]) {
    const raw = input[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const [min, max] = BEAT_FX_PARAMETER_RANGES[key];
    next[key] = Math.max(min, Math.min(max, raw));
  }
  return Object.freeze(next);
}

export function loadBeatFxSettings(): Readonly<BeatFxSettings> {
  try {
    return sanitizeBeatFxSettings(
      JSON.parse(localStorage.getItem(BEAT_FX_SETTINGS_KEY) ?? 'null')
    );
  } catch {
    return DEFAULT_BEAT_FX_SETTINGS;
  }
}

export function saveBeatFxSettings(settings: Readonly<BeatFxSettings>): void {
  writeSetting(BEAT_FX_SETTINGS_KEY, JSON.stringify(settings));
}
