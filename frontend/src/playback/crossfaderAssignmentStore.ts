import type { ChannelId } from './mixer';

export const CROSSFADER_ASSIGNMENTS = ['left', 'thru', 'right'] as const;
export type CrossfaderAssignment = (typeof CROSSFADER_ASSIGNMENTS)[number];
export type CrossfaderAssignments = Record<ChannelId, CrossfaderAssignment>;

const STORAGE_KEY = 'manadj-crossfader-assignments';
const POSITION_STORAGE_KEY = 'manadj-crossfader-position';

export const DEFAULT_CROSSFADER_ASSIGNMENTS: CrossfaderAssignments = {
  A: 'left',
  B: 'right',
  C: 'left',
  D: 'right',
};

function isAssignment(value: unknown): value is CrossfaderAssignment {
  return CROSSFADER_ASSIGNMENTS.some((assignment) => assignment === value);
}

export function loadCrossfaderAssignments(): CrossfaderAssignments {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CROSSFADER_ASSIGNMENTS };
    const parsed = JSON.parse(raw) as Partial<Record<ChannelId, unknown>>;
    return Object.fromEntries(
      (Object.keys(DEFAULT_CROSSFADER_ASSIGNMENTS) as ChannelId[]).map((channel) => {
        const value = parsed[channel];
        return [channel, isAssignment(value) ? value : DEFAULT_CROSSFADER_ASSIGNMENTS[channel]];
      })
    ) as CrossfaderAssignments;
  } catch {
    return { ...DEFAULT_CROSSFADER_ASSIGNMENTS };
  }
}

export function saveCrossfaderAssignments(assignments: CrossfaderAssignments): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
  } catch {
    // Persistence is best-effort; the Mixer keeps the session state.
  }
}

export function loadCrossfaderPosition(): number {
  try {
    const value = Number(localStorage.getItem(POSITION_STORAGE_KEY));
    if (!Number.isFinite(value)) return 0;
    return Math.max(-1, Math.min(1, value));
  } catch {
    return 0;
  }
}

export function saveCrossfaderPosition(position: number): void {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, String(position));
  } catch {
    // Persistence is best-effort; the Mixer keeps the session state.
  }
}
