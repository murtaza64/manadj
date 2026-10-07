// Inline panels that open under a row in the Acquisition table (gh#342):
// Soulseek search + ranked candidates, match review, and the fulfilled
// item's correspondence/provenance editor. Each is keyed by item id by the
// caller so switching rows never carries state over (gh#215).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { SoulseekResult, SourceItem, Track } from '../../types';
import { SoulseekCandidates } from './SoulseekCandidates';
import { formatDuration, needsTarget, timeAgo } from './format';
import { useInvalidateItems } from './useItems';
import { useSuppliers } from './useSuppliers';

/** Soulseek search with the remembered query, editable; ranked results. */
export function SoulseekPanel({ item, soulseekAvailable }: { item: SourceItem; soulseekAvailable: boolean }) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateItems();
  // null = untouched: show the remembered query, else the Cleanup default
  const [typed, setTyped] = useState<string | null>(null);

  const { data: remembered, isLoading } = useQuery({
    queryKey: ['soulseekSearch', item.id],
    queryFn: () => api.acquisition.soulseekRemembered(item.id),
    enabled: soulseekAvailable,
    // a failed download enqueues an automatic search; poll until it lands
    refetchInterval: q => (q.state.data == null && item.stage === 'failed' ? 10_000 : false),
  });
  const query = typed ?? remembered?.query ?? item.search_query ?? item.title;

  const searchMutation = useMutation({
    mutationFn: () => api.acquisition.soulseekSearch(item.id, query.trim()),
    onSuccess: data => {
      queryClient.setQueryData(['soulseekSearch', item.id], data);
      invalidate();
    },
  });
  const pickMutation = useMutation({
    mutationFn: (r: SoulseekResult) => api.acquisition.soulseekPick(item.id, r),
    onSuccess: invalidate,
  });
  const autoMutation = useMutation({
    mutationFn: () => api.acquisition.soulseekAuto(item.id),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['soulseekSearch', item.id] });
    },
  });
  const retryMutation = useMutation({ mutationFn: () => api.acquisition.queueDownload(item.id), onSuccess: invalidate });
  const ignoreMutation = useMutation({ mutationFn: () => api.acquisition.ignoreItem(item.id), onSuccess: invalidate });

  const err =
    (searchMutation.error as Error | null)?.message ??
    (pickMutation.error as Error | null)?.message ??
    (autoMutation.error as Error | null)?.message ??
    (retryMutation.error as Error | null)?.message ??
    null;
  const results = remembered?.results;
  const { soundcloud: soundcloudAvailable } = useSuppliers();
  const retryable = needsTarget(item) && item.error_kind !== 'drm' && soundcloudAvailable && item.source === 'soundcloud';

  return (
    <div className="acq-inline">
      {item.stage === 'failed' && item.download?.error && (
        <div className="acq-inline-error">
          {item.download.error}
          {item.error_kind === 'drm' && (
            <span className="acq-inline-hint"> — Go+ tracks never download from SoundCloud; get it from Soulseek or ignore.</span>
          )}
        </div>
      )}
      {soulseekAvailable ? (
        <>
          <div className="acq-inline-row">
            <span className="acq-sub">soulseek</span>
            <input
              className="acq-inline-input"
              value={query}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && query.trim()) searchMutation.mutate();
              }}
            />
            <button className="btn btn-mini" disabled={!query.trim() || searchMutation.isPending} onClick={() => searchMutation.mutate()}>
              {searchMutation.isPending ? 'searching…' : 'search'}
            </button>
            {remembered?.searched_at && <span className="acq-sub">searched {timeAgo(remembered.searched_at)}</span>}
            <span className="acq-sub">★ best by duration · quality · availability — one click downloads</span>
            <span className="acq-spacer" />
            <button
              className="btn btn-mini btn-primary"
              disabled={autoMutation.isPending}
              title="hands-off: auto-pick a high-quality mp3 (duration within ±5s, ≥192 kbps) and retry up to 5 peers on failure"
              onClick={() => autoMutation.mutate()}
            >
              {autoMutation.isPending ? 'picking…' : '⚡ auto (walk candidates)'}
            </button>
            {retryable && (
              <button className="btn btn-mini" disabled={retryMutation.isPending} onClick={() => retryMutation.mutate()}>
                ↻ retry soundcloud
              </button>
            )}
            {(item.stage === 'new' || needsTarget(item)) && (
              <button className="btn btn-mini btn-danger" disabled={ignoreMutation.isPending} onClick={() => ignoreMutation.mutate()}>
                ignore
              </button>
            )}
          </div>
          {err && <div className="acq-inline-error">{err}</div>}
          {isLoading && <div className="acq-sub">loading remembered search…</div>}
          {!isLoading && remembered == null && !searchMutation.isPending && (
            <div className="acq-sub">
              {item.stage === 'failed' ? 'searching Soulseek automatically… (or search now)' : 'not searched yet — press search'}
            </div>
          )}
          {results && results.length === 0 && <div className="acq-sub">no peers offered a match — edit the query and search again</div>}
          {results && results.length > 0 && (
            <SoulseekCandidates results={results} disabled={pickMutation.isPending} onPick={r => pickMutation.mutate(r)} />
          )}
        </>
      ) : (
        <div className="acq-inline-row">
          <span className="acq-sub">Soulseek isn't set up — Settings → Accounts → Soulseek.</span>
          <span className="acq-spacer" />
          {retryable && (
            <button className="btn btn-mini" onClick={() => retryMutation.mutate()}>↻ retry soundcloud</button>
          )}
          <button className="btn btn-mini btn-danger" onClick={() => ignoreMutation.mutate()}>ignore</button>
        </div>
      )}
      <ManualLink item={item} />
    </div>
  );
}

/** Proposed correspondence: side-by-side compare, accept / reject / get anyway. */
export function MatchPanel({ item }: { item: SourceItem }) {
  const invalidate = useInvalidateItems();
  const { soundcloud: soundcloudAvailable, soulseek: soulseekAvailable } = useSuppliers();
  const corr = item.correspondence;
  const accept = useMutation({ mutationFn: () => api.acquisition.acceptMatch(item.id), onSuccess: invalidate });
  const reject = useMutation({ mutationFn: () => api.acquisition.rejectMatch(item.id), onSuccess: invalidate });
  const getAnyway = useMutation({
    mutationFn: async () => {
      await api.acquisition.rejectMatch(item.id);
      await api.acquisition.queueDownload(item.id);
    },
    onSuccess: invalidate,
  });
  const autoAnyway = useMutation({
    mutationFn: async () => {
      await api.acquisition.rejectMatch(item.id);
      await api.acquisition.soulseekAuto(item.id);
    },
    onSuccess: invalidate,
  });
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
        {soundcloudAvailable && item.source === 'soundcloud' ? (
          <button className="btn btn-mini btn-primary" disabled={getAnyway.isPending} onClick={() => getAnyway.mutate()}>⇣ get anyway</button>
        ) : soulseekAvailable ? (
          <button className="btn btn-mini btn-primary" disabled={autoAnyway.isPending} onClick={() => autoAnyway.mutate()}>⚡ soulseek anyway</button>
        ) : null}
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
