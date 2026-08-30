/**
 * Overview ladder (sets 03, freed in sets 05): the staircase minimap
 * above the Set list — prototype variant D's geometry (mirrored deck
 * lanes around a center line, titles on the outer edge, real hot cues on
 * the title side, transition/take bands, dashed-red-✕ hard cuts) on a
 * freely navigable mix-time axis.
 *
 * Free ladder (sets 05, replacing 03's list scroll-pin — see CONTEXT.md
 * "Overview ladder"): pan = native horizontal scroll; zoom = vertical
 * wheel (waveform convention), anchored at the cursor's mix-time — at
 * the playhead while follow is engaged. Default framing fits the whole
 * set up to ~10 minutes of mix (longer sets open on a 10-minute window);
 * the viewport persists per Set in the set store. The ladder and
 * the track list are independent surfaces converging on EVENTS only:
 * clicking the ladder SEEKS (Conductor), and under follow-playback the
 * ladder auto-scrolls DAW-style (paged — pan when the playhead crosses
 * ~78% of the viewport; a seek discontinuity centers instead). Manual
 * pan disengages follow; zoom never does.
 *
 * Four decks + Routines (sets #161, closing #159's deferred acceptance
 * item): when the plan allocates C/D (Routine spans), the ladder grows a
 * second mirrored braid (C up / D down under the A/B pair); Routine
 * spans render as full-height magenta bands (the cast bracket's color)
 * across their covered range; and every lane carries a per-deck
 * fader-LEVEL curve (prototype variant E) sampled from planStateAt —
 * authored window fades, recorded Routine choreography, and grace fades
 * all read from the same model the Conductor executes.
 */
import { ROUTINE_ACCENT } from '../theme/routineColor';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { bContentSegments } from '../editor/mixModel';
import { DECK_COLORS } from '../theme/deckColors';
import type { HotCue, Track } from '../types';
import type { DecodedWaveform } from '../waveform/blob';
import { useStyleSlot } from '../waveform/styleSlots';
import { useWaveformBlob } from '../waveform/useWaveformBlob';
import { cueCssColor } from '../hotcues/palette';
import { getConductor, setFollowPlayback } from './conductorStore';
import { WILL_RESTORE_COLOR, type AdjacencyFuture } from './dormancy';
import { drawStyledWave, MINIMAP_BRIGHTNESS } from './ladderWaveStyle';
import {
  WAVE_BG_COLOR,
  CUE_FLAG_POLE_W,
  CUE_FLAG_MINI_SIZE,
  PLAYHEAD_MACHINE,
} from '../theme/markers';
import { planColumnModulator } from './ladderPlanModulation';
import {
  planStateAt,
  type PlanDeck,
  type PlannedAdjacency,
  type PlannedEntry,
  type SetPlan,
} from './planner';
import { getLadderView, setLadderView } from './setStore';

const LANE_H = 46;
const TITLE_H = 13;
export const LADDER_H = LANE_H * 2 + 4;
/** The routine family's magenta (cast bracket, candidate chips). */
const ROUTINE_BAND_COLOR = ROUTINE_ACCENT;

// ── Four-deck lane geometry (sets #161) ────────────────────────────────
// Two-deck: the classic A/B mirrored braid. Four-deck: the PHYSICAL deck
// layout top-to-bottom — C, A, B, D (C above A, D below B) — the A/B
// braid stays central, the outboard decks flank it. Wave directions keep
// titles on each lane's outer edge.
const LANE_STRIDE = LANE_H + 2;
function laneTopFor(fourDeck: boolean): Record<PlanDeck, number> {
  return fourDeck
    ? { C: 0, A: LANE_STRIDE, B: LANE_STRIDE * 2, D: LANE_STRIDE * 3 }
    : { A: 0, B: LANE_STRIDE, C: LANE_STRIDE * 2, D: LANE_STRIDE * 3 };
}
const LANE_UP: Record<PlanDeck, boolean> = { A: true, B: false, C: true, D: false };
/** Max zoom: ~8s of mix per 100px. */
const MAX_PX_PER_SEC = 12.5;
/** Default framing shows at most this much mix — a whole hour-long set
 * squeezed into one viewport reads as noise, so long sets open zoomed to
 * a ~10-minute window instead (zoom 1 still means "whole set fits"). */
const DEFAULT_MAX_VISIBLE_S = 600;
/** Follow paging: pan when the playhead passes this viewport fraction,
 * landing it at the re-entry fraction. */
const PAGE_TRIGGER = 0.78;
const PAGE_REENTRY = 0.15;
/** A mix-time discontinuity this large is a seek — center, don't page. */
const SEEK_JUMP_S = 2;
/** Scroll events within this window of a programmatic scrollTo are ours,
 * not the user's (smooth scrolling animates through many events). */
const AUTO_SCROLL_WINDOW_MS = 700;
/** Shared empty-cues identity — a fresh [] per render would defeat the
 * LadderClip memo (issue 43). */
const EMPTY_CUES: HotCue[] = [];

// ── Clip-draw scheduler ────────────────────────────────────────────────
// Opening a Set mounts 20-40 clip canvases whose effects all want to
// rasterize in the same commit — at the 10-minute default framing (with
// 2x supersampling) that's a 100-200ms main-thread burst that visibly
// lags the pane. Instead, draws queue here and a rAF pump burns a fixed
// budget per frame: the pane paints immediately and clips fill in over a
// few frames. Zoom-settle and styles-mode redraws ride the same queue,
// so their bursts de-spike too.
const DRAW_BUDGET_MS = 6;
type DrawJob = { fn: () => void; cancelled: boolean };
const drawQueue: DrawJob[] = [];
let drawPumping = false;
function pumpDraws() {
  const start = performance.now();
  while (drawQueue.length > 0 && performance.now() - start < DRAW_BUDGET_MS) {
    const job = drawQueue.shift()!;
    if (!job.cancelled) job.fn();
  }
  if (drawQueue.length > 0) requestAnimationFrame(pumpDraws);
  else drawPumping = false;
}
/** Queue a clip draw; returns a canceller (effect cleanup — a superseded
 * draw must not run with stale props against a re-rendered canvas). */
