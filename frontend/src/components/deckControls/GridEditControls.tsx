import {
  GRID_NUDGE_MS,
  useBeatgridData,
  useDropAnchor,
  useNudgeBeatgrid,
  useSetBeatgridDownbeat,
} from '../../hooks/useBeatgridData';
import { useMetricLadderData, usePutMetricLadder } from '../../hooks/useMetricLadderData';
import { nearestDownbeatOrdinal, nearestMark } from '../../meter/ladder';
import { GridNudgeLeftIcon, GridNudgeRightIcon } from '../icons/GridIcons';
import { AnchorIcon } from '../icons/AnchorIcon';
import { DropAnchorIcon, ResetMarkDeleteIcon, ResetMarkIcon } from '../icons/MeterIcons';
import './deckControls.css';

/**
 * Grid-edit buttons (deck-controls PRD, curation class): nudge earlier /
 * set downbeat / nudge later — ONE implementation for every mode. They
 * render as a fragment INSIDE the BpmControl's segmented cluster: BPM and
 * beatgrid are one domain (ADR 0016 — BPM is a projection of the grid),
 * so they share one semantic unit under the tempo icon.
 *
 * Injected per mode:
 * - `getPlayhead`: where "downbeat at playhead" reads time from
 *   (DeckEngine playhead vs MixPlayer track time).
 * - `disabled`: each mode's own gate (library's isBeatgridEditable rule,
 *   PERF's ready check, the editor's track-loaded rule).
 *
 * Set-downbeat records the grid's anchor (ADR 0016) — hence the anchor
 * icon; nudges shift the anchor along with everything.
 */
export function GridEditButtons({
  trackId,
  getPlayhead,
  disabled = false,
  disabledTitle,
}: {
  trackId: number | null;
  /** Playhead source for "set downbeat at playhead". */
  getPlayhead: () => number;
  /** The mode's editability gate (e.g. library's isBeatgridEditable). */
  disabled?: boolean;
  /** Mode-specific tooltip while gated (e.g. "Load this track…"). */
  disabledTitle?: string;
}) {
  const nudgeGrid = useNudgeBeatgrid();
  const setDownbeat = useSetBeatgridDownbeat();
  const dropAnchor = useDropAnchor();
  const { data: beatgrid } = useBeatgridData(trackId);
  const { data: ladder } = useMetricLadderData(trackId);
  const putLadder = usePutMetricLadder();

  const gated = disabled || trackId === null;
  const title = (active: string) => (gated && disabledTitle ? disabledTitle : active);

  const nudge = (offsetMs: number) => {
    if (trackId === null) return;
    nudgeGrid.mutate({ trackId, offsetMs });
  };

  // Reset-mark gestures (metric-ladder 02): ear-first — play into the
  // moment, tap on the downbeat you hear the count restart. Each gesture
  // is one full-state PUT; the inverse gesture is its undo.
  const downbeats = beatgrid?.data.downbeat_times ?? [];
  const marks = ladder?.reset_marks ?? [];

  const markReset = () => {
    if (trackId === null || downbeats.length === 0) return;
    const snapped = downbeats[nearestDownbeatOrdinal(downbeats, getPlayhead())];
    putLadder.mutate({ trackId, resetMarks: [...marks, snapped] });
  };

  const deleteNearestMark = () => {
    if (trackId === null) return;
    const nearest = nearestMark(marks, getPlayhead());
    if (nearest === null) return;
    putLadder.mutate({ trackId, resetMarks: marks.filter((m) => m !== nearest) });
  };

  return (
    <>
      <button
        className="player-button"
        disabled={gated || nudgeGrid.isPending}
        onClick={() => nudge(-GRID_NUDGE_MS)}
        title={title(`Nudge grid ${GRID_NUDGE_MS}ms earlier`)}
      >
        <GridNudgeLeftIcon />
      </button>
      <button
        className="player-button deck-downbeat"
        disabled={gated || setDownbeat.isPending}
        onClick={() => {
          if (trackId === null) return;
          setDownbeat.mutate({ trackId, downbeatTime: getPlayhead() });
        }}
        title={title('Set downbeat at playhead (anchors the grid)')}
      >
        <AnchorIcon />
      </button>
      <button
        className="player-button"
        disabled={gated || dropAnchor.isPending}
        onClick={() => {
          if (trackId === null) return;
          dropAnchor.mutate({ trackId, dropTime: getPlayhead() });
        }}
        title={title('Anchor drop at playhead (grid, ladder, and cue ladder)')}
      >
        <DropAnchorIcon />
      </button>
      <button
        className="player-button"
        disabled={gated || nudgeGrid.isPending}
        onClick={() => nudge(GRID_NUDGE_MS)}
        title={title(`Nudge grid ${GRID_NUDGE_MS}ms later`)}
      >
        <GridNudgeRightIcon />
      </button>
      <button
        className="player-button"
        disabled={gated || downbeats.length === 0 || putLadder.isPending}
        onClick={markReset}
        title={title(
          downbeats.length === 0 && !gated
            ? 'No beatgrid — the Metric ladder is undefined'
            : 'Mark phrase reset at playhead (count restarts here)'
        )}
      >
        <ResetMarkIcon />
      </button>
      <button
        className="player-button"
        disabled={gated || marks.length === 0 || putLadder.isPending}
        onClick={deleteNearestMark}
        title={title(
          marks.length === 0 && !gated
            ? 'No reset marks on this track'
            : 'Delete the reset mark nearest the playhead'
        )}
      >
        <ResetMarkDeleteIcon />
      </button>
    </>
  );
}

/** Grid config the BpmControl threads through to its embedded buttons. */
export interface GridEditConfig {
  getPlayhead: () => number;
  disabled?: boolean;
  disabledTitle?: string;
}
