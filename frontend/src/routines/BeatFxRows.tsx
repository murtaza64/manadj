/**
 * Beat FX rows in the Mix editor (#353): the section-level FX track under
 * the slot blocks. STATE strip = step segments (effect, target, length,
 * on/off — one shared section, so one strip); DEPTH strip = the
 * LEVEL/DEPTH envelope. Recorded FX shows read-only until ✎ copies it
 * into an authored track (the lane idiom); ↺ discards the edit.
 */
import { useMemo, useRef, useState } from 'react';
import type { LanePoint } from '../editor/mixModel';
import { LaneCanvas, type LaneGuide } from '../editor/LaneCanvas';
import {
  routineFxAt,
  type RoutineBeatFx,
  type RoutineFxStep,
} from '../editor/beatFxLane';
import { BEAT_FX_EFFECTS, ECHO_BEATS_DEFAULT, stepEchoBeats, type BeatFxEffectId } from '../playback/beatFx';
import type { PlannedRoutine } from '../sets/routinePlan';
import type { RoutineDraftStore } from './routineDraftStore';
import { slotAccent } from './routineEditorModel';

/** FX identity color (fully saturated, per the project palette rule). */
const FX_COLOR = '#ff00ff';
const MASTER_COLOR = '#ffffff';
const STATE_H = 30;
const DEPTH_H = 22;
const DEPTH_H_AUTHORED = 56;
/** A fresh FX track's default span (beats) — one echo-out phrase. */
const NEW_FX_BEATS = 8;

const EFFECT_LABEL: Record<BeatFxEffectId, string> = { echo: 'ECHO', reverb: 'REVERB', flanger: 'FLANGER' };

function fmtFxBeats(b: number): string {
  if (Math.abs(b - 0.25) < 1e-6) return '¼';
  if (Math.abs(b - 0.5) < 1e-6) return '½';
  if (Math.abs(b - 0.75) < 1e-6) return '¾';
  return String(Math.round(b * 100) / 100);
}

