import { useEffect, useRef, useState } from 'react';
import './MidiInspectorPage.css';

type MessageType = 'note-on' | 'note-off' | 'cc' | 'other';
type ControlType = 'button' | 'absolute' | 'relative' | 'note' | 'unknown';

interface MidiLogEntry {
  id: number;
  time: string;
  portId: string;
  portName: string;
  bytes: number[];
  decoded: DecodedMidiMessage;
  learnedControlId?: string;
}

interface DecodedMidiMessage {
  messageType: MessageType;
  mappingMessage: 'note' | 'cc' | null;
  channel: number;
  number: number | null;
  value: number | null;
  description: string;
}

interface LearnedMessage {
  message: 'note' | 'cc';
  channel: number;
  number: number;
  values: number[];
  count: number;
  firstBytes: number[];
}

interface LearnTarget {
  id: string;
  label: string;
  group: string;
  controlType: ControlType;
  targetCode?: string;
  notes?: string;
}

interface LearnedControl extends LearnTarget {
  messages: LearnedMessage[];
}

const MAX_LOG_ENTRIES = 400;
const HAS_WEB_MIDI = 'requestMIDIAccess' in navigator;

const LEARN_TARGETS: LearnTarget[] = [
  { id: 'deck-a-play', label: 'Deck A PLAY', group: 'transport', controlType: 'button', targetCode: `{ control: 'transport', deck: 'A' }` },
  { id: 'deck-a-cue', label: 'Deck A CUE', group: 'transport', controlType: 'button', targetCode: `{ control: 'cue', deck: 'A' }` },
  { id: 'deck-b-play', label: 'Deck B PLAY', group: 'transport', controlType: 'button', targetCode: `{ control: 'transport', deck: 'B' }` },
  { id: 'deck-b-cue', label: 'Deck B CUE', group: 'transport', controlType: 'button', targetCode: `{ control: 'cue', deck: 'B' }` },
  { id: 'deck-a-load', label: 'Deck A LOAD', group: 'browser', controlType: 'button', targetCode: `{ control: 'load', deck: 'A' }` },
  { id: 'deck-b-load', label: 'Deck B LOAD', group: 'browser', controlType: 'button', targetCode: `{ control: 'load', deck: 'B' }` },
  { id: 'browser-encoder', label: 'Browser encoder turn', group: 'browser', controlType: 'relative', targetCode: `{ control: 'selection-move' }`, notes: 'Turn both directions before advancing.' },
  { id: 'deck-a-jog', label: 'Deck A jog wheel turn', group: 'jog', controlType: 'relative', targetCode: `{ control: 'jog', deck: 'A' }`, notes: 'Turn both directions; avoid touch-only gestures first.' },
  { id: 'deck-b-jog', label: 'Deck B jog wheel turn', group: 'jog', controlType: 'relative', targetCode: `{ control: 'jog', deck: 'B' }`, notes: 'Turn both directions; avoid touch-only gestures first.' },
  { id: 'deck-a-jog-touch', label: 'Deck A jog touch', group: 'jog', controlType: 'note', notes: 'Capture separately if the platter sends touch on/off.' },
  { id: 'deck-b-jog-touch', label: 'Deck B jog touch', group: 'jog', controlType: 'note', notes: 'Capture separately if the platter sends touch on/off.' },
  { id: 'deck-a-pitch', label: 'Deck A pitch fader', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'pitch', deck: 'A' }`, notes: 'Move through the full range slowly to reveal 7-bit vs 14-bit.' },
  { id: 'deck-b-pitch', label: 'Deck B pitch fader', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'pitch', deck: 'B' }`, notes: 'Move through the full range slowly to reveal 7-bit vs 14-bit.' },
  { id: 'channel-a-trim', label: 'Channel A trim', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'trim', channel: 'A' }` },
  { id: 'channel-b-trim', label: 'Channel B trim', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'trim', channel: 'B' }` },
  { id: 'channel-a-eq-high', label: 'Channel A EQ high', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'eq', channel: 'A', band: 'high' }` },
  { id: 'channel-a-eq-mid', label: 'Channel A EQ mid', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'eq', channel: 'A', band: 'mid' }` },
  { id: 'channel-a-eq-low', label: 'Channel A EQ low', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'eq', channel: 'A', band: 'low' }` },
  { id: 'channel-b-eq-high', label: 'Channel B EQ high', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'eq', channel: 'B', band: 'high' }` },
  { id: 'channel-b-eq-mid', label: 'Channel B EQ mid', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'eq', channel: 'B', band: 'mid' }` },
  { id: 'channel-b-eq-low', label: 'Channel B EQ low', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'eq', channel: 'B', band: 'low' }` },
  { id: 'channel-a-filter', label: 'Channel A filter', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'filter', channel: 'A' }` },
  { id: 'channel-b-filter', label: 'Channel B filter', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'filter', channel: 'B' }` },
  { id: 'channel-a-fader', label: 'Channel A volume fader', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'channel-fader', channel: 'A' }` },
  { id: 'channel-b-fader', label: 'Channel B volume fader', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'channel-fader', channel: 'B' }` },
  { id: 'crossfader', label: 'Crossfader', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'crossfader' }` },
  { id: 'master', label: 'Master volume', group: 'mixer', controlType: 'absolute', targetCode: `{ control: 'master' }` },
  { id: 'deck-a-match', label: 'Deck A SYNC/MATCH', group: 'buttons', controlType: 'button', targetCode: `{ control: 'match', deck: 'A' }` },
  { id: 'deck-b-match', label: 'Deck B SYNC/MATCH', group: 'buttons', controlType: 'button', targetCode: `{ control: 'match', deck: 'B' }` },
  { id: 'deck-a-beatjump-back', label: 'Deck A beatjump back', group: 'buttons', controlType: 'button', targetCode: `{ control: 'beatjump', deck: 'A', direction: 'back' }` },
  { id: 'deck-a-beatjump-forward', label: 'Deck A beatjump forward', group: 'buttons', controlType: 'button', targetCode: `{ control: 'beatjump', deck: 'A', direction: 'forward' }` },
  { id: 'deck-b-beatjump-back', label: 'Deck B beatjump back', group: 'buttons', controlType: 'button', targetCode: `{ control: 'beatjump', deck: 'B', direction: 'back' }` },
  { id: 'deck-b-beatjump-forward', label: 'Deck B beatjump forward', group: 'buttons', controlType: 'button', targetCode: `{ control: 'beatjump', deck: 'B', direction: 'forward' }` },
  ...hotCueTargets('A'),
  ...hotCueTargets('B'),
  { id: 'shift', label: 'SHIFT', group: 'modifiers', controlType: 'note', notes: 'Hold/release SHIFT alone, then try SHIFT plus another control and compare the raw log.' },
];

function hotCueTargets(deck: 'A' | 'B'): LearnTarget[] {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `deck-${deck.toLowerCase()}-hot-cue-${index + 1}`,
    label: `Deck ${deck} hot cue ${index + 1}`,
    group: 'pads',
    controlType: 'button',
    targetCode: `{ control: 'hot-cue', deck: '${deck}', pad: ${index + 1} }`,
  }));
}

function decodeMidiMessage(bytes: readonly number[]): DecodedMidiMessage {
  if (bytes.length < 1) {
    return { messageType: 'other', mappingMessage: null, channel: 0, number: null, value: null, description: 'empty' };
  }

  const status = bytes[0];
  const kind = status >> 4;
  const channel = status & 0x0f;
  const number = bytes.length > 1 ? bytes[1] : null;
  const value = bytes.length > 2 ? bytes[2] : null;

  if (kind === 0x8 || (kind === 0x9 && value === 0)) {
    return { messageType: 'note-off', mappingMessage: 'note', channel, number, value, description: 'note off' };
  }
  if (kind === 0x9) {
    return { messageType: 'note-on', mappingMessage: 'note', channel, number, value, description: 'note on' };
  }
  if (kind === 0xb) {
    return { messageType: 'cc', mappingMessage: 'cc', channel, number, value, description: 'control change' };
  }
  return { messageType: 'other', mappingMessage: null, channel, number, value, description: `status 0x${hexByte(status)}` };
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase();
}

function bytesToHex(bytes: readonly number[]): string {
  return bytes.map((byte) => `0x${hexByte(byte)}`).join(' ');
}

function signatureFor(decoded: DecodedMidiMessage): string | null {
  if (decoded.mappingMessage === null || decoded.number === null) return null;
  return `${decoded.mappingMessage}:${decoded.channel}:${decoded.number}`;
}

function learnedMessageFrom(entry: MidiLogEntry): LearnedMessage | null {
  if (entry.decoded.mappingMessage === null || entry.decoded.number === null) return null;
  return {
    message: entry.decoded.mappingMessage,
    channel: entry.decoded.channel,
    number: entry.decoded.number,
    values: entry.decoded.value === null ? [] : [entry.decoded.value],
    count: 1,
    firstBytes: entry.bytes,
  };
}

function mergeLearnedMessage(messages: LearnedMessage[], entry: MidiLogEntry): LearnedMessage[] {
  const message = learnedMessageFrom(entry);
  if (!message) return messages;
  const signature = `${message.message}:${message.channel}:${message.number}`;
  const existing = messages.find((item) => `${item.message}:${item.channel}:${item.number}` === signature);
  if (!existing) return [...messages, message];
  return messages.map((item) => {
    if (item !== existing) return item;
    const values = new Set(item.values);
    for (const value of message.values) values.add(value);
    return { ...item, values: Array.from(values).sort((a, b) => a - b), count: item.count + 1 };
  });
}

function describeForLog(decoded: DecodedMidiMessage): string {
  if (decoded.mappingMessage === null || decoded.number === null) return decoded.description;
  return `${decoded.description} ${decoded.mappingMessage}#${decoded.number} value ${decoded.value ?? '-'} map ch ${decoded.channel} (MIDI ch ${decoded.channel + 1})`;
}