function scheduleClipDraw(fn: () => void): () => void {
  const job: DrawJob = { fn, cancelled: false };
  drawQueue.push(job);
  if (!drawPumping) {
    drawPumping = true;
    requestAnimationFrame(pumpDraws);
  }
  return () => {
    job.cancelled = true;
  };
}

interface OverviewLadderProps {
  setId: number;
  plan: SetPlan;
  tracks: Map<number, Track>;
  hotCuesByTrack: Map<number, HotCue[]>;
  /** The Conductor is active on THIS set (playhead + follow live). */
  conducting: boolean;
  /** Follow-playback engaged (conductor store state). */
  follow: boolean;
  /** Ladder click: seek Set playback to a mix-time instant. */
  onSeek: (mixTimeSec: number) => void;
  /** Live drag preview (sets 07): the plan is HYPOTHETICAL and each
   * affected adjacency's future is marked — will-restore (a Dormant pin
   * waits), auto-resolves (a library Transition exists), unresolved.
   * Index-aligned with plan.adjacencies; null = unaffected. */
  previewFutures?: (AdjacencyFuture | null)[];
}

/** Memoized (issue 43): the ladder subtree is ~90 positioned divs plus a
 * canvas per entry — it must not re-render on unrelated pane commits
 * (query resolutions, selection). All props are identity-stable at the
 * call site: plan/tracks/cue-map from stable queries, onSeek ref-backed. */