export function BeatFxRows({
  planned,
  authored,
  draftStore,
  xOf,
  pxPerBeat,
  width,
  authoringStart,
  authoringEnd,
  playheadBeat,
  guides,
  registerScrollDraw,
  visible,
}: {
  planned: PlannedRoutine;
  /** The draft's authored FX track (edits.beatFx); undefined = recorded plays. */
  authored: RoutineBeatFx | undefined;
  draftStore: RoutineDraftStore;
  xOf: (beat: number) => number;
  pxPerBeat: number;
  width: number;
  authoringStart: number;
  authoringEnd: number;
  playheadBeat: () => number;
  guides: LaneGuide[];
  registerScrollDraw: Parameters<typeof LaneCanvas>[0]['registerScrollDraw'];
  visible: boolean;
}) {
  const recorded = planned.beatFxRecorded ?? null;
  const fx = authored ?? recorded;
  const editable = authored !== undefined;
  const [open, setOpen] = useState<number | null>(null);
  const [depthCollapsed, setDepthCollapsed] = useState(false);
  const drag = useRef<{ index: number; startX: number; startBeat: number; min: number; max: number } | null>(null);

  const slotColor = (target: string): string =>
    target === 'master' ? MASTER_COLOR : slotAccent(planned.slots.find((s) => s.slotId === target)?.deck);
  const targetLabel = (target: string): string => {
    if (target === 'master') return 'MST';
    const slot = planned.slots.find((s) => s.slotId === target);
    return slot ? String(slot.slot) : '?';
  };

  const commit = (next: RoutineBeatFx, key?: string) => draftStore.setBeatFx(next, key);
  const withStep = (i: number, patch: Partial<RoutineFxStep>): RoutineBeatFx => ({
    steps: authored!.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)),
    depth: authored!.depth,
  });

  const snapBeat = (beat: number, fine: boolean) => (fine ? beat : Math.round(beat));

  /** ✎: author from the recording, or seed a fresh echo on the outgoing
   * slot at the playhead (window start when the playhead is outside). */
  const startAuthoring = () => {
    if (recorded) {
      commit({ steps: recorded.steps.map((s) => ({ ...s })), depth: recorded.depth.map((p) => ({ ...p })) });
    } else {
      const ph = playheadBeat();
      const at = Math.round(ph >= authoringStart && ph <= authoringEnd - 1 ? ph : Math.max(0, authoringStart));
      const target = planned.slots[0]?.slotId ?? 'master';
      commit({
        steps: [
          { beat: at, on: true, selected: 'echo', target, beats: ECHO_BEATS_DEFAULT },
          { beat: at + NEW_FX_BEATS, on: false, selected: 'echo', target, beats: ECHO_BEATS_DEFAULT },
        ],
        depth: [{ beat: at, value: 0 }],
      });
    }
    draftStore.endGesture();
  };

  /** Add a step at `beat`, continuing the state there (switched ON). */
  const addStepAt = (beat: number) => {
    if (!authored) return;
    const v = routineFxAt(authored, beat);
    const step: RoutineFxStep = {
      beat,
      on: true,
      selected: v.selected,
      target: v.target,
      beats: v.beats,
    };
    const steps = [...authored.steps.filter((s) => Math.abs(s.beat - beat) > 1e-6), step]
      .sort((a, b) => a.beat - b.beat);
    commit({ steps, depth: authored.depth });
    draftStore.endGesture();
    setOpen(steps.indexOf(step));
  };

  const segments = useMemo(() => {
    if (!fx) return [];
    return fx.steps.map((s, i) => ({
      step: s,
      index: i,
      start: s.beat,
      end: fx.steps[i + 1]?.beat ?? Math.max(authoringEnd, s.beat + 1),
    }));
  }, [fx, authoringEnd]);

  const laneDuration = authoringEnd - authoringStart;
  const laneWidth = Math.max(laneDuration * pxPerBeat, 4);
  const depthPoints: LanePoint[] = useMemo(
    () =>
      (fx?.depth ?? []).map((p) => ({
        x: laneDuration > 0 ? (p.beat - authoringStart) / laneDuration : 0,
        y: (p.value + 1) / 2,
      })),
    [fx, authoringStart, laneDuration]
  );
  const [depthSel, setDepthSel] = useState<number[]>([]);

  const status = editable ? 'edited ✎' : recorded ? 'recorded' : 'none';
  const openStep = open !== null && authored ? authored.steps[open] : null;

  return (
    <div className="rt-fxblock" data-testid="beat-fx-rows">
      <div className="rt-fxpanel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="rt-sp-title">
          <span className="rt-slotnum" style={{ background: FX_COLOR }}>FX</span>
          <span className="rt-sp-trunc">Beat FX</span>
        </div>
        <div className="rt-sp-meta">
          <span className="rt-fx-status">{status}</span>
          {!editable && (
            <button
              className="rt-fx-btn"
              title={recorded
                ? 'Edit the FX: copies the recorded section into editable steps + depth'
                : 'Add Beat FX: an echo on slot 0 at the playhead (edit steps + depth below)'}
              onClick={startAuthoring}
            >
              ✎ {recorded ? 'edit' : 'add'}
            </button>
          )}
          {editable && (
            <>
              <button
                className="rt-fx-btn"
                title="Add an FX step at the playhead (continues the current state, switched on)"
                onClick={() => addStepAt(Math.round(playheadBeat()))}
              >
                + step
              </button>
              <button
                className="rt-fx-btn"
                title={recorded ? 'Discard the edited FX — the recorded FX plays again' : 'Remove the Beat FX'}
                onClick={() => {
                  setOpen(null);
                  draftStore.clearBeatFx();
                }}
              >
                ↺
              </button>
            </>
          )}
        </div>
      </div>
      <div
        className="rt-fx-state"
        style={{ height: STATE_H }}
        onDoubleClick={(e) => {
          if (!editable) return;
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const beat = (e.clientX - rect.left + xOfInverseOrigin(xOf)) / pxPerBeat;
          addStepAt(snapBeat(beat, e.shiftKey));
        }}
        title={editable ? 'Double-click: add an FX step here (shift = off-grid)' : undefined}
      >
        {segments.map(({ step, index, start, end }) => {
          const x0 = xOf(start);
          const x1 = xOf(end);
          if (x1 < -4 || x0 > width + 4) return null;
          const color = slotColor(step.target);
          return (
            <div
              key={index}
              className={`rt-fx-seg${step.on ? ' on' : ' off'}${open === index ? ' open' : ''}`}
              style={{
                transform: `translateX(${x0}px)`,
                width: Math.max(x1 - x0, 2),
                ...(step.on
                  ? { background: `color-mix(in srgb, ${color} 30%, rgba(6, 8, 12, 0.6))`, borderColor: color }
                  : {}),
              }}
              title={step.on
                ? `${EFFECT_LABEL[step.selected]} ${fmtFxBeats(step.beats)} → ${targetLabel(step.target)}${editable ? ' (click to edit, drag the edge to move)' : ''}`
                : `FX off${editable ? ' (click to edit, drag the edge to move)' : ''}`}
              onPointerDown={(e) => {
                if (!editable) return;
                e.stopPropagation();
              }}
              onClick={(e) => {
                if (!editable) return;
                e.stopPropagation();
                setOpen(open === index ? null : index);
              }}
            >
              {editable && (
                <span
                  className="rt-fx-handle"
                  style={{ background: step.on ? color : 'var(--subtext0)' }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    const steps = authored!.steps;
                    drag.current = {
                      index,
                      startX: e.clientX,
                      startBeat: step.beat,
                      min: index > 0 ? steps[index - 1].beat + 1e-3 : -Infinity,
                      max: index < steps.length - 1 ? steps[index + 1].beat - 1e-3 : Infinity,
                    };
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current;
                    if (!d || pxPerBeat <= 0) return;
                    const raw = d.startBeat + (e.clientX - d.startX) / pxPerBeat;
                    const beat = Math.max(d.min, Math.min(d.max, snapBeat(raw, e.shiftKey)));
                    commit(withStep(d.index, { beat }), `beat-fx-drag:${d.index}`);
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                    draftStore.endGesture();
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                    draftStore.endGesture();
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              {step.on && x1 - x0 > 28 && (
                <span className="rt-fx-label" style={{ color }}>
                  {EFFECT_LABEL[step.selected]} {fmtFxBeats(step.beats)} → {targetLabel(step.target)}
                </span>
              )}
            </div>
          );
        })}
        {editable && openStep && open !== null && (
          <div
            className="rt-jump-popover rt-fx-popover"
            style={{ left: Math.max(0, xOf(openStep.beat) - 20) }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className={openStep.on ? 'on' : ''}
              title="Switch the FX on/off from this step"
              onClick={() => commit(withStep(open, { on: !openStep.on }))}
            >
              {openStep.on ? 'ON' : 'OFF'}
            </button>
            <span className="rt-fx-group">
              {BEAT_FX_EFFECTS.map((id) => (
                <button
                  key={id}
                  className={openStep.selected === id ? 'on' : ''}
                  onClick={() => commit(withStep(open, { selected: id }))}
                >
                  {EFFECT_LABEL[id]}
                </button>
              ))}
            </span>
            <span className="rt-fx-group" title="Target (one section: the FX sits on one channel at a time)">
              {[...planned.slots.map((s) => s.slotId), 'master'].map((t) => (
                <button
                  key={t}
                  className={openStep.target === t ? 'on' : ''}
                  style={{ borderColor: slotColor(t) }}
                  onClick={() => commit(withStep(open, { target: t }))}
                >
                  {targetLabel(t)}
                </button>
              ))}
            </span>
            <span className="rt-fx-group" title="Beat length (BEAT ◄ ►)">
              <button onClick={() => commit(withStep(open, { beats: stepEchoBeats(openStep.beats, 'halve') }))}>◄</button>
              <span className="rt-fx-beats">{fmtFxBeats(openStep.beats)}</span>
              <button onClick={() => commit(withStep(open, { beats: stepEchoBeats(openStep.beats, 'double') }))}>►</button>
            </span>
            <button
              className="rt-jump-delete"
              title="Delete this step"
              onClick={() => {
                commit({ steps: authored!.steps.filter((_, k) => k !== open), depth: authored!.depth });
                draftStore.endGesture();
                setOpen(null);
              }}
            >
              delete
            </button>
            <button onClick={() => setOpen(null)}>✕</button>
          </div>
        )}
      </div>
      {fx && (
        <div
          className="rt-lanestrip"
          data-tutorial-control="beat-fx-depth"
          style={{ height: editable && !depthCollapsed ? DEPTH_H_AUTHORED : DEPTH_H }}
        >
          {editable && !depthCollapsed ? (
            <div
              className="rt-lanewindow"
              style={{ left: xOf(authoringStart), width: laneWidth }}
              onPointerUpCapture={() => draftStore.endGesture()}
              onPointerCancelCapture={() => draftStore.endGesture()}
            >
              <LaneCanvas
                visible={visible}
                id="filterA"
                kind="trim"
                color={FX_COLOR}
                widthPx={laneWidth}
                points={depthPoints}
                guides={guides}
                chopWall={laneDuration > 0 ? 0.1 / laneDuration : 0.01}
                windowLeftPx={authoringStart * pxPerBeat}
                registerScrollDraw={registerScrollDraw}
                onChange={(next) =>
                  commit(
                    {
                      steps: authored!.steps,
                      depth: next.map((p) => ({ beat: p.x * laneDuration + authoringStart, value: p.y * 2 - 1 })),
                    },
                    'beat-fx-depth'
                  )
                }
                selected={depthSel}
                onSelectedChange={setDepthSel}
              />
            </div>
          ) : (
            <DepthPreview fx={fx} xOf={xOf} width={width} start={authoringStart} end={authoringEnd} />
          )}
          <span className="rt-laneedge" style={{ background: FX_COLOR }} />
          <span className="rt-lanelabel" style={{ color: FX_COLOR }}>
            DEPTH{editable ? ' ✎' : ''}
          </span>
          {editable && (
            <button
              className="rt-laneauthor rt-lanecollapse"
              title={depthCollapsed ? 'Expand the depth envelope editor' : 'Collapse the depth lane to strip height'}
              onClick={(e) => {
                e.stopPropagation();
                setDepthCollapsed((c) => !c);
              }}
            >
              {depthCollapsed ? '✎' : '⊟'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** xOf(beat) = beat·px − origin, so origin = −xOf(0). */
function xOfInverseOrigin(xOf: (beat: number) => number): number {
  return -xOf(0);
}

/** Read-only depth envelope (recorded / collapsed). */
function DepthPreview({
  fx,
  xOf,
  width,
  start,
  end,
}: {
  fx: RoutineBeatFx;
  xOf: (beat: number) => number;
  width: number;
  start: number;
  end: number;
}) {
  const pts = fx.depth.length > 0 ? fx.depth : [{ beat: start, value: 0 }];
  const y = (v: number) => DEPTH_H - 3 - ((v + 1) / 2) * (DEPTH_H - 6);
  const coords = [
    { x: xOf(Math.min(start, pts[0].beat)), y: y(pts[0].value) },
    ...pts.map((p) => ({ x: xOf(p.beat), y: y(p.value) })),
    { x: xOf(Math.max(end, pts[pts.length - 1].beat)), y: y(pts[pts.length - 1].value) },
  ];
  return (
    <svg className="rt-fx-depthpreview" width={Math.max(width, 1)} height={DEPTH_H}>
      <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke="var(--surface1)" strokeDasharray="2 3" />
      <polyline
        points={coords.map((c) => `${c.x},${c.y}`).join(' ')}
        fill="none"
        stroke={FX_COLOR}
        strokeWidth={1.5}
      />
    </svg>
  );
}
