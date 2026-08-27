import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { presetById } from '../visualizer/presets';
import {
  aliveCandidateListings,
  ensureCandidate,
  getCachedCandidate,
  isCandidateId,
} from '../visualizer/presets/gen';
import {
  getVisualizerRemote,
  sendVisualizerCycle,
  sendVisualizerParam,
  sendVisualizerPreset,
  sendVisualizerSolo,
  subscribeVisualizerRemote,
} from '../visualizer/remote';
import type { CycleMode } from '../visualizer/soloReview';
import { isVisualizerOpen, openArena, toggleVisualizer } from '../visualizer/windowControl';
import './VisualizerControlModal.css';

/**
 * Laptop-side visualizer control (realtime-visualization 03): everything
 * needed to drive a projector-fullscreen visualizer without touching it —
 * window open/focus/close, live preset switching (BroadcastChannel
 * set-preset; the grid mirrors the viz window's own preset from its
 * pings), and, under the desktop shell, the display picker that sends the
 * window fullscreen onto a chosen display (HDMI flow). In a browser the
 * display section hides — drag + ⛶ remains the fallback.
 */
/** How long a locally-dragged value outranks the ping echo (the viz
 * window reports params every 500 ms; without this, dragging snaps back
 * to the previous echo mid-gesture). */
const LOCAL_EDIT_PRECEDENCE_MS = 1200;
/** Genepool candidates in the switcher while the marathon runs (rt-viz 06). */
const GEN_LISTINGS = aliveCandidateListings();

/** Auto-cycle modes, mirroring the viz window's `c` hotkey states. */
const CYCLE_CHOICES: { mode: CycleMode; label: string; title: string }[] = [
  { mode: 'off', label: 'Off', title: 'No auto-cycle' },
  { mode: 'timer', label: '45s', title: 'Advance every 45 seconds' },
  { mode: 'drop', label: 'Post-drop', title: 'Advance 128 beats after each drop' },
];

