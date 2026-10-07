/**
 * Cue mode Setup guide (setup-guides #289). Registered by ./register; the
 * framework hosts it in the Setup sequence. Day-to-day the mode flips from
 * the Performance strip's GATED toggle (lit = Gated; PerfSectionToggles).
 */
import { useSyncExternalStore } from 'react';
import { getCueMode, setCueMode, subscribeCueMode, type CueMode } from '../../playback/cueModeStore';
import { setGuideStatus, type GuideProps } from '../guides';
import './cueMode.css';

export const CUE_MODE_GUIDE_ID = 'cue-mode';

const MODES: { id: CueMode; name: string; description: string }[] = [
  {
    id: 'gated',
    name: 'Gated',
    description: 'Hold a Hot Cue to preview from it; release returns to the cue. (CDJ default)',
  },
  {
    id: 'trigger',
    name: 'Trigger',
    description: 'Press a Hot Cue to jump there and start playing; playback continues after release.',
  },
];

export function CueModeGuide({ onDone, onSkip }: GuideProps) {
  const mode = useSyncExternalStore(subscribeCueMode, getCueMode);
  return (
    <div className="setup-guide" data-guide={CUE_MODE_GUIDE_ID}>
      <h2>Cue mode</h2>
      <p>What should pressing a Hot Cue do when the Deck is paused?</p>
      <div className="setup-cue-modes" role="radiogroup" aria-label="Cue mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={mode === m.id}
            className={`btn setup-cue-mode${mode === m.id ? ' btn-selected' : ''}`}
            onClick={() => setCueMode(m.id)}
          >
            <strong>{m.name}</strong>
            <span>{m.description}</span>
          </button>
        ))}
      </div>
      <p className="setup-guide-note">
        Applies to Hot Cues on a paused Deck — keyboard, MIDI and on-screen pads. On a playing
        Deck Hot Cues always jump; the Main cue keeps its hold behavior in both modes. Change it
        any time with the GATED toggle in the Performance view (lit = Gated, unlit = Trigger).
      </p>
      <div className="setup-guide-actions">
        <button
          className="btn btn-secondary"
          onClick={() => {
            setGuideStatus(CUE_MODE_GUIDE_ID, 'skipped');
            onSkip();
          }}
        >
          Skip
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            setGuideStatus(CUE_MODE_GUIDE_ID, 'done');
            onDone();
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
