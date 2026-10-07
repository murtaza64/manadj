/**
 * Persistent top bar, mode-first (gh#66 redesign, variant B):
 *
 * - The bar's spine is a prominent labeled segmented mode control
 *   (EXPORT / PERFORM / EDIT / SYNC), followed by the Settings toggle;
 *   rarer modes live behind an overflow trigger at the control's right
 *   end, which wears the active overflow mode's segment when one is
 *   selected. No title — segments carry their own labels.
 * - Global status docks right, stable across modes, grouped by concern:
 *   visualizer | tasks | recording | audio (routing · deck ownership · MIDI).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { pairEditorFallback } from '../routines/openMix';
import { DEV_SURFACES } from '../devMode';
import { useAppConfig } from '../settings/useAppConfig';
import { connectedControllers, subscribeControllers } from '../midi/connectionStore';
import { isQuantizeOn, setQuantize } from '../playback/quantizeStore';
import { AudioRoutingPicker } from './AudioRoutingPicker';
import { AudioOwnershipChip } from './AudioOwnershipChip';
import { TasksWidget } from './TasksWidget';
import { MasterRecorderControl } from './MasterRecorderControl';
import { isVisualizerOpen, toggleVisualizer } from '../visualizer/windowControl';
import { VisualizerControlModal } from './VisualizerControlModal';
import { hasKeyboardOverlay, isQuantizeShortcut, isTypingTarget } from './performance/performanceKeys';
import { TourReplayButton } from '../tour/TourReplayButton';
import './TopBar.css';

export type AppMode = 'library' | 'performance' | 'transition' | 'routine' | 'history' | 'sync';

type ModeMeta = { id: AppMode; icon: string; label: string; title: string };

/** The daily-driver modes: always visible as labeled segments, full-word
 * labels. The library mode presents as EXPORT (the id stays 'library' —
 * it's baked into ?view=, the stored view, and mode plumbing). */
const PRIMARY_MODES: ModeMeta[] = [
  { id: 'library', icon: '≡', label: 'EXPORT', title: 'Export' },
  { id: 'performance', icon: '▸', label: 'PERFORM', title: 'Performance' },
  // #221 phase 3 (ADR 0037): the MIX EDITOR is THE editor — the primary
  // EDIT slot routes to the unified surface (mode id 'routine'); the pair
  // editor demotes to the overflow behind the dev fallback flag until
  // phase 5 deletes it.
  { id: 'routine', icon: '⋈', label: 'EDIT', title: 'Mix editor' },
  { id: 'sync', icon: '⇄', label: 'SYNC', title: 'Sync' },
];

/** Rarer modes, relegated to the overflow menu (walkthrough verdict on
 * gh#66). */
const OVERFLOW_MODES: ModeMeta[] = [
  { id: 'history', icon: '↻', label: 'HISTORY', title: 'Transition history' },
];

/** The retired pair editor — overflow-reachable only under the dev
 * fallback flag (openMix.pairEditorFallback), or while already active. */
const PAIR_EDITOR_MODE: ModeMeta = {
  id: 'transition',
  icon: '⧉',
  label: 'PAIR',
  title: 'Transition editor (legacy — dies in phase 5)',
};

/** Visualizer cluster (realtime-visualization 02): labeled window toggle
 * (opens the separate visualizer window, focuses it when buried, closes it
 * when focused; lit while open) plus a caret for the presets/display
 * popover. */
function VisualizerCluster() {
  const [open, setOpen] = useState(isVisualizerOpen());
  const [modal, setModal] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setOpen(isVisualizerOpen()), 500);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="topbar-visualizer-cluster">
      <button
        className={`topbar-visualizer${open ? ' on' : ''}`}
        title={open ? 'Visualizer: focus (or close when focused)' : 'Open visualizer window'}
        onClick={() => {
          toggleVisualizer();
          setOpen(isVisualizerOpen());
        }}
      >
        <span className="topbar-visualizer-icon">▣</span>
        VIZ
      </button>
      <button
        className="topbar-visualizer-caret"
        title="Visualizer controls (review, presets, cycle, display)"
        onClick={() => setModal(true)}
      >
        ⚙
      </button>
      {modal && <VisualizerControlModal onClose={() => setModal(false)} />}
    </span>
  );
}

/** ffmpeg health (packaged-app #278): waveforms/analysis/stems all decode
 * through ffmpeg, so a missing binary is an app-level error state. Renders
 * nothing while healthy (the overwhelmingly common case). */
function FfmpegWarning() {
  const { data } = useAppConfig();
  if (!data || data.ffmpeg_available) return null;
  return (
    <span
      className="topbar-ffmpeg-warning"
      role="alert"
      title="ffmpeg was not found. Waveforms, analysis and stems will fail until it is installed (brew install ffmpeg), then restart manaDJ."
    >
      ⚠ ffmpeg missing
    </span>
  );
}

