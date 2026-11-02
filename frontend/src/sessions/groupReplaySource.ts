import { API_BASE } from '../api/client';
import type { CaptureDeck, CaptureEvent } from '../capture/events';
import type { DeckEngine } from '../playback/DeckEngine';

export interface GroupReplayIdentity {
  group_id: string; operation_id: string; operation_sha256: string; session_uuid: string;
  origin_device_id: string; receiver_device_id: string;
}
interface ExactAsset { algorithm: 'sha256-file-bytes-v1'; sha256: string; byte_length: number }
export interface GroupReceiverSelection {
  format: 'manadj-group-receiver-selection/v1'; selection_id: string;
  receiver_key: string; incarnation: string; label: string; asset: ExactAsset;
}
export interface GroupReplayBinding {
  logical_track_id: string; selection_id: string; receiver_key: string; incarnation: string; asset: ExactAsset;
}
export interface GroupReplayReadiness {
  format: 'manadj-group-replay-readiness/v1'; identity: GroupReplayIdentity;
  grammar: 'capture-group-basic-replay/v1'; state: string; generation: string | null;
  bindings: GroupReplayBinding[]; reason: string | null; playable: false;
}
interface GroupReplayWire {
  format: 'manadj-group-replay-source/v1'; identity: GroupReplayIdentity;
  grammar: 'capture-group-basic-replay/v1'; generation: string; bindings: GroupReplayBinding[];
  events: CaptureEvent[]; playable: false;
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}/peer-sync/group-replay/${path}`, {
    cache: 'no-store', ...(body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  });
  if (!response.ok) throw new Error(`Group replay refused (${response.status})`);
  return response.json();
}
const scope = (group: string, operation: string) => `${encodeURIComponent(group)}/${encodeURIComponent(operation)}`;
export const groupReplayApi = {
  readiness: (group: string, operation: string) => request<GroupReplayReadiness>(`${scope(group, operation)}/readiness`),
  select: (trackId: number) => request<GroupReceiverSelection>(`selections/${trackId}`, {}),
  bind: (group: string, operation: string, logical: string, selection: GroupReceiverSelection) =>
    request<GroupReplayReadiness>(`${scope(group, operation)}/bindings`, {
      logical_track_id: logical, selection_id: selection.selection_id, incarnation: selection.incarnation,
    }),
};

const identityKey = (identity: GroupReplayIdentity) => [identity.group_id, identity.operation_id, identity.operation_sha256,
  identity.session_uuid, identity.origin_device_id, identity.receiver_device_id].join(':');
const engineAttempts = new WeakMap<DeckEngine, symbol>();

/** Explicit GROUP source only. No generic Session/raw-ID/cache fallback. */
export async function groupReplaySource(group: string, operation: string, engines: Record<CaptureDeck, DeckEngine>) {
  const candidate = await groupReplayApi.readiness(group, operation);
  if (candidate.state !== 'candidate-exact' || !candidate.generation || candidate.playable !== false
      || candidate.grammar !== 'capture-group-basic-replay/v1'
      || candidate.identity.group_id !== group || candidate.identity.operation_id !== operation) {
    throw new Error('Group replay needs current exact local selections');
  }
  const generation = candidate.generation;
  const path = scope(group, operation);
  const wire = await request<GroupReplayWire>(`${path}/source?generation=${encodeURIComponent(generation)}`);
  if (wire.format !== 'manadj-group-replay-source/v1' || wire.generation !== generation
      || identityKey(wire.identity) !== identityKey(candidate.identity) || wire.grammar !== candidate.grammar
      || wire.playable !== false || JSON.stringify(wire.bindings) !== JSON.stringify(candidate.bindings)) {
    throw new Error('Group source changed');
  }
  if (new Set(wire.bindings.map(binding => binding.receiver_key)).size !== wire.bindings.length) {
    throw new Error('Group source has ambiguous receiver bindings');
  }
  const loaded: Partial<Record<CaptureDeck, string>> = {};
  const attempts: Partial<Record<CaptureDeck, symbol>> = {};
  const validateSource = async () => {
    try {
      const current = await groupReplayApi.readiness(group, operation);
      return current.state === 'candidate-exact' && current.generation === generation && current.playable === false
        && current.grammar === candidate.grammar && identityKey(current.identity) === identityKey(candidate.identity)
        && Object.entries(loaded).every(([deck, key]) => {
          const snapshot = engines[deck as CaptureDeck].getSnapshot();
          return snapshot.loadState === 'ready' && snapshot.audioSourceKey === key;
        });
    } catch { return false; }
  };
  if (!await validateSource()) throw new Error('Group source changed during open');
  const loadTrack = async (deck: CaptureDeck, trackId: number) => {
    const binding = wire.bindings.find(binding => binding.receiver_key === String(trackId));
    const attempt = Symbol();
    attempts[deck] = attempt;
    engineAttempts.set(engines[deck], attempt);
    if (!binding || !await validateSource() || engineAttempts.get(engines[deck]) !== attempt) return false;
    delete loaded[deck];
    const audioSourceKey = `GROUP:${identityKey(wire.identity)}:${generation}:${binding.selection_id}:${crypto.randomUUID()}`;
    try {
      const event = wire.events.find(event => event.kind === 'load' && event.trackId === trackId);
      await engines[deck].load({ trackId, bpm: event?.kind === 'load' ? event.bpm : null,
        bypassCache: true, audioSourceKey,
        audioUrl: `${API_BASE}/peer-sync/group-replay/${path}/audio/${binding.logical_track_id}?generation=${encodeURIComponent(generation)}` });
      const snapshot = engines[deck].getSnapshot();
      if (engineAttempts.get(engines[deck]) !== attempt || snapshot.loadState !== 'ready' || snapshot.audioSourceKey !== audioSourceKey) return false;
      loaded[deck] = audioSourceKey;
      return await validateSource() && attempts[deck] === attempt && engineAttempts.get(engines[deck]) === attempt;
    } catch { return false; }
  };
  return { events: wire.events, identity: wire.identity, generation, loadTrack, validateSource };
}
