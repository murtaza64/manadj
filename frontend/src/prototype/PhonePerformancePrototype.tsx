/* eslint-disable react-hooks/refs -- The throwaway surface renders a mutable Web Audio engine snapshot on a timer. */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { PhoneAudio, type Side, type CaptureStart } from './phoneAudio';
import { cueCssColor } from '../hotcues/palette';
import './phonePerformance.css';

// Three variants of a phone DJ surface, switchable via ?variant= on this throwaway route.
type Action = { at: number; deck?: Side; kind: string; value?: number };
const variants = ['stack', 'focus', 'mixer'] as const;
const names = ['STACKED DECKS', 'FOCUS + SATELLITE', 'MIXER + PADS'];
const other = (side: Side): Side => side === 'A' ? 'B' : 'A';
const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function PhonePerformancePrototype() {
  const [engine] = useState(() => new PhoneAudio());
  const [, redraw] = useState(0);
  const refresh = () => redraw(x => x + 1);
  const [variant, setVariant] = useState(() => Math.max(0, variants.indexOf(new URLSearchParams(location.search).get('variant') as typeof variants[number])));
  const [focus, setFocus] = useState<Side>('A');
  const [padMode, setPadMode] = useState<'cues' | 'jump' | 'loops'>('cues');
  const [heldCue, setHeldCue] = useState<Side[]>([]);
  const [events, setEvents] = useState<Action[]>([]);
  const [capturing, setCapturing] = useState(false);
  const capturedAt = useRef(0);
  const captureStart = useRef<CaptureStart | null>(null);
  const replaying = useRef(false);
  const timers = useRef<number[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileSide = useRef<Side>('A');
  useEffect(() => {
    const interval = window.setInterval(refresh, 100);
    const pop = () => setVariant(Math.max(0, variants.indexOf(new URLSearchParams(location.search).get('variant') as typeof variants[number])));
    window.addEventListener('popstate', pop);
    return () => { clearInterval(interval); window.removeEventListener('popstate', pop); timers.current.forEach(clearTimeout); engine.dispose(); };
  }, [engine]);
  const switchVariant = (delta: number) => {
    const next = (variant + delta + variants.length) % variants.length;
    setVariant(next);
    const url = new URL(location.href); url.searchParams.set('variant', variants[next]); history.replaceState(null, '', url);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); switchVariant(e.key === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  const action = (kind: string, deck?: Side, value?: number) => {
    if (capturing && !replaying.current) setEvents(current => [...current, { at: performance.now() - capturedAt.current, kind, deck, value }]);
    engine.apply(kind, deck, value); refresh();
  };
  const loadFile = async (file: File, side: Side) => {
    await engine.ready();
    const buffer = await engine.ctx!.decodeAudioData(await file.arrayBuffer());
    engine.setFile(side, file.name, buffer);
    refresh();
  };
  const transport = (kind: string, deck: Side, value?: number) => { void engine.ready(); action(kind, deck, value); };
  const replay = async () => {
    if (!events.length) return;
    timers.current.forEach(clearTimeout); timers.current = [];
    await engine.ready(); replaying.current = true;
    if (captureStart.current) engine.restore(captureStart.current);
    events.forEach(event => timers.current.push(window.setTimeout(() => action(event.kind, event.deck, event.value), event.at)));
    timers.current.push(window.setTimeout(() => { replaying.current = false; }, events.at(-1)!.at + 100));
  };
  const slider = (label: string, value: number, min: number, max: number, step: number, change: (v: number) => void, shown?: string) => <label className="phone-slider"><span>{label}</span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => change(Number(e.target.value))} /><b>{shown ?? value.toFixed(1)}</b></label>;
  const waveform = (side: Side) => {
    const d = engine.decks[side], duration = d.buffer?.duration || 32 * 60 / d.bpm, pos = engine.position(side);
    return <div className="phone-wave" role="group" aria-label={`Deck ${side} schematic position seek ruler`}>
      <div className="phone-wave-caption"><span>POSITION RULER / SCHEMATIC — NOT AUDIO WAVEFORM</span><span>{Math.round(pos / duration * 100)}%</span></div>
      <div className="phone-wave-well">
        <div className="phone-wave-bars">{Array.from({ length: 17 }, (_, i) => <i key={i} className={i % 4 === 0 ? 'major' : ''} />)}</div>
        <div className="phone-main-cue" style={{ left: `${d.cue / duration * 100}%` }} title="Main cue" />
        {d.hot.map((at, index) => at === null ? null : <div key={index} className="phone-hot-marker" style={{ left: `${at / duration * 100}%`, '--cue-color': cueCssColor(index + 1) } as CSSProperties}><span>{index + 1}</span></div>)}
        <div className="phone-playhead" style={{ left: `${pos / duration * 100}%` }} title="Transport playhead" />
      </div>
      <input aria-label={`Seek deck ${side}`} type="range" min="0" max={duration} step="0.01" value={pos} onChange={e => action('seek', side, Number(e.target.value))} />
      <div className="phone-wave-time"><span>{fmt(pos)}</span><span>{fmt(duration)}</span></div>
    </div>;
  };
  const transportRow = (side: Side) => <div className="phone-transport"><button className={`btn phone-cue${heldCue.includes(side) ? ' engaged' : ''}`} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setHeldCue(current => [...current, side]); transport('cueDown', side); }} onPointerUp={() => { setHeldCue(current => current.filter(item => item !== side)); action('cueUp', side); }} onPointerCancel={() => { setHeldCue(current => current.filter(item => item !== side)); action('cueUp', side); }} aria-label={`Hold cue deck ${side}`}>CUE / HOLD</button><button className={`btn phone-play${engine.decks[side].playing ? ' engaged' : ''}`} onClick={() => transport('play', side)} aria-label={`${engine.decks[side].playing ? 'Pause' : 'Play'} deck ${side}`}>{engine.decks[side].playing ? 'Ⅱ  PLAYING' : '▶  PLAY'}</button></div>;
  const deckHead = (side: Side) => { const d = engine.decks[side]; return <div className="phone-deck-head"><strong className="phone-deck-id">{side}</strong><div className="phone-title"><b>{d.title}</b><small>{d.playing ? 'PLAYING' : 'READY'}  ·  {d.tempo.toFixed(1)} BPM  ·  {fmt(engine.position(side))}</small></div><button className="btn btn-primary phone-load" onClick={() => { fileSide.current = side; fileInput.current?.click(); }}>LOAD</button></div>; };
  const pitch = (side: Side) => { const d = engine.decks[side]; return <div className="phone-pitch">{slider(`${side} tempo`, d.tempo, d.bpm * .75, d.bpm * 1.25, .1, v => action('tempo', side, v), `${d.tempo.toFixed(1)} BPM`)}<button className="btn btn-secondary" onClick={() => action('match', side)}>MATCH {other(side)}</button></div>; };
  const pads = (side: Side) => <div className="phone-pads">{[0, 1, 2, 3].map(i => <button key={i} style={padMode === 'cues' ? { '--cue-color': cueCssColor(i + 1) } as CSSProperties : undefined} className={`btn phone-pad${padMode === 'cues' && engine.decks[side].hot[i] !== null ? ' set' : ''}${padMode === 'loops' && engine.decks[side].loop === [1, 2, 4, 8][i] * 4 * 60 / engine.decks[side].bpm ? ' loop-on' : ''}`} onClick={() => transport(padMode === 'cues' ? 'hot' : padMode === 'jump' ? 'jump' : 'loop', side, padMode === 'cues' ? i : padMode === 'jump' ? [-16, -4, 4, 16][i] : [1, 2, 4, 8][i])} onContextMenu={e => { e.preventDefault(); if (padMode === 'cues') action('clearHot', side, i); }}><span>{padMode === 'cues' ? `${i + 1}${i === 3 ? ' DROP' : ''}` : padMode === 'jump' ? `${[-16, -4, 4, 16][i] > 0 ? '+' : ''}${[-16, -4, 4, 16][i]}` : `${[1, 2, 4, 8][i]} BAR`}</span><small>{padMode === 'cues' && engine.decks[side].hot[i] !== null ? fmt(engine.decks[side].hot[i]!) : ' '}</small></button>)}</div>;
  const padTabs = <div className="phone-pad-tabs">{(['cues', 'jump', 'loops'] as const).map(mode => <button key={mode} className={`btn btn-secondary${padMode === mode ? ' btn-selected' : ''}`} onClick={() => setPadMode(mode)}>{mode.toUpperCase()}</button>)}</div>;
  const channel = (side: Side) => { const d = engine.decks[side]; return <div className={`phone-channel side-${side}`}><strong><span>{side}</span> / CHANNEL  ·  EQ  /  FX</strong>{slider(`${side} trim`, d.gain, 0, 1.5, .01, v => action('gain', side, v))}{['LOW', 'MID', 'HIGH'].map((band, i) => <div key={band}>{slider(`${side} ${band}`, d.eq[i], -18, 18, 1, v => action(`eq${i}`, side, v), `${d.eq[i]} dB`)}</div>)}{slider(`${side} filter`, d.filter, -1, 1, .01, v => action('filter', side, v), d.filter === 0 ? 'OFF' : d.filter < 0 ? 'LP' : 'HP')}{slider(`${side} ½-beat ECHO`, d.echo, 0, .8, .01, v => action('echo', side, v), `${Math.round(d.echo * 100)}%`)}</div>; };
  const mixer = <section className="phone-mixer"><div className="phone-section-label">CHANNEL STRIPS <span>TRIM / EQ / FILTER / ECHO</span></div><div className="phone-mixer-channels">{channel('A')}{channel('B')}</div></section>;
  const card = (side: Side, expanded: boolean) => <section className={`phone-deck side-${side} ${expanded ? 'expanded' : ''}`} key={side}>{deckHead(side)}{waveform(side)}{transportRow(side)}{expanded && <>{pitch(side)}<div className="phone-section-label">PERFORMANCE PADS <span>{side} / 4 DROP</span></div>{padTabs}{pads(side)}<div className="phone-jumps"><button className="btn btn-secondary" onClick={() => action('jump', side, -4)}>−4 BEATS</button><button className="btn btn-secondary" onClick={() => action('jump', side, 4)}>+4 BEATS</button></div></>}</section>;
  return <div className="phone-prototype"><header className="phone-header"><div><span className="phone-kicker">MANADJ / PERF / 2 DECKS</span><h1>PERFORMANCE <span>/ PROTOTYPE</span></h1></div><span className="phone-badge">LOCAL / NO SYNC</span></header>
    <div className="phone-warning">SYNTH DEMO / LOCAL FILE · VARISPEED, NO KEYLOCK · MASTER OUT ONLY</div>
    {variant === 0 && <main className="phone-stack">{card('A', true)}{card('B', true)}{mixer}</main>}
    {variant === 1 && <main className="phone-focus"><div className="phone-selector"><button className={`btn btn-secondary${focus === 'A' ? ' btn-selected' : ''}`} onClick={() => setFocus('A')}>FOCUS A</button><button className={`btn btn-secondary${focus === 'B' ? ' btn-selected' : ''}`} onClick={() => setFocus('B')}>FOCUS B</button></div>{card(focus, true)}<section className={`phone-satellite side-${other(focus)}`}>{deckHead(other(focus))}{waveform(other(focus))}{transportRow(other(focus))}<button className="btn btn-secondary" onClick={() => setFocus(other(focus))}>EXPAND {other(focus)} ↗</button></section>{channel(focus)}{channel(other(focus))}</main>}
    {variant === 2 && <main className="phone-mixer-first"><div className="phone-mini-decks">{(['A', 'B'] as Side[]).map(side => <section className={`side-${side}`} key={side}>{deckHead(side)}{waveform(side)}{transportRow(side)}</section>)}</div>{mixer}<section className={`phone-pad-bank side-${focus}`}><div className="phone-selector"><button className={`btn btn-secondary${focus === 'A' ? ' btn-selected' : ''}`} onClick={() => setFocus('A')}>PADS A</button><button className={`btn btn-secondary${focus === 'B' ? ' btn-selected' : ''}`} onClick={() => setFocus('B')}>PADS B</button></div>{pitch(focus)}{padTabs}{pads(focus)}<div className="phone-jumps"><button className="btn btn-secondary" onClick={() => action('jump', focus, -4)}>−4 BEATS</button><button className="btn btn-secondary" onClick={() => action('jump', focus, 4)}>+4 BEATS</button></div></section></main>}
    <details className="phone-future"><summary>PROTOTYPE TOOLS / SESSION + SET <span>LIMITS · CAPTURE · REPLAY</span></summary><div className="phone-future-body"><h2>SESSION / SET · SIMULATED</h2><p>Future desktop ⇄ phone playback and sync. No desktop connection, Set engine, library metadata, grid analysis, or sync protocol in this prototype. The position rulers are schematic, not audio waveforms or analyzed beat grids.</p><div className="phone-session-actions"><button className={`btn ${capturing ? 'btn-danger' : 'btn-primary'}`} onClick={() => { if (!capturing) { setEvents([]); capturedAt.current = performance.now(); captureStart.current = engine.snapshot(); } setCapturing(!capturing); }}>{capturing ? '■ STOP CAPTURE' : '● CAPTURE ACTIONS'}</button><button className="btn btn-primary" disabled={!events.length || capturing} onClick={() => void replay()}>▶ REPLAY HERE</button><button className="btn btn-secondary" disabled={!events.length} onClick={() => setEvents([])}>CLEAR</button></div><small>In-memory prototype event list ({events.length}) · replay applies recorded controls on this device, not desktop Session format. Hold-cue and sliders record actions too.</small><div className="phone-event-list">{events.slice(-8).map((event, i) => <div key={i}>{(event.at / 1000).toFixed(1)}s · {event.deck || 'MIX'} · {event.kind} {event.value?.toFixed(2)}</div>)}</div></div></details>
    <footer className="phone-bus"><div className="phone-status">A {engine.decks.A.playing ? '▶' : 'Ⅱ'} {fmt(engine.position('A'))} / {engine.decks.A.tempo.toFixed(1)} · B {engine.decks.B.playing ? '▶' : 'Ⅱ'} {fmt(engine.position('B'))} / {engine.decks.B.tempo.toFixed(1)} · XF {Math.round(engine.cross * 100)}%</div><div className="phone-bus-controls"><button className={`btn phone-bus-deck side-A${engine.decks.A.playing ? ' engaged' : ''}`} onClick={() => transport('play', 'A')} aria-label="Rail toggle deck A">A {engine.decks.A.playing ? 'Ⅱ' : '▶'}</button><button className={`btn phone-bus-deck side-B${engine.decks.B.playing ? ' engaged' : ''}`} onClick={() => transport('play', 'B')} aria-label="Rail toggle deck B">B {engine.decks.B.playing ? 'Ⅱ' : '▶'}</button>{slider('XF', engine.cross, 0, 1, .01, v => action('cross', undefined, v), engine.cross < .45 ? 'A' : engine.cross > .55 ? 'B' : 'A+B')}{slider('OUT', engine.volume, 0, 1, .01, v => action('master', undefined, v), `${Math.round(engine.volume * 100)}`)}</div></footer>
    <nav className="phone-switcher" aria-label="Prototype variants"><button className="btn btn-secondary" onClick={() => switchVariant(-1)} aria-label="Previous variant">←</button><span>{variant + 1}/3 · {names[variant]}</span><button className="btn btn-secondary" onClick={() => switchVariant(1)} aria-label="Next variant">→</button></nav>
    <input ref={fileInput} hidden type="file" accept="audio/*" onChange={e => { const file = e.target.files?.[0]; if (file) void loadFile(file, fileSide.current); e.target.value = ''; }} />
  </div>;
}
