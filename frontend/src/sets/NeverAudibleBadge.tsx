/**
 * NEVER AUDIBLE row badge (sets 19): a loud marker for a planned entry
 * that enters at/after its own exit — the track never plays (the planner
 * flags the same case as an `entry-after-exit` error). Replaces the
 * innocuous "plays 0:00" as the row's signal. Lives in its own module so
 * the (lane-contested) SetDetailPane only mounts it.
 */
import type { PlannedEntry } from './planner';
import { fmtSec, isNeverAudible } from './planner';

export function NeverAudibleBadge({ planned }: { planned: PlannedEntry | undefined }) {
  if (!planned || !isNeverAudible(planned)) return null;
  return (
    <span
      title={`planned entry ${fmtSec(planned.entrySec)} is after the exit ${fmtSec(planned.exitSec)} — this track never plays`}
      style={{
        padding: '1px 6px',
        background: 'var(--red)',
        color: 'var(--base)',
        fontSize: '11px',
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      NEVER AUDIBLE
    </span>
  );
}
