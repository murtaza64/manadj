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
 * set; the viewport persists per Set in the set store. The ladder and
 * the track list are independent surfaces converging on EVENTS only:
 * clicking the ladder SEEKS (Conductor), and under follow-playback the
 * ladder auto-scrolls DAW-style (paged — pan when the playhead crosses
 * ~78% of the viewport; a seek discontinuity centers instead). Manual
 * pan disengages follow; zoom never does.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DECK_COLORS } from '../theme/deckColors';
import type { HotCue, Track } from '../types';
import type { DecodedWaveform } from '../waveform/blob';
import { useStyleSlot } from '../waveform/styleSlots';
import { useWaveformBlob } from '../waveform/useWaveformBlob';
import { HOT_CUE_CSS_COLORS } from '../waveform/WaveformRendererV2';
import { getConductor, setFollowPlayback } from './conductorStore';
import { WILL_RESTORE_COLOR, type AdjacencyFuture } from './dormancy';
import { drawStyledWave } from './ladderWaveStyle';
import type { PlannedAdjacency, PlannedEntry, SetPlan } from './planner';
import { getLadderView, setLadderView } from './setStore';

const LANE_H = 46;
const TITLE_H = 13;
export const LADDER_H = LANE_H * 2 + 4;
/** Max zoom: ~8s of mix per 100px. */
const MAX_PX_PER_SEC = 12.5;
/** Follow paging: pan when the playhead passes this viewport fraction,
 * landing it at the re-entry fraction. */
const PAGE_TRIGGER = 0.78;
const PAGE_REENTRY = 0.15;
/** A mix-time discontinuity this large is a seek — center, don't page. */
const SEEK_JUMP_S = 2;
/** Scroll events within this window of a programmatic scrollTo are ours,
 * not the user's (smooth scrolling animates through many events). */
const AUTO_SCROLL_WINDOW_MS = 700;

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
   * waits), auto-fillable (a library Transition exists), unresolved.
   * Index-aligned with plan.adjacencies; null = unaffected. */
  previewFutures?: (AdjacencyFuture | null)[];
}

export function OverviewLadder({
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
  const [zoom, setZoom] = useState(() => getLadderView(setId).zoom);
  /** Cursor anchor for the pending zoom render: keep this mix-time under
   * this viewport x through the width change. */
  const zoomAnchor = useRef<{ mixTime: number; viewportX: number } | null>(null);
  const lastAutoScrollAt = useRef(0);
  const lastMixTime = useRef<number | null>(null);
  const total = Math.max(plan.totalSec, 0.001);

  // Canvases redraw at the SETTLED zoom (crisp after the gesture, cheap
  // during it — CSS scaling covers the in-between frames).
  const [settledZoom, setSettledZoom] = useState(zoom);
  useEffect(() => {
    const id = window.setTimeout(() => setSettledZoom(zoom), 150);
    return () => window.clearTimeout(id);
  }, [zoom]);

  // ── Viewport restore (session state, per Set) ─────────────────────────
  // Zoom restores in the state initializer — the call site keys this
  // component by setId, so a Set switch remounts with its own viewport.
  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (outer) outer.scrollLeft = getLadderView(setId).scrollLeft;
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
          height: LADDER_H,
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
            />
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
                  top: inDeck === 'A' ? LANE_H - 7 : LANE_H + 3,
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
                  top: LANE_H - 8,
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
              track={tracks.get(entry.trackId)}
              hotCues={hotCuesByTrack.get(entry.trackId) ?? []}
              total={total}
              redrawKey={settledZoom}
            />
          ))}
          {/* Grace fades (sets 14): the synthesized fade-out drawn over the
              clip tail, plus the dropped (unreachable) authored tail hatched
              past the truncated exit. */}
          {plan.entries.map((entry, i) => {
            const g = entry.graceFade;
            if (!g) return null;
            const top = entry.deck === 'A' ? 0 : LANE_H + 2;
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
                    clipPath:
                      entry.deck === 'A'
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
          {/* Center line the mirrored lanes meet at */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: LANE_H,
              height: 2,
              background: 'rgba(255,255,255,0.35)',
              zIndex: 3,
              pointerEvents: 'none',
            }}
          />
          {/* Conductor playhead (sets 05) — rAF-driven, hidden when idle */}
          <div
            ref={playheadRef}
            style={{
              display: 'none',
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 2,
              marginLeft: -1,
              background: '#ffffff',
              boxShadow: '0 0 4px #000',
              zIndex: 5,
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
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
            background: follow ? 'var(--mauve)' : 'rgba(0,0,0,0.55)',
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
}

function AdjacencyBand({
  adj,
  total,
  future,
}: {
  adj: PlannedAdjacency;
  total: number;
  /** Drag-preview future (sets 07); null = not previewing / unaffected. */
  future: AdjacencyFuture | null;
}) {
  if (adj.kind === 'hardcut') {
    // AUTO-FILLABLE preview: this hypothetical pair has a library
    // Transition on offer — a dashed yellow blade + ◆ instead of the
    // unresolved red ✕ (which UNRESOLVED futures keep).
    const color = future === 'auto-fillable' ? '#ffe000' : '#ff0040';
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
          {future === 'auto-fillable' ? '◆' : '✕'}
        </span>
      </div>
    );
  }
  const color = adj.kind === 'transition' ? '#00ff00' : '#ff9900';
  const bg = adj.kind === 'transition' ? 'rgba(0,255,0,0.10)' : 'rgba(255,153,0,0.12)';
  // WILL-RESTORE preview: a Dormant pin wakes if the drop commits — the
  // band renders in its pin-kind color inside a dashed violet frame + ↺
  // (violet is unclaimed: cyan/magenta are Deck identity, never state —
  // CONTEXT.md "Deck color").
  const willRestore = future === 'will-restore';
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
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

function LadderClip({
  entry,
  track,
  hotCues,
  total,
  redrawKey,
}: {
  entry: PlannedEntry;
  track: Track | undefined;
  hotCues: HotCue[];
  total: number;
  /** Bumps when the canvas backing store should re-render (zoom settle). */
  redrawKey: number;
}) {
  const { data } = useWaveformBlob(entry.trackId);
  const isA = entry.deck === 'A';
  const title = track ? (track.title ?? track.filename) : `Track ${entry.trackId}`;
  const cues = hotCues.map((c) => ({
    t: c.time_seconds,
    color: c.color ?? HOT_CUE_CSS_COLORS[c.slot_number] ?? '#fff',
  }));
  return (
    <div
      style={{
        position: 'absolute',
        left: `${(entry.entryMixSec / total) * 100}%`,
        width: `${((entry.exitMixSec - entry.entryMixSec) / total) * 100}%`,
        top: isA ? 0 : LANE_H + 2,
        height: LANE_H,
        border: `1px solid ${DECK_COLORS[entry.deck]}`,
        background: '#0b0b12',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 2,
      }}
    >
      {isA && <ClipTitle title={title} color={DECK_COLORS.A} />}
      <LadderWave
        wave={data ?? null}
        height={LANE_H - TITLE_H - 2}
        range={[entry.entrySec, entry.exitSec]}
        cues={cues}
        dir={isA ? 'up' : 'down'}
        redrawKey={redrawKey}
      />
      {!isA && <ClipTitle title={title} color={DECK_COLORS.B} />}
    </div>
  );
}

function ClipTitle({ title, color }: { title: string; color: string }) {
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
        color,
      }}
    >
      {title}
    </div>
  );
}