export const OverviewLadder = memo(function OverviewLadder({
  setId,
  plan,
  tracks,
  hotCuesByTrack,
  conducting,
  follow,
  onSeek,
  previewFutures,
}: OverviewLadderProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(
    () => getLadderView(setId)?.zoom ?? Math.max(1, plan.totalSec / DEFAULT_MAX_VISIBLE_S),
  );
  /** Cursor anchor for the pending zoom render: keep this mix-time under
   * this viewport x through the width change. */
  const zoomAnchor = useRef<{ mixTime: number; viewportX: number } | null>(null);
  const lastAutoScrollAt = useRef(0);
  const lastMixTime = useRef<number | null>(null);
  const total = Math.max(plan.totalSec, 0.001);

  // Four-deck mode (sets #161): a second mirrored braid (C/D) exactly
  // when the plan allocates beyond A/B — i.e. Routine spans exist.
  const fourDeck =
    plan.routines.length > 0 || plan.entries.some((e) => e.deck === 'C' || e.deck === 'D');
  const decks: readonly PlanDeck[] = fourDeck ? ['A', 'B', 'C', 'D'] : ['A', 'B'];
  const ladderH = fourDeck ? LANE_H * 4 + 8 : LADDER_H;
  // Physical lane order (C, A, B, D in four-deck mode).
  const laneTop = laneTopFor(fourDeck);

  // Per-deck fader-LEVEL polylines (prototype variant E), sampled from
  // planStateAt — the same model the Conductor executes, so authored
  // window fades, recorded Routine choreography, grace fades, and hard
  // cuts all show as real levels. One-off per plan identity (~4000
  // samples over the whole mix; step-compressed before rendering).
  const faderLevels = useMemo(() => sampleFaderLevels(plan, decks), [plan, fourDeck]); // eslint-disable-line react-hooks/exhaustive-deps

  // Content runs per entry (#161): clips render the audio AS IT PLAYS —
  // jumps splice, loops repeat, leads/pauses go blank.
  const contentSegments = useMemo(
    () => clipContentSegments(plan, (id) => tracks.get(id)?.duration_secs ?? Infinity),
    [plan, tracks]
  );

  // Canvases redraw at the SETTLED zoom (crisp after the gesture, cheap
  // during it — CSS scaling covers the in-between frames; the backing
  // stores are horizontally supersampled so that scaling blurs less).
  const [settledZoom, setSettledZoom] = useState(zoom);
  useEffect(() => {
    const id = window.setTimeout(() => setSettledZoom(zoom), 80);
    return () => window.clearTimeout(id);
  }, [zoom]);

  // ── Viewport restore (session state, per Set) ─────────────────────────
  // Zoom restores in the state initializer — the call site keys this
  // component by setId, so a Set switch remounts with its own viewport.
  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (outer) outer.scrollLeft = getLadderView(setId)?.scrollLeft ?? 0;
    lastMixTime.current = null;
  }, [setId]);

  // ── Zoom: vertical wheel, cursor-anchored (playhead-anchored under
  // follow). Native horizontal scroll pans. ─────────────────────────────
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // horizontal = pan
      e.preventDefault();
      const inner = innerRef.current;
      if (!inner) return;
      const outerW = outer.clientWidth;
      const maxZoom = Math.max(1, (total * MAX_PX_PER_SEC) / outerW);
      setZoom((z) => {
        const next = Math.min(maxZoom, Math.max(1, z * Math.exp(-e.deltaY * 0.002)));
        if (next === z) return z;
        const rect = outer.getBoundingClientRect();
        const conductor = getConductor();
        if (conducting && follow && conductor) {
          // Follow keeps the playhead put — zoom around it.
          const px = (conductor.getMixTime() / total) * inner.clientWidth;
          zoomAnchor.current = {
            mixTime: conductor.getMixTime(),
            viewportX: px - outer.scrollLeft,
          };
        } else {
          const viewportX = e.clientX - rect.left;
          const mixTime = ((outer.scrollLeft + viewportX) / inner.clientWidth) * total;
          zoomAnchor.current = { mixTime, viewportX };
        }
        return next;
      });
    };
    outer.addEventListener('wheel', onWheel, { passive: false });
    return () => outer.removeEventListener('wheel', onWheel);
  }, [total, conducting, follow]);

  // Apply the zoom anchor after the width change lands.
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    const anchor = zoomAnchor.current;
    if (!outer || !inner || !anchor) return;
    zoomAnchor.current = null;
    lastAutoScrollAt.current = performance.now(); // not a user pan
    outer.scrollLeft = (anchor.mixTime / total) * inner.clientWidth - anchor.viewportX;
    setLadderView(setId, { zoom, scrollLeft: outer.scrollLeft });
  }, [zoom, setId, total]);

  // ── Pan bookkeeping: persist viewport; manual pan disengages follow ───
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const onScroll = () => {
      setLadderView(setId, { zoom, scrollLeft: outer.scrollLeft });
      if (performance.now() - lastAutoScrollAt.current > AUTO_SCROLL_WINDOW_MS) {
        if (conducting && follow) setFollowPlayback(false);
      }
    };
    outer.addEventListener('scroll', onScroll);
    return () => outer.removeEventListener('scroll', onScroll);
  }, [setId, zoom, conducting, follow]);

  // ── Playhead + follow auto-scroll (rAF, no React state per frame) ─────
  useEffect(() => {
    const playheadEl = playheadRef.current;
    if (!conducting) {
      if (playheadEl) playheadEl.style.display = 'none';
      lastMixTime.current = null;
      return;
    }
    let raf = 0;
    const frame = () => {
      const conductor = getConductor();
      const outer = outerRef.current;
      const inner = innerRef.current;
      const el = playheadRef.current;
      if (conductor && outer && inner && el) {
        const t = conductor.getMixTime();
        const px = (t / total) * inner.clientWidth;
        el.style.display = 'block';
        el.style.left = `${(t / total) * 100}%`;
        if (follow) {
          const viewX = px - outer.scrollLeft;
          const outerW = outer.clientWidth;
          const seeked =
            lastMixTime.current !== null && Math.abs(t - lastMixTime.current) > SEEK_JUMP_S;
          if (seeked && (viewX < 0 || viewX > outerW)) {
            // Seek landed off-viewport: animated pan to CENTER it.
            lastAutoScrollAt.current = performance.now();
            outer.scrollTo({ left: px - outerW / 2, behavior: 'smooth' });
          } else if (viewX > outerW * PAGE_TRIGGER || viewX < 0) {
            // DAW-style page: re-enter at the leading edge.
            lastAutoScrollAt.current = performance.now();
            outer.scrollTo({ left: px - outerW * PAGE_REENTRY, behavior: 'smooth' });
          }
        }
        lastMixTime.current = t;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [conducting, follow, total]);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - rect.left) / rect.width) * total);
  };

  return (
    <div style={{ position: 'relative', flex: 'none' }}>
      <div
        ref={outerRef}
        style={{
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'thin',
          position: 'relative',
          height: ladderH,
          borderBottom: '1px solid var(--surface0)',
          background: 'var(--crust)',
        }}
      >
        <div
          ref={innerRef}
          onClick={onClick}
          style={{
            position: 'relative',
            width: `${zoom * 100}%`,
            height: '100%',
            cursor: 'pointer',
          }}
        >
          {/* Transition/Take window bands + hard-cut blades */}
          {plan.adjacencies.map((adj, i) => (
            <AdjacencyBand
              key={`adj-${i}`}
              adj={adj}
              total={total}
              future={previewFutures?.[i] ?? null}
              outTop={laneTop[plan.entries[i]?.deck ?? 'A']}
              inTop={laneTop[plan.entries[i + 1]?.deck ?? 'B']}
            />
          ))}
          {/* Routine spans (sets #161): a full-height magenta band across
              the covered range — the recording is the authority inside;
              the cast bracket in the list wears the same color. */}
          {plan.routines.map((r, i) => (
            <div
              key={`routine-${i}`}
              title={`Pinned Routine — ${r.slots.length} cast slots replay as recorded across this span`}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${(r.mixStartSec / total) * 100}%`,
                width: `${Math.max(((r.mixEndSec - r.mixStartSec) / total) * 100, 0.05)}%`,
                background: 'rgba(var(--routine-accent-rgb), 0.07)',
                borderLeft: `1px solid ${ROUTINE_BAND_COLOR}`,
                borderRight: `1px dashed ${ROUTINE_BAND_COLOR}`,
                zIndex: 1,
                pointerEvents: 'none',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 1,
                  left: 3,
                  color: ROUTINE_BAND_COLOR,
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  textShadow: '0 0 4px #000',
                  whiteSpace: 'nowrap',
                }}
              >
                ◆ ROUTINE
              </span>
            </div>
          ))}
          {/* Tempo return ramps (sets 06): the incoming eases back to its
              native tempo after the window — drawn on its lane, fading out
              where the ramp completes. */}
          {plan.adjacencies.map((adj, i) => {
            if (adj.tempoReturnEndSec <= adj.mixEndSec) return null;
            const inDeck = plan.entries[i + 1]?.deck ?? 'B';
            return (
              <div
                key={`ramp-${i}`}
                title="Tempo return — easing back to native tempo"
                style={{
                  position: 'absolute',
                  left: `${(adj.mixEndSec / total) * 100}%`,
                  width: `${((adj.tempoReturnEndSec - adj.mixEndSec) / total) * 100}%`,
                  top: LANE_UP[inDeck]
                    ? laneTop[inDeck] + LANE_H - 7
                    : laneTop[inDeck] + 1,
                  height: 6,
                  background: 'linear-gradient(90deg, #ff00ff 0%, rgba(255,0,255,0) 100%)',
                  zIndex: 3,
                  pointerEvents: 'none',
                }}
              />
            );
          })}
          {/* Plan warnings (sets 06): ⚠ at the afflicted adjacency —
              runway clamps, window overlaps… (errors in red). */}
          {plan.warnings.map((w, k) => {
            if (w.adjacencyIndex === undefined) return null;
            const adj = plan.adjacencies[w.adjacencyIndex];
            if (!adj) return null;
            return (
              <span
                key={`warn-${k}`}
                title={w.message}
                style={{
                  position: 'absolute',
                  left: `${(adj.mixStartSec / total) * 100}%`,
                  top: laneTop.A + LANE_H - 8,
                  transform: 'translateX(-50%)',
                  color: w.severity === 'error' ? '#ff0040' : '#ffe000',
                  fontSize: 12,
                  fontWeight: 700,
                  textShadow: '0 0 4px #000, 0 0 4px #000',
                  zIndex: 4,
                  pointerEvents: 'none',
                }}
              >
                ⚠
              </span>
            );
          })}
          {/* Entry clips: mirrored lanes, titles on the outer edge */}
          {plan.entries.map((entry, i) => (
            <LadderClip
              key={`${entry.trackId}-${i}`}
              entry={entry}
              segments={contentSegments[i] ?? EMPTY_SEGMENTS}
              plan={plan}
              top={laneTop[entry.deck]}
              position={i + 1}
              track={tracks.get(entry.trackId)}
              hotCues={hotCuesByTrack.get(entry.trackId) ?? EMPTY_CUES}
              total={total}
              redrawKey={settledZoom}
            />
          ))}
          {/* Per-deck fader LEVELS (prototype variant E, sets #161): the
              deck's audible level over mix time as a filled curve on its
              lane — window fades, recorded Routine rides, grace fades. */}
          {decks.map((d) => (
            <FaderLevelLane
              key={`level-${d}`}
              deck={d}
              top={laneTop[d]}
              points={faderLevels[d] ?? []}
              total={total}
            />
          ))}
          {/* Grace fades (sets 14): the synthesized fade-out drawn over the
              clip tail, plus the dropped (unreachable) authored tail hatched
              past the truncated exit. */}
          {plan.entries.map((entry, i) => {
            const g = entry.graceFade;
            if (!g) return null;
            const top = laneTop[entry.deck];
            return (
              <div key={`grace-${i}`} style={{ pointerEvents: 'none' }}>
                <div
                  title="Synthesized fade — the planner fades this track early to free its deck"
                  style={{
                    position: 'absolute',
                    left: `${(g.fadeStartMixSec / total) * 100}%`,
                    width: `${((entry.exitMixSec - g.fadeStartMixSec) / total) * 100}%`,
                    top,
                    height: LANE_H,
                    background: 'rgba(255,0,64,0.30)',
                    clipPath: LANE_UP[entry.deck]
                      ? 'polygon(0 0, 0 100%, 100% 100%)'
                      : 'polygon(0 0, 100% 0, 0 100%)',
                    zIndex: 3,
                  }}
                />
                <div
                  title="Dropped tail — authored material past the truncation is unreachable"
                  style={{
                    position: 'absolute',
                    left: `${(entry.exitMixSec / total) * 100}%`,
                    width: `${((g.authoredExitMixSec - entry.exitMixSec) / total) * 100}%`,
                    top,
                    height: LANE_H,
                    background:
                      'repeating-linear-gradient(45deg, rgba(255,0,64,0.28) 0 4px, transparent 4px 9px)',
                    border: '1px dashed rgba(255,0,64,0.7)',
                    zIndex: 3,
                  }}
                />
              </div>
            );
          })}
          {/* Center line the A/B braid meets at */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: laneTop.A + LANE_H,
              height: 2,
              background: 'rgba(255,255,255,0.35)',
              zIndex: 3,
              pointerEvents: 'none',
            }}
          />
          {fourDeck &&
            [laneTop.A - 1, laneTop.D - 1].map((y) => (
              <div
                key={`sep-${y}`}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: y,
                  height: 1,
                  background: 'rgba(255,255,255,0.18)',
                  zIndex: 3,
                  pointerEvents: 'none',
                }}
              />
            ))}
          {/* Conductor playhead (sets 05) — rAF-driven, hidden when idle.
              Machine orange (D6 registry): the Conductor's position. */}
          <div
            ref={playheadRef}
            style={{
              display: 'none',
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 2,
              marginLeft: -1,
              background: PLAYHEAD_MACHINE,
              boxShadow: '0 0 4px #000',
              zIndex: 5,
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
      {/* Deck lane letters (four-deck mode): a fixed gutter overlay so the
          braids stay legible while panning. */}
      {fourDeck &&
        decks.map((d) => (
          <span
            key={`lane-label-${d}`}
            style={{
              position: 'absolute',
              left: 3,
              top: laneTop[d] + (LANE_UP[d] ? 2 : LANE_H - 14),
              zIndex: 6,
              color: DECK_COLORS[d],
              fontSize: 10,
              fontWeight: 800,
              textShadow: '0 0 4px #000, 0 0 4px #000',
              pointerEvents: 'none',
            }}
          >
            {d}
          </span>
        ))}
      {/* Follow-playback toggle (sets 05): on at playback start, off on
          manual pan/scroll, re-engaged by seeking or this button. */}
      {conducting && (
        <button
          onClick={() => setFollowPlayback(!follow)}
          title={follow ? 'Following playback — click to stop' : 'Follow playback'}
          style={{
            position: 'absolute',
            top: 4,
            right: 8,
            zIndex: 6,
            padding: '0 6px',
            fontSize: '13px',
            lineHeight: '18px',
            background: follow ? 'var(--accent)' : 'rgba(0,0,0,0.55)',
            color: follow ? 'var(--base)' : 'var(--text)',
            border: '1px solid var(--surface1)',
            cursor: 'pointer',
          }}
        >
          ⌖
        </button>
      )}
    </div>
  );
});

/** One linear run of audible content inside a clip (#161): between
 * these, the artifact jumps (beat jumps, stabs, loop-collapsed repeats),
 * pauses, or sits in a silent lead — rendered blank, exactly as it will
 * play. */
export interface ClipContentSegment {
  mixStart: number;
  mixEnd: number;
  trackStart: number;
  trackEnd: number;
}

/** Merge tolerance: consecutive runs whose positions meet within this
 * are one continuous strip (no splice mark for numeric dust). */
const SEGMENT_MERGE_EPS_S = 0.5;

function pushRun(out: ClipContentSegment[], seg: ClipContentSegment): void {
  if (seg.mixEnd - seg.mixStart <= 1e-6) return;
  const prev = out[out.length - 1];
  if (
    prev &&
    Math.abs(prev.mixEnd - seg.mixStart) < 1e-6 &&
    Math.abs(prev.trackEnd - seg.trackStart) < SEGMENT_MERGE_EPS_S
  ) {
    prev.mixEnd = seg.mixEnd;
    prev.trackEnd = seg.trackEnd;
    return;
  }
  out.push(seg);
}

/**
 * Per-entry audible content runs (#161): the ladder renders the audio AS
 * IT WILL PLAY — repeated sections drawn repeated, skipped audio skipped,
 * silent leads/pauses blank. Windowed entries take the transition model's
 * own piecewise walk (bContentSegments, jump-expanded); Routine entries
 * take their slot trace's moving runs; everything else is one linear
 * strip.
 */
export function clipContentSegments(
  plan: SetPlan,
  durOf: (trackId: number) => number
): ClipContentSegment[][] {
  return plan.entries.map((entry, i) => {
    const out: ClipContentSegment[] = [];
    const span = entry.exitMixSec - entry.entryMixSec;
    if (span <= 0) return out;

    // Routine slot? Its trace IS the playback (runs between jumps/pauses).
    const routine = plan.routines.find(
      (r) => i >= r.startEntryIndex && i < r.startEntryIndex + r.slots.length
    );
    const slot = routine?.slots[i - routine.startEntryIndex];
    if (routine && slot && slot.deck !== null) {
      const spb = routine.secPerBeat;
      // Head plays from its own entry up to the span open (linear).
      if (entry.entryMixSec < routine.mixStartSec) {
        const first = slot.trace[0];
        pushRun(out, {
          mixStart: entry.entryMixSec,
          mixEnd: routine.mixStartSec,
          trackStart: entry.entrySec,
          trackEnd: Math.max(0, first?.pos ?? entry.entrySec),
        });
      }
      for (let k = 0; k < slot.trace.length - 1; k++) {
        const a = slot.trace[k];
        const b = slot.trace[k + 1];
        if (!a.moving || a.ratePerBeat <= 0) continue;
        // Run to the next point (jump landings cut runs; traceStateAt
        // rides a's rate up to the landing).
        let beat0 = a.beat;
        let pos0 = a.pos;
        const beat1 = b.beat;
        const pos1 = b.jump ? a.pos + a.ratePerBeat * (beat1 - a.beat) : b.pos;
        if (pos1 <= 0) continue; // wholly inside the silent lead
        if (pos0 < 0) {
          // Clip the run at its 0-crossing (park-until-positive rule).
          beat0 = a.beat + -a.pos / a.ratePerBeat;
          pos0 = 0;
        }
        pushRun(out, {
          mixStart: Math.max(entry.entryMixSec, routine.mixStartSec + beat0 * spb),
          mixEnd: Math.min(entry.exitMixSec, routine.mixStartSec + beat1 * spb),
          trackStart: pos0,
          trackEnd: pos1,
        });
      }
      // The exit slot keeps sounding past the span end (linear to exit).
      if (entry.exitMixSec > routine.mixEndSec) {
        pushRun(out, {
          mixStart: routine.mixEndSec,
          mixEnd: entry.exitMixSec,
          trackStart: routine.exit.trackSecAtEnd,
          trackEnd: entry.exitSec,
        });
      }
      return out;
    }

    // Windowed incoming: the transition model's own audible walk (lead
    // gaps deferred, jumps expanded — loops render repeated).
    const entryAdj = i > 0 ? plan.adjacencies[i - 1] : undefined;
    if (entryAdj && (entryAdj.kind === 'transition' || entryAdj.kind === 'take')) {
      const tr = entryAdj.transition;
      const authoredEnd = tr.startSec + tr.durationSec;
      const segs = bContentSegments(tr, durOf(entry.trackId), entryAdj.rateIncoming);
      for (const s of segs) {
        // The walk runs to B's track end; the window owns only its own
        // span — the post-window solo strip is appended below.
        const a0 = s.mixStartSec;
        const a1 = Math.min(s.mixEndSec, authoredEnd);
        if (a1 <= a0) continue;
        // Authored window axis → global mix axis via the outgoing's rate.
        const g0 = entryAdj.mixStartSec + (a0 - tr.startSec) / entryAdj.rateOutgoing;
        const g1 = entryAdj.mixStartSec + (a1 - tr.startSec) / entryAdj.rateOutgoing;
        pushRun(out, {
          mixStart: Math.max(entry.entryMixSec, g0),
          mixEnd: Math.min(entry.exitMixSec, g1),
          trackStart: s.bStartSec,
          trackEnd: s.bStartSec + (a1 - a0) * entryAdj.rateIncoming,
        });
      }
      // Past the window: solo to the exit (Tempo return curvature is
      // sub-pixel at minimap scale — endpoints exact).
      const windowEndGlobal = entryAdj.mixEndSec;
      if (entry.exitMixSec > windowEndGlobal) {
        const last = out[out.length - 1];
        pushRun(out, {
          mixStart: Math.max(entry.entryMixSec, windowEndGlobal),
          mixEnd: entry.exitMixSec,
          trackStart: last ? last.trackEnd : entry.entrySec,
          trackEnd: entry.exitSec,
        });
      }
      if (out.length > 0) return out;
    }

    // Plain entry: one linear strip (the pre-#161 render).
    pushRun(out, {
      mixStart: entry.entryMixSec,
      mixEnd: entry.exitMixSec,
      trackStart: entry.entrySec,
      trackEnd: entry.exitSec,
    });
    return out;
  });
}

/** Per-deck audible level over mix time (variant E): playing × fader,
 * sampled from planStateAt and step-compressed (levels are mostly flat —
 * points survive only where the value moves). ~one sample per
 * totalSec/4000 (floor 0.5s): a minimap curve, not an automation lane. */
function sampleFaderLevels(
  plan: SetPlan,
  decks: readonly PlanDeck[]
): Partial<Record<PlanDeck, [number, number][]>> {
  const out: Partial<Record<PlanDeck, [number, number][]>> = {};
  for (const d of decks) out[d] = [];
  const total = Math.max(plan.totalSec, 0.001);
  if (plan.entries.length === 0) return out;
  const step = Math.max(0.5, total / 4000);
  // Track the previous raw sample per deck so a level CHANGE first drops
  // an anchor at the pre-change instant (steps stay steps, not slopes).
  const prev: Partial<Record<PlanDeck, [number, number]>> = {};
  for (let t = 0; t <= total; t += step) {
    const s = planStateAt(plan, t);
    for (const d of decks) {
      const v = s.decks[d].playing ? s.lanes[d].fader : 0;
      const pts = out[d]!;
      const last = pts[pts.length - 1];
      if (!last) {
        pts.push([t, v]);
      } else if (Math.abs(v - last[1]) > 0.004) {
        const p = prev[d];
        if (p && p[0] > last[0]) pts.push(p);
        pts.push([t, v]);
      }
      prev[d] = [t, v];
    }
  }
  for (const d of decks) {
    const pts = out[d]!;
    const p = prev[d];
    if (p && (pts.length === 0 || p[0] > pts[pts.length - 1][0])) pts.push(p);
  }
  return out;
}

/** SVG width units for a fader-level lane (preserveAspectRatio="none"
 * stretches it to the ladder's zoomed width). */
const LEVEL_VIEW_W = 4000;

/** One deck's fader-level curve (variant E): a filled polyline on the
 * deck's lane, anchored at the braid's center line (up lanes fill upward,
 * down lanes downward) in the deck's identity color. */
function FaderLevelLane({
  deck,
  top,
  points,
  total,
}: {
  deck: PlanDeck;
  /** The deck's lane top (physical order — C, A, B, D in four-deck). */
  top: number;
  points: [number, number][];
  total: number;
}) {
  if (points.length === 0) return null;
  // Uniform UP on every lane (#161): level rises from the lane's bottom
  // edge regardless of stacking position — mirroring lives only in the
  // lane geometry (C/A/B/D), never in how a curve reads within a lane.
  const H = LANE_H;
  const yAt = (v: number) => H - v * (H - 4);
  const xAt = (t: number) => (t / total) * LEVEL_VIEW_W;
  const base = H;
  let dPath = `M ${xAt(points[0][0]).toFixed(1)} ${base}`;
  for (const [t, v] of points) dPath += ` L ${xAt(t).toFixed(1)} ${yAt(v).toFixed(1)}`;
  dPath += ` L ${xAt(points[points.length - 1][0]).toFixed(1)} ${base} Z`;
  const color = DECK_COLORS[deck];
  return (
    <svg
      viewBox={`0 0 ${LEVEL_VIEW_W} ${H}`}
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        left: 0,
        top,
        width: '100%',
        height: H,
        zIndex: 3,
        pointerEvents: 'none',
      }}
    >
      <path
        d={dPath}
        fill={color}
        fillOpacity={0.16}
        stroke={color}
        strokeOpacity={0.65}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function AdjacencyBand({
  adj,
  total,
  future,
  outTop,
  inTop,
}: {
  adj: PlannedAdjacency;
  total: number;
  /** Drag-preview future (sets 07); null = not previewing / unaffected. */
  future: AdjacencyFuture | null;
  /** Lane tops of the decks this handover involves — the band spans
   * exactly their lanes (four-deck mode would otherwise paint columns
   * over idle lanes). */
  outTop: number;
  inTop: number;
}) {
  if (adj.kind === 'hardcut') {
    // AUTO-FILLABLE preview: this hypothetical pair has a library
    // Transition on offer — a dashed yellow blade + ◆ instead of the
    // unresolved red ✕ (which UNRESOLVED futures keep).
    const color = future === 'auto-resolves' ? '#ffe000' : '#ff0040';
    // Unmissable: dashed blade + glyph at the center line.
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${(adj.mixStartSec / total) * 100}%`,
          width: 4,
          marginLeft: -2,
          background: `repeating-linear-gradient(180deg, ${color} 0 6px, transparent 6px 12px)`,
          zIndex: 3,
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color,
            fontSize: 13,
            fontWeight: 700,
            textShadow: '0 0 4px #000, 0 0 4px #000',
            whiteSpace: 'nowrap',
          }}
        >
          {future === 'auto-resolves' ? '◆' : '✕'}
        </span>
      </div>
    );
  }
  // Routine coverage renders as ONE magenta span band (the ladder's
  // routine layer) — per-adjacency bands would be interior slivers.
  if (adj.kind === 'routine') return null;
  const color = adj.kind === 'transition' ? '#00ff00' : '#ff9900';
  const bg = adj.kind === 'transition' ? 'rgba(0,255,0,0.10)' : 'rgba(255,153,0,0.12)';
  // The band spans exactly the lanes of the two decks involved (a
  // routine-exit handover can leave from C/D — sets #161).
  const top = Math.min(outTop, inTop);
  const bottom = Math.max(outTop, inTop) + LANE_H;
  // WILL-RESTORE preview: a Dormant pin wakes if the drop commits — the
  // band renders in its pin-kind color inside a dashed violet frame + ↺
  // (violet is unclaimed: cyan/magenta are Deck identity, never state —
  // CONTEXT.md "Deck color").
  const willRestore = future === 'will-restore';
  return (
    <div
      style={{
        position: 'absolute',
        top,
        height: bottom - top,
        left: `${(adj.mixStartSec / total) * 100}%`,
        width: `${Math.max(((adj.mixEndSec - adj.mixStartSec) / total) * 100, 0.05)}%`,
        background: bg,
        borderLeft: `1px solid ${color}`,
        borderRight: `1px solid ${color}`,
        outline: willRestore ? `2px dashed ${WILL_RESTORE_COLOR}` : undefined,
        outlineOffset: willRestore ? -1 : undefined,
        zIndex: 1,
        pointerEvents: 'none',
      }}
    >
      {willRestore && (
        <span
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: WILL_RESTORE_COLOR,
            fontSize: 13,
            fontWeight: 700,
            textShadow: '0 0 4px #000, 0 0 4px #000',
          }}
        >
          ↺
        </span>
      )}
    </div>
  );
}

