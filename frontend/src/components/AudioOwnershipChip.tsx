/**
 * TopBar audio-ownership chip (sets 40): one persistent chip in the
 * global chrome answering "who owns the decks right now — and what will
 * my next transport gesture drive".
 *
 * Three faces (grilled 2026-07-06), face selection in ownershipChip.ts:
 * SET (▶/⏸ + name — a paused Conductor still holds the claim, ADR 0024),
 * AUDITION (editor holds), muted DECKS (shared default). Always mounted:
 * the muted→colored flip IS the takeover/stand-down signal.
 *
 * Navigate-only: click SET → the conducting set in the browse view;
 * click AUDITION → the editor. Never a transport control (settled — a
 * global pause in chrome re-scatters the transport 34 just gathered).
 */
import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { audibleHolder, subscribeAudible } from '../playback/audibleSurface';
import { useConductorState } from '../sets/conductorStore';
import { useSelectedSetId } from '../sets/setStore';
import { requestSetNavigate } from '../sets/navigateToSet';
import { requestSessionMoment } from '../sessions/openSession';
import { replayNowT, replayState } from '../sessions/replayStore';
import { chipTooltip, resolveChipFace } from './ownershipChip';
import type { AppMode } from './TopBar';

export function AudioOwnershipChip({
  mode,
  onModeChange,
}: {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
}) {
  const holder = useSyncExternalStore(subscribeAudible, audibleHolder);
  const conductor = useConductorState();
  const selectedSetId = useSelectedSetId();
  // Deliberately the same query key as the sidebar/plan feed — one cache.
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: api.sets.list });

  const face = resolveChipFace(holder, conductor);
  const set = face.kind === 'set' ? sets.find((s) => s.id === face.setId) : undefined;
  const tooltip = chipTooltip(face, {
    setName: set?.name ?? null,
    editorMounted: mode === 'transition',
    setSelected: selectedSetId !== null,
  });

  const onClick = () => {
    if (face.kind === 'set') {
      requestSetNavigate(face.setId);
      onModeChange('library');
    } else if (face.kind === 'audition') {
      onModeChange('transition');
    } else if (face.kind === 'replay') {
      // Jump INTO the replay (sessions 16): the replayed Session's
      // timeline, centered on the live playhead, at most 15 minutes
      // visible — in the PERFORMANCE view, whose embedded browse consumes
      // the same session request (replay is a decks activity; the decks
      // stay on screen). onModeChange runs after the event dispatch, so
      // it overrides App's library default for history jumps.
      const uuid = replayState().sessionUuid;
      if (uuid !== null) {
        requestSessionMoment({ sessionUuid: uuid, atS: replayNowT(), spanS: 900 });
      }
      onModeChange('performance');
    }
    // DECKS: nothing to navigate to — the chip never touches audio.
  };

  return (
    <button
      className={`topbar-ownership ${
        face.kind === 'set' ? (face.playing ? 'set-playing' : 'set-paused') : face.kind
      }`}
      title={tooltip}
      onClick={onClick}
      disabled={face.kind === 'decks'}
      style={set?.color ? { borderLeft: `3px solid ${set.color}` } : undefined}
    >
      {face.kind === 'set' ? (
        <>
          <span className="topbar-ownership-icon">{face.playing ? '▶' : '⏸'}</span>
          <span className="topbar-ownership-kind">SET</span>
          <span className="topbar-ownership-name">{set?.name ?? `#${face.setId}`}</span>
        </>
      ) : face.kind === 'audition' ? (
        <span className="topbar-ownership-kind">AUDITION</span>
      ) : face.kind === 'replay' ? (
        <span className="topbar-ownership-kind">REPLAY</span>
      ) : (
        <span className="topbar-ownership-kind">DECKS</span>
      )}
    </button>
  );
}
