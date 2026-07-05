/**
 * Overview ladder (sets 03): the zoomed staircase minimap above the Set
 * list — prototype variant D's verdict, reimplemented fresh against the
 * pure planner (never promoted prototype code).
 *
 * Geometry: mirrored deck lanes around a center line (A grows up, B hangs
 * down), each entry a clip spanning its audible mix span; title strips
 * OUTSIDE the waveform on the outer edge; real hot cues as faint line +
 * triangle on the title side; transition/take bands across the window;
 * hard cuts as an unmissable dashed red blade + ✕ at the center line.
 *
 * Scroll: the ladder is ZOOM× the viewport wide and PINNED to the Set
 * list through one progress value — the list's scroll fraction maps to
 * the ladder's scroll fraction (pure centering fails at the edges: list
 * top ⇒ set start flush left, bottom ⇒ set end flush right). Clicking the
 * ladder scrolls the list to the progress that centers the clicked clip
 * (click-to-SEEK is issue 05 and replaces this).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { DECK_COLORS } from '../theme/deckColors';
import type { HotCue, Track } from '../types';
import { toThreeBands, type ThreeBandWaveform } from '../waveform/blob';
import { useWaveformBlob } from '../waveform/useWaveformBlob';
import type { PlannedAdjacency, PlannedEntry, SetPlan } from './planner';

const LANE_H = 46;
const TITLE_H = 13;
export const LADDER_H = LANE_H * 2 + 4;
const ZOOM = 5;

/** Hot-cue slot palette (matches the waveform renderer's slot colors). */
const CUE_SLOT_COLORS: Record<number, string> = {
  1: 'rgb(137, 180, 250)',
  2: 'rgb(249, 226, 175)',
  3: 'rgb(250, 179, 135)',
  4: 'rgb(243, 139, 168)',
  5: 'rgb(166, 227, 161)',
  6: 'rgb(245, 194, 231)',
  7: 'rgb(203, 166, 247)',
  8: 'rgb(148, 226, 213)',
};

interface OverviewLadderProps {
  plan: SetPlan;
  tracks: Map<number, Track>;
  hotCuesByTrack: Map<number, HotCue[]>;
  /** The Set list's scroll container — the other end of the pinned-scroll
   * pair. Rows are located via [data-set-track-row]. */
  listRef: React.RefObject<HTMLDivElement | null>;
}

export function OverviewLadder({ plan, tracks, hotCuesByTrack, listRef }: OverviewLadderProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  /** Entry index span currently visible in the list (dims the rest). */
  const [view, setView] = useState<[number, number]>([0, plan.entries.length - 1]);
  const total = Math.max(plan.totalSec, 0.001);

  // ── Pinned scrolls: one progress value drives both ─────────────────────
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const recompute = () => {
      const outer = outerRef.current;
      if (!outer) return;
      const scrollable = list.scrollHeight - list.clientHeight;
      const progress = scrollable > 0 ? list.scrollTop / scrollable : 0;
      outer.scrollLeft = progress * (outer.clientWidth * ZOOM - outer.clientWidth);

      // Visible rows → dim clips outside the span.
      const rows = list.querySelectorAll('[data-set-track-row]');
      const top = list.scrollTop;
      const bottom = top + list.clientHeight;
      let first = -1;
      let last = -1;
      rows.forEach((el, i) => {
        const y0 = (el as HTMLElement).offsetTop - list.offsetTop;
        const y1 = y0 + (el as HTMLElement).offsetHeight;
        if (y1 > top && y0 < bottom) {
          if (first === -1) first = i;
          last = i;
        }
      });
      if (first !== -1) setView([first, last]);
    };
    recompute();
    list.addEventListener('scroll', recompute);
    return () => list.removeEventListener('scroll', recompute);
  }, [listRef, plan]);

  // Click: scroll the list to the progress that centers the clicked clip
  // (clamped at the edges — the pinned handler then moves the ladder).
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const outer = outerRef.current;
    const list = listRef.current;
    if (!outer || !list) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * total;
    let idx = plan.entries.findIndex((en) => t <= en.exitMixSec);
    if (idx === -1) idx = plan.entries.length - 1;
    const en = plan.entries[idx];
    const innerW = outer.clientWidth * ZOOM;
    const clipCenterPx = (((en.entryMixSec + en.exitMixSec) / 2) / total) * innerW;
    const progress = Math.min(
      Math.max((clipCenterPx - outer.clientWidth / 2) / (innerW - outer.clientWidth), 0),
      1
    );
    list.scrollTo({ top: progress * (list.scrollHeight - list.clientHeight), behavior: 'smooth' });
  };

  return (
    <div
      ref={outerRef}
      style={{
        overflow: 'hidden',
        position: 'relative',
        flex: 'none',
        height: LADDER_H,
        borderBottom: '1px solid var(--surface0)',
        background: 'var(--crust)',
      }}
    >
      <div
        onClick={onClick}
        style={{ position: 'relative', width: `${ZOOM * 100}%`, height: '100%', cursor: 'pointer' }}
      >
        {/* Transition/Take window bands + hard-cut blades */}
        {plan.adjacencies.map((adj, i) => (
          <AdjacencyBand key={`adj-${i}`} adj={adj} total={total} />
        ))}
        {/* Entry clips: mirrored lanes, titles on the outer edge */}
        {plan.entries.map((entry, i) => (
          <LadderClip
            key={`${entry.trackId}-${i}`}
            entry={entry}
            track={tracks.get(entry.trackId)}
            hotCues={hotCuesByTrack.get(entry.trackId) ?? []}
            total={total}
            dim={i < view[0] || i > view[1]}
          />
        ))}
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
      </div>
    </div>
  );
}

