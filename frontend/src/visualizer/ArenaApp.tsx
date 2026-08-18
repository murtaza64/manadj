import { useEffect, useRef, useState } from 'react';
import { BACKEND_URL } from '../api/client';
import { candidateIds, loadCandidate } from './presets/gen';
import { getParamValues, setParamValue, subscribeParams } from './visualizerStore';
import type { PresetRenderer, VisualizerPreset } from './presets/types';
import { feedFrame, useVisualizerFeed } from './useVisualizerFeed';
import './ArenaApp.css';

/**
 * The genetic arena (realtime-visualization 06): head-to-head candidate
 * judging. Two genepool candidates render split-screen off the ONE live
 * feed (same musical moment hits both); the human votes with hotkeys and
 * attaches free-text notes that feed descendants' briefs. Judgments are
 * append-only events (backend /api/ga); the orchestrating agent owns the
 * manifest and breeds generations (docs/visualizer-ga.md).
 *
 * Hotkeys: ←/→ winner · ↓ both bad · ↑ both good · space next pair ·
 * f focus left/right/split · t note · [ / ] promote left/right.
 * A candidate that throws mid-render auto-loses and is flagged.
 */

const API = `${BACKEND_URL}/api/ga`;

interface Slot {
  id: string;
  preset: VisualizerPreset;
  renderer: PresetRenderer;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  errored: string | null;
}

interface GaState {
  manifest: { generation: number; candidates: Record<string, { rating?: number; status?: string }> };
  events: { type: string; a?: string; b?: string; target?: string }[];
}

async function postEvent(event: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${API}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch {
    console.warn('[arena] event post failed', event);
  }
}

/** Pair scheduler: alive candidates, fewest votes first, nearest rating. */
function schedulePair(state: GaState, ids: string[]): [string, string] | null {
  const alive = ids.filter((id) => {
    const entry = state.manifest.candidates[id];
    return !entry || entry.status === 'alive' || entry.status === undefined;
  });
  if (alive.length < 2) return null;
  const votes = new Map<string, number>(alive.map((id) => [id, 0]));
  for (const event of state.events) {
    if (event.type !== 'vote') continue;
    for (const id of [event.a, event.b]) {
      if (id && votes.has(id)) votes.set(id, (votes.get(id) ?? 0) + 1);
    }
  }
  const rating = (id: string) => state.manifest.candidates[id]?.rating ?? 1000;
  const sorted = [...alive].sort(
    (x, y) => (votes.get(x)! - votes.get(y)!) || Math.random() - 0.5
  );
  const first = sorted[0];
  const partner = sorted
    .slice(1)
    .sort((x, y) => Math.abs(rating(x) - rating(first)) - Math.abs(rating(y) - rating(first)))[0];
  return Math.random() < 0.5 ? [first, partner] : [partner, first];
}

function makeSlot(id: string, preset: VisualizerPreset): Slot | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return { id, preset, renderer: preset.create(), canvas, ctx, errored: null };
}

