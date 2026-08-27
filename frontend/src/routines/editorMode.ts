/**
 * Mix-editor modal editing (ADR 0038, gh#207 slice 1): explicit top-level
 * MODES gate pointer gestures on the timeline canvas — select (V), pan (H),
 * jump (J) — replacing the accreted gesture overloads (dblclick=jump,
 * alt+dblclick=pause, scrub-vs-select collisions). Chrome (popovers, Linked,
 * transport) and navigation (seek, wheel) stay modeless.
 *
 * Doctrine (from the grill):
 * - Letter keys are canonical (V/H/J); digits stay free for hot cues.
 * - Pan is BOTH a sticky mode and a hold-`H` momentary quasimode: a TAP of
 *   H switches sticky; a HOLD (≥ HOLD_TAP_MS) reverts to the prior mode on
 *   release. Explicit switches (V/J, toolbar) during a hold cancel the
 *   revert — the user changed their mind mid-hold.
 * - Two-tier Escape lives in the timeline (it owns the transient state);
 *   this module only exposes the "home" mode.
 * - Modes persist within a session (working posture, not artifact state):
 *   the state lives in the view shell and survives artifact switches.
 */
import { useCallback, useEffect, useState } from 'react';
import { isTypingTarget } from '../components/performance/performanceKeys';

export type EditorMode = 'select' | 'pan' | 'jump';

export const HOME_MODE: EditorMode = 'select';

/** Tap-vs-hold boundary for the H quasimode (ms). */
export const HOLD_TAP_MS = 250;

export const MODE_KEYS: Record<string, EditorMode> = {
  v: 'select',
  h: 'pan',
  j: 'jump',
};

export const MODE_LABELS: Record<EditorMode, string> = {
  select: 'select',
  pan: 'pan',
  jump: 'jump',
};

export const MODE_KEY_HINTS: Record<EditorMode, string> = {
  select: 'V',
  pan: 'H',
  jump: 'J',
};

export const MODE_TITLES: Record<EditorMode, string> = {
  select:
    'Select (V) — click a slot to select; drag horizontally to slide its track; ' +
    'cmd-click toggles, shift-click extends; trim handles live here',
  pan: 'Pan (H) — drag to pan the view; hold H from any mode for momentary pan',
  jump:
    'Jump (J) — click a slot row to insert a jump at that beat ' +
    '(pause is an option in the popup); click a marker to edit it',
};

// ── Pure quasimode machine (the testable seam) ─────────────────────────

export interface ModeMachineState {
  mode: EditorMode;
  /** Mode to return to if the current H press turns out to be a HOLD. */
  holdReturn: EditorMode | null;
  /** Timestamp of the H keydown, null when no hold is pending. */
  holdDownAt: number | null;
}

export function initialModeState(mode: EditorMode = HOME_MODE): ModeMachineState {
  return { mode, holdReturn: null, holdDownAt: null };
}

/** An explicit switch (toolbar click, V/J key): cancels any pending hold —
 * the user chose a mode mid-hold; releasing H must not undo that. */
export function explicitSwitch(s: ModeMachineState, mode: EditorMode): ModeMachineState {
  return { mode, holdReturn: null, holdDownAt: null };
}

export function modeKeyDown(
  s: ModeMachineState,
  key: string,
  now: number,
  repeat = false
): ModeMachineState {
  const target = MODE_KEYS[key];
  if (!target || repeat) return s;
  if (target !== 'pan') return explicitSwitch(s, target);
  // H: arm the quasimode only when it changes the mode (H while already
  // sticky-pan is a no-op — nothing to return to).
  if (s.mode === 'pan') return s;
  return { mode: 'pan', holdReturn: s.mode, holdDownAt: now };
}

export function modeKeyUp(s: ModeMachineState, key: string, now: number): ModeMachineState {
  if (MODE_KEYS[key] !== 'pan') return s;
  if (s.holdDownAt === null) return s;
  const held = now - s.holdDownAt >= HOLD_TAP_MS;
  return held
    ? { mode: s.holdReturn ?? HOME_MODE, holdReturn: null, holdDownAt: null }
    : { mode: s.mode, holdReturn: null, holdDownAt: null };
}

// ── Hook ────────────────────────────────────────────────────────────────

/** Mode state + V/H/J key handling while `active`. Returns the mode and an
 * explicit setter (toolbar / Escape-home). */
export function useEditorMode(active: boolean): [EditorMode, (m: EditorMode) => void] {
  const [state, setState] = useState<ModeMachineState>(() => initialModeState());
  const setMode = useCallback((m: EditorMode) => {
    setState((s) => explicitSwitch(s, m));
  }, []);
  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (!MODE_KEYS[key]) return;
      e.preventDefault();
      setState((s) => modeKeyDown(s, key, performance.now(), e.repeat));
    };
    const up = (e: KeyboardEvent) => {
      // Releases must land even from a typing target or with a modifier
      // held mid-release — the quasimode must never stick.
      const key = e.key.toLowerCase();
      if (!MODE_KEYS[key]) return;
      setState((s) => modeKeyUp(s, key, performance.now()));
    };
    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    return () => {
      document.removeEventListener('keydown', down);
      document.removeEventListener('keyup', up);
    };
  }, [active]);
  return [state.mode, setMode];
}
