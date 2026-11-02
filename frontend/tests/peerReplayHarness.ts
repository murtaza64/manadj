import { Mixer } from '../src/playback/mixer';
import { DeckEngine } from '../src/playback/DeckEngine';
import { SessionReplayDriver } from '../src/sessions/SessionReplayDriver';
import { sessionReplaySource } from '../src/sessions/sessionReplaySource';
import { planReplay } from '../src/sessions/replayPlanner';

// No mocked API, audio context, deck, mixer, cache, driver or worklet.
const mixer = new Mixer();
const engines = {
  A: new DeckEngine(mixer.portFor('A')), B: new DeckEngine(mixer.portFor('B')),
  C: new DeckEngine(mixer.portFor('C')), D: new DeckEngine(mixer.portFor('D')),
};
let driver: SessionReplayDriver;
let stopped: string | null = null;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const proof = {
  async start(uuid: string) {
    await mixer.audioContext().resume();
    const source = await sessionReplaySource(uuid, engines, async () => { throw new Error('foreign raw-ID load'); });
    const plan = planReplay(source.detail.events, 0.1);
    if (!plan.ok) throw new Error(plan.reason);
    driver = new SessionReplayDriver(plan.plan, { mixer, engines }, {
      loadTrack: source.loadTrack, validateSource: source.validateSource,
      onStopped: reason => { stopped = reason; },
    });
    await driver.start();
    // Worklet registration/real audio clock, not a fake ready flag.
    await sleep(300);
    const result = { track: engines.A.getSnapshot().trackId, state: engines.A.getSnapshot().loadState,
      playing: engines.A.getSnapshot().playing, playhead: engines.A.getPlayhead(),
      level: mixer.readChannelLevel('A').meanAbsolute, stopped,
      generation: source.detail.replay_generation };
    driver.pauseReplay();
    return result;
  },
  async resume() {
    driver.resumeReplay();
    await sleep(150);
    return { playing: engines.A.getSnapshot().playing, stopped };
  },
};
(window as unknown as { peerProof: typeof proof }).peerProof = proof;
