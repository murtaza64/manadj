import { useId, useState } from 'react';
import { DeckScope } from '../../contexts/DeckContext';
import { useDeck, useDeckSnapshot } from '../../hooks/useDeck';
import type { ChannelId } from '../../playback/mixer';
import {
  mouseJogBendTarget, resetMouseJogSettings, setMouseJogSettings,
  useMouseJogSettings, useMouseJogSpeed,
} from './mouseJogSettings';
import './MouseJogTuner.css';

function MouseJogReadout() {
  const { deck } = useDeck();
  const speed = useMouseJogSpeed(deck);
  const bend = useDeckSnapshot((snapshot) => snapshot.bendPercent);
  return (
    <div className="mouse-jog-readout" role="group" aria-label={`Deck ${deck} mouse jog`}>
      <strong style={{ color: `var(--deck-${deck.toLowerCase()})` }}>DECK {deck}</strong>
      <span>Rim <output aria-label={`Deck ${deck} rim speed`}>{speed.toFixed(0)} px/s</output></span>
      <span>Actual bend <output aria-label={`Deck ${deck} actual bend`}>{bend > 0 ? '+' : ''}{bend.toFixed(2)}%</output></span>
    </div>
  );
}

function MouseJogControls() {
  const settings = useMouseJogSettings();
  return (
    <>
      <div className="mouse-jog-controls">
        <label>
          <span>Sensitivity <output>{settings.sensitivity.toFixed(2)}x</output></span>
          <input type="range" aria-label="Sensitivity" min={0.25} max={12} step={0.25}
            value={settings.sensitivity} onChange={(event) => setMouseJogSettings({ sensitivity: event.currentTarget.valueAsNumber })} />
          <small>Higher reaches full bend with slower movement.</small>
        </label>
        <label>
          <span>Acceleration <output>{settings.acceleration.toFixed(1)}</output></span>
          <input type="range" aria-label="Acceleration" min={1} max={3} step={0.1}
            value={settings.acceleration} onChange={(event) => setMouseJogSettings({ acceleration: event.currentTarget.valueAsNumber })} />
          <small>Higher keeps fine control; full-bend speed stays the same.</small>
        </label>
        <label>
          <span>Smoothing <output>{settings.smoothingMs.toFixed(0)} ms</output></span>
          <input type="range" aria-label="Smoothing" min={0} max={200} step={5}
            value={settings.smoothingMs} onChange={(event) => setMouseJogSettings({ smoothingMs: event.currentTarget.valueAsNumber })} />
          <small>Higher adds inertia; zero responds immediately.</small>
        </label>
      </div>
      <div className="mouse-jog-preview">
        <span>Full bend (+/-8%) at <strong>{(6000 / settings.sensitivity).toFixed(0)} px/s</strong></span>
        <span>Target magnitude (before smoothing):</span>
        {[200, 600, 1200].map((speed) => (
          <span key={speed}>{speed} px/s: <strong>{mouseJogBendTarget(speed, settings).toFixed(2)}%</strong></span>
        ))}
        <button type="button" className="btn btn-secondary" onClick={resetMouseJogSettings}>Reset baseline</button>
      </div>
    </>
  );
}

export function MouseJogTuner({ leftFocus, rightFocus }: { leftFocus: ChannelId; rightFocus: ChannelId }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <section className="mouse-jog-tuner" aria-label="Mouse jog tuning" data-cursor-normal>
      <button type="button" className="btn btn-secondary" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(!open)}>MOUSE / JOG TUNE</button>
      {open && (
        <div id={panelId} className="mouse-jog-panel">
          <p>Hold T / Y for left / right rim. Shift+T / Y arms scratch; move to grab. Playback keeps going until you drag.</p>
          <MouseJogControls />
          <div className="mouse-jog-readouts">
            <DeckScope deck={leftFocus}><MouseJogReadout /></DeckScope>
            <DeckScope deck={rightFocus}><MouseJogReadout /></DeckScope>
          </div>
        </div>
      )}
    </section>
  );
}
