import { expect, it, vi } from 'vitest';
import { SessionReplayDriver } from './SessionReplayDriver';
import type { ReplayCue } from './replayPlanner';

it('does not move a paused desktop engine on noisy Session sync evidence', () => {
  let position = 10;
  const seek = vi.fn((value: number) => { position = value; });
  const engine = {
    syncScheduledScratch: () => null,
    getSnapshot: () => ({ playing: false, loadState: 'ready', pitchPercent: 0, scratching: false, loop: null }),
    getPlayhead: () => position,
    seek,
    setPitch: vi.fn(),
  };
  // Isolate the actual production sync-cue handler; no WebAudio, global audible ownership or UI claims.
  const driver = Object.assign(Object.create(SessionReplayDriver.prototype), {
    engines: { A: engine, B: engine, C: engine, D: engine },
    anchors: { A: { offset: 0, playhead: 10, rate: 1 } },
    anchorAudioTime: 0,
    syncDrift: {}, rateBuf: {}, servo: {}, servoActivity: {}, lastCorrection: {}, unsettled: {},
  }) as { applyCue(cue: ReplayCue): void };
  for (const [offsetS, source] of [[600, 9.98], [600.5, 10.02], [601, 9.98]]) {
    driver.applyCue({ kind: 'sync', offsetS, playheads: { A: source } });
    expect(position).toBe(10);
  }
  expect(seek).not.toHaveBeenCalled();
  expect(engine.setPitch).not.toHaveBeenCalled();
});
