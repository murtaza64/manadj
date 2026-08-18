import { useEffect, useState, useSyncExternalStore } from 'react';
import { PRESETS } from '../visualizer/presets';
import {
  getVisualizerRemote,
  sendVisualizerPreset,
  subscribeVisualizerRemote,
} from '../visualizer/remote';
import { isVisualizerOpen, toggleVisualizer } from '../visualizer/windowControl';
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
export function VisualizerControlModal({ onClose }: { onClose: () => void }) {
  const remote = useSyncExternalStore(subscribeVisualizerRemote, getVisualizerRemote);
  const [displays, setDisplays] = useState<VisualizerDisplayInfo[] | null>(null);
  const bridge = window.manadjVisualizer;

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
