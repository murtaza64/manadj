import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  createBpmCommitter,
  growShrinkBpm,
  projectBpm,
  type BpmCommitter,
} from '../components/deckControls/bpmCommit';
import {
  GRID_NUDGE_MS,
  useBeatgridData,
  useNudgeBeatgrid,
  useSetBeatgridDownbeat,
} from './useBeatgridData';
import { shiftBeatgrid } from '../midi/gridChord';
import { useDeck, useDeckReady } from './useDeck';
import type { BeatgridResponse } from '../types';

/**
 * The deck's grid-edit operations for hardware pads (midi-performance-ops
 * 05) — the exact ops the on-screen controls perform, through the same
 * mutations and commit chain, so screen and hardware cannot drift:
 *
 * - nudge step: the ±GRID_NUDGE_MS translate (GridEditButtons), serialized
 *   so rapid taps never interleave their read-modify-write POSTs (the
 *   lesson of mix-editor/24).
 * - anchor: set-downbeat at the playhead (ADR 0016).
 * - grow/shrink and halve/double: BPM edits through the one serialized
 *   BPM committer (bpmCommit.ts) against the PROJECTED BPM, with the same
 *   optimistic base BpmControl keeps so rapid steps accumulate.
 *
 * Gridless Track (no beatgrid data — no BPM, or empty deck): every op
 * no-ops and `hasBeatgrid` is false, the same predicate the pad lamps
 * render. Variable grids: nudge/anchor apply (grid ops), BPM ops no-op
 * (the readout-only rule of the on-screen control; the PATCH would 409).
 */
export interface GridEditActions {
  /** The loaded Track has a Beatgrid — the pad-lamp predicate. */
  hasBeatgrid: boolean;
  /** One discrete ±GRID_NUDGE_MS grid-nudge step, persisting. */
  nudgeStep(direction: 'earlier' | 'later'): void;
  /** Set the grid's downbeat/anchor at the deck's playhead. */
  setDownbeatAtPlayhead(): void;
  /** Grow/Shrink micro-adjust; BPM halve/double (screen-identical rounding). */
  bpm(change: 'grow' | 'shrink' | 'halve' | 'double'): void;
  /** Spin-to-nudge tick apply (midi-performance-ops 06): shift the CACHED
   * grid only — the engine and waveform follow the query cache live; no
   * persistence until the gesture's commit. */
  nudgeLocal(offsetMs: number): void;
  /** Spin-to-nudge release: persist the accumulated net offset in one
   * call, through the same serialized chain as the discrete steps. */
  nudgeCommit(offsetMs: number): void;
}

export function useGridEditActions(): GridEditActions {
  const { engine, loadedTrack } = useDeck();
  const ready = useDeckReady();
  const queryClient = useQueryClient();
  const trackId = loadedTrack?.id ?? null;

  const { data: grid, error: gridError } = useBeatgridData(trackId);
  const hasBeatgrid = trackId !== null && !gridError && grid != null;

  const projection = useMemo(
    () =>
      projectBpm(
        gridError ? null : grid?.data ?? null,
        loadedTrack?.bpm ?? null,
        loadedTrack?.duration_secs ?? null
      ),
    [grid, gridError, loadedTrack?.bpm, loadedTrack?.duration_secs]
  );

  const nudgeGrid = useNudgeBeatgrid();
  const setDownbeat = useSetBeatgridDownbeat();
  /** Serializes nudge POSTs (each is a server-side read-modify-write). */
  const nudgeChain = useRef<Promise<unknown>>(Promise.resolve());

  /** Last committed-but-not-yet-refetched BPM (steps accumulate on it),
   * mirroring BpmControl's optimistic base. */
  const optimistic = useRef<{ trackId: number; bpm: number } | null>(null);
  useEffect(() => {
    optimistic.current = null;
  }, [trackId]);
  useEffect(() => {
    // Server truth arrived and matches what we committed — hand back.
    const current = optimistic.current;
    if (
      current &&
      projection.kind !== 'none' &&
      Math.abs(current.bpm - projection.bpm) < 0.005
    ) {
      optimistic.current = null;
    }
  }, [projection]);

  const latest = useRef({ trackId });
  useEffect(() => {
    latest.current = { trackId };
  });
  const committerRef = useRef<BpmCommitter | null>(null);
  const getCommitter = () => {
    committerRef.current ??= createBpmCommitter({
      save: async (bpm) => {
        const id = latest.current.trackId;
        if (id === null) return;
        await api.tracks.update(id, { bpm });
      },
      onCommitted: () => {
        const id = latest.current.trackId;
        if (id !== null) {
          void queryClient.invalidateQueries({ queryKey: ['beatgrid', id] });
          void queryClient.invalidateQueries({ queryKey: ['track', id] });
        }
      },
      onConflict: () => {
        optimistic.current = null;
      },
    });
    return committerRef.current;
  };

  return {
    hasBeatgrid,
    nudgeStep: (direction) => {
      if (!hasBeatgrid || trackId === null) return;
      const offsetMs = direction === 'earlier' ? -GRID_NUDGE_MS : GRID_NUDGE_MS;
      nudgeChain.current = nudgeChain.current.then(() =>
        nudgeGrid
          .mutateAsync({ trackId, offsetMs })
          .catch((error) => console.error('grid nudge failed:', error))
      );
    },
    setDownbeatAtPlayhead: () => {
      // `ready` gates the playhead read, like the on-screen buttons' gates.
      if (!hasBeatgrid || trackId === null || !ready) return;
      setDownbeat.mutate({ trackId, downbeatTime: engine.getPlayhead() });
    },
    bpm: (change) => {
      if (!hasBeatgrid || trackId === null) return;
      // Variable grids: BPM readout only (the PATCH answers 409); plain/none
      // have no grid to re-tempo through this surface.
      if (projection.kind !== 'grid') return;
      const base =
        optimistic.current?.trackId === trackId ? optimistic.current.bpm : projection.bpm;
      const next =
        change === 'grow' || change === 'shrink'
          ? growShrinkBpm(base, change)
          : // Screen-identical octave semantics (BpmControl's ×1/2 and ×2
            // dropdown options round to whole BPM).
            Math.round(change === 'halve' ? base / 2 : base * 2);
      if (!isFinite(next) || next <= 0) return;
      optimistic.current = { trackId, bpm: next };
      void getCommitter().commit(next);
    },
    nudgeLocal: (offsetMs) => {
      if (!hasBeatgrid || trackId === null) return;
      // Optimistic apply: shift the cached grid; useDeckBeatgridSync and
      // the waveform read this cache, so the tick is audible/visible live.
      queryClient.setQueryData<BeatgridResponse>(['beatgrid', trackId], (old) =>
        old === undefined ? old : shiftBeatgrid(old, offsetMs)
      );
    },
    nudgeCommit: (offsetMs) => {
      if (!hasBeatgrid || trackId === null) return;
      nudgeChain.current = nudgeChain.current.then(() =>
        nudgeGrid
          .mutateAsync({ trackId, offsetMs })
          .catch((error) => console.error('grid nudge commit failed:', error))
      );
    },
  };
}
