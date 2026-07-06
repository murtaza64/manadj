/**
 * Live re-plan (sets 24) — pure remap + sounding-window graft at the
 * planner seam.
 *
 * While the Conductor plays, any plan-input change (a Transition edit,
 * a re-pin / auto-fill, a Dormant restore, a tempo change, a reorder)
 * recomputes the plan; the Conductor continues seamlessly in the new
 * one. The remap is Pickup's anchor mapping reused, run internally by
 * the Conductor itself: anchor on the audibly dominant deck at its
 * current PLAN track-time, map that track-time into the new plan
 * (mixTimeForTrackTime), leave the anchor untouched, reconcile only
 * silent decks. A live re-plan is "an automatic Pickup into the new
 * plan" — same invariants, no button.
 *
 * Deliberately NOT the user-facing predicate (evaluatePickup): that
 * gate refuses any non-'shared' audible-surface holder (sets 25), and
 * during a re-plan the holder is the Conductor itself — the normal
 * case here, not a refusal case. This seam consumes plans only; the
 * live engines never enter (drift stays the drift check's business).
 *
 * THE SOUNDING-WINDOW RULE (decided in the issue): geometry changes
 * (start, duration, B-entry alignment, jumps, tempo-match) to the
 * adjacency currently sounding mid-window are DEFERRED — the active
 * window completes as it was; the new geometry applies downstream and
 * on any later replay. Its lane VALUES apply live (swapping automation
 * values under the playhead is riding the mix — the editor's idiom).
 * The graft is input-level: re-running planSet with the sounding
 * adjacency's old geometry keeps every cascaded consequence (grace
 * fades, tempo returns, downstream offsets) correct by construction —
 * a plan-level splice would have to re-derive all of them.
 */
import { DEFAULT_DETECTOR_PARAMS } from '../capture/events';
import type { Transition } from '../editor/mixModel';
import type { ChannelId } from '../playback/mixer';
import { channelFaderToGain } from '../playback/mixerMath';
import { mixTimeForTrackTime } from './pickup';
import {
  planStateAt,
  type PlanAutomation,
  type PlanInput,
  type SetPlan,
} from './planner';

/** The pin uuid the graft plans a frozen sounding window under, when the
 * live pin no longer matches it (re-pin / unpin mid-window). */
export const GRAFT_PIN_UUID = '__live-window-graft__';

export type ReplanDecision =
  | {
      ok: true;
      /** The remapped mix instant in the new plan. */
      mixTime: number;
      /** The new plan must be deck-mirrored (flipPlanDecks) to keep the
       * anchor's entry on its physical deck. */
      flip: boolean;
      /** The audibly dominant deck the mapping anchored on. */
      anchor: ChannelId;
    }
  | {
      ok: false;
      /** anchor-gone: the anchor's track left the Set (mid-playback
       * reorder/removal). unmappable: the track remains but its current
       * moment maps nowhere audible in the new plan. */
      reason: 'empty-plan' | 'anchor-gone' | 'unmappable';
      anchorTrackId: number | null;
    };

const { eqKillBelow, filterKillBeyond } = DEFAULT_DETECTOR_PARAMS;

/** The Conductor's DRIFT_TOLERANCE_S: the largest span clamp that is
 * guaranteed inaudible (the post-remap drift check never trips on it). */
const CLAMP_TOLERANCE_S = 0.12;

/** A deck's Master-bus gain under the Conductor's automation (crossfader
 * pinned neutral): pickup.ts's audibility model read from PLAN lanes. */
function laneGain(lanes: PlanAutomation): number {
  const eqKilled =
    lanes.eq.low <= eqKillBelow &&
    lanes.eq.mid <= eqKillBelow &&
    lanes.eq.high <= eqKillBelow;
  if (eqKilled || Math.abs(lanes.filter) >= filterKillBeyond) return 0;
  return channelFaderToGain(lanes.fader);
}

/**
 * Map the ongoing run (old exec plan @ mixTime) into the new plan.
 *
 * Anchor selection: the audibly dominant playing deck by plan-lane gain
 * (both plans' orientations are physical — the exec plan is already
 * flipped when the run is). At a silent instant (a hard-cut gap, a
 * grace-truncated tail) the active entry anchors instead: nothing is
 * sounding, so nothing is audibly destructible.
 *
 * The anchor's track-time may sit a hair outside its new audible span
 * (FP residue, a tempo-return boundary): it is clamped in, but only
 * within the Conductor's drift tolerance — a sub-tolerance clamp never
 * re-seeks the anchor (the drift check stays silent by construction).
 * Beyond that, the anchor's current moment genuinely does not exist in
 * the new plan (a window dragged wholly across the playhead): mapping
 * it anywhere would jump the sounding deck — audibly destructive — so
 * the decision is `unmappable` and the runtime stands down, surfacing
 * the state exactly like Pickup's outside-span case.
 */