/** Memoized (issue 43): a big set mounts ~90 of these; without the memo
 * every ladder render re-ran them all (528 clip renders per 88-track
 * open). Props are stable plan/track slices; the blob arrives through
 * the clip's own query subscription. */
const EMPTY_SEGMENTS: ClipContentSegment[] = [];

const LadderClip = memo(function LadderClip({
  entry,
  segments,
  plan,
  top,
  position,
  track,
  hotCues,
  total,
  redrawKey,
}: {
  entry: PlannedEntry;
  /** Audible content runs (#161): each renders its own wave slice —
   * jumps splice, loops repeat, leads/pauses show the clip's dark bg. */
  segments: ClipContentSegment[];
  /** Whole plan, for the clip's fader/EQ waveform modulation (sets #171)
   * — a stable slice: replans swap the object, so the memo still holds
   * between replans. */
  plan: SetPlan;
  /** The entry deck's lane top (physical order, four-deck aware). */
  top: number;
  /** 1-based position in the set — matches the track list's numbering. */
  position: number;
  track: Track | undefined;
  hotCues: HotCue[];
  total: number;
  /** Bumps when the canvas backing store should re-render (zoom settle). */
  redrawKey: number;
}) {
  // Chrome is NOT mirrored (sneak fix, 2026-08-30): titles and cue flags
  // sit on the TOP edge on every deck — mirroring belongs to the lane
  // STACKING geometry only, and mirrored chrome on B/D read as inverted.
  const title = track ? (track.title ?? track.filename) : `Track ${entry.trackId}`;
  const cues = hotCues.map((c) => ({
    t: c.time_seconds,
    // Stored cue hex is validated (cueCssColor) — an arbitrary stored string
    // must never reach the DOM flag fill (gh#201 item 2).
    color: cueCssColor(c.slot_number, c.color),
  }));
  const span = Math.max(entry.exitMixSec - entry.entryMixSec, 0.001);
  return (
    <div
      style={{
        position: 'absolute',
        left: `${(entry.entryMixSec / total) * 100}%`,
        width: `${(span / total) * 100}%`,
        top,
        height: LANE_H,
        border: `1px solid ${DECK_COLORS[entry.deck]}`,
        background: WAVE_BG_COLOR,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 2,
      }}
    >
      <ClipTitle position={position} title={title} color={DECK_COLORS[entry.deck]} />
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {segments.map((seg, k) => (
          <div
            key={`seg-${k}`}
            style={{
              position: 'absolute',
              left: `${((seg.mixStart - entry.entryMixSec) / span) * 100}%`,
              width: `${((seg.mixEnd - seg.mixStart) / span) * 100}%`,
              top: 0,
              bottom: 0,
              // Splice mark: a run boundary is a real playback jump.
              borderLeft: k > 0 ? '1px solid rgba(255,255,255,0.45)' : undefined,
            }}
          >
            <LadderWave
              trackId={entry.trackId}
              height={LANE_H - TITLE_H - 2}
              range={[seg.trackStart, seg.trackEnd]}
              cues={cues}
              redrawKey={redrawKey}
              plan={plan}
              deck={entry.deck}
              mixRange={[seg.mixStart, seg.mixEnd]}
            />
          </div>
        ))}
      </div>
    </div>
  );
});

