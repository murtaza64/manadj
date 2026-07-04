import {
  GRID_NUDGE_MS,
  useNudgeBeatgrid,
  useSetBeatgridDownbeat,
} from '../../hooks/useBeatgridData';
import { GridNudgeLeftIcon, GridNudgeRightIcon } from '../icons/GridIcons';
import { AnchorIcon } from '../icons/AnchorIcon';
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

  const gated = disabled || trackId === null;
  const title = (active: string) => (gated && disabledTitle ? disabledTitle : active);

  const nudge = (offsetMs: number) => {
    if (trackId === null) return;
    nudgeGrid.mutate({ trackId, offsetMs });
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
        disabled={gated || nudgeGrid.isPending}
        onClick={() => nudge(GRID_NUDGE_MS)}
        title={title(`Nudge grid ${GRID_NUDGE_MS}ms later`)}
      >
        <GridNudgeRightIcon />
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
