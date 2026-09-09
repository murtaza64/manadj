/** Synthetic diagnostics only; no device, database, or audible output.
 * Run from frontend/: npx tsx ../docs/research/vinyl-scratch-quality.probe.ts
 * --check-release / --check-gain are regression checks for the measured defects. */
import assert from 'node:assert/strict';
import { JogController } from '../../frontend/src/midi/jog';
import { GRV6_JOG_CALIBRATION } from '../../frontend/src/midi/jogCalibration';
import { DeckSourceKernel } from '../../frontend/src/playback/worklet/deckSourceKernel';
import { moveScratch, scratchRate, type ScratchMotion } from '../../frontend/src/playback/worklet/scratchMotion';

let clock = 0;
let nextTimer = 0;
const timers = new Map<number, { at: number; fn: () => void }>();
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = ((fn: () => void, delay: number) => {
  const id = ++nextTimer;
  timers.set(id, { at: clock + delay, fn });
  return id;
}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout;
function advance(target: number) {
  while (true) {
    const due = [...timers].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    clock = due[1].at;
    timers.delete(due[0]);
    due[1].fn();
  }
  clock = target;
}

let active = false;
let endedAt = -1;
let motion: ScratchMotion = { position: 5, time: 0, drive: 0, rate: 0, trackDuration: 20, loop: null };
const jog = new JogController({
  isPlaying: () => true, getPlayhead: () => 5, seek: () => {}, setBend: () => {},
  scratch: {
    isActive: () => active, vinylMode: () => true,
    begin: () => { active = true; },
    move: (delta, duration) => { motion = moveScratch(motion, clock / 1000, delta, duration); },
    rate: () => scratchRate(motion, clock / 1000),
    end: () => { active = false; endedAt = clock; },
  },
});
let release;
try {
  jog.onTouch(true, 0);
  advance(10);
  jog.onTouchTicks(20, clock, GRV6_JOG_CALIBRATION, 'grv6');
  advance(11);
  jog.onTouch(false, clock);
  const releaseAt = clock;
  advance(100);
  release = { handUpMs: releaseAt, normalResumesMs: endedAt, releaseDelayMs: endedAt - releaseAt };
} finally {
  jog.dispose();
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
}

const sr = 48000;
function render(packetMs: number | null, tone: boolean) {
  const kernel = new DeckSourceKernel(240, 48);
  const source = Float32Array.from({ length: sr * 10 }, (_, i) => tone ? Math.sin(2 * Math.PI * 1000 * i / sr) : 1);
  kernel.setTrack([source], 1);
  let state: ScratchMotion = { position: 2, time: 0, drive: 0, rate: 0, trackDuration: 10, loop: null };
  const packetFrames = packetMs === null ? sr : Math.round(packetMs * sr / 1000);
  const result = new Float32Array(sr);
  if (packetMs === null) kernel.start(2 * sr, 1);
  for (let start = 0; start < sr; start += packetFrames) {
    const duration = packetFrames / sr;
    if (packetMs !== null) {
      state = moveScratch(state, start / sr, 1.08 * duration, duration);
      kernel.setScratch(state);
    }
    for (let frame = start; frame < Math.min(sr, start + packetFrames); frame += 128) {
      const out = new Float32Array(Math.min(128, start + packetFrames - frame, sr - frame));
      kernel.render([out], new Float32Array([1.08]), frame / sr, sr);
      result.set(out, frame);
    }
  }
  return result;
}
// Exclude the gesture's actual start/end fades from all measurements.
function amplitude(samples: Float32Array, hz: number) {
  let re = 0, im = 0;
  for (let i = sr / 10; i < sr * 0.9; i++) {
    re += samples[i] * Math.cos(2 * Math.PI * hz * i / sr);
    im += samples[i] * Math.sin(2 * Math.PI * hz * i / sr);
  }
  return Math.hypot(re, im) * 2 / (sr * 0.8);
}
function stats(a: Float32Array) {
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = sr / 10; i < sr * 0.9; i++) {
    min = Math.min(min, a[i]); max = Math.max(max, a[i]); sum += a[i];
  }
  return { min, max, mean: sum / (sr * 0.8) };
}
const gain = { continuous: stats(render(null, false)), packet5ms: stats(render(5, false)) };
const tone = render(5, true), baseline = render(null, true);
const sidebands = {
  packetDb: 20 * Math.log10(amplitude(tone, 880) / amplitude(tone, 1080)),
  continuousDb: 20 * Math.log10(amplitude(baseline, 880) / amplitude(baseline, 1080)),
};
console.log(JSON.stringify({ release, gain, sidebands }, null, 2));
if (process.argv.includes('--check-release')) {
  assert.ok(release.releaseDelayMs <= 5, 'Ordinary release should begin transport handover within 5ms');
}
if (process.argv.includes('--check-gain')) {
  assert.ok(gain.packet5ms.min > 0.95, 'Uniform motion should not fade on MIDI packet boundaries');
}
