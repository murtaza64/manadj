/**
 * Session timeline (sessions 04, ADR 0033): the per-Session lens. Deck
 * lanes with track names, waveforms of the audio that played, audibility
 * bands, playhead traces; idle collapsed; machine tenure shown as honest
 * gaps; Takes drawn in place (click → the Transition editor, exactly as
 * the history does). The graduated design from the sessions-03 prototype.
 *
 * A canvas layer (waveforms) sits under an SVG overlay (everything
 * interactive). Playback (auditioning a moment) is sessions 05 — the
 * scrub readout here is already the replay planner's input.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { SessionRowWire, TakeRowWire } from '../api/client';
import { DECK_COLORS } from '../theme/deckColors';
import { requestTakeReview } from '../capture/takeReview';
import type { CaptureDeck, CaptureEvent } from '../capture/events';
import { decodeWaveformBlob, toThreeBands } from '../waveform/blob';
import type { ThreeBandWaveform } from '../waveform/blob';
import {
  ALL_DECKS,
  buildTimeAxis,
  deriveTimeline,
  stateAt,
} from './timelineModel';
import type { TimelineModel } from './timelineModel';
import { drawSpanWaveform } from './waveformLanes';
import './sessionTimeline.css';

// ── Layout ──────────────────────────────────────────────────────────────

const LANE_H = 76;
const LANE_GAP = 8;
const CHIP_STRIP_H = 30;
const RULER_H = 22;
const BASE_W = 1180;

// ── Formatting ──────────────────────────────────────────────────────────

function fmtClock(s: number): string {
  const abs = Math.abs(s);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const sec = Math.floor(abs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtDur(s: number): string {
  if (s < 90) return `${Math.round(s)}s`;
  return `${Math.round(s / 60)}m`;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type Selection =
  | { kind: 'none' }
  | { kind: 'moment'; t: number }
  | { kind: 'take'; take: TakeRowWire };

interface Props {
  session: SessionRowWire;
  /** Deep-link: center on this capture-clock moment on open (history jump). */
  focusS?: number | null;
  onBack(): void;
}

