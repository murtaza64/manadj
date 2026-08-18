/**
 * Persistent top bar: brand, icon mode switch (Library / Performance /
 * Transition editor / Sync), the active section's title, the MIDI
 * Controller badge (top right — lit while a mapped controller is attached),
 * and the app-wide Quantize toggle (looping 01).
 */
import { useSyncExternalStore } from 'react';
import { connectedControllers, subscribeControllers } from '../midi/connectionStore';
import { isQuantizeOn, setQuantize, subscribeQuantize } from '../playback/quantizeStore';
import { AudioRoutingPicker } from './AudioRoutingPicker';
import { AudioOwnershipChip } from './AudioOwnershipChip';
import { TasksWidget } from './TasksWidget';
import { MasterRecorderControl } from './MasterRecorderControl';
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

/** Opens the visualizer window (realtime-visualization 01): a separate
 * window rendering the master-bus 3-band visualization — fullscreen it on
 * a second display for the HDMI projection setup. Named target: clicking
 * again focuses the existing window instead of stacking duplicates. */
function VisualizerButton() {
  return (
    <button
      className="topbar-visualizer"
      title="Open visualizer window"
      onClick={() => window.open('/visualizer', 'manadj-visualizer', 'width=960,height=540')}
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
      <h1 className="topbar-title">{MODES.find((m) => m.id === mode)?.title}</h1>
      <MidiBadge />
      <MasterRecorderControl />
      <TasksWidget />
      <VisualizerButton />
      <QuantizeToggle />
      <AudioRoutingPicker />
      <AudioOwnershipChip mode={mode} onModeChange={onModeChange} />
    </header>
  );
}