function valuesSummary(values: readonly number[]): string {
  if (values.length === 0) return '-';
  if (values.length <= 8) return values.join(', ');
  return `${values[0]}..${values[values.length - 1]} (${values.length} values)`;
}

function bindingCode(control: LearnedControl): string {
  if (control.messages.length === 0) return `    // ${control.label}: not learned yet`;
  const primary = [...control.messages].sort((a, b) => b.count - a.count)[0];
  const extra = control.messages.filter((message) => message !== primary);
  const lines = [`    // ${control.label}: ${control.messages.map((message) => `${message.message} ch ${message.channel} #${message.number}`).join(', ')}`];

  if (!control.targetCode || control.controlType === 'unknown' || control.controlType === 'note') {
    lines.push(
      `    // TODO(map-target): ${control.label}`,
      `    // { match: { message: '${primary.message}', channel: ${primary.channel}, number: 0x${hexByte(primary.number)} }, controlType: 'button', target: { control: '...' } },`
    );
    return lines.join('\n');
  }

  if (control.controlType === 'absolute') {
    const lsb = extra.find((message) => message.message === 'cc' && message.channel === primary.channel);
    const bits = primary.message === 'cc' && lsb ? 14 : 7;
    lines.push('    {');
    lines.push(`      match: { message: '${primary.message}', channel: ${primary.channel}, number: 0x${hexByte(primary.number)} },`);
    lines.push(`      controlType: 'absolute',`);
    lines.push(`      target: ${control.targetCode},`);
    lines.push(`      bits: ${bits},`);
    if (bits === 14 && lsb) lines.push(`      lsbNumber: 0x${hexByte(lsb.number)},`);
    lines.push('    },');
    return lines.join('\n');
  }

  lines.push('    {');
  lines.push(`      match: { message: '${primary.message}', channel: ${primary.channel}, number: 0x${hexByte(primary.number)} },`);
  lines.push(`      controlType: '${control.controlType}',`);
  lines.push(`      target: ${control.targetCode},`);
  lines.push('    },');
  return lines.join('\n');
}

function mappingSkeleton(portNameMatch: string, learned: Record<string, LearnedControl>): string {
  const learnedControls = LEARN_TARGETS.map((target) => learned[target.id] ?? { ...target, messages: [] });
  return `import type { Mapping } from '../mapping';

export const INPULSE_300_MK2: Mapping = {
  portNameMatch: '${portNameMatch.replaceAll("'", "\\'")}',
  bindings: [
${learnedControls.map(bindingCode).join('\n')}
  ],
};
`;
}

export default function MidiInspectorPage() {
  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [error, setError] = useState<string | null>(
    HAS_WEB_MIDI ? null : 'Web MIDI is not available in this browser. Use Chrome or Edge.'
  );
  const [inputs, setInputs] = useState<MIDIInput[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>('all');
  const [log, setLog] = useState<MidiLogEntry[]>([]);
  const [learned, setLearned] = useState<Record<string, LearnedControl>>({});
  const [activeTargetId, setActiveTargetId] = useState<string>(LEARN_TARGETS[0]?.id ?? '');
  const [isLearning, setIsLearning] = useState(false);
  const counterRef = useRef(0);
  const learningRef = useRef<{ isLearning: boolean; activeTargetId: string }>({ isLearning, activeTargetId });

  useEffect(() => {
    learningRef.current = { isLearning, activeTargetId };
  }, [isLearning, activeTargetId]);

  useEffect(() => {
    if (!HAS_WEB_MIDI) return;

    let disposed = false;
    let currentAccess: MIDIAccess | null = null;
    const refreshInputs = () => {
      if (currentAccess) setInputs(Array.from(currentAccess.inputs.values()));
    };

    navigator.requestMIDIAccess().then(
      (midiAccess) => {
        if (disposed) return;
        currentAccess = midiAccess;
        setAccess(midiAccess);
        refreshInputs();
        midiAccess.addEventListener('statechange', refreshInputs);
      },
      (reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'MIDI permission denied or unavailable.');
      }
    );

    return () => {
      disposed = true;
      currentAccess?.removeEventListener('statechange', refreshInputs);
    };
  }, []);

  useEffect(() => {
    const detach: Array<() => void> = [];
    for (const input of inputs) {
      const onMessage = (event: MIDIMessageEvent) => {
        if (!event.data) return;
        const bytes = Array.from(event.data);
        const decoded = decodeMidiMessage(bytes);
        const learning = learningRef.current;
        const learnedControlId = learning.isLearning ? learning.activeTargetId : undefined;
        const entry: MidiLogEntry = {
          id: counterRef.current,
          time: new Date().toLocaleTimeString(),
          portId: input.id,
          portName: input.name ?? input.id,
          bytes,
          decoded,
          learnedControlId,
        };
        counterRef.current += 1;

        if (selectedInputId === 'all' || selectedInputId === input.id) {
          setLog((current) => [entry, ...current].slice(0, MAX_LOG_ENTRIES));
        }

        if (learning.isLearning && (selectedInputId === 'all' || selectedInputId === input.id)) {
          const target = LEARN_TARGETS.find((item) => item.id === learning.activeTargetId);
          if (target && signatureFor(decoded)) {
            setLearned((current) => {
              const previous = current[target.id] ?? { ...target, messages: [] };
              return { ...current, [target.id]: { ...previous, messages: mergeLearnedMessage(previous.messages, entry) } };
            });
          }
        }
      };
      input.addEventListener('midimessage', onMessage);
      detach.push(() => input.removeEventListener('midimessage', onMessage));
    }
    return () => {
      for (const remove of detach) remove();
    };
  }, [inputs, selectedInputId]);

  const activeIndex = LEARN_TARGETS.findIndex((target) => target.id === activeTargetId);
  const activeTarget = LEARN_TARGETS[activeIndex] ?? LEARN_TARGETS[0];
  const activeLearned = activeTarget ? learned[activeTarget.id] : undefined;
  const selectedInput = inputs.find((input) => input.id === selectedInputId);
  const portNameMatch = selectedInput?.name ?? inputs[0]?.name ?? 'DJControl Inpulse 300';
  const generatedCode = mappingSkeleton(portNameMatch, learned);

  const movePrompt = (delta: number) => {
    if (LEARN_TARGETS.length === 0) return;
    const next = Math.max(0, Math.min(LEARN_TARGETS.length - 1, activeIndex + delta));
    setActiveTargetId(LEARN_TARGETS[next].id);
  };

  const learnedCount = Object.values(learned).filter((control) => control.messages.length > 0).length;

  return (
    <div className="midi-inspector">
      <header className="midi-inspector__header">
        <div>
          <h1>MIDI Inspector</h1>
          <p className="midi-inspector__subtitle">Raw Web MIDI monitor + Inpulse 300 MK2 mapping capture</p>
        </div>
        <div className="midi-inspector__actions">
          <button onClick={() => setLog([])}>Clear log</button>
          <button className="midi-inspector__danger" onClick={() => setLearned({})}>Reset learn</button>
          <button className="midi-inspector__primary" onClick={() => setIsLearning((value) => !value)}>
            {isLearning ? 'Stop learning' : 'Start learning'}
          </button>
        </div>
      </header>

      <div className="midi-inspector__grid">
        <section className="midi-inspector__panel">
          <div className="midi-inspector__panel-header">
            <h2>Ports</h2>
            <span className={`midi-inspector__status ${access ? 'midi-inspector__status--ready' : ''}`}>
              {access ? 'MIDI ready' : 'Waiting'}
            </span>
          </div>
          <div className="midi-inspector__panel-body">
            {error ? <p className="midi-inspector__danger">{error}</p> : null}
            <div className="midi-inspector__learn-row">
              <select value={selectedInputId} onChange={(event) => setSelectedInputId(event.target.value)}>
                <option value="all">All inputs</option>
                {inputs.map((input) => (
                  <option key={input.id} value={input.id}>{input.name ?? input.id}</option>
                ))}
              </select>
            </div>
            <div className="midi-inspector__ports">
              {inputs.length === 0 ? <p className="midi-inspector__muted">No MIDI inputs found.</p> : null}
              {inputs.map((input) => (
                <div className="midi-inspector__port" key={input.id}>
                  <span className="midi-inspector__port-name">{input.name ?? '(unnamed input)'}</span>
                  <span className="midi-inspector__muted">id: {input.id}</span>
                  <span className="midi-inspector__muted">state: {input.state} / connection: {input.connection}</span>
                  <span className="midi-inspector__muted">manufacturer: {input.manufacturer ?? '-'}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="midi-inspector__panel">
          <div className="midi-inspector__panel-header">
            <h2>Learn</h2>
            <span className="midi-inspector__muted">{learnedCount}/{LEARN_TARGETS.length} controls captured</span>
          </div>
          <div className="midi-inspector__panel-body midi-inspector__learn">
            {activeTarget ? (
              <>
                <div className="midi-inspector__prompt">
                  <div className="midi-inspector__prompt-title">{activeTarget.label}</div>
                  <div className="midi-inspector__prompt-meta">
                    {activeTarget.group} / {activeTarget.controlType}{activeTarget.notes ? ` / ${activeTarget.notes}` : ''}
                  </div>
                </div>
                <div className="midi-inspector__learn-controls">
                  <select value={activeTargetId} onChange={(event) => setActiveTargetId(event.target.value)}>
                    {LEARN_TARGETS.map((target) => (
                      <option key={target.id} value={target.id}>{target.label}</option>
                    ))}
                  </select>
                  <div className="midi-inspector__learn-row">
                    <button onClick={() => movePrompt(-1)} disabled={activeIndex <= 0}>Previous</button>
                    <button onClick={() => movePrompt(1)} disabled={activeIndex >= LEARN_TARGETS.length - 1}>Next</button>
                    <button onClick={() => setLearned((current) => ({ ...current, [activeTarget.id]: { ...activeTarget, messages: [] } }))}>Clear this</button>
                  </div>
                </div>
                <div className="midi-inspector__captures">
                  {!activeLearned || activeLearned.messages.length === 0 ? (
                    <p className="midi-inspector__muted">{isLearning ? 'Move or press the prompted control.' : 'Start learning to capture this control.'}</p>
                  ) : null}
                  {activeLearned?.messages.map((message) => (
                    <div className="midi-inspector__capture" key={`${message.message}:${message.channel}:${message.number}`}>
                      <span>{message.message} map ch {message.channel} (MIDI ch {message.channel + 1}) number 0x{hexByte(message.number)} / {message.number}</span>
                      <span className="midi-inspector__muted">values: {valuesSummary(message.values)} / count: {message.count} / first: {bytesToHex(message.firstBytes)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </section>
      </div>

      <div className="midi-inspector__grid" style={{ marginTop: 16 }}>
        <section className="midi-inspector__panel">
          <div className="midi-inspector__panel-header">
            <h2>Raw Log</h2>
            <span className="midi-inspector__muted">newest first</span>
          </div>
          <div className="midi-inspector__panel-body">
            <div className="midi-inspector__log">
              <div className="midi-inspector__log-row midi-inspector__log-header">
                <span>Time</span><span>Port</span><span>Type</span><span>Channel</span><span>No.</span><span>Bytes / value</span>
              </div>
              {log.map((entry) => (
                <div className={`midi-inspector__log-row ${entry.learnedControlId ? 'midi-inspector__log-row--learned' : ''}`} key={entry.id}>
                  <span>{entry.time}</span>
                  <span>{entry.portName}</span>
                  <span>{entry.decoded.messageType}</span>
                  <span>map {entry.decoded.channel} / MIDI {entry.decoded.channel + 1}</span>
                  <span>{entry.decoded.number ?? '-'}</span>
                  <span>{bytesToHex(entry.bytes)} / {describeForLog(entry.decoded)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="midi-inspector__panel">
          <div className="midi-inspector__panel-header">
            <h2>Mapping Skeleton</h2>
            <button onClick={() => void navigator.clipboard?.writeText(generatedCode)}>Copy</button>
          </div>
          <div className="midi-inspector__panel-body">
            <pre className="midi-inspector__code">{generatedCode}</pre>
          </div>
        </section>
      </div>
    </div>
  );
}
