/**
 * Persistent top bar: brand, icon mode switch (Library / Performance /
 * Transition editor / Sync), the active section's title, the MIDI
 * Controller badge (top right — lit while a mapped controller is attached),
 * and the app-wide Quantize toggle (looping 01).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { connectedControllers, subscribeControllers } from '../midi/connectionStore';
import { isQuantizeOn, setQuantize, subscribeQuantize } from '../playback/quantizeStore';
import { AudioRoutingPicker } from './AudioRoutingPicker';
import { AudioOwnershipChip } from './AudioOwnershipChip';
import { TasksWidget } from './TasksWidget';
import { MasterRecorderControl } from './MasterRecorderControl';
import { isVisualizerOpen, toggleVisualizer } from '../visualizer/windowControl';
import './TopBar.css';

export type AppMode = 'library' | 'performance' | 'transition' | 'history' | 'sync' | 'styles' | 'jog-tune';

const MODES: { id: AppMode; icon: string; title: string }[] = [
  { id: 'library', icon: '≡', title: 'Library' },
  { id: 'performance', icon: '▸', title: 'Performance' },
  { id: 'transition', icon: '⋈', title: 'Transition editor' },
  { id: 'history', icon: '↻', title: 'Transition history' },
  { id: 'sync', icon: '⇄', title: 'Sync' },
  { id: 'styles', icon: '◔', title: 'Waveform styles' },
  { id: 'jog-tune', icon: '◎', title: 'Jog calibration' },
];

/** App-wide Quantize toggle: lit while beat-relative gestures snap. */
function QuantizeToggle() {
  const on = useSyncExternalStore(subscribeQuantize, isQuantizeOn);
  return (
    <button
      className={`topbar-quantize${on ? ' on' : ''}`}
      title={on ? 'Quantize on: gestures snap to the beat' : 'Quantize off: exact placement'}
      onClick={() => setQuantize(!on)}
    >
      Q
    </button>
  );
}

/** Visualizer window toggle (realtime-visualization 02): opens the
 * separate visualizer window, focuses it when it's open but buried, and
 * closes it when it already has focus. Lit while the window is open. */
function VisualizerButton() {
  const [open, setOpen] = useState(isVisualizerOpen());
  useEffect(() => {
    const timer = setInterval(() => setOpen(isVisualizerOpen()), 500);
    return () => clearInterval(timer);
  }, []);
  return (
    <button
      className={`topbar-visualizer${open ? ' on' : ''}`}
      title={open ? 'Visualizer: focus (or close when focused)' : 'Open visualizer window'}
      onClick={() => {
        toggleVisualizer();
        setOpen(isVisualizerOpen());
      }}
    >
      ✷
    </button>
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

export function TopBar({
  mode,
  onModeChange,
}: {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
}) {
  return (
    <header className="topbar">
      <img src="/logo.png" alt="manaDJ logo" className="topbar-logo" />
      <nav className="topbar-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`topbar-mode${mode === m.id ? ' active' : ''}`}
            title={m.title}
            onClick={() => onModeChange(m.id)}
          >
            {m.icon}
          </button>
        ))}
      </nav>
      <VisualizerButton />
      <h1 className="topbar-title">{MODES.find((m) => m.id === mode)?.title}</h1>
      <MidiBadge />
      <MasterRecorderControl />
      <TasksWidget />
      <QuantizeToggle />
      <AudioRoutingPicker />
      <AudioOwnershipChip mode={mode} onModeChange={onModeChange} />
    </header>
  );
}