function AdjacencyBand({ adj, total }: { adj: PlannedAdjacency; total: number }) {
  if (adj.kind === 'hardcut') {
    // Unmissable: dashed red blade + ✕ at the center line.
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${(adj.mixStartSec / total) * 100}%`,
          width: 4,
          marginLeft: -2,
          background: 'repeating-linear-gradient(180deg, #ff0040 0 6px, transparent 6px 12px)',
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
            color: '#ff0040',
            fontSize: 13,
            fontWeight: 700,
            textShadow: '0 0 4px #000, 0 0 4px #000',
          }}
        >
          ✕
        </span>
      </div>
    );
  }
  const color = adj.kind === 'transition' ? '#00ff00' : '#ff9900';
  const bg = adj.kind === 'transition' ? 'rgba(0,255,0,0.10)' : 'rgba(255,153,0,0.12)';
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
        zIndex: 1,
        pointerEvents: 'none',
      }}
    />
  );
}

function LadderClip({
  entry,
  track,
  hotCues,
  total,
  dim,
}: {
  entry: PlannedEntry;
  track: Track | undefined;
  hotCues: HotCue[];
  total: number;
  dim: boolean;
}) {
  const { data } = useWaveformBlob(entry.trackId);
  const wave = useMemo(() => (data ? toThreeBands(data) : null), [data]);
  const isA = entry.deck === 'A';
  const title = track ? (track.title ?? track.filename) : `Track ${entry.trackId}`;
  const cues = hotCues.map((c) => ({
    t: c.time_seconds,
    color: c.color ?? CUE_SLOT_COLORS[c.slot_number] ?? '#fff',
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
        opacity: dim ? 0.3 : 1,
        zIndex: 2,
      }}
    >
      {isA && <ClipTitle title={title} color={DECK_COLORS.A} />}
      <LadderWave
        wave={wave}
        height={LANE_H - TITLE_H - 2}
        range={[entry.entrySec, entry.exitSec]}
        cues={cues}
        dir={isA ? 'up' : 'down'}
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

/** Static 2D-canvas three-band waveform for one clip. Bars grow from the
 * center line ('up' anchors the baseline at the bottom edge, 'down' hangs
 * them from the top); hot cues draw a faint full-height line plus a
 * triangle on the OUTER (title-side) edge, keeping the center line clean. */
function LadderWave({
  wave,
  height,
  range,
  cues,
  dir,
}: {
  wave: ThreeBandWaveform | null;
  height: number;
  /** Track-time span this clip plays. */
  range: [number, number];
  cues: { t: number; color: string }[];
  dir: 'up' | 'down';
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cueKey = cues.map((c) => `${c.t}:${c.color}`).join('|');

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

    const bands = [
      { data: wave.low, color: '242,97,97' },
      { data: wave.mid, color: '0,230,0' },
      { data: wave.high, color: '135,222,237' },
    ];
    const frames = wave.low.length;
    for (let x = 0; x < w; x++) {
      const t = t0 + (x / w) * span;
      if (t < 0 || t > wave.duration) continue;
      const idx = Math.max(0, Math.min(frames - 1, Math.floor((t / wave.duration) * frames)));
      for (const band of bands) {
        const amp = band.data[idx] * h * 0.95;
        if (amp <= 0.5) continue;
        ctx.fillStyle = `rgba(${band.color},0.85)`;
        ctx.fillRect(x, dir === 'up' ? h - amp : 0, 1, amp);
      }
    }

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
  }, [wave, height, dir, range[0], range[1], cueKey]);

  return <canvas ref={ref} style={{ width: '100%', height, display: 'block', flex: 'none' }} />;
}