function MidiBadge() {
  const controllers = useSyncExternalStore(subscribeControllers, connectedControllers);
  const on = controllers.length > 0;
  return (
    <span
      className={`topbar-midi${on ? ' on' : ''}`}
      title={on ? `MIDI controller: ${controllers.join(', ')}` : 'No MIDI controller connected'}
    >
      <span className="topbar-midi-dot" />
      MIDI
    </span>
  );
}

/** The segmented mode control: primary segments plus the overflow trigger.
 * The trigger is a segment itself — quiet "⋯" normally, and the active
 * overflow mode's icon + label (lit) when one is selected. */
function ModeControl({
  mode,
  onModeChange,
  settingsOpen,
  onSettingsToggle,
}: {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  settingsOpen: boolean;
  onSettingsToggle: () => void;
}) {
  const [menu, setMenu] = useState(false);
  // The legacy pair editor rides the overflow only under the dev fallback
  // flag in dev builds (packaged-app #278), or while it IS the active view —
  // never strand the user.
  const overflowModes =
    (DEV_SURFACES && pairEditorFallback()) || mode === 'transition'
      ? [...OVERFLOW_MODES, PAIR_EDITOR_MODE]
      : OVERFLOW_MODES;
  const activeOverflow = overflowModes.find((m) => m.id === mode);

  useEffect(() => {
    if (!menu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menu]);

  return (
    <nav className="topbar-mode-control" aria-label="Mode" data-tour="topbar.modes">
      {PRIMARY_MODES.map((m) => (
        <button
          key={m.id}
          className={`topbar-segment${mode === m.id ? ' active' : ''}`}
          title={m.title}
          aria-pressed={mode === m.id}
          onClick={() => onModeChange(m.id)}
        >
          <span className="topbar-segment-icon">{m.icon}</span>
          <span className="topbar-segment-label">{m.label}</span>
        </button>
      ))}
      <button
        className={`topbar-segment${settingsOpen ? ' active' : ''}`}
        aria-label="Settings"
        aria-pressed={settingsOpen}
        title="Settings"
        onClick={() => {
          setMenu(false);
          onSettingsToggle();
        }}
      >
        <span className="topbar-segment-icon">⚙</span>
        <span className="topbar-segment-label">SETTINGS</span>
      </button>
      <button
        className={`topbar-segment topbar-segment-overflow${activeOverflow ? ' active' : ''}${menu ? ' open' : ''}`}
        title={
          activeOverflow
            ? `${activeOverflow.title} — more modes`
            : 'More modes (Transition history)'
        }
        onClick={() => setMenu((v) => !v)}
      >
        {activeOverflow ? (
          <>
            <span className="topbar-segment-icon">{activeOverflow.icon}</span>
            <span className="topbar-segment-label">{activeOverflow.label}</span>
          </>
        ) : (
          <span className="topbar-segment-icon">⋯</span>
        )}
      </button>
      {menu && (
        <>
          <div className="topbar-mode-menu-scrim" onMouseDown={() => setMenu(false)} />
          <div className="topbar-mode-menu" role="menu">
            {overflowModes.map((m) => (
              <button
                key={m.id}
                role="menuitem"
                className={`topbar-mode-menu-item${mode === m.id ? ' active' : ''}`}
                onClick={() => {
                  onModeChange(m.id);
                  setMenu(false);
                }}
              >
                <span className="topbar-segment-icon">{m.icon}</span>
                <span className="topbar-segment-label">{m.label}</span>
                <span className="topbar-mode-menu-title">{m.title}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </nav>
  );
}

export function TopBar({
  mode,
  onModeChange,
  settingsOpen,
  onSettingsToggle,
}: {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  settingsOpen: boolean;
  onSettingsToggle: () => void;
}) {
  // Quantize stays global even when the Performance mixer is unmounted.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!isQuantizeShortcut(event) || event.defaultPrevented || event.isComposing
        || isTypingTarget(event) || hasKeyboardOverlay()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) setQuantize(!isQuantizeOn());
    };
    document.addEventListener('keydown', down, true);
    return () => document.removeEventListener('keydown', down, true);
  }, []);

  return (
    <header className="topbar">
      <img src="/logo.png" alt="manaDJ logo" className="topbar-logo" />
      <ModeControl
        mode={mode}
        onModeChange={onModeChange}
        settingsOpen={settingsOpen}
        onSettingsToggle={onSettingsToggle}
      />
      <div className="topbar-status">
        <FfmpegWarning />
        <VisualizerCluster />
        <span className="topbar-divider" />
        <TasksWidget />
        <span className="topbar-divider" />
        <MasterRecorderControl />
        <span className="topbar-divider" />
        <div className="topbar-group">
          <AudioRoutingPicker />
          <AudioOwnershipChip mode={mode} onModeChange={onModeChange} />
          <MidiBadge />
        </div>
        <span className="topbar-divider" />
        {/* Tour replay (feature-tour #282): every section's coach marks. */}
        <TourReplayButton onModeChange={onModeChange} />
      </div>
    </header>
  );
}
