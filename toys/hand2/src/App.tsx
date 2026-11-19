import { useEffect, useMemo, useRef, useState } from 'react';

/* manaDJ tokens (frontend/src/theme/tokens.ts, deckColors.ts) */
const MJ = {
    void: '#0b0b0f', mantle: '#181818',
    surface0: '#313136', text: '#cdd6f4', subtext0: '#a6adc8', overlay0: '#6c7086',
    success: '#00e676', warning: '#ffcc00', orange: '#ff9500',
    deckA: '#00e5ff', deckB: '#ff2d95',
};

const BPM = 128;

/* Tiny synth kit. All sounds are synthesized, no samples. */
function useAudio() {
    const ref = useRef<AudioContext | null>(null);
    const ensure = () => {
        try {
            if (!ref.current) {
                const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
                ref.current = new AC();
            }
            if (ref.current.state === 'suspended') void ref.current.resume();
        } catch { /* no audio in this browser */ }
        return ref.current;
    };
    const tone = (freq: number, endFreq: number, dur: number, gain: number, type: OscillatorType = 'sine') => {
        const ctx = ref.current;
        if (!ctx) return;
        try {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = type;
            o.frequency.setValueAtTime(freq, ctx.currentTime);
            o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), ctx.currentTime + dur);
            g.gain.setValueAtTime(gain, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
            o.connect(g); g.connect(ctx.destination);
            o.start(); o.stop(ctx.currentTime + dur + 0.02);
        } catch { /* ignore */ }
    };
    const noise = (dur: number, gain: number, highpass: number) => {
        const ctx = ref.current;
        if (!ctx) return;
        try {
            const len = Math.floor(ctx.sampleRate * dur);
            const buf = ctx.createBuffer(1, len, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const f = ctx.createBiquadFilter();
            f.type = 'highpass';
            f.frequency.value = highpass;
            const g = ctx.createGain();
            g.gain.setValueAtTime(gain, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
            src.connect(f); f.connect(g); g.connect(ctx.destination);
            src.start();
        } catch { /* ignore */ }
    };
    return {
        ensure,
        kick: () => tone(150, 45, 0.14, 0.5),
        snare: () => { noise(0.09, 0.3, 1800); tone(190, 120, 0.08, 0.18, 'triangle'); },
        hat: () => noise(0.04, 0.16, 7000),
        blip: () => tone(880, 660, 0.06, 0.1, 'square'),
    };
}

/* ---------------- Toy 1: Pocket 8 ---------------- */

type Lane = 'kick' | 'snare' | 'hat';
const LANES: { id: Lane; label: string; color: string }[] = [
    { id: 'kick', label: 'KICK', color: MJ.deckA },
    { id: 'snare', label: 'SNARE', color: MJ.deckB },
    { id: 'hat', label: 'HAT', color: MJ.warning },
];
const START_GRID: Record<Lane, boolean[]> = {
    kick: [true, false, false, false, true, false, false, false],
    snare: [false, false, true, false, false, false, true, false],
    hat: [true, true, true, true, true, true, true, true],
};

function Pocket8() {
    const audio = useAudio();
    const [grid, setGrid] = useState<Record<Lane, boolean[]>>(START_GRID);
    const [playing, setPlaying] = useState(false);
    const [step, setStep] = useState(-1);
    const stepRef = useRef(0);

    useEffect(() => {
        if (!playing) { setStep(-1); return; }
        const stepSec = (60 / BPM) / 2; /* 8th notes */
        const id = setInterval(() => {
            const s = stepRef.current % 8;
            setStep(s);
            if (grid.kick[s]) audio.kick();
            if (grid.snare[s]) audio.snare();
            if (grid.hat[s]) audio.hat();
            stepRef.current = s + 1;
        }, stepSec * 1000);
        return () => clearInterval(id);
    }, [playing, grid]);

    useEffect(() => () => { setPlaying(false); }, []);

    const toggle = (lane: Lane, i: number) => {
        audio.ensure();
        const next = { ...grid, [lane]: grid[lane].slice() };
        next[lane][i] = !next[lane][i];
        setGrid(next);
        if (!playing && next[lane][i]) {
            if (lane === 'kick') audio.kick();
            if (lane === 'snare') audio.snare();
            if (lane === 'hat') audio.hat();
        }
    };

    return <>
        <div className="seq">
            {LANES.map(lane => (
                <div key={lane.id} className="seq-lane">
                    <span className="seq-label" style={{ color: lane.color }}>{lane.label}</span>
                    {grid[lane.id].map((on, i) => (
                        <button key={i} type="button" aria-label={`${lane.label} step ${i + 1}`}
                            className={`seq-cell${on ? ' is-on' : ''}${step === i ? ' is-now' : ''}`}
                            style={on ? { background: lane.color, borderColor: lane.color } : undefined}
                            onClick={() => toggle(lane.id, i)} />
                    ))}
                </div>
            ))}
        </div>
        <div className="toy-controls">
            <button type="button" className="mj-btn mj-play"
                onClick={() => { audio.ensure(); stepRef.current = 0; setPlaying(!playing); }}>
                {playing ? 'STOP' : 'PLAY'}
            </button>
            <button type="button" className="mj-btn" onClick={() => setGrid(START_GRID)}>RESET</button>
            <span className="toy-meta">{BPM.toFixed(1)} BPM · 8 steps</span>
        </div>
    </>;
}

/* ---------------- Toy 2: Drop needle ---------------- */

const SWEEP_MS = 2100;

function DropNeedle() {
    const audio = useAudio();
    const [phase, setPhase] = useState<'idle' | 'sweeping' | 'done'>('idle');
    const [pos, setPos] = useState(0); /* 0..1 */
    const [target, setTarget] = useState(0.7);
    const [result, setResult] = useState<{ beatsOff: number; early: boolean } | null>(null);
    const startRef = useRef(0);
    const rafRef = useRef(0);

    const start = () => {
        audio.ensure();
        audio.blip();
        setResult(null);
        setTarget(0.5 + Math.random() * 0.35);
        setPhase('sweeping');
        startRef.current = performance.now();
        const tick = () => {
            const t = (performance.now() - startRef.current) / SWEEP_MS;
            if (t >= 1) {
                setPos(1);
                setPhase('done');
                setResult({ beatsOff: Infinity, early: false });
                return;
            }
            setPos(t);
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
    };
    const drop = () => {
        if (phase !== 'sweeping') return;
        cancelAnimationFrame(rafRef.current);
        const t = Math.min(1, (performance.now() - startRef.current) / SWEEP_MS);
        setPos(t);
        setPhase('done');
        const beatsOff = Math.abs(t - target) * 64; /* lane is one 64-beat phrase */
        setResult({ beatsOff, early: t < target });
        if (beatsOff < 0.5) { audio.kick(); audio.snare(); }
        else audio.blip();
    };
    useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

    const verdict = !result ? null
        : result.beatsOff === Infinity ? 'You let it sail right past the drop. The crowd noticed.'
        : result.beatsOff < 0.25 ? 'Needle drop. Perfect. The room levitates.'
        : result.beatsOff < 1 ? `${result.early ? 'Early' : 'Late'} by a hair — the crowd goes mild.`
        : result.beatsOff < 4 ? `${result.early ? 'Early' : 'Late'} by ${result.beatsOff.toFixed(1)} beats. Trainable.`
        : `${result.early ? 'Early' : 'Late'} by ${result.beatsOff.toFixed(1)} beats. The drop filed a complaint.`;

    return <>
        <div className="needle-lane" onClick={phase === 'sweeping' ? drop : undefined}>
            <div className="needle-track">
                <div className="needle-target" style={{ left: `${target * 100}%` }}>◆</div>
                {(phase !== 'idle') && <div className="needle-head" style={{ left: `${pos * 100}%` }} />}
            </div>
        </div>
        <div className="toy-controls">
            {phase === 'sweeping'
                ? <button type="button" className="mj-btn mj-cue" onClick={drop}>DROP NOW</button>
                : <button type="button" className="mj-btn mj-play" onClick={start}>{phase === 'done' ? 'AGAIN' : 'START'}</button>}
            {verdict && <span className="toy-verdict">{verdict}</span>}
        </div>
    </>;
}

/* ---------------- Toy 3: Tempo oracle ---------------- */

const ANCHORS: [number, string][] = [
    [74, 'lofi head-nod'],
    [100, 'downtempo strut'],
    [124, 'house party'],
    [128, 'manaDJ o\u2019clock'],
    [140, 'bass weight'],
    [174, 'drum & bass sprint'],
];

function TempoOracle() {
    const audio = useAudio();
    const [taps, setTaps] = useState<number[]>([]);
    const bpm = useMemo(() => {
        if (taps.length < 2) return null;
        const spans: number[] = [];
        for (let i = 1; i < taps.length; i++) spans.push(taps[i] - taps[i - 1]);
        const avg = spans.reduce((a, b) => a + b, 0) / spans.length;
        return Math.round(60000 / avg);
    }, [taps]);
    const nearest = bpm === null ? null
        : ANCHORS.reduce((best, a) => Math.abs(a[0] - bpm) < Math.abs(best[0] - bpm) ? a : best);

    const tap = () => {
        audio.ensure();
        audio.blip();
        const now = performance.now();
        setTaps(prev => {
            const kept = prev.length && now - prev[prev.length - 1] > 2200 ? [] : prev;
            return [...kept, now].slice(-9);
        });
    };

    return <>
        <div className="toy-controls oracle-row">
            <button type="button" className="mj-btn mj-jump" onClick={tap}>TAP</button>
            <button type="button" className="mj-btn" onClick={() => setTaps([])}>RESET</button>
        </div>
        <div className="oracle-read">
            {bpm === null
                ? <span className="toy-meta">{taps.length === 0 ? 'Waiting for taps…' : 'Keep tapping…'}</span>
                : <>
                    <span className="oracle-bpm">{bpm} BPM</span>
                    {nearest && Math.abs(nearest[0] - bpm) <= 3
                        ? <span className="toy-verdict">Dead on {nearest[0]} — {nearest[1]}.</span>
                        : nearest && <span className="toy-verdict">Nearest shelf: {nearest[0]} BPM, {nearest[1]}.</span>}
                </>}
        </div>
    </>;
}

/* ---------------- Page: compact rows, one panel open ---------------- */

type ToyId = 'pocket' | 'needle' | 'oracle';
const TOYS: { id: ToyId; name: string; sub: string }[] = [
    { id: 'pocket', name: 'Pocket 8', sub: 'A tiny drum machine. Tap cells, press play.' },
    { id: 'needle', name: 'Drop needle', sub: 'Stop the playhead on the diamond.' },
    { id: 'oracle', name: 'Tempo oracle', sub: 'Tap the pad, it reads your BPM.' },
];

export function App() {
    const [open, setOpen] = useState<ToyId | null>(null);

    return <div className="page">
        <header className="page-head">
            <h1 className="page-title">A fresh hand of toys</h1>
            <p className="page-intro">Three pocket toys. Sound on or headphones in.</p>
        </header>
        <div className="hand">
            {TOYS.map(toy => {
                const isOpen = open === toy.id;
                return <div key={toy.id} className={`toy-dark${isOpen ? ' is-open' : ''}`}>
                    <button type="button" className="toy-row" aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : toy.id)}>
                        <span className="toy-row-text">
                            <span className="toy-name">{toy.name}</span>
                            {!isOpen && <span className="toy-sub">{toy.sub}</span>}
                        </span>
                        <span className="toy-hint">{isOpen ? 'CLOSE' : 'OPEN'}</span>
                    </button>
                    {isOpen && <div className="toy-panel">
                        {toy.id === 'pocket' && <Pocket8 />}
                        {toy.id === 'needle' && <DropNeedle />}
                        {toy.id === 'oracle' && <TempoOracle />}
                    </div>}
                </div>;
            })}
        </div>
        <footer className="page-foot">
            All audio is synthesized in the browser, no samples and no manaDJ engine. The silence-loop
            pick from the last hand still stands; this hand is just for playing.
        </footer>
    </div>;
}