function ClipTitle({
  position,
  title,
  color,
}: {
  position: number;
  title: string;
  color: string;
}) {
  return (
    <div
      style={{
        flex: 'none',
        height: TITLE_H,
        lineHeight: `${TITLE_H}px`,
        padding: '0 3px',
        fontSize: 9,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        pointerEvents: 'none',
        // Deck identity, but eased off the full-saturation cyan/magenta —
        // 9px bold in pure deck color vibrates against the dark clip.
        color: `color-mix(in srgb, ${color} 62%, #6a6a74 38%)`,
      }}
    >
      {/* Set-position number, dimmed so the title stays the headline. */}
      <span style={{ opacity: 0.55, fontWeight: 400 }}>{position} </span>
      {title}
    </div>
  );
}

/** Static 2D-canvas styled waveform for one clip (sets 30): a CPU
 * interpretation of the global Waveform style — the 'minimap' slot, the
 * same source of truth the player minimaps render from — re-drawn live on
 * any styles-mode tweak. Bars grow from the center line ('up' anchors the
 * baseline at the bottom edge, 'down' hangs them from the top — the
 * mirrored-lane layout wins over the style's own anchor); hot cues use the
 * deck minimaps' zoned mark — a 2px full-height pole flying a 5×5 square
 * flag — flag at the TOP edge on every deck (chrome is never mirrored;
 * sneak fix 2026-08-30). Cue marks are DOM overlays, NOT canvas pixels (issue 172):
 * during a zoom gesture the stale bitmap is CSS-stretched until the
 * settle redraw, so anything in it stretches too — DOM marks ride the
 * width change by % position while keeping fixed pixel geometry. */
