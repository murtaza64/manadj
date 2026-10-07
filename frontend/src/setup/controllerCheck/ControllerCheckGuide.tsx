/**
 * Controller check (setup-guides PRD): audio — pick Master/Cue outputs and
 * play a test tone on each; MIDI — detect devices, say whether a Mapping
 * exists, live "press anything" highlight for mapped devices; jog
 * calibration where the Mapping has a tunable one. Works inside the
 * First-run sequence and standalone (Settings → Controller check).
 *
 * MIDI is observed through its own requestMIDIAccess (like the MIDI
 * inspector); the Controller layer keeps acting on the same messages.
 */
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getRoutingSnapshot,
  refreshRouting,
  setCueDevice,
  setMasterDevice,
  subscribeRouting,
} from '../../playback/routingStore';
import { outputPairOptions, sameOutputChoice } from '../../playback/routing';
import type { OutputPair, SavedDevice } from '../../playback/routing';
import { CONTROLLER_MODELS } from '../../midi/mappings';
import type { ControllerModel } from '../../midi/mappings';
import type { GuideProps } from '../guides';
import {
  bindingCount,
  bindingForMessage,
  bindingKey,
  decodeMessage,
  describeBinding,
  jogProfileOf,
  modelForPort,
} from './check';
import { playTestTone } from './testTone';
import './controllerCheck.css';

const JogTuning = lazy(() => import('../../midi/JogTuningPage'));
const hasWebMidi = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

type ToneState =
  | { kind: 'idle' }
  | { kind: 'playing' }
  | { kind: 'played' }
  | { kind: 'error'; message: string };

