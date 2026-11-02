import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GroupSessionView } from '../api/client';
import { useDecks } from '../hooks/useDeck';
import { useMixer } from '../hooks/useMixer';
import { groupReplayApi, groupReplaySource } from './groupReplaySource';
import { planReplay } from './replayPlanner';
import { replayState, seekReplay, startReplay, stopReplay, subscribeReplay, toggleReplayPause } from './replayStore';

/** Explicit local-owner actions. Received source IDs never preselect a Track. */
export function GroupReplayControls({ view }: { view: GroupSessionView }) {
  const decks = useDecks();
  const mixer = useMixer();
  const replay = useSyncExternalStore(subscribeReplay, replayState);
  const active = replay.sessionUuid === view.session_uuid && replay.status !== 'idle';
  const [localIds, setLocalIds] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState('0');
  const [source, setSource] = useState<Awaited<ReturnType<typeof groupReplaySource>> | null>(null);
  const readiness = useQuery({ queryKey: ['group-replay', view.group_id, view.operation_id],
    queryFn: () => groupReplayApi.readiness(view.group_id, view.operation_id), refetchInterval: 5000, retry: false });
  useEffect(() => {
    if (active && source && (readiness.error || readiness.data?.generation !== source.generation)) {
      stopReplay();
    }
  }, [active, source, readiness.data, readiness.error]);
  const bind = async (logical: string) => {
    setBusy(true); setError(null);
    try {
      const id = Number(localIds[logical]);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Choose a current local Track ID');
      const selection = await groupReplayApi.select(id);
      await groupReplayApi.bind(view.group_id, view.operation_id, logical, selection);
      await readiness.refetch();
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const play = async () => {
    setBusy(true); setError(null);
    try {
      if (!Number.isFinite(Number(offset)) || Number(offset) < 0) throw new Error('Choose a nonnegative replay offset');
      const engines = { A: decks.A.engine, B: decks.B.engine, C: decks.C.engine, D: decks.D.engine };
      const next = await groupReplaySource(view.group_id, view.operation_id, engines);
      const plan = planReplay(next.events, Number(offset));
      if (!plan.ok) throw new Error('No supported replay at this offset');
      setSource(next);
      await startReplay(view.session_uuid, plan.plan, { mixer, engines }, next.loadTrack,
        reason => { if (reason === 'load-failed') setError('Replay refused: audio decode or current source check failed'); }, next.validateSource);
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const seek = async () => {
    setBusy(true);
    try {
      if (!Number.isFinite(Number(offset)) || Number(offset) < 0) { setError('Choose a nonnegative replay offset'); return; }
      if (!source || !await source.validateSource()) { stopReplay(); setError('Replay source changed'); return; }
      const plan = planReplay(source.events, Number(offset));
      if (plan.ok) await seekReplay(plan.plan);
    } finally { setBusy(false); }
  };
  return <section aria-label="Exact local group replay">
    <h3>Local replay</h3>
    <p role="status">{readiness.data?.state ?? 'Checking local assets'} · Engine decode required before playback</p>
    {(error || readiness.error) && <p role="alert">{String(error ?? readiness.error)}</p>}
    {view.tracks.map((track, index) => <div key={track.logical_track_id}>
      <label>Track {index + 1} local library ID <input type="number" min="1" value={localIds[track.logical_track_id] ?? ''}
        onChange={event => setLocalIds(ids => ({ ...ids, [track.logical_track_id]: event.target.value }))} /></label>
      <button className="btn btn-secondary" disabled={busy || active} onClick={() => void bind(track.logical_track_id)}>Select and bind exact local audio</button>
    </div>)}
    <label>Replay offset (seconds) <input type="number" min="0" step="0.25" value={offset} onChange={event => setOffset(event.target.value)} /></label>
    <button className="btn btn-primary" disabled={busy || active || readiness.data?.state !== 'candidate-exact'} onClick={() => void play()}>Replay local audio</button>
    {active && <>
      <span role="status">{replay.status}</span>
      <button className="btn btn-secondary" disabled={busy || replay.status === 'loading'} onClick={toggleReplayPause}>{replay.status === 'paused' ? 'Resume' : 'Pause'}</button>
      <button className="btn btn-secondary" disabled={busy || replay.status === 'loading'} onClick={() => void seek()}>Seek</button>
      <button className="btn btn-secondary" onClick={stopReplay}>Stop</button>
    </>}
  </section>;
}
