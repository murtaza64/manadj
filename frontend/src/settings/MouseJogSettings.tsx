import { useState } from 'react';
import { CommittedNumberInput } from '../components/CommittedNumberInput';
import { HFader } from '../components/performance/MixerStrip';
import {
  DEFAULT_MOUSE_JOG_SETTINGS, mouseJogBendTarget, resetMouseJogSettings, setMouseJogSettings,
  useMouseJogSettings, useMouseJogSpeed,
} from '../components/performance/mouseJogSettings';
import { DeckScope } from '../contexts/DeckContext';
import { useDeck, useDeckSnapshot } from '../hooks/useDeck';
import { useControlFocus } from '../performance/controlFocus';

const PARAMS = [
  { key: 'sensitivity', label: 'Sensitivity', unit: 'x', min: 0.25, max: 12, step: 0.25,
    note: 'Higher reaches full bend with slower movement.' },
  { key: 'acceleration', label: 'Acceleration', unit: '', min: 1, max: 3, step: 0.1,
    note: 'Higher softens fine motion and strengthens fast swipes.' },
  { key: 'smoothingMs', label: 'Smoothing', unit: 'ms', min: 0, max: 200, step: 5,
    note: 'Higher adds inertia; zero responds immediately.' },
  { key: 'maxBendPercent', label: 'Maximum bend', unit: '%', min: 8, max: 50, step: 1,
    note: 'Raises the ceiling for coarse adjustments without amplifying fine bends.' },
] as const;

function MouseReadout() {
  const { deck } = useDeck();
  const speed = useMouseJogSpeed(deck);
  const bend = useDeckSnapshot((snapshot) => snapshot.bendPercent);
  const handKey = deck === 'A' || deck === 'C' ? 'T' : 'Y';
  return (
    <div className="settings-field" role="group" aria-label={`Deck ${deck} mouse jog`}>
      <div className="settings-mouse-readout">
        <strong style={{ color: `var(--deck-${deck.toLowerCase()})` }}>Deck {deck}</strong>
        <span>Mouse speed <output aria-label={`Deck ${deck} mouse speed`}>{speed.toFixed(0)} px/s</output></span>
        <span>Actual bend <output aria-label={`Deck ${deck} actual bend`}>{bend > 0 ? '+' : ''}{bend.toFixed(2)}%</output></span>
      </div>
      <p>Hold {handKey} for Deck {deck} rim. With Vinyl on, Shift+{handKey} arms scratch until motion. Playback keeps going until you drag.</p>
    </div>
  );
}

export default function MouseJogSettings({ performance = false }: { performance?: boolean }) {
  const settings = useMouseJogSettings();
  const focus = useControlFocus();
  const [resetKey, setResetKey] = useState(0);
  return (
    <>
      <div className="settings-section-heading">
        <div>
          <h2>Mouse jog</h2>
          <p>Keyboard and mouse response for all four decks.</p>
        </div>
        <button className="btn btn-secondary" onClick={() => {
          setResetKey((key) => key + 1);
          resetMouseJogSettings();
        }}>Reset mouse defaults</button>
      </div>
      <div className="settings-filter-layout">
        <div className="settings-fields">
          {PARAMS.map(({ key, label, unit, min, max, step, note }) => (
            <div className="settings-field" key={key}>
              <div>
                <span className="settings-field-label">{label}</span>
                <p>{note}</p>
              </div>
              <div className="settings-field-inputs">
                <HFader id={`mouse-jog-${key}`} ariaLabel={label}
                  label={Number(settings[key].toPrecision(6)).toString()} accent
                  fill fillColor="var(--accent)"
                  min={min} max={max} step={step} defaultValue={DEFAULT_MOUSE_JOG_SETTINGS[key]}
                  value={settings[key]} onChange={(value) => setMouseJogSettings({ [key]: value })} />
                <CommittedNumberInput key={resetKey} aria-label={`${label} value`}
                  min={min} max={max} step={step} value={settings[key]}
                  onCommit={(value) => setMouseJogSettings({ [key]: value })} />
                <span>{unit}</span>
              </div>
            </div>
          ))}
          <div className="settings-field">
            <p>Full bend (+/-{settings.maxBendPercent}%) at <strong>{(6000 / settings.sensitivity * (settings.maxBendPercent / 8) ** (1 / settings.acceleration)).toFixed(0)} px/s</strong></p>
            <p>Steady-motion targets (before smoothing):</p>
            {[200, 600, 1200].map((speed) => (
              <p key={speed}>{speed} px/s: <strong>{mouseJogBendTarget(speed, settings).toFixed(2)}%</strong></p>
            ))}
          </div>
        </div>
        <div>
          {performance ? (
            <>
              <p className="settings-hint">Test with the decks above. T/Y follow the current left/right control focus; these readouts are read-only.</p>
              {[focus.left, focus.right].map((deck) => (
                <DeckScope key={deck} deck={deck}><MouseReadout /></DeckScope>
              ))}
            </>
          ) : (
            <p className="settings-hint">Switch to Performance to test T/Y mouse jog with the decks above.</p>
          )}
        </div>
      </div>
    </>
  );
}
