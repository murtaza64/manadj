/**
 * Pickup (sets 16) — pure predicate + mapping at the planner seam.
 *
 * The Conductor's inverse of takeover: adopt the current deck/mixer
 * state as a mix instant and resume Set playback from it. `evaluatePickup`
 * answers "does the live state map cleanly onto the plan?" — lit with the
 * mix instant when it does, unlit with a teaching reason when it doesn't
 * (glossary: Pickup; PRD grill round 4). Everything here is pure: the
 * runtime (Conductor.pickup) only executes the decision.
 *
 * Anchoring uses the Master-bus audibility model from Handover detection
 * (capture/detector.ts), with one deliberate difference: a PAUSED deck
 * still counts (the issue: the predicate is computed from mixer state
 * "even when paused" — picking up a parked deck resumes from its parked
 * position). A deck with no track loaded is never audible.
 *
 * Deck orientation: plan decks are ping-pong parity (entry i on A when i
 * is even). The user may have the anchor track on the OTHER physical
 * deck; the mapping is still clean — the plan is symmetric under an A↔B
 * swap, so the decision carries `flip` and `flipPlanDecks` mirrors the
 * plan for the Conductor to execute. This is mapping, not re-planning:
 * every instant, track, and Transition stays exactly as pinned.
 */
import { DEFAULT_DETECTOR_PARAMS } from '../capture/events';
import { bContentSegments, bTrackTimeAt } from '../editor/mixModel';
import type { ChannelId } from '../playback/mixer';
import { channelFaderToGain, crossfaderGains, trimToGain } from '../playback/mixerMath';
import type { PlanAutomation, PlannedAdjacency, PlannedEntry, SetPlan } from './planner';

/** Default alignment tolerance for the two-deck blend case: the
 * Conductor's drift tolerance (issue 16). Tunable — but raising it past
 * the drift tolerance means the non-dominant deck can be adopted far
 * enough off-plan that the first post-ramp drift check re-seeks it
 * audibly (the plan and the deck genuinely disagree; something gives). */
export const DEFAULT_PICKUP_TOLERANCE_S = 0.12;

/** Default mixer/pitch convergence ramp at the pickup instant. */
export const DEFAULT_PICKUP_RAMP_SEC = 1.5;

/** Keep the mapped instant strictly inside the audible span: at an exact
 * boundary planStateAt would already call the anchor not-playing and the
 * Conductor would pause it — audibly destructive. */
const SPAN_EPS = 1e-3;

export interface PickupDeckSnapshot {
  trackId: number | null;
  /** Playhead in track seconds (paused decks report their parked spot). */
  playheadSec: number;
  playing: boolean;
  pitchPercent: number;
}

/** Base mixer channel state, in the Mixer's domain (fader/EQ 0..1,
 * filter −1..1) — the same fields the audibility model reads. */
export interface PickupChannelSnapshot {
  trim: number;
  fader: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
}

export interface PickupSnapshot {
  decks: Record<ChannelId, PickupDeckSnapshot>;
  channels: Record<ChannelId, PickupChannelSnapshot>;
  crossfader: number;
  crossfaderEnabled: boolean;
}

export interface PickupParams {
  /** Two-deck alignment tolerance, in incoming-track seconds. */
  toleranceSec?: number;
}

export type PickupUnlitReason =
  | 'no-audible-deck'
  | 'not-in-set'
  | 'outside-span'
  | 'non-adjacent'
  | 'misaligned';

export type PickupDecision =
  | {
      lit: true;
      /** The adopted mix instant. */
      mixTime: number;
      /** The plan must be deck-mirrored (flipPlanDecks) to put the
       * anchor's entry on its physical deck. */
      flip: boolean;
      /** The audible (anchor) decks — untouchable at the instant; their
       * pitch converges by ramp instead of snapping. */
      anchors: ChannelId[];
    }
  | { lit: false; reason: PickupUnlitReason; message: string };

// ── Snapshot capture (narrow reads, recorder.ts's seam style) ───────────

/** What the snapshot needs from the Mixer (base state only — the
 * automation overlay is the Conductor's own writing, ADR 0022). */
export interface PickupMixerReads {
  getChannelState(ch: ChannelId): {
    trim: number;
    fader: number;
    eq: { low: number; mid: number; high: number };
    filter: number;
  };
  getCrossfader(): number;
  getCrossfaderEnabled(): boolean;
}

