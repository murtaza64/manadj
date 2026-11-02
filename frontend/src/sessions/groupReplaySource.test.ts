import { afterEach, expect, it, vi } from 'vitest';
import type { CaptureDeck } from '../capture/events';
import type { DeckEngine } from '../playback/DeckEngine';
import { groupReplaySource } from './groupReplaySource';

const identity = { group_id: 'group', operation_id: 'operation', session_uuid: 'session',
  operation_sha256: 'a'.repeat(64), origin_device_id: 'origin', receiver_device_id: 'receiver' };
const bindings = [{ logical_track_id: 'logical', selection_id: 'selected', receiver_key: '73', incarnation: 'b'.repeat(64),
  asset: { algorithm: 'sha256-file-bytes-v1', sha256: 'c'.repeat(64), byte_length: 192044 } }];
const ready = () => ({ format: 'manadj-group-replay-readiness/v1', identity, bindings,
  grammar: 'capture-group-basic-replay/v1', state: 'candidate-exact', generation: 'generation', playable: false, reason: null });
const wire = () => ({ format: 'manadj-group-replay-source/v1', identity, bindings,
  grammar: 'capture-group-basic-replay/v1', generation: 'generation', playable: false,
  events: [{ kind: 'load', t: 0, channel: 'A', trackId: 73, bpm: 120 }] });
afterEach(() => vi.unstubAllGlobals());

function environment() {
  let current = ready();
  const snapshot = { loadState: 'empty', audioSourceKey: '' };
  const load = vi.fn(async (info: { audioSourceKey: string }) => {
    snapshot.audioSourceKey = info.audioSourceKey; snapshot.loadState = 'ready';
  });
  const engine = { load, getSnapshot: () => snapshot } as unknown as DeckEngine;
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/source?') ? wire() : current), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  return { engines: { A: engine, B: engine, C: engine, D: engine } as Record<CaptureDeck, DeckEngine>,
    load, snapshot, fetch, change: (state: string) => { current = { ...current, state, generation: 'new-generation' }; } };
}

it('only fresh actual engine readiness grants a local attempt; never bare-ID cache URLs', async () => {
  const e = environment();
  const source = await groupReplaySource('group', 'operation', e.engines);
  expect(await source.loadTrack('A', 7)).toBe(false);
  expect(e.load).not.toHaveBeenCalled();
  expect(await source.loadTrack('A', 73)).toBe(true);
  expect(e.load.mock.calls[0][0]).toMatchObject({ bypassCache: true,
    audioUrl: expect.stringContaining('/group-replay/group/operation/audio/logical?generation=generation'),
    audioSourceKey: expect.stringContaining('GROUP:') });
  const key = e.snapshot.audioSourceKey;
  expect(await source.loadTrack('A', 73)).toBe(true);
  expect(e.snapshot.audioSourceKey).not.toBe(key);
  e.snapshot.audioSourceKey = 'old bare-id cache';
  expect(await source.validateSource()).toBe(false);
});

it('rechecks after decode; revocation cannot be satisfied by an old successful load', async () => {
  const e = environment();
  const source = await groupReplaySource('group', 'operation', e.engines);
  e.load.mockImplementationOnce(async info => {
    e.snapshot.audioSourceKey = info.audioSourceKey; e.snapshot.loadState = 'ready';
    e.change('revoked');
  });
  expect(await source.loadTrack('A', 73)).toBe(false);
  expect(await source.validateSource()).toBe(false);
});

it('rejects decoder errors even if a response claims decoded/playable authority', async () => {
  const e = environment();
  const source = await groupReplaySource('group', 'operation', e.engines);
  e.load.mockImplementationOnce(async info => { e.snapshot.audioSourceKey = info.audioSourceKey; e.snapshot.loadState = 'error'; });
  expect(await source.loadTrack('A', 73)).toBe(false);
  e.fetch.mockImplementation(async () => new Response(JSON.stringify({ ...ready(), playable: true, decoded: true })));
  await expect(groupReplaySource('group', 'operation', e.engines)).rejects.toThrow();
});

it('rejects a stale asynchronous attempt displaced by a newer group source', async () => {
  const e = environment();
  const old = await groupReplaySource('group', 'operation', e.engines);
  const next = await groupReplaySource('group', 'operation', e.engines);
  let finish!: () => void;
  e.load.mockImplementationOnce(info => new Promise<void>(resolve => {
    finish = () => { e.snapshot.audioSourceKey = info.audioSourceKey; e.snapshot.loadState = 'ready'; resolve(); };
  }));
  const stale = old.loadTrack('A', 73);
  await vi.waitFor(() => expect(e.load).toHaveBeenCalledTimes(1));
  expect(await next.loadTrack('A', 73)).toBe(true);
  finish();
  expect(await stale).toBe(false);
  expect(await next.validateSource()).toBe(false); // fake stale engine mutated; real DeckEngine aborts it
});

it('fails closed on readiness IO errors and source identity changes', async () => {
  const e = environment();
  e.fetch.mockImplementation(async () => new Response(JSON.stringify({ ...wire(), identity: { ...identity, operation_sha256: 'other' } })));
  await expect(groupReplaySource('group', 'operation', e.engines)).rejects.toThrow();
  e.fetch.mockRejectedValue(new Error('unavailable'));
  await expect(groupReplaySource('group', 'operation', e.engines)).rejects.toThrow();
});