export function ArenaApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slotsRef = useRef<{ left: Slot | null; right: Slot | null }>({ left: null, right: null });
  const stateRef = useRef<GaState>({ manifest: { generation: 0, candidates: {} }, events: [] });
  const focusRef = useRef<'split' | 'left' | 'right'>('split');
  const [pairLabel, setPairLabel] = useState<string>('loading…');
  const [panes, setPanes] = useState<{ left: VisualizerPreset | null; right: VisualizerPreset | null }>({
    left: null,
    right: null,
  });
  const [, forceParams] = useState(0);
  useEffect(() => subscribeParams(() => forceParams((n) => n + 1)), []);
  const [generation, setGeneration] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<'left' | 'right' | 'pair'>('pair');
  const [noteText, setNoteText] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const { feedRef, stalled } = useVisualizerFeed({
    wantsWave: () =>
      !!(slotsRef.current.left?.preset.wantsWave || slotsRef.current.right?.preset.wantsWave),
  });

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 1600);
  };

  const nextPair = async () => {
    const response = await fetch(`${API}/state`);
    const state: GaState = await response.json();
    stateRef.current = state;
    setGeneration(state.manifest.generation ?? 0);
    const pair = schedulePair(state, candidateIds());
    if (!pair) {
      setPairLabel('need ≥2 alive candidates — ask the orchestrator to breed');
      slotsRef.current = { left: null, right: null };
      setPanes({ left: null, right: null });
      return;
    }
    const [leftPreset, rightPreset] = await Promise.all(pair.map(loadCandidate));
    if (!leftPreset || !rightPreset) {
      // A candidate that fails to LOAD auto-loses against its partner.
      const dead = !leftPreset ? pair[0] : pair[1];
      const alive = !leftPreset ? pair[1] : pair[0];
      await postEvent({ type: 'error', target: dead, text: 'failed to load' });
      await postEvent({ type: 'vote', a: alive, b: dead, outcome: 'a' });
      flash(`${dead} failed to load — auto-loss`);
      void nextPair();
      return;
    }
    slotsRef.current = {
      left: makeSlot(pair[0], leftPreset),
      right: makeSlot(pair[1], rightPreset),
    };
    focusRef.current = 'split';
    setPanes({ left: leftPreset, right: rightPreset });
    setPairLabel(`${pair[0]}  vs  ${pair[1]}`);
  };

  const vote = async (outcome: 'a' | 'b' | 'both_bad' | 'both_good') => {
    const { left, right } = slotsRef.current;
    if (!left || !right) return;
    await postEvent({
      type: 'vote',
      a: left.id,
      b: right.id,
      outcome,
      paramsA: getParamValues(left.preset),
      paramsB: getParamValues(right.preset),
    });
    flash(
      outcome === 'a'
        ? `winner: ${left.id}`
        : outcome === 'b'
          ? `winner: ${right.id}`
          : outcome.replace('_', ' ')
    );
    void nextPair();
  };

  useEffect(() => {
    document.title = 'manaDJ arena';
    document.documentElement.classList.add('visualizer-root');
    void nextPair();
    return () => document.documentElement.classList.remove('visualizer-root');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render loop: both slots, same frame, half-width panes (or focused).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let rafId = 0;
    let startedAt = 0;
    let lastAt = 0;

    const renderSlot = (slot: Slot, x: number, w: number, h: number, frame: object) => {
      if (slot.errored || w < 2 || h < 2) return; // resize race: never 0-size
      if (slot.canvas.width !== w || slot.canvas.height !== h) {
        slot.canvas.width = w;
        slot.canvas.height = h;
      }
      try {
        slot.renderer.render(slot.ctx, w, h, {
          ...(frame as Parameters<PresetRenderer['render']>[3]),
          params: getParamValues(slot.preset),
        });
      } catch (error) {
        slot.errored = String(error);
        void postEvent({ type: 'error', target: slot.id, text: slot.errored });
        const other = slotsRef.current.left === slot ? slotsRef.current.right : slotsRef.current.left;
        if (other && !other.errored) {
          const a = slotsRef.current.left!.id;
          const b = slotsRef.current.right!.id;
          void postEvent({ type: 'vote', a, b, outcome: slot === slotsRef.current.left ? 'b' : 'a' });
          flash(`${slot.id} crashed — auto-loss`);
          void nextPair();
        }
        return;
      }
      ctx.drawImage(slot.canvas, x, 0);
    };

    const tick = (now: number) => {
      if (startedAt === 0) startedAt = now;
      const dt = lastAt > 0 ? Math.min(0.1, (now - lastAt) / 1000) : 1 / 60;
      lastAt = now;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const feed = feedFrame(feedRef.current, now);
      const frame = { ...feed, time: (now - startedAt) / 1000, dt, params: {} };
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      const { left, right } = slotsRef.current;
      const focus = focusRef.current;
      if (left && (focus === 'split' || focus === 'left')) {
        renderSlot(left, 0, focus === 'left' ? width : Math.floor(width / 2), height, frame);
      }
      if (right && (focus === 'split' || focus === 'right')) {
        renderSlot(
          right,
          focus === 'right' ? 0 : Math.ceil(width / 2),
          focus === 'right' ? width : Math.floor(width / 2),
          height,
          frame
        );
      }
      if (focus === 'split' && left && right) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(Math.floor(width / 2) - 1, 0, 2, height);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hotkeys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (noteOpen) return; // the note input owns the keyboard
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // sliders own arrows
      if (e.key === 'ArrowLeft') void vote('a');
      else if (e.key === 'ArrowRight') void vote('b');
      else if (e.key === 'ArrowDown') void vote('both_bad');
      else if (e.key === 'ArrowUp') void vote('both_good');
      else if (e.key === ' ') void nextPair();
      else if (e.key === 'f') {
        focusRef.current =
          focusRef.current === 'split' ? 'left' : focusRef.current === 'left' ? 'right' : 'split';
      } else if (e.key === 't') {
        setNoteTarget('pair');
        setNoteOpen(true);
      } else if (e.key === '[' || e.key === ']') {
        const slot = e.key === '[' ? slotsRef.current.left : slotsRef.current.right;
        if (slot) {
          void postEvent({ type: 'promote', target: slot.id });
          flash(`promote requested: ${slot.id}`);
        }
      } else if (e.key === 'Escape') {
        window.close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteOpen]);

  const submitNote = async () => {
    const { left, right } = slotsRef.current;
    if (noteText.trim() && left && right) {
      const target =
        noteTarget === 'pair' ? `pair:${left.id}|${right.id}` : noteTarget === 'left' ? left.id : right.id;
      await postEvent({ type: 'note', target, text: noteText.trim() });
      flash('note recorded');
    }
    setNoteText('');
    setNoteOpen(false);
  };

  return (
    <div className="arena">
      <canvas ref={canvasRef} className="arena-canvas" />
      <div className="arena-hud">
        <span className="arena-gen">gen {generation}</span>
        <span className="arena-pair">{pairLabel}</span>
        <span className="arena-keys">← → win · ↓ kill · ↑ keep · ␣ next · f focus · t note · [ ] promote</span>
      </div>
      {stalled && <div className="arena-nosignal">waiting for manaDJ audio</div>}
      {toast && <div className="arena-toast">{toast}</div>}
      {(['left', 'right'] as const).map((side) => {
        const preset = panes[side];
        if (!preset || (preset.params?.length ?? 0) === 0) return null;
        const values = getParamValues(preset);
        return (
          <div key={side} className={`arena-params arena-params-${side}`}>
            {preset.params!.map((param) => (
              <label key={param.id} className="arena-param">
                <span>{param.label}</span>
                <input
                  type="range"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={values[param.id] ?? param.default}
                  onChange={(e) => setParamValue(preset.id, param.id, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
        );
      })}
      {noteOpen && (
        <div className="arena-note">
          <div className="arena-note-targets">
            {(['left', 'pair', 'right'] as const).map((target) => (
              <button
                key={target}
                className={noteTarget === target ? 'active' : ''}
                onClick={() => setNoteTarget(target)}
              >
                {target}
              </button>
            ))}
          </div>
          <input
            autoFocus
            value={noteText}
            placeholder="feedback for the breeder…"
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNote();
              if (e.key === 'Escape') setNoteOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

export default ArenaApp;