/** What the snapshot needs from a deck's engine. */
export interface PickupDeckReads {
  getSnapshot(): { trackId: number | null; playing: boolean; pitchPercent: number };
  getPlayhead(): number;
}

/** One coherent read of the live state the predicate anchors on. */
export function readPickupSnapshot(
  mixer: PickupMixerReads,
  engines: Record<ChannelId, PickupDeckReads>
): PickupSnapshot {
  const deckOf = (ch: ChannelId): PickupDeckSnapshot => {
    const s = engines[ch].getSnapshot();
    return {
      trackId: s.trackId,
      playheadSec: engines[ch].getPlayhead(),
      playing: s.playing,
      pitchPercent: s.pitchPercent,
    };
  };
  const channelOf = (ch: ChannelId): PickupChannelSnapshot => {
    const c = mixer.getChannelState(ch);
    return { trim: c.trim, fader: c.fader, eq: { ...c.eq }, filter: c.filter };
  };
  return {
    decks: { A: deckOf('A'), B: deckOf('B') },
    channels: { A: channelOf('A'), B: channelOf('B') },
    crossfader: mixer.getCrossfader(),
    crossfaderEnabled: mixer.getCrossfaderEnabled(),
  };
}

// ── Audibility (Master-bus model, paused decks count) ───────────────────

const { audibleGain, eqKillBelow, filterKillBeyond } = DEFAULT_DETECTOR_PARAMS;

/** detector.ts's deckAudible without the transport gate: would this
 * channel be audible on the Master bus if its deck ran? */
function channelAudible(snap: PickupSnapshot, ch: ChannelId): boolean {
  if (snap.decks[ch].trackId === null) return false;
  const c = snap.channels[ch];
  if (c.eq.low <= eqKillBelow && c.eq.mid <= eqKillBelow && c.eq.high <= eqKillBelow) {
    return false;
  }
  if (Math.abs(c.filter) >= filterKillBeyond) return false;
  return channelGain(snap, ch) >= audibleGain;
}

function xfGain(snap: PickupSnapshot, ch: ChannelId): number {
  const xf = crossfaderGains(snap.crossfaderEnabled ? snap.crossfader : 0);
  return ch === 'A' ? xf.a : xf.b;
}

function channelGain(snap: PickupSnapshot, ch: ChannelId): number {
  const c = snap.channels[ch];
  return trimToGain(c.trim) * channelFaderToGain(c.fader) * xfGain(snap, ch);
}

// ── Track time → mix time (the inverse of playingTrackTimeAt) ───────────

type Windowed = Extract<PlannedAdjacency, { kind: 'transition' | 'take' }>;

const isWindowed = (adj: PlannedAdjacency | undefined): adj is Windowed =>
  adj !== undefined && adj.kind !== 'hardcut';

/** Authored window axis → global mix time (inverse of authoredLocalAt). */
function mixFromAuthored(adj: Windowed, authored: number): number {
  return adj.mixStartSec + (authored - adj.transition.startSec) / adj.rateOutgoing;
}

/**
 * The mix instant at which entry `idx` plays track time `tau`, or null
 * when no such instant exists inside the entry's audible span (outside
 * [entrySec, exitSec], or content a Jump skips over). Piecewise inverse
 * of the planner's playingTrackTimeAt: the entry window's segment walk,
 * the Tempo return quadratic, else the solo anchor.
 */
