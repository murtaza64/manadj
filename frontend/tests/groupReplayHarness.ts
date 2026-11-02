import { Mixer } from '../src/playback/mixer';
import { DeckEngine } from '../src/playback/DeckEngine';
import { SessionReplayDriver } from '../src/sessions/SessionReplayDriver';
import { groupReplaySource } from '../src/sessions/groupReplaySource';
import { planReplay } from '../src/sessions/replayPlanner';
import { putCachedBuffer } from '../src/playback/bufferCache';

const mixer = new Mixer();
const engines = { A: new DeckEngine(mixer.portFor('A')), B: new DeckEngine(mixer.portFor('B')),
  C: new DeckEngine(mixer.portFor('C')), D: new DeckEngine(mixer.portFor('D')) };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let driver: SessionReplayDriver;
let source: Awaited<ReturnType<typeof groupReplaySource>>;
let stopped: string | null = null;
let rendered: number[] = [];

function snapshot() {
  return { stopped, decks: Object.fromEntries(['A', 'B'].map(deck => {
    const engine = engines[deck as 'A' | 'B'];
    // Test-only observation of the actual successful WebAudio decode held by
    // the existing engine, not an alternate decoder or injected ready flag.
    const decoded = (engine as unknown as { buffer: AudioBuffer | null }).buffer;
    return [deck, { ...engine.getSnapshot(), playhead: engine.getPlayhead(),
      decoded: decoded ? { frames: decoded.length, rate: decoded.sampleRate,
        pcm: Array.from(decoded.getChannelData(0).slice(0, 192)) } : null }];
  })), renderedFrames: rendered.length, renderedPeak: Math.max(0, ...rendered.map(Math.abs)) };
}
const proof = {
  async start(group: string, operation: string) {
    await mixer.audioContext().resume();
    const tap = mixer.createMasterRecordingTap();
    const recorder = tap.ctx.createScriptProcessor(1024, 2, 2);
    recorder.onaudioprocess = event => { rendered.push(...event.inputBuffer.getChannelData(0)); };
    tap.input.connect(recorder); recorder.connect(tap.ctx.destination);
    // Poison ordinary bare-ID cache. GROUP must fetch/decode selected bytes.
    for (const id of [73, 88]) {
      const poison = tap.ctx.createBuffer(1, 100, 48000);
      poison.getChannelData(0).fill(0.99); putCachedBuffer(id, poison);
    }
    source = await groupReplaySource(group, operation, engines);
    const plan = planReplay(source.events, 0);
    if (!plan.ok) throw new Error(plan.reason);
    driver = new SessionReplayDriver(plan.plan, { mixer, engines }, { loadTrack: source.loadTrack,
      validateSource: source.validateSource, onStopped: reason => { stopped = reason; } });
    await driver.start(); await sleep(350); driver.pauseReplay();
    return snapshot();
  },
  async seek(offset: number) {
    const plan = planReplay(source.events, offset);
    if (!plan.ok) throw new Error(plan.reason);
    await driver.seekTo(plan.plan);
    return snapshot();
  },
  async resume() { driver.resumeReplay(); await sleep(180); driver.pauseReplay(); return snapshot(); },
  snapshot,
};
(window as unknown as { groupProof: typeof proof }).groupProof = proof;