export function evaluateReplan(
  oldExecPlan: SetPlan,
  mixTime: number,
  newPlan: SetPlan
): ReplanDecision {
  if (newPlan.entries.length === 0) {
    return { ok: false, reason: 'empty-plan', anchorTrackId: null };
  }
  const state = planStateAt(oldExecPlan, mixTime);
  const playing = (['A', 'B'] as const).filter((ch) => state.decks[ch].playing);

  let anchor: ChannelId;
  let anchorTrackId: number | null;
  let tau: number;
  let oldIdx: number;
  if (playing.length === 0) {
    // Silent instant: anchor bookkeeping on the active entry.
    const idx = state.activeEntryIndex;
    const entry = oldExecPlan.entries[idx];
    if (!entry) return { ok: false, reason: 'unmappable', anchorTrackId: null };
    anchor = entry.deck;
    const d = state.decks[entry.deck];
    if (d.entryIndex === idx && d.trackId !== null) {
      anchorTrackId = d.trackId;
      tau = d.trackTime;
    } else {
      anchorTrackId = entry.trackId;
      tau = entry.exitSec;
    }
    oldIdx = idx;
  } else {
    anchor =
      playing.length === 1
        ? playing[0]
        : laneGain(state.lanes[playing[0]]) >= laneGain(state.lanes[playing[1]])
          ? playing[0]
          : playing[1];
    const d = state.decks[anchor];
    anchorTrackId = d.trackId;
    tau = d.trackTime;
    oldIdx = d.entryIndex ?? state.activeEntryIndex;
  }
  if (anchorTrackId === null) {
    return { ok: false, reason: 'unmappable', anchorTrackId: null };
  }

  // The anchor's entry in the new plan: prefer the physical-deck match
  // (no flip), then the nearest index (reorders move entries; the same
  // track rarely appears twice).
  const candidates = newPlan.entries
    .map((entry, idx) => ({ entry, idx }))
    .filter((c) => c.entry.trackId === anchorTrackId)
    .sort(
      (a, b) =>
        Number(b.entry.deck === anchor) - Number(a.entry.deck === anchor) ||
        Math.abs(a.idx - oldIdx) - Math.abs(b.idx - oldIdx)
    );
  if (candidates.length === 0) {
    return { ok: false, reason: 'anchor-gone', anchorTrackId };
  }
  // Nothing sounding → nothing destructible: the clamp is unbounded at a
  // silent instant (a hard-cut gap can land anywhere reasonable).
  const clampLimit = playing.length === 0 ? Number.POSITIVE_INFINITY : CLAMP_TOLERANCE_S;
  for (const { entry, idx } of candidates) {
    const tauClamped = Math.min(Math.max(tau, entry.entrySec), entry.exitSec);
    if (Math.abs(tauClamped - tau) > clampLimit) continue;
    const t = mixTimeForTrackTime(newPlan, idx, tauClamped);
    if (t === null) continue;
    return { ok: true, mixTime: t, flip: entry.deck !== anchor, anchor };
  }
  return { ok: false, reason: 'unmappable', anchorTrackId };
}

// ── The sounding-window graft ────────────────────────────────────────────

/** The adjacency currently sounding mid-window in the exec plan (the
 * Tempo return after mixEnd is the incoming's solo — no window). The
 * transition carried is the EXECUTED one: already grafted geometry on a
 * re-replan, so the original deferral propagates until completion. */
export interface SoundingWindow {
  adjacencyIndex: number;
  outTrackId: number;
  inTrackId: number;
  pinUuid: string | null;
  transition: Transition;
}

/** A sounding window's identity across plan recomputes: the track pair,
 * as "out:in" (geometry and pins may change; the pair is the window). */
export const soundingWindowKey = (w: SoundingWindow | null): string | null =>
  w ? `${w.outTrackId}:${w.inTrackId}` : null;

export function soundingWindowAt(execPlan: SetPlan, mixTime: number): SoundingWindow | null {
  let found: SoundingWindow | null = null;
  execPlan.adjacencies.forEach((adj, i) => {
    if (adj.kind === 'hardcut') return;
    if (mixTime < adj.mixStartSec || mixTime >= adj.mixEndSec) return;
    found = {
      adjacencyIndex: i,
      outTrackId: execPlan.entries[i].trackId,
      inTrackId: execPlan.entries[i + 1].trackId,
      pinUuid: adj.pinUuid ?? null,
      transition: adj.transition,
    };
  });
  return found;
}