export function mixTimeForTrackTime(plan: SetPlan, idx: number, tau: number): number | null {
  const entry = plan.entries[idx];
  if (!entry) return null;
  if (tau < entry.entrySec - SPAN_EPS || tau > entry.exitSec + SPAN_EPS) return null;
  const clampSpan = (t: number) =>
    Math.min(Math.max(t, entry.entryMixSec), entry.exitMixSec - SPAN_EPS);

  const entryAdj = idx > 0 ? plan.adjacencies[idx - 1] : undefined;
  if (isWindowed(entryAdj)) {
    const w = entryAdj;
    const tr = w.transition;
    // Inside the entry window: B advances at rateIncoming between Jump
    // events — invert per content segment (durB unbounded: the entry's
    // own exitSec already bounds tau).
    for (const seg of bContentSegments(tr, Number.POSITIVE_INFINITY, w.rateIncoming)) {
      const authored = seg.mixStartSec + (tau - seg.bStartSec) / w.rateIncoming;
      if (authored < seg.mixStartSec - SPAN_EPS || authored >= seg.mixEndSec) continue;
      const t = mixFromAuthored(w, authored);
      if (t < w.mixStartSec - SPAN_EPS || t >= w.mixEndSec) continue;
      return clampSpan(t);
    }
    // Through the Tempo return: trackTime = b + r·x + (1−r)x²/(2d).
    const d = w.tempoReturnEndSec - w.mixEndSec;
    if (d > 0) {
      const r = w.rateIncoming;
      const b = bTrackTimeAt(tr, tr.startSec + tr.durationSec, r);
      const endTau = b + r * d + ((1 - r) * d) / 2; // trackTime at ramp end
      if (tau >= b - SPAN_EPS && tau < endTau) {
        const a = (1 - r) / (2 * d);
        let x: number;
        if (Math.abs(a) < 1e-9) {
          x = (tau - b) / r;
        } else {
          const disc = r * r - 4 * a * (b - tau);
          if (disc < 0) return null;
          x = (-r + Math.sqrt(disc)) / (2 * a);
        }
        if (x >= 0 && x < d) return clampSpan(w.mixEndSec + x);
        return null;
      }
    }
  }
  // Solo anchor (also the outgoing's regime inside its EXIT window — the
  // authored axis is its own track time at its solo rate).
  const t = entry.mixOffsetSec + tau / entry.rate;
  const soloFrom = isWindowed(entryAdj) ? entryAdj.tempoReturnEndSec : entry.entryMixSec;
  if (t < soloFrom - SPAN_EPS) return null;
  return clampSpan(t);
}

// ── The predicate ────────────────────────────────────────────────────────

/**
 * Would a Pickup at this instant map cleanly? Lit with the mix instant
 * and anchor decks, or unlit with the reason that teaches the fix.
 */
export function evaluatePickup(
  plan: SetPlan,
  snap: PickupSnapshot,
  params: PickupParams = {}
): PickupDecision {
  if (plan.entries.length === 0) {
    return { lit: false, reason: 'not-in-set', message: 'The set is empty' };
  }
  const audible = (['A', 'B'] as const).filter((ch) => channelAudible(snap, ch));
  if (audible.length === 0) {
    return {
      lit: false,
      reason: 'no-audible-deck',
      message: 'No audible deck to anchor on — bring a set track into the mix',
    };
  }
  if (audible.length === 1) return oneDeckPickup(plan, snap, audible[0]);
  return twoDeckPickup(plan, snap, audible, params.toleranceSec ?? DEFAULT_PICKUP_TOLERANCE_S);
}

const deckName = (ch: ChannelId) => `Deck ${ch}`;

const otherDeck = (ch: ChannelId): ChannelId => (ch === 'A' ? 'B' : 'A');

function oneDeckPickup(plan: SetPlan, snap: PickupSnapshot, ch: ChannelId): PickupDecision {
  const deck = snap.decks[ch];
  const candidates = plan.entries
    .map((e, i) => ({ entry: e, idx: i }))
    .filter((c) => c.entry.trackId === deck.trackId);
  if (candidates.length === 0) {
    return {
      lit: false,
      reason: 'not-in-set',
      message: `${deckName(ch)}'s track is not in the set`,
    };
  }
  // Prefer the parity-matching entry (no flip); flipped entries map just
  // as cleanly when the track sits on the other physical deck.
  candidates.sort((a, b) => Number(b.entry.deck === ch) - Number(a.entry.deck === ch));
  for (const { entry, idx } of candidates) {
    const t = mixTimeForTrackTime(plan, idx, deck.playheadSec);
    if (t === null) continue;
    return { lit: true, mixTime: t, flip: entry.deck !== ch, anchors: [ch] };
  }
  return {
    lit: false,
    reason: 'outside-span',
    message: `${deckName(ch)} is outside its planned span — this moment is silent in the set`,
  };
}