/** Static 2D-canvas styled waveform for one clip (sets 30): a CPU
 * interpretation of the global Waveform style — the 'minimap' slot, the
 * same source of truth the player minimaps render from — re-drawn live on
 * any styles-mode tweak. Bars grow from the center line ('up' anchors the
 * baseline at the bottom edge, 'down' hangs them from the top — the
 * mirrored-lane layout wins over the style's own anchor); hot cues draw a
 * faint full-height line plus a triangle on the OUTER (title-side) edge,
 * keeping the center line clean. */
function LadderWave({
  wave,
  height,
  range,
  cues,
  dir,
  redrawKey,
}: {
  wave: DecodedWaveform | null;
  height: number;
  /** Track-time span this clip plays. */
  range: [number, number];
  cues: { t: number; color: string }[];
  dir: 'up' | 'down';
  redrawKey: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cueKey = cues.map((c) => `${c.t}:${c.color}`).join('|');
  const slot = useStyleSlot('minimap');

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!wave) return;

    const [t0, t1] = range;
    const span = Math.max(t1 - t0, 0.001);
    const xAt = (t: number) => ((t - t0) / span) * w;

    drawStyledWave(ctx, wave, slot.styleId, slot.params, {
      width: w,
      height: h,
      dir,
      range,
    });

    for (const c of cues) {
      const x = xAt(c.t);
      if (x < -4 || x > w + 4) continue;
      ctx.strokeStyle = c.color;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.color;
      ctx.beginPath();
      // Triangle on the title side: top edge for 'up' (title above), bottom
      // edge for 'down' (title below).
      if (dir === 'up') {
        ctx.moveTo(x - 4, 0);
        ctx.lineTo(x + 4, 0);
        ctx.lineTo(x, 6);
      } else {
        ctx.moveTo(x - 4, h);
        ctx.lineTo(x + 4, h);
        ctx.lineTo(x, h - 6);
      }
      ctx.closePath();
      ctx.fill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wave, height, dir, range[0], range[1], cueKey, redrawKey, slot]);

  return <canvas ref={ref} style={{ width: '100%', height, display: 'block', flex: 'none' }} />;
}