function LadderWave({
  trackId,
  height,
  range,
  cues,
  redrawKey,
  plan,
  deck,
  mixRange,
}: {
  /** The blob is fetched HERE, not passed down (issue 43): a decoded
   * waveform in props is deep-walked — typed arrays and all — by React's
   * dev-build props diff on every arrival, seconds per set open. Hook
   * state is never serialized. */
  trackId: number;
  height: number;
  /** Track-time span this clip plays. */
  range: [number, number];
  cues: { t: number; color: string }[];
  redrawKey: number;
  /** Plan + deck + mix-time span drive per-column fader/EQ modulation
   * (sets #171): the columns dim/shrink with the planned fader and drop
   * band colors on EQ kills — session-timeline parity, evaluated from
   * planStateAt so the clip shows what the Conductor will do. */
  plan: SetPlan;
  deck: PlanDeck;
  /** Mix-time span this clip occupies ([entryMixSec, exitMixSec]). */
  mixRange: [number, number];
}) {
  const { data } = useWaveformBlob(trackId);
  const wave: DecodedWaveform | null = data ?? null;
  const ref = useRef<HTMLCanvasElement>(null);
  const slot = useStyleSlot('minimap');
  const [t0, t1] = range;
  const span = Math.max(t1 - t0, 0.001);

  useEffect(() => {
    // Rasterizing is the expensive part — it runs through the clip-draw
    // scheduler (frame-budgeted), not synchronously in the effect, so a
    // Set open / zoom settle / style tweak never blocks a paint on the
    // whole ladder's worth of columns.
    return scheduleClipDraw(() => {
      const canvas = ref.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      // Horizontal supersampling: up to 2x the display resolution, so the
      // CSS stretch while a zoom-in gesture is in flight has real detail to
      // stretch into (half the blur until the settle redraw lands). Tapers
      // to 1x as clips get wide (high zoom) to bound backing-store memory
      // and settle-redraw cost.
      const os = Math.max(1, Math.min(2, 8192 / (w * dpr)));
      const wDraw = Math.round(w * os);
      canvas.width = wDraw * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, wDraw, h);
      if (!wave) return;

      // Bipolar on every lane (#161): the classic symmetric read —
      // mirroring belongs to the lane STACKING (C/A/B/D geometry), never
      // to how a lane's own content is drawn.
      drawStyledWave(ctx, wave, slot.styleId, slot.params, {
        width: wDraw,
        height: h,
        dir: 'bipolar',
        range,
        brightness: MINIMAP_BRIGHTNESS,
        modulate: planColumnModulator(plan, deck, mixRange, wDraw),
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wave, height, range[0], range[1], redrawKey, slot, plan, deck, mixRange[0], mixRange[1]]);

  return (
    <div style={{ position: 'relative', height, flex: 'none' }}>
      <canvas ref={ref} style={{ width: '100%', height, display: 'block' }} />
      {/* The minimap's zoned cue mark (WaveformRendererV2.pushHotCues,
          minimap branch): 2px full-height pole + 5×5 square flag off its
          right, flag at the TOP on every deck (chrome never mirrors).
          %-positioned DOM so the mark tracks zoom continuously at fixed
          pixel size (the clip's overflow:hidden trims edge marks). */}
      {cues.map((c, i) => {
        const frac = (c.t - t0) / span;
        if (frac < 0 || frac > 1) return null;
        return (
          <div
            key={`${c.t}-${i}`}
            style={{
              position: 'absolute',
              left: `${frac * 100}%`,
              top: 0,
              bottom: 0,
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: -CUE_FLAG_POLE_W / 2,
                top: 0,
                bottom: 0,
                width: CUE_FLAG_POLE_W,
                background: c.color,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: CUE_FLAG_POLE_W / 2,
                width: CUE_FLAG_MINI_SIZE,
                height: CUE_FLAG_MINI_SIZE,
                top: 0,
                background: c.color,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
