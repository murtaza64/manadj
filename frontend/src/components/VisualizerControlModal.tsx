import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PRESETS, presetById } from '../visualizer/presets';
import {
  aliveCandidateListings,
  ensureCandidate,
  getCachedCandidate,
  isCandidateId,
} from '../visualizer/presets/gen';
import {
  getVisualizerRemote,
  sendVisualizerParam,
  sendVisualizerPreset,
  subscribeVisualizerRemote,
} from '../visualizer/remote';
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

export function VisualizerControlModal({ onClose }: { onClose: () => void }) {
  const remote = useSyncExternalStore(subscribeVisualizerRemote, getVisualizerRemote);
  const [displays, setDisplays] = useState<VisualizerDisplayInfo[] | null>(null);
  const bridge = window.manadjVisualizer;
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

        <h3>Preset</h3>
        <div className="vizmodal-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={`vizmodal-btn${preset.id === remote.presetId ? ' active' : ''}`}
              disabled={!remote.open}
              onClick={() => sendVisualizerPreset(preset.id)}
            >
              {preset.name}
            </button>
          ))}
        </div>

        <h3>Genepool (rating)</h3>
        <div className="vizmodal-presets">
          {GEN_LISTINGS.map(({ id, rating }) => (
            <button
              key={id}
              className={`vizmodal-btn gen${id === remote.presetId ? ' active' : ''}`}
              disabled={!remote.open}
              onClick={() => sendVisualizerPreset(id)}
            >
              {id} · {Math.round(rating)}
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
