// Inline panels that open under a row in the Acquisition table (gh#342):
// match review and the fulfilled item's correspondence/provenance editor.
// Each is keyed by item id by the caller so switching rows never carries
// state over (gh#215).
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { SourceItem, Track } from '../../types';
import { formatDuration } from './format';
import { useInvalidateItems } from './useItems';

/** Proposed correspondence: side-by-side compare, accept / reject. */
export function MatchPanel({ item }: { item: SourceItem }) {
  const invalidate = useInvalidateItems();
  const corr = item.correspondence;
  const accept = useMutation({ mutationFn: () => api.acquisition.acceptMatch(item.id), onSuccess: invalidate });
  const reject = useMutation({ mutationFn: () => api.acquisition.rejectMatch(item.id), onSuccess: invalidate });
  if (!corr || corr.status !== 'proposed') return null;
  return (
    <div className="acq-inline">
      <div className="acq-inline-row">
        <span className="acq-sub">already in library?</span>
        <span className="acq-inline-cmp">
          {item.uploader} - {item.title} <span className="acq-sub">{formatDuration(item.duration_ms)}</span>
        </span>
        <span className="acq-sub">≈</span>
        <span className="acq-inline-cmp">
          {corr.track_artist} - {corr.track_title}{' '}
          <span className="acq-sub">
            {corr.track_duration_secs != null ? formatDuration(corr.track_duration_secs * 1000) : '?:??'} · {Math.round((corr.score ?? 0) * 100)}%
          </span>
        </span>
        <span className="acq-spacer" />
        <button className="btn btn-mini btn-success" disabled={accept.isPending} onClick={() => accept.mutate()}>✓ same track</button>
        <button className="btn btn-mini" disabled={reject.isPending} onClick={() => reject.mutate()}>✕ different</button>
        {item.beatport_url && (
          <a className="btn btn-mini btn-primary" href={item.beatport_url} target="_blank" rel="noreferrer" title="search Beatport for a legitimate copy">
            find on Beatport ↗
          </a>
        )}
      </div>
      <ManualLink item={item} label="or link a different library track" />
    </div>
  );
}

/** Fulfilled item: what it corresponds to, where the audio came from. */
export function FulfilledPanel({ item }: { item: SourceItem }) {
  const corr = item.correspondence;
  const prov = item.provenance;
  return (
    <div className="acq-inline">
      <div className="acq-inline-row">
        <span className="acq-sub">corresponds to</span>
        <span className="acq-inline-cmp">
          {corr?.track_artist} - {corr?.track_title}
          {corr?.track_duration_secs != null && <span className="acq-sub"> {formatDuration(corr.track_duration_secs * 1000)}</span>}
        </span>
        {prov && (
          <span className="acq-sub">
            audio {prov.asserted ? `via ${prov.label}` : `downloaded by manadj (${prov.label})`}
            {prov.acquired_at && ` · ${new Date(prov.acquired_at).toLocaleDateString('sv')}`}
            {prov.url && (
              <>
                {' '}
                <a href={prov.url} target="_blank" rel="noreferrer">link</a>
              </>
            )}
          </span>
        )}
        <a className="acq-sub" href={item.permalink_url} target="_blank" rel="noreferrer">soundcloud ↗</a>
      </div>
      {(!prov || prov.asserted) && <ProvenanceEditor item={item} />}
    </div>
  );
}

function ProvenanceEditor({ item }: { item: SourceItem }) {
  const invalidate = useInvalidateItems();
  const [audioFrom, setAudioFrom] = useState(item.provenance?.url ?? item.provenance?.label ?? '');
  const mutation = useMutation({
    mutationFn: () => api.acquisition.setProvenance(item.id, audioFrom.trim()),
    onSuccess: invalidate,
  });
  return (
    <div className="acq-inline-row">
      <span className="acq-sub">audio from</span>
      <input
        className="acq-inline-input"
        placeholder="paste a URL, or a label like cd-rip…"
        value={audioFrom}
        onChange={e => setAudioFrom(e.target.value)}
      />
      <button className="btn btn-mini" disabled={!audioFrom.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
        {item.provenance ? 'update' : 'set'}
      </button>
      {mutation.isError && <span className="acq-inline-error">{(mutation.error as Error).message}</span>}
    </div>
  );
}

/** Link to an existing library track by search (the escape hatch). */
function ManualLink({ item, label = 'or link a library track' }: { item: SourceItem; label?: string }) {
  const invalidate = useInvalidateItems();
  const [linkSearch, setLinkSearch] = useState('');
  const [audioFrom, setAudioFrom] = useState('');
  const { data } = useQuery({
    queryKey: ['acquisitionLinkSearch', linkSearch],
    queryFn: () => api.tracks.list(1, 20, { search: linkSearch }),
    enabled: linkSearch.length >= 2,
  });
  const link = useMutation({
    mutationFn: (trackId: number) => api.acquisition.linkToTrack(item.id, trackId, audioFrom.trim() || undefined),
    onSuccess: () => {
      setLinkSearch('');
      setAudioFrom('');
      invalidate();
    },
  });
  return (
    <div className="acq-inline-link">
      <div className="acq-inline-row">
        <span className="acq-sub">{label}</span>
        <input
          className="acq-inline-input"
          placeholder="search library by title, artist, filename…"
          value={linkSearch}
          onChange={e => setLinkSearch(e.target.value)}
        />
        {linkSearch.length >= 2 && (
          <input
            className="acq-inline-input"
            placeholder="audio from (optional)"
            title="Asserts Audio Provenance: where this Track's audio actually came from"
            value={audioFrom}
            onChange={e => setAudioFrom(e.target.value)}
          />
        )}
      </div>
      {(data?.items ?? []).slice(0, 6).map((track: Track) => (
        <button key={track.id} className="acq-link-result" disabled={link.isPending} onClick={() => link.mutate(track.id)}>
          {track.artist ?? '?'} - {track.title ?? track.filename}
          {track.duration_secs != null && <span className="acq-sub"> · {formatDuration(track.duration_secs * 1000)}</span>}
        </button>
      ))}
      {linkSearch.length >= 2 && data && data.items.length === 0 && <div className="acq-sub">no library tracks match</div>}
    </div>
  );
}