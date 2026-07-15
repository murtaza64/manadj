import { useEffect, useRef, useState } from 'react';
import type { JogCalibration } from './jogCalibration';
import {
  grv6CalibrationCode,
  resetGrv6JogCalibration,
  setGrv6JogCalibration,
  useGrv6JogCalibration,
} from './jogCalibrationStore';
import {
  addJogMessage,
  decodeGrv6JogMessage,
  emptyJogStreamStats,
  jogStatsRate,
} from './jogTelemetry';
import type { Grv6JogMessage, Grv6JogStream, JogStreamStats } from './jogTelemetry';
import './JogTuningPage.css';

const STREAMS: readonly Grv6JogStream[] = [
  'side',
  'platter-vinyl',
  'platter-no-vinyl',
  'shift-side',
  'shift-platter',
];

const HAS_WEB_MIDI = 'requestMIDIAccess' in navigator;

const EMPTY_STATS = Object.fromEntries(
  STREAMS.map((stream) => [stream, emptyJogStreamStats()])
) as Record<Grv6JogStream, JogStreamStats>;

interface RevolutionCapture {
  stream: Grv6JogStream;
  deck: Grv6JogMessage['deck'] | 'any';
  stats: JogStreamStats;
  active: boolean;
}

function number(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export default function JogTuningPage() {
  const calibration = useGrv6JogCalibration();
  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [inputs, setInputs] = useState<MIDIInput[]>([]);
  const [selectedInputId, setSelectedInputId] = useState('');
  const [error, setError] = useState<string | null>(
    HAS_WEB_MIDI ? null : 'Web MIDI unavailable. Open the lane through Electron.'
  );
  const [stats, setStats] = useState<Record<Grv6JogStream, JogStreamStats>>(EMPTY_STATS);
  const [capture, setCapture] = useState<RevolutionCapture>({
    stream: 'side',
    deck: 'any',
    stats: emptyJogStreamStats(),
    active: false,
  });
  const statsRef = useRef(stats);
  const captureRef = useRef(capture);
  const changeCapture = (update: (current: RevolutionCapture) => RevolutionCapture) => {
    const next = update(captureRef.current);
    captureRef.current = next;
    setCapture(next);
  };

  useEffect(() => {
    if (!HAS_WEB_MIDI) return;
    let disposed = false;
    let midi: MIDIAccess | null = null;
    const refresh = () => {
      if (!midi) return;
      const next = Array.from(midi.inputs.values()).filter((input) =>
        (input.name ?? '').includes('DDJ-GRV6')
      );
      setInputs(next);
      setSelectedInputId((current) => current || next[0]?.id || '');
    };
    navigator.requestMIDIAccess().then(
      (next) => {
        if (disposed) return;
        midi = next;
        setAccess(next);
        refresh();
        next.addEventListener('statechange', refresh);
      },
      (reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'MIDI access failed');
      }
    );
    return () => {
      disposed = true;
      midi?.removeEventListener('statechange', refresh);
    };
  }, []);

  useEffect(() => {
    const input = inputs.find((candidate) => candidate.id === selectedInputId);
    if (!input) return;
    let frame = 0;
    const publish = () => {
      frame = 0;
      setStats({ ...statsRef.current });
      setCapture({ ...captureRef.current });
    };
    const onMessage = (event: MIDIMessageEvent) => {
      if (!event.data) return;
      const message = decodeGrv6JogMessage(event.data);
      if (!message) return;
      const atMs = performance.now();
      statsRef.current = {
        ...statsRef.current,
        [message.stream]: addJogMessage(statsRef.current[message.stream], message, atMs),
      };
      const currentCapture = captureRef.current;
      if (
        currentCapture.active &&
        currentCapture.stream === message.stream &&
        (currentCapture.deck === 'any' || currentCapture.deck === message.deck)
      ) {
        captureRef.current = {
          ...currentCapture,
          stats: addJogMessage(currentCapture.stats, message, atMs),
        };
      }
      if (frame === 0) frame = requestAnimationFrame(publish);
    };
    input.addEventListener('midimessage', onMessage);
    return () => {
      input.removeEventListener('midimessage', onMessage);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [inputs, selectedInputId]);

  const patch = (key: keyof JogCalibration, value: number) =>
    setGrv6JogCalibration({ [key]: value });

  const slider = (
    label: string,
    key: keyof JogCalibration,
    min: number,
    max: number,
    step: number,
    unit: string
  ) => (
    <label className="jog-tune__slider" key={key}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={calibration[key]}
        onChange={(event) => patch(key, Number(event.target.value))}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={calibration[key]}
        onChange={(event) => patch(key, Number(event.target.value))}
      />
      <small>{unit}</small>
    </label>
  );

  const captureRate = jogStatsRate(capture.stats);
  const selectedInput = inputs.find((input) => input.id === selectedInputId);

  return (
    <div className="jog-tune">
      <header className="jog-tune__header">
        <div>
          <span className="jog-tune__eyebrow">DDJ-GRV6 / issue 29</span>
          <h1>Jog calibration bench</h1>
          <p>Load and play a Deck in Performance, then return here. Slider changes apply to the next jog message.</p>
        </div>
        <div className={`jog-tune__connection${selectedInput ? ' online' : ''}`}>
          {selectedInput ? selectedInput.name : access ? 'GRV6 not found' : 'MIDI waiting'}
        </div>
      </header>

      {error ? <div className="jog-tune__error">{error}</div> : null}

      <section className="jog-tune__panel jog-tune__capture">
        <div>
          <span className="jog-tune__eyebrow">hardware measurement</span>
          <h2>One exact revolution</h2>
          <p>Choose the active stream, start capture, rotate exactly 360 degrees at a steady speed, then stop.</p>
        </div>
        <select value={selectedInputId} onChange={(event) => setSelectedInputId(event.target.value)}>
          {inputs.length === 0 ? <option value="">No GRV6 input</option> : null}
          {inputs.map((input) => <option key={input.id} value={input.id}>{input.name}</option>)}
        </select>
        <select
          value={capture.stream}
          onChange={(event) => changeCapture((current) => ({ ...current, stream: event.target.value as Grv6JogStream }))}
        >
          {STREAMS.map((stream) => <option key={stream}>{stream}</option>)}
        </select>
        <select
          value={capture.deck}
          onChange={(event) => changeCapture((current) => ({ ...current, deck: event.target.value as RevolutionCapture['deck'] }))}
        >
          <option value="any">any Deck</option>
          {(['A', 'B', 'C', 'D'] as const).map((deck) => <option key={deck}>{deck}</option>)}
        </select>
        <button
          className={capture.active ? 'recording' : ''}
          onClick={() => changeCapture((current) => ({
            ...current,
            active: !current.active,
            stats: current.active ? current.stats : emptyJogStreamStats(),
          }))}
        >
          {capture.active ? 'Stop capture' : 'Start capture'}
        </button>
        <div className="jog-tune__measure">
          <strong>{capture.stats.absoluteTicks}</strong><span>absolute ticks</span>
          <strong>{capture.stats.signedTicks}</strong><span>signed ticks</span>
          <strong>{capture.stats.messages}</strong><span>messages</span>
          <strong>{number(captureRate.ticksPerSecond)}</strong><span>ticks/sec</span>
          <strong>{capture.stats.maxDelta}</strong><span>max delta</span>
        </div>
      </section>

      <section className="jog-tune__streams">
        {STREAMS.map((stream) => {
          const value = stats[stream];
          const rate = jogStatsRate(value);
          return (
            <article key={stream} className="jog-tune__stream">
              <span>{stream}</span>
              <strong>{value.lastDelta > 0 ? '+' : ''}{value.lastDelta}</strong>
              <dl>
                <dt>ticks</dt><dd>{value.absoluteTicks}</dd>
                <dt>msgs</dt><dd>{value.messages}</dd>
                <dt>ticks/s</dt><dd>{number(rate.ticksPerSecond)}</dd>
                <dt>msg/s</dt><dd>{number(rate.messagesPerSecond)}</dd>
              </dl>
            </article>
          );
        })}
      </section>

      <section className="jog-tune__panel">
        <div className="jog-tune__calibration-head">
          <div>
            <span className="jog-tune__eyebrow">live response</span>
            <h2>GRV6 calibration</h2>
          </div>
          <button onClick={resetGrv6JogCalibration}>Reset</button>
          <button onClick={() => void navigator.clipboard.writeText(grv6CalibrationCode())}>Copy Mapping values</button>
        </div>
        <div className="jog-tune__sliders">
          {slider('Playback bend gain', 'bendPercentPerTick', 0.1, 10, 0.1, '% per filtered tick')}
          {slider('Playback bend clamp', 'bendMaxPercent', 0.5, 50, 0.5, '%')}
          {slider('Playback decay window', 'bendFilterWindow', 1, 40, 1, '25 ms slots')}
          {slider('Paused bare rim', 'rimSeekSecondsPerTick', 0.00005, 0.01, 0.00005, 'seconds / tick')}
          {slider('Paused touch platter', 'touchSeekSecondsPerTick', 0.00005, 0.01, 0.00005, 'seconds / tick')}
          {slider('Shift fast-seek base', 'fastSeekSecondsPerTick', 0.00005, 0.1, 0.00005, 'seconds / tick')}
          {slider('Fast-seek acceleration threshold', 'fastSeekAccelTicksPerSecond', 10, 500, 5, 'ticks / sec')}
          {slider('Fast-seek acceleration cap', 'fastSeekAccelMax', 1, 100, 1, 'multiplier')}
        </div>
        <pre>{grv6CalibrationCode(calibration)}</pre>
      </section>
    </div>
  );
}