function OutputRow({
  bus,
  noneLabel,
  saved,
  options,
  onPick,
  sinkId,
  pair,
  enabled,
  warning,
}: {
  bus: 'Master' | 'Cue';
  noneLabel: string;
  saved: SavedDevice | null;
  options: readonly SavedDevice[];
  onPick: (d: SavedDevice | null) => void;
  sinkId: string | null;
  pair: OutputPair | null;
  enabled: boolean;
  warning: string | null;
}) {
  const [tone, setTone] = useState<ToneState>({ kind: 'idle' });
  const savedIndex = saved === null ? -1 : options.findIndex((o) => sameOutputChoice(o, saved));
  const test = async () => {
    setTone({ kind: 'playing' });
    try {
      await playTestTone(sinkId, pair, bus === 'Master' ? 440 : 660);
      setTone({ kind: 'played' });
    } catch (err) {
      setTone({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };
  return (
    <div className="cc-output" data-testid={`cc-output-${bus.toLowerCase()}`}>
      <span className="cc-output-bus">{bus}</span>
      <select
        aria-label={`${bus} output`}
        value={saved === null ? '' : savedIndex >= 0 ? String(savedIndex) : 'saved'}
        onChange={(e) => {
          setTone({ kind: 'idle' });
          const v = e.target.value;
          if (v === '') return onPick(null);
          const option = options[Number(v)];
          if (option) onPick(option);
        }}
      >
        <option value="">{noneLabel}</option>
        {saved !== null && savedIndex < 0 && (
          <option value="saved">{saved.label} (unavailable)</option>
        )}
        {options.map((o, i) => (
          <option key={`${o.deviceId}:${o.pair?.left ?? 'd'}`} value={String(i)}>
            {o.label || o.deviceId}
          </option>
        ))}
      </select>
      <button
        className="btn"
        disabled={!enabled || tone.kind === 'playing'}
        onClick={() => void test()}
      >
        {tone.kind === 'playing' ? 'Playing…' : 'Test tone'}
      </button>
      <span className="cc-output-result" role="status">
        {warning ? (
          <span className="cc-warn">{warning}</span>
        ) : tone.kind === 'played' ? (
          'Heard it? If not, pick another output.'
        ) : tone.kind === 'error' ? (
          <span className="cc-bad">{tone.message}</span>
        ) : null}
      </span>
    </div>
  );
}

function AudioSection() {
  const { prefs, resolved, devices } = useSyncExternalStore(subscribeRouting, getRoutingSnapshot);
  useEffect(() => {
    void refreshRouting();
  }, []);
  const options = outputPairOptions(devices);
  return (
    <section className="cc-section">
      <h3>Audio outputs</h3>
      <p>
        Master is what the crowd hears; Cue is your headphones. On a controller with a
        headphone jack, Cue is usually its outputs 3/4.
      </p>
      <OutputRow
        bus="Master"
        noneLabel="System default"
        saved={prefs.master}
        options={options}
        onPick={setMasterDevice}
        sinkId={resolved.masterSinkId}
        pair={resolved.masterPair}
        enabled
        warning={
          resolved.masterMissing
            ? 'Saved device is unplugged — using the system default.'
            : resolved.masterNeedsPair
              ? 'Choose an explicit output pair for this device.'
              : null
        }
      />
      <OutputRow
        bus="Cue"
        noneLabel="Off"
        saved={prefs.cue}
        options={options}
        onPick={setCueDevice}
        sinkId={resolved.cueSinkId}
        pair={resolved.cuePair}
        enabled={resolved.cueSinkId !== null}
        warning={
          resolved.cueMissing
            ? 'Saved device is unplugged — cue is off.'
            : resolved.cueNeedsPair
              ? 'Choose an explicit output pair for this device.'
              : prefs.cue === null
                ? 'Pick a Cue output to preview tracks in headphones.'
                : null
        }
      />
    </section>
  );
}

interface Port {
  id: string;
  name: string;
  model: ControllerModel | null;
}

interface Press {
  label: string;
  mapped: boolean;
  seq: number;
}

function useMidiInputs(): { ports: Port[]; error: string | null; access: MIDIAccess | null } {
  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [ports, setPorts] = useState<Port[]>([]);
  const [error, setError] = useState<string | null>(
    hasWebMidi() ? null : 'MIDI is not available in this browser.'
  );
  useEffect(() => {
    if (!hasWebMidi()) return;
    let disposed = false;
    let current: MIDIAccess | null = null;
    const refresh = () => {
      if (!current) return;
      setPorts(
        Array.from(current.inputs.values())
          .filter((i) => i.state === 'connected')
          .map((i) => ({
            id: i.id,
            name: i.name ?? i.id,
            model: modelForPort(i.name ?? '', CONTROLLER_MODELS),
          }))
      );
    };
    navigator.requestMIDIAccess().then(
      (a) => {
        if (disposed) return;
        current = a;
        setAccess(a);
        refresh();
        a.addEventListener('statechange', refresh);
      },
      (reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'MIDI permission denied.');
      }
    );
    return () => {
      disposed = true;
      current?.removeEventListener('statechange', refresh);
    };
  }, []);
  return { ports, error, access };
}

function MidiSection() {
  const { ports, error, access } = useMidiInputs();
  const [press, setPress] = useState<Record<string, Press>>({});
  const [confirmed, setConfirmed] = useState<Record<string, ReadonlySet<string>>>({});
  const seq = useRef(0);

  useEffect(() => {
    if (!access) return;
    const detach: Array<() => void> = [];
    for (const port of ports) {
      const input = access.inputs.get(port.id);
      const model = port.model;
      if (!input || !model) continue;
      const onMessage = (e: MIDIMessageEvent) => {
        if (!e.data) return;
        const msg = decodeMessage(e.data);
        if (!msg) return;
        const binding = bindingForMessage(model.mapping, msg);
        // Button releases repeat the press; keep the highlight on the press.
        if ((binding === null || binding.controlType === 'button') && msg.message === 'note' && msg.value === 0) return;
        seq.current += 1;
        const next: Press = binding
          ? { label: describeBinding(binding), mapped: true, seq: seq.current }
          : {
              label: `Unmapped control (${msg.message} ch ${msg.channel + 1} #${msg.number})`,
              mapped: false,
              seq: seq.current,
            };
        setPress((p) => ({ ...p, [port.id]: next }));
        if (binding) {
          const key = bindingKey(binding);
          setConfirmed((c) => {
            const prev = c[port.id] ?? new Set<string>();
            return prev.has(key) ? c : { ...c, [port.id]: new Set([...prev, key]) };
          });
        }
      };
      input.addEventListener('midimessage', onMessage);
      detach.push(() => input.removeEventListener('midimessage', onMessage));
    }
    return () => detach.forEach((d) => d());
  }, [access, ports]);

  const models = new Map<string, ControllerModel>();
  for (const p of ports) if (p.model) models.set(p.model.name, p.model);
  const jogModels = [...models.values()]
    .map((model) => ({ model, profile: jogProfileOf(model.mapping) }))
    .filter((j) => j.profile !== null);

  return (
    <>
      <section className="cc-section">
        <h3>MIDI controller</h3>
        {error ? (
          <p className="cc-bad">{error}</p>
        ) : !access ? (
          <p>Looking for MIDI devices…</p>
        ) : ports.length === 0 ? (
          <p>
            No MIDI devices detected. Plug in your controller over USB; it appears here
            automatically.
          </p>
        ) : (
          <ul className="cc-devices">
            {ports.map((port) => {
              const p = press[port.id];
              return (
                <li key={port.id} className="cc-device" data-supported={port.model ? 'yes' : 'no'}>
                  <div className="cc-device-head">
                    <strong>{port.name}</strong>
                    {port.model ? (
                      <span className="cc-good">Mapping: {port.model.name}</span>
                    ) : (
                      <span className="cc-warn">No Mapping</span>
                    )}
                  </div>
                  {port.model ? (
                    <>
                      <div
                        key={p?.seq ?? 0}
                        className={`cc-press${p ? (p.mapped ? ' cc-press-hit' : ' cc-press-miss') : ''}`}
                        aria-live="polite"
                      >
                        {p ? p.label : 'Press any button or move any control'}
                      </div>
                      <span className="cc-device-count">
                        {confirmed[port.id]?.size ?? 0} of {bindingCount(port.model.mapping)} mapped
                        controls checked
                      </span>
                    </>
                  ) : (
                    <p>
                      manadj has no Mapping for this device, so its controls won't do anything.
                      Supported: {CONTROLLER_MODELS.map((m) => m.name).join(', ')}.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {jogModels.map(({ model, profile }) => (
        <JogSection key={model.name} name={model.name} tunable={profile === 'grv6'} />
      ))}
    </>
  );
}

function JogSection({ name, tunable }: { name: string; tunable: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="cc-section">
      <h3>Jog calibration · {name}</h3>
      {tunable ? (
        <>
          <p>Defaults suit most units. Tune if nudging or seeking feels too fast or slow.</p>
          <button className="btn" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide calibration' : 'Calibrate jog wheels'}
          </button>
          {open && (
            <div className="cc-jog">
              <Suspense fallback={<p role="status">Loading…</p>}>
                <JogTuning />
              </Suspense>
            </div>
          )}
        </>
      ) : (
        <p>Uses a fixed factory calibration; nothing to tune.</p>
      )}
    </section>
  );
}

export default function ControllerCheckGuide({ onDone, onSkip }: GuideProps) {
  return (
    <div className="cc-guide">
      <div className="settings-section-heading">
        <div>
          <h2>Controller check</h2>
          <p>Confirm your audio outputs and DJ controller work. You can come back here any time.</p>
        </div>
      </div>
      <AudioSection />
      <MidiSection />
      <div className="cc-actions">
        <button className="btn" onClick={onSkip}>
          Skip
        </button>
        <button className="btn btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