function twoDeckPickup(
  plan: SetPlan,
  snap: PickupSnapshot,
  audible: ChannelId[],
  toleranceSec: number
): PickupDecision {
  // The audibly dominant deck anchors reasons ("fade the OTHER one out").
  const [dom, other] =
    channelGain(snap, audible[0]) >= channelGain(snap, audible[1])
      ? [audible[0], audible[1]]
      : [audible[1], audible[0]];
  const fadeHint = `fade ${deckName(other)} out and the button lights`;

  const inSet = (ch: ChannelId) => plan.entries.some((e) => e.trackId === snap.decks[ch].trackId);
  if (!inSet(dom) || !inSet(other)) {
    const stray = inSet(dom) ? other : dom;
    return {
      lit: false,
      reason: 'not-in-set',
      message: `${deckName(stray)}'s track is not in the set — fade ${deckName(stray)} out and the button lights`,
    };
  }

  // Adjacent entries whose tracks sit on the two audible decks (either
  // orientation). Track both a candidate and the sharpest failure.
  let failure: PickupDecision | null = null;
  for (let i = 0; i < plan.adjacencies.length; i++) {
    const outEntry = plan.entries[i];
    const inEntry = plan.entries[i + 1];
    const outDeck = (['A', 'B'] as const).find(
      (ch) =>
        snap.decks[ch].trackId === outEntry.trackId &&
        snap.decks[otherDeck(ch)].trackId === inEntry.trackId
    );
    if (!outDeck) continue;
    const inDeck = otherDeck(outDeck);
    const adj = plan.adjacencies[i];
    if (!isWindowed(adj)) {
      failure ??= {
        lit: false,
        reason: 'misaligned',
        message: `The plan hard-cuts between these tracks (no blend) — ${fadeHint}`,
      };
      continue;
    }
    // The blend instant from the audibly DOMINANT deck (the anchor whose
    // seamlessness matters most): the outgoing's window regime IS its
    // solo mapping; the incoming inverts the window walk. Required inside
    // the window and both spans.
    const t =
      dom === inDeck
        ? mixTimeForTrackTime(plan, i + 1, snap.decks[inDeck].playheadSec)
        : outEntry.mixOffsetSec + snap.decks[outDeck].playheadSec / outEntry.rate;
    if (
      t === null ||
      t < adj.mixStartSec - SPAN_EPS ||
      t >= Math.min(adj.mixEndSec, outEntry.exitMixSec) ||
      t < inEntry.entryMixSec - SPAN_EPS
    ) {
      failure ??= {
        lit: false,
        reason: 'misaligned',
        message: `The decks are outside the planned window for this handover — ${fadeHint}`,
      };
      continue;
    }
    // The NON-dominant deck must sit within tolerance of the pinned
    // Transition at that instant (any residue lands on it, not the anchor).
    const offDeck = dom === inDeck ? outDeck : inDeck;
    const expected =
      offDeck === outDeck
        ? (t - outEntry.mixOffsetSec) * outEntry.rate
        : bTrackTimeAt(
            adj.transition,
            adj.transition.startSec + (t - adj.mixStartSec) * adj.rateOutgoing,
            adj.rateIncoming
          );
    const off = snap.decks[offDeck].playheadSec - expected;
    if (Math.abs(off) > toleranceSec) {
      failure ??= {
        lit: false,
        reason: 'misaligned',
        message: `${deckName(offDeck)} is ${Math.abs(off).toFixed(2)}s off the pinned Transition — ${fadeHint}`,
      };
      continue;
    }
    const clamped = Math.min(Math.max(t, adj.mixStartSec), adj.mixEndSec - SPAN_EPS);
    return { lit: true, mixTime: clamped, flip: outEntry.deck !== outDeck, anchors: [dom, other] };
  }
  return (
    failure ?? {
      lit: false,
      reason: 'non-adjacent',
      message: `The two audible tracks are not adjacent in the set — ${fadeHint}`,
    }
  );
}

// ── Execution helpers (pure; the runtime applies them) ──────────────────

/** Mirror a plan's physical deck assignment (A↔B). planStateAt derives
 * decks and lanes from entry.deck alone, so this transform is complete. */
export function flipPlanDecks(plan: SetPlan): SetPlan {
  const flip = (d: PlannedEntry['deck']): PlannedEntry['deck'] => (d === 'A' ? 'B' : 'A');
  return { ...plan, entries: plan.entries.map((e) => ({ ...e, deck: flip(e.deck) })) };
}

/**
 * The convergence ramp's starting automation values: the CURRENT base
 * mixer state, with the crossfader's gain contribution folded into each
 * fader (the automation overlay pins the crossfader neutral, and fader
 * gain is value² — value·√xf preserves the sounding gain at engage).
 */
export function pickupStartLanes(snap: PickupSnapshot): Record<ChannelId, PlanAutomation> {
  const lane = (ch: ChannelId): PlanAutomation => {
    const c = snap.channels[ch];
    return {
      fader: c.fader * Math.sqrt(xfGain(snap, ch)),
      eq: { ...c.eq },
      filter: c.filter,
    };
  };
  return { A: lane('A'), B: lane('B') };
}