export function SessionTimelineView({ session, focusS, onBack }: Props) {
  const [collapseIdle, setCollapseIdle] = useState(true);
  const [thresholdS, setThresholdS] = useState(45);
  const [expandedIdle, setExpandedIdle] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [showTraces, setShowTraces] = useState(true);
  const [scrubT, setScrubT] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });

  const { data: detail, error } = useQuery({
    queryKey: ['session', session.uuid],
    queryFn: () => api.sessions.get(session.uuid),
  });
  const { data: allTakes } = useQuery({ queryKey: ['takes'], queryFn: api.takes.list });

  const events = detail?.events as CaptureEvent[] | undefined;
  const takes = useMemo(
    () => (allTakes ?? []).filter((t) => t.session_uuid === session.uuid),
    [allTakes, session.uuid]
  );

  const model: TimelineModel | null = useMemo(
    () => (events ? deriveTimeline(events) : null),
    [events]
  );

  // Track titles for every loaded track + Take pairs.
  const [trackNames, setTrackNames] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!model) return;
    const wanted = new Set<number>(model.trackIds);
    for (const t of takes) {
      wanted.add(t.a_track_id);
      wanted.add(t.b_track_id);
    }
    const missing = [...wanted].filter((id) => trackNames[id] === undefined);
    if (missing.length === 0) return;
    Promise.all(
      missing.map((id) =>
        api.tracks
          .getById(id)
          .then((tr: { title?: string }) => [id, tr.title ?? `#${id}`] as const)
          .catch(() => [id, `#${id}`] as const)
      )
    ).then((pairs) => setTrackNames((prev) => ({ ...prev, ...Object.fromEntries(pairs) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, takes]);

  const axis = useMemo(
    () =>
      model ? buildTimeAxis(model, { collapseIdle, thresholdS, expanded: expandedIdle }) : null,
    [model, collapseIdle, thresholdS, expandedIdle]
  );

  // Deep-link focus: drop the scrub cursor + a moment selection once.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (focusedRef.current || focusS == null || !model) return;
    focusedRef.current = true;
    setScrubT(focusS);
    setSelection({ kind: 'moment', t: focusS });
  }, [focusS, model]);

  const scrubState = useMemo(
    () => (events && scrubT !== null ? stateAt(events, scrubT) : null),
    [events, scrubT]
  );
  const momentState = useMemo(
    () => (events && selection.kind === 'moment' ? stateAt(events, selection.t) : null),
    [events, selection]
  );

  const width = BASE_W * zoom;
  const svgH = RULER_H + CHIP_STRIP_H + 4 * (LANE_H + LANE_GAP);
  const lanesTop = RULER_H + CHIP_STRIP_H;
  const laneY = (i: number) => lanesTop + i * (LANE_H + LANE_GAP);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const xFrac = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  // Waveform blobs for every loaded track — the same query keys as
  // useWaveformBlob, so decodes are shared with the decks/editor.
  const blobQueries = useQueries({
    queries: (model?.trackIds ?? []).map((id) => ({
      queryKey: ['waveform-blob', id],
      queryFn: async () => decodeWaveformBlob(await api.waveforms.getData(id)),
      staleTime: Infinity,
      retry: 5,
      refetchInterval: (query: { state: { data: unknown } }) =>
        query.state.data === undefined ? 8000 : false,
    })),
  });
  const blobsReadyKey = blobQueries.map((q) => (q.data ? '1' : '0')).join('');
  const bandsByTrack = useMemo(() => {
    const out: Record<number, ThreeBandWaveform> = {};
    (model?.trackIds ?? []).forEach((id, i) => {
      const d = blobQueries[i]?.data;
      if (d) out[id] = toThreeBands(d);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, blobsReadyKey]);

  // Waveform canvas: one owner draws everything (resize+clear+paint in a
  // single effect, so axis/zoom changes can never leave stale paint).
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !model || !axis) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = svgH * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, svgH);
    ALL_DECKS.forEach((deck, i) => {
      for (const span of model.decks[deck].trackSpans) {
        drawSpanWaveform(
          ctx,
          bandsByTrack[span.trackId] ?? null,
          span,
          model.decks[deck],
          axis,
          DECK_COLORS[deck],
          { width, yOffset: laneY(i), height: LANE_H }
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, axis, width, svgH, bandsByTrack]);

  return (
    <div className="session-timeline">
      <div className="stl-controls">
        <button className="stl-back" onClick={onBack}>
          ‹ Sessions
        </button>
        <span className="stl-title">
          {fmtWhen(session.started_at)}
          {model ? ` · ${fmtDur(model.end - model.start)} · ${takes.length} takes` : ''}
        </span>
        <label>
          <input
            type="checkbox"
            checked={collapseIdle}
            onChange={(e) => setCollapseIdle(e.target.checked)}
          />
          collapse idle ≥
        </label>
        <select
          value={thresholdS}
          onChange={(e) => setThresholdS(Number(e.target.value))}
          disabled={!collapseIdle}
        >
          <option value={30}>30s</option>
          <option value={45}>45s</option>
          <option value={120}>2m</option>
          <option value={300}>5m</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={showTraces}
            onChange={(e) => setShowTraces(e.target.checked)}
          />
          playheads
        </label>
        <span className="stl-zoom">
          zoom
          {[1, 3, 8].map((z) => (
            <button key={z} className={zoom === z ? 'active' : ''} onClick={() => setZoom(z)}>
              {z}×
            </button>
          ))}
        </span>
      </div>

      {error ? <div className="stl-error">{String(error)}</div> : null}

      {model && axis ? (
        <>
          <div className="stl-scroll">
            <div className="stl-stage" style={{ width, height: svgH }}>
              <canvas ref={canvasRef} className="stl-canvas" style={{ width, height: svgH }} />
              <svg
                ref={svgRef}
                width={width}
                height={svgH}
                className="stl-svg"
                onMouseMove={(e) => axis && setScrubT(axis.xToT(xFrac(e.clientX)))}
                onMouseLeave={() => setScrubT(null)}
                onClick={(e) =>
                  axis && setSelection({ kind: 'moment', t: axis.xToT(xFrac(e.clientX)) })
                }
              >
                <TimelineScene
                  model={model}
                  axis={axis}
                  width={width}
                  lanesTop={lanesTop}
                  laneY={laneY}
                  takes={takes}
                  trackNames={trackNames}
                  scrubT={scrubT}
                  selection={selection}
                  showTraces={showTraces}
                  onTakeClick={(take) => setSelection({ kind: 'take', take })}
                  onIdleClick={(idx) =>
                    setExpandedIdle((prev) => {
                      const next = new Set(prev);
                      if (next.has(idx)) next.delete(idx);
                      else next.add(idx);
                      return next;
                    })
                  }
                />
              </svg>
            </div>
          </div>

          <Legend />

          <DetailPanel
            selection={selection}
            scrubState={scrubState}
            momentState={momentState}
            trackNames={trackNames}
            model={model}
            onOpenTake={(uuid) => requestTakeReview(uuid)}
            onClear={() => setSelection({ kind: 'none' })}
          />
        </>
      ) : (
        <div className="stl-loading">Loading session…</div>
      )}
    </div>
  );
}

// ── SVG scene ─────────────────────────────────────────────────────────────

interface SceneProps {
  model: TimelineModel;
  axis: ReturnType<typeof buildTimeAxis>;
  width: number;
  lanesTop: number;
  laneY(i: number): number;
  takes: TakeRowWire[];
  trackNames: Record<number, string>;
  scrubT: number | null;
  selection: Selection;
  showTraces: boolean;
  onTakeClick(take: TakeRowWire): void;
  onIdleClick(idx: number): void;
}

function TimelineScene({
  model,
  axis,
  width,
  lanesTop,
  laneY,
  takes,
  trackNames,
  scrubT,
  selection,
  showTraces,
  onTakeClick,
  onIdleClick,
}: SceneProps) {
  const X = (t: number) => axis.tToX(t) * width;
  const lanesBottom = laneY(3) + LANE_H;

  const ticks: number[] = [];
  {
    const targetCount = Math.max(4, Math.floor(width / 110));
    const stepRaw = axis.visibleDurationS / targetCount;
    const step = [5, 10, 15, 30, 60, 120, 300, 600, 1200].find((s) => s >= stepRaw) ?? 1800;
    for (let t = Math.ceil(model.start / step) * step; t <= model.end; t += step) {
      const seg = axis.segments.find((s) => t >= s.start && t <= s.end);
      if (seg?.collapsed) continue;
      ticks.push(t);
    }
  }

  return (
    <g>
      {ticks.map((t) => (
        <g key={`tick-${t}`}>
          <line x1={X(t)} y1={RULER_H - 6} x2={X(t)} y2={lanesBottom} className="stl-gridline" />
          <text x={X(t) + 3} y={RULER_H - 8} className="stl-tick-label">
            {fmtClock(t)}
          </text>
        </g>
      ))}

      {ALL_DECKS.map((deck, i) => (
        <DeckLane
          key={deck}
          deck={deck}
          y={laneY(i)}
          model={model}
          X={X}
          trackNames={trackNames}
          showTraces={showTraces}
        />
      ))}

      {/* Tenure holds. */}
      {model.tenures.map((sp, i) => {
        const x0 = X(sp.start);
        const x1 = Math.max(X(sp.end), x0 + 14);
        return (
          <g key={`tenure-${i}`}>
            <rect
              x={x0}
              y={lanesTop}
              width={x1 - x0}
              height={lanesBottom - lanesTop}
              className="stl-tenure"
            />
            <text
              x={(x0 + x1) / 2}
              y={lanesTop + 13}
              className="stl-tenure-label"
              textAnchor="middle"
            >
              {sp.holder} held the surface · {fmtDur(sp.end - sp.start)}
              {sp.open ? ' · unclosed' : ''}
            </text>
          </g>
        );
      })}

      {/* Suspended (>2 audible). */}
      {model.suspended.map((sp, i) => (
        <rect
          key={`susp-${i}`}
          x={X(sp.start)}
          y={lanesTop}
          width={Math.max(X(sp.end) - X(sp.start), 3)}
          height={lanesBottom - lanesTop}
          className="stl-suspended"
        />
      ))}

      {/* Collapsed idle markers. */}
      {axis.segments
        .filter((s) => s.collapsed)
        .map((seg) => {
          const idx = model.idle.findIndex((sp) => sp.start === seg.start && sp.end === seg.end);
          const cx = ((seg.x0 + seg.x1) / 2) * width;
          return (
            <g
              key={`idle-${seg.start}`}
              className="stl-idle-marker"
              onClick={(e) => {
                e.stopPropagation();
                if (idx >= 0) onIdleClick(idx);
              }}
            >
              <rect
                x={seg.x0 * width}
                y={RULER_H}
                width={(seg.x1 - seg.x0) * width}
                height={lanesBottom - RULER_H}
                className="stl-idle-rect"
              />
              <text
                x={cx}
                y={(RULER_H + lanesBottom) / 2}
                textAnchor="middle"
                className="stl-idle-label"
              >
                ‖ {fmtDur(seg.end - seg.start)} idle
              </text>
            </g>
          );
        })}

      {/* Take chips. */}
      {takes.map((t) => {
        const x0 = X(t.window_start_s);
        const x1 = Math.max(X(t.window_end_s), x0 + 12);
        const selected = selection.kind === 'take' && selection.take.uuid === t.uuid;
        const label = `${trackNames[t.a_track_id] ?? t.a_track_id} → ${
          trackNames[t.b_track_id] ?? t.b_track_id
        }`;
        return (
          <g
            key={t.uuid}
            className={`stl-take-chip${selected ? ' selected' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onTakeClick(t);
            }}
          >
            <title>{`${label} · confidence ${t.confidence.toFixed(2)}`}</title>
            <rect x={x0} y={RULER_H + 2} width={x1 - x0} height={CHIP_STRIP_H - 6} rx={5} />
            {x1 - x0 > 90 ? (
              <text x={x0 + 5} y={RULER_H + 17}>
                ● {label.slice(0, Math.floor((x1 - x0) / 7))}
              </text>
            ) : (
              <text x={x0 + 4} y={RULER_H + 17}>
                ●
              </text>
            )}
            <line
              x1={x0}
              y1={RULER_H + CHIP_STRIP_H - 4}
              x2={x0}
              y2={lanesBottom}
              className="stl-take-whisker"
            />
            <line
              x1={x1}
              y1={RULER_H + CHIP_STRIP_H - 4}
              x2={x1}
              y2={lanesBottom}
              className="stl-take-whisker"
            />
          </g>
        );
      })}

      {/* Moment selection anchor. */}
      {selection.kind === 'moment' ? (
        <g className="stl-anchor">
          <line x1={X(selection.t)} y1={RULER_H} x2={X(selection.t)} y2={lanesBottom} />
          <polygon
            points={`${X(selection.t) - 6},${RULER_H} ${X(selection.t) + 6},${RULER_H} ${X(selection.t)},${RULER_H + 9}`}
          />
        </g>
      ) : null}

      {/* Scrub cursor. */}
      {scrubT !== null ? (
        <line
          x1={X(scrubT)}
          y1={RULER_H}
          x2={X(scrubT)}
          y2={lanesBottom}
          className="stl-scrub-line"
        />
      ) : null}
    </g>
  );
}

function DeckLane({
  deck,
  y,
  model,
  X,
  trackNames,
  showTraces,
}: {
  deck: CaptureDeck;
  y: number;
  model: TimelineModel;
  X(t: number): number;
  trackNames: Record<number, string>;
  showTraces: boolean;
}) {
  const dt = model.decks[deck];
  const color = DECK_COLORS[deck];
  const h = LANE_H;
  const maxPlayhead = Math.max(1, ...dt.traces.flat().map((p) => p.playhead));

  return (
    <g className="stl-lane">
      <rect x={0} y={y} width="100%" height={h} className="stl-lane-bg" />
      <text x={6} y={y + 14} className="stl-lane-letter" fill={color}>
        {deck}
      </text>

      {dt.trackSpans.map((sp, i) => (
        <text
          key={`trk-${i}`}
          x={X(sp.start) + 18}
          y={y + 14}
          className="stl-track-label"
          fill={color}
        >
          {trackNames[sp.trackId] ?? `#${sp.trackId}`}
        </text>
      ))}

      {/* Audibility bands (bright). */}
      {dt.audibleSpans.map((sp, i) => (
        <rect
          key={`aud-${i}`}
          x={X(sp.start)}
          y={y + h - 7}
          width={Math.max(X(sp.end) - X(sp.start), 2)}
          height={7}
          fill={color}
          opacity={0.95}
        />
      ))}

      {/* Playhead traces (over the waveform, showing track position). */}
      {showTraces
        ? dt.traces.map((trace, i) => (
            <polyline
              key={`trace-${i}`}
              points={trace
                .map((p) => `${X(p.t)},${y + 18 + (1 - p.playhead / maxPlayhead) * (h - 30)}`)
                .join(' ')}
              className="stl-trace"
              stroke={color}
            />
          ))
        : null}
    </g>
  );
}

function Legend() {
  return (
    <div className="stl-legend">
      <span>
        <i className="stl-swatch stl-swatch-wave" /> waveform (audio that played)
      </span>
      <span>
        <i className="stl-swatch stl-swatch-audible" /> audible on Master
      </span>
      <span>
        <i className="stl-swatch stl-swatch-trace" /> playhead trace
      </span>
      <span>
        <i className="stl-swatch stl-swatch-tenure" /> machine tenure (honest gap)
      </span>
      <span>
        <i className="stl-swatch stl-swatch-suspended" /> &gt;2 audible (detector suspended)
      </span>
      <span>
        <i className="stl-swatch stl-swatch-take" /> Take (click → editor)
      </span>
      <span className="stl-legend-hint">
        hover = scrub · click = moment · click an idle marker to expand
      </span>
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────

function DetailPanel({
  selection,
  scrubState,
  momentState,
  trackNames,
  model,
  onOpenTake,
  onClear,
}: {
  selection: Selection;
  scrubState: ReturnType<typeof stateAt> | null;
  momentState: ReturnType<typeof stateAt> | null;
  trackNames: Record<number, string>;
  model: TimelineModel;
  onOpenTake(uuid: string): void;
  onClear(): void;
}) {
  return (
    <div className="stl-panel">
      <div className="stl-panel-col">
        <div className="stl-panel-title">Scrub — state at cursor</div>
        {scrubState ? (
          <StateReadout state={scrubState} trackNames={trackNames} />
        ) : (
          <div className="stl-dim">
            Hover the timeline to read reconstructed deck state at any moment.
          </div>
        )}
      </div>

      <div className="stl-panel-col">
        {selection.kind === 'none' ? (
          <>
            <div className="stl-panel-title">Selection</div>
            <div className="stl-dim">
              Click a moment to inspect it, or a Take chip to open it in the editor.
            </div>
          </>
        ) : null}

        {selection.kind === 'moment' && momentState ? (
          <>
            <div className="stl-panel-title">
              Moment {fmtClock(selection.t)}
              <button className="stl-clear" onClick={onClear}>
                ✕
              </button>
            </div>
            <div className="stl-stub-body">
              {ALL_DECKS.some((d) => momentState.decks[d].trackId !== null) ? (
                <>
                  Auditioning this moment (sessions 05) replays through the live decks from here:{' '}
                  {ALL_DECKS.filter((d) => momentState.decks[d].trackId !== null)
                    .map(
                      (d) =>
                        `${trackNames[momentState.decks[d].trackId!] ?? momentState.decks[d].trackId} on ${d} @ ${fmtClock(momentState.decks[d].playhead)}`
                    )
                    .join(' · ')}
                  .
                </>
              ) : (
                'No tracks loaded at this moment.'
              )}
            </div>
            <StateReadout state={momentState} trackNames={trackNames} />
          </>
        ) : null}

        {selection.kind === 'take' ? (
          <>
            <div className="stl-panel-title">
              Take {trackNames[selection.take.a_track_id] ?? selection.take.a_track_id} →{' '}
              {trackNames[selection.take.b_track_id] ?? selection.take.b_track_id}
              <button className="stl-clear" onClick={onClear}>
                ✕
              </button>
            </div>
            <div className="stl-stub-body">
              window {fmtClock(selection.take.window_start_s)}–
              {fmtClock(selection.take.window_end_s)} · confidence{' '}
              {selection.take.confidence.toFixed(2)} · origin {selection.take.origin}
            </div>
            <button className="stl-open-editor" onClick={() => onOpenTake(selection.take.uuid)}>
              Open in Transition editor →
            </button>
          </>
        ) : null}
      </div>

      <div className="stl-panel-col stl-panel-facts">
        <div className="stl-panel-title">Session facts</div>
        <div className="stl-facts">
          <span>log span {fmtDur(model.end - model.start)}</span>
          <span>
            {model.idle.length} idle stretch{model.idle.length === 1 ? '' : 'es'}
          </span>
          <span>
            {model.tenures.length} tenure hold{model.tenures.length === 1 ? '' : 's'}
          </span>
          <span>{model.suspended.length} suspended (&gt;2 audible)</span>
        </div>
      </div>
    </div>
  );
}

function StateReadout({
  state,
  trackNames,
}: {
  state: ReturnType<typeof stateAt>;
  trackNames: Record<number, string>;
}) {
  return (
    <table className="stl-readout">
      <tbody>
        <tr className="stl-readout-head">
          <td>{fmtClock(state.t)}</td>
          <td colSpan={3}>
            xf {state.crossfader.toFixed(2)}
            {state.tenureHolder ? ` · ${state.tenureHolder} holds the surface` : ''}
          </td>
        </tr>
        {ALL_DECKS.map((d) => {
          const ds = state.decks[d];
          return (
            <tr key={d} className={ds.audible ? 'audible' : ds.playing ? 'playing' : 'silent'}>
              <td style={{ color: DECK_COLORS[d] }}>{d}</td>
              <td className="stl-readout-track">
                {ds.trackId !== null ? trackNames[ds.trackId] ?? `#${ds.trackId}` : '—'}
              </td>
              <td>{ds.trackId !== null ? fmtClock(ds.playhead) : ''}</td>
              <td>
                {ds.audible
                  ? `audible ${(ds.gain * 100).toFixed(0)}%`
                  : ds.playing
                    ? 'playing (silent)'
                    : 'stopped'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