/**
 * The editor's live Conductor playhead (sets 38): where the ongoing run
 * sits on the AUTHORED axis of the editor timeline whose loaded
 * transition is `transitionUuid` (the outgoing track's own time — the
 * Sketch origin invariant), or null when the marker must hide (the plan
 * doesn't execute this pin, nothing of the pair sounds, a re-pin
 * mid-window — the graft plans the frozen window under GRAFT_PIN_UUID,
 * matching nothing).
 *
 * Inside the window the mapping is the planner's authoredLocalAt,
 * computed from the EXECUTED adjacency's geometry: during a deferred
 * geometry edit (the graft) the editor draws the NEW window while the
 * Conductor executes the OLD — the executed mapping is the truthful one.
 * Outside the window (park-review feedback) the marker follows the pair
 * across the whole timeline: the outgoing's audible span maps directly
 * (deck track-time = authored time), and the incoming's tail maps back
 * through the window's B alignment (bInSec / rateIncoming) onto where
 * that B content is drawn.
 */
export function authoredPlayheadAt(
  execPlan: SetPlan,
  mixTime: number,
  transitionUuid: string
): number | null {
  const i = execPlan.adjacencies.findIndex(
    (a) => a.kind !== 'hardcut' && a.pinUuid === transitionUuid
  );
  if (i < 0) return null;
  const adj = execPlan.adjacencies[i];
  if (adj.kind === 'hardcut') return null; // unreachable; narrows the type
  if (mixTime >= adj.mixStartSec && mixTime < adj.mixEndSec) {
    const authored =
      adj.transition.startSec + (mixTime - adj.mixStartSec) * adj.rateOutgoing;
    const f = (authored - adj.transition.startSec) / adj.transition.durationSec;
    return f >= 0 && f < 1 ? authored : null;
  }
  // Outside the window: the pair's deck must actually be sounding at the
  // pair's entry (ping-pong reuses decks — a later entry on the same deck
  // must not claim the marker).
  const state = planStateAt(execPlan, mixTime);
  const side = mixTime < adj.mixStartSec ? i : i + 1;
  const entry = execPlan.entries[side];
  const deck = state.decks[entry.deck];
  if (!deck.playing || deck.entryIndex !== side || deck.trackId !== entry.trackId) {
    return null;
  }
  return side === i
    ? deck.trackTime // the outgoing IS the authored axis
    : adj.transition.startSec + (deck.trackTime - adj.transition.bInSec) / adj.rateIncoming;
}

const jumpsEqual = (a: Transition['jumps'], b: Transition['jumps']): boolean =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

const sameGeometry = (a: Transition, b: Transition): boolean =>
  a.startSec === b.startSec &&
  a.durationSec === b.durationSec &&
  a.bInSec === b.bInSec &&
  a.tempoMatch === b.tempoMatch &&
  jumpsEqual(a.jumps, b.jumps);

/**
 * Defer the sounding window's geometry: a PlanInput whose adjacency for
 * (outTrackId → inTrackId) resolves to a transition with the SOUNDING
 * geometry — new lane values when the same pin is still pinned (lanes
 * ride live), the whole old transition when the pin changed mid-window
 * (the active window completes exactly as it was).
 *
 * Null = no graft needed: the pair is no longer adjacent (the window
 * collapses at the playhead — the remap handles it), or nothing about
 * the geometry changed.
 */
export function graftSoundingWindow(
  input: PlanInput,
  sounding: SoundingWindow
): PlanInput | null {
  const i = input.entries.findIndex(
    (e, idx) =>
      e.trackId === sounding.outTrackId &&
      input.entries[idx + 1]?.trackId === sounding.inTrackId
  );
  if (i < 0) return null;
  const old = sounding.transition;
  const pin = input.entries[i].pin;
  if (pin?.kind === 'transition' && pin.uuid === sounding.pinUuid) {
    const fresh = input.transitionsByUuid[pin.uuid];
    if (fresh) {
      if (sameGeometry(fresh, old)) return null; // values-only edit: no deferral
      const merged: Transition = {
        ...fresh,
        startSec: old.startSec,
        durationSec: old.durationSec,
        bInSec: old.bInSec,
        tempoMatch: old.tempoMatch,
        jumps: old.jumps,
      };
      return {
        ...input,
        transitionsByUuid: { ...input.transitionsByUuid, [pin.uuid]: merged },
      };
    }
  }
  // A Take pin still pinned re-vectorizes deterministically — same
  // geometry by construction, nothing to defer.
  if (pin?.kind === 'take' && pin.uuid === sounding.pinUuid) return null;
  // Re-pin / unpin / dangling pin mid-window: freeze the window whole.
  return {
    ...input,
    entries: input.entries.map((e, idx) =>
      idx === i ? { ...e, pin: { kind: 'transition' as const, uuid: GRAFT_PIN_UUID } } : e
    ),
    transitionsByUuid: { ...input.transitionsByUuid, [GRAFT_PIN_UUID]: old },
  };
}