export function VisualizerControlModal({ onClose }: { onClose: () => void }) {
  const remote = useSyncExternalStore(subscribeVisualizerRemote, getVisualizerRemote);
  const [displays, setDisplays] = useState<VisualizerDisplayInfo[] | null>(null);
  const bridge = window.manadjVisualizer;
  const [genFilter, setGenFilter] = useState('');
  const [genTick, setGenTick] = useState(0);
  void genTick; // re-render trigger once a gen module resolves
  const activePreset = remote.presetId
    ? isCandidateId(remote.presetId)
      ? getCachedCandidate(remote.presetId)
      : presetById(remote.presetId)
    : null;
  // Gen preset params need the candidate module (async import, then cache).
  useEffect(() => {
    if (remote.presetId && isCandidateId(remote.presetId) && !getCachedCandidate(remote.presetId)) {
      void ensureCandidate(remote.presetId).then(() => setGenTick((t) => t + 1));
    }
  }, [remote.presetId]);
  // Recently-dragged values take precedence over the ping echo.
  const localEdits = useRef<Record<string, { value: number; at: number }>>({});
  const [, forceRender] = useState(0);
  const paramValue = (paramId: string, fallback: number): number => {
    const local = localEdits.current[`${remote.presetId}:${paramId}`];
    if (local && performance.now() - local.at < LOCAL_EDIT_PRECEDENCE_MS) return local.value;
    return remote.params?.[paramId] ?? fallback;
  };
  const editParam = (paramId: string, value: number) => {
    if (!remote.presetId) return;
    localEdits.current[`${remote.presetId}:${paramId}`] = { value, at: performance.now() };
    sendVisualizerParam(remote.presetId, paramId, value);
    forceRender((n) => n + 1);
  };

  // Displays: load on open and refresh while the modal is up (plugging in
  // the HDMI cable while the modal is open should just show the display).
  useEffect(() => {
    if (!bridge) return;
    let disposed = false;
    const refresh = () =>
      bridge.displays().then((list) => {
        if (!disposed) setDisplays(list);
      });
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [bridge, remote.open]);

  return (
    <div className="vizmodal-overlay" onClick={onClose}>
      <div className="vizmodal" onClick={(e) => e.stopPropagation()}>
        <div className="vizmodal-header">
          <span className={`vizmodal-dot${remote.open ? ' on' : ''}`} />
          <h2>Visualizer</h2>
          <button className="vizmodal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="vizmodal-row">
          <button className="vizmodal-btn" onClick={() => toggleVisualizer()}>
            {isVisualizerOpen() || remote.open ? 'Focus / close' : 'Open window'}
          </button>
          <button className="vizmodal-btn" onClick={() => openArena()}>
            Open arena
          </button>
        </div>

        <h3>Review — {remote.presetId ?? 'no preset'}</h3>
        <div className="vizmodal-row">
          <button
            className="vizmodal-btn"
            disabled={!remote.open}
            title="Like the current candidate (viz hotkey g)"
            onClick={() => sendVisualizerSolo('like')}
          >
            👍 Like
          </button>
          <button
            className="vizmodal-btn"
            disabled={!remote.open}
            title="Dislike the current candidate (viz hotkey b)"
            onClick={() => sendVisualizerSolo('dislike')}
          >
            👎 Dislike
          </button>
          <button
            className="vizmodal-btn"
            disabled={!remote.open}
            title="Neutral verdict on the current candidate (viz hotkey m)"
            onClick={() => sendVisualizerSolo('neutral')}
          >
            · Neutral
          </button>
          <button
            className="vizmodal-btn"
            disabled={!remote.open}
            title="Skip to the next candidate — logs watch time (viz hotkey n)"
            onClick={() => sendVisualizerSolo('next')}
          >
            ⏭ Next
          </button>
        </div>

        <h3>Auto-cycle</h3>
        <div className="vizmodal-row vizmodal-cycle">
          {CYCLE_CHOICES.map(({ mode, label, title }) => (
            <button
              key={mode}
              className={`vizmodal-btn${remote.cycleMode === mode ? ' active' : ''}`}
              disabled={!remote.open}
              title={title}
              onClick={() => sendVisualizerCycle(mode)}
            >
              {label}
            </button>
          ))}
        </div>

        <h3>Presets (score)</h3>
        <input
          className="vizmodal-gen-search"
          type="search"
          placeholder={`filter ${GEN_LISTINGS.length} presets…`}
          value={genFilter}
          onChange={(e) => setGenFilter(e.target.value)}
        />
        <div className="vizmodal-presets vizmodal-genlist">
          {GEN_LISTINGS.filter(({ id }) =>
            id.toLowerCase().includes(genFilter.trim().toLowerCase())
          ).map(({ id, score }) => (
            <button
              key={id}
              className={`vizmodal-btn gen${id === remote.presetId ? ' active' : ''}`}
              disabled={!remote.open}
              onClick={() => sendVisualizerPreset(id)}
            >
              {id} · {score >= 0 ? `+${score}` : score}
            </button>
          ))}
        </div>

        {activePreset && (activePreset.params?.length ?? 0) > 0 && (
          <>
            <h3>Parameters — {activePreset.name}</h3>
            <div className="vizmodal-params">
              {activePreset.params!.map((param) => (
                <label key={param.id} className="vizmodal-param">
                  <span>{param.label}</span>
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    disabled={!remote.open}
                    value={paramValue(param.id, param.default)}
                    onChange={(e) => editParam(param.id, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
          </>
        )}

        {bridge && (
          <>
            <h3>Display</h3>
            <div className="vizmodal-displays">
              {(displays ?? []).map((display) => (
                <button
                  key={display.id}
                  className={`vizmodal-btn${display.fullscreen ? ' active' : ''}`}
                  disabled={!remote.open}
                  title={`${display.width}×${display.height}`}
                  onClick={() => void bridge.fullscreenOn(display.id)}
                >
                  ⛶ {display.label}
                  {display.primary ? ' (primary)' : ''}
                </button>
              ))}
              <button
                className="vizmodal-btn"
                disabled={!remote.open}
                onClick={() => void bridge.windowed()}
              >
                Windowed
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
