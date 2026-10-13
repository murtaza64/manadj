// Ranked Soulseek candidates (gh#342): the server sorts best-pick-first, so
// the first row is the one-click default (★ get); the rest are picks.
import { useState } from 'react';
import type { SoulseekResult } from '../../types';
import { formatDuration, formatSize, remoteBasename } from './format';

// duration deltas beyond this are rendered loudly (wrong recording guard)
const DURATION_DELTA_LOUD_SECS = 3;

export function SoulseekCandidates({
  results,
  limit = 4,
  disabled,
  onPick,
  withDelta = true,
}: {
  results: SoulseekResult[];
  limit?: number;
  disabled: boolean;
  onPick: (r: SoulseekResult) => void;
  // standalone searches have no item duration: no deltas, no alarms
  withDelta?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? results : results.slice(0, limit);
  return (
    <div className="acq-cands">
      <div className="acq-cand acq-cand-head">
        <span />
        <span>fmt</span>
        <span>length</span>
        <span>size</span>
        <span>queue</span>
        <span>peer · file</span>
        <span />
      </div>
      {list.map((r, idx) => {
        const deltaSecs = r.duration_delta_ms != null ? Math.round(r.duration_delta_ms / 1000) : null;
        const loud = withDelta && (deltaSecs === null || Math.abs(deltaSecs) > DURATION_DELTA_LOUD_SECS);
        return (
          <button
            key={r.download_token}
            className={`acq-cand${idx === 0 ? ' acq-cand-top' : ''}`}
            title={`${r.filename}\nclick to download via Soulseek`}
            disabled={disabled}
            onClick={() => onPick(r)}
          >
            <span className="acq-cand-rank">{idx === 0 ? '★' : idx + 1}</span>
            <span className="acq-cand-fmt">
              {r.format || '?'}
              {r.bitrate_kbps ? ` ${r.bitrate_kbps}` : ''}
            </span>
            <span className={loud ? 'acq-loud' : undefined}>
              {r.duration_ms != null ? formatDuration(r.duration_ms) : '?:??'}
              {deltaSecs !== null && deltaSecs !== 0 && (
                <> ({deltaSecs > 0 ? '+' : ''}{deltaSecs}s)</>
              )}
            </span>
            <span>{formatSize(r.size_bytes)}</span>
            <span className={r.has_free_slot ? 'acq-free' : undefined}>
              {r.has_free_slot ? 'free slot' : r.queue_length != null ? `queue ${r.queue_length}` : '?'}
            </span>
            <span className="acq-cand-file">
              {r.username ? `${r.username} · ` : ''}
              {remoteBasename(r.filename)}
            </span>
            <span className="acq-cand-go">{idx === 0 ? 'get' : 'pick'}</span>
          </button>
        );
      })}
      {results.length > limit && (
        <button className="acq-cands-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'fewer' : `+${results.length - limit} more candidates`}
        </button>
      )}
    </div>
  );
}
