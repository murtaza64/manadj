import type { ReactNode } from 'react';
import { useAtCuePoint } from '../../hooks/useAtCuePoint';
import { useBeatgridData } from '../../hooks/useBeatgridData';
import { useDeck, useDeckReady, useDeckSnapshot } from '../../hooks/useDeck';
import {
  beatFlashAnimationDelayMs,
  beatFlashFraction,
  beatFlashPeriodMs,
} from '../../midi/feedback';
import { effectiveBpm } from '../../playback/tempo';

/**
 * PLAY + hold-CUE for the scoped deck — the one transport implementation
 * shared by the library Player and the Performance DeckPanel (deck-controls
 * PRD, playback class). Returns a fragment: callers own the container.
 *
 * - CUE is a hold: pointer capture keeps the release even if the pointer
 *   leaves the button; at-cue/away-from-cue styling comes from a coarse
 *   playhead poll (setState only on flips — steady playback re-renders
 *   nothing).
 * - PLAY latches while loading: the engine stores the intent and starts
 *   when decoding finishes, so the button never disables during a load
 *   (keyboard parity).
 * - Paused transport flashes CDJ-style (four-deck 31, table in
 *   midi/feedback.ts): PLAY pulses whenever a loaded deck is paused; CUE
 *   pulses paused-away-from-cue (even with no cue set — recordable), is
 *   solid at the cue, through a preview, and during playback with a cue
 *   set. Cadence: the deck's effective BPM, phase-locked to its own grid
 *   via inline animation duration/delay (fallback 1 Hz) — the same pure
 *   seam the Controller lamps use, so screen and hardware agree.
 */
export function TransportPair({
  cueKbd,
  playKbd,
  cueTitle = 'Cue',
}: {
  /** On-control keyboard hint slots (Performance view). */
  cueKbd?: ReactNode;
  playKbd?: ReactNode;
  cueTitle?: string;
}) {
  const { engine, loadedTrack } = useDeck();
  const ready = useDeckReady();
  const previewing = useDeckSnapshot((s) => s.previewing);
  const cuePoint = useDeckSnapshot((s) => s.cuePoint);
  const playing = useDeckSnapshot((s) => s.playing);
  const pendingPlay = useDeckSnapshot((s) => s.pendingPlay);
  const bpm = useDeckSnapshot((s) => s.bpm);
  const pitchPercent = useDeckSnapshot((s) => s.pitchPercent);
  // Play can be pressed while loading — the engine latches the intent.
  const canPlay = useDeckSnapshot(
    (s) =>
      s.loadState === 'ready' || s.loadState === 'fetching' || s.loadState === 'decoding'
  );
  const { data: beatgrid } = useBeatgridData(loadedTrack?.id ?? null);

  // At-cue styling: the shared coarse poll (hooks/useAtCuePoint).
  const atCuePoint = useAtCuePoint();

  const loaded = loadedTrack != null;
  const pausedLoaded = !previewing && !playing && loaded;
  const cueFlashing = pausedLoaded && !(cuePoint !== null && atCuePoint);
  const playFlashing = pausedLoaded && !pendingPlay;

  // Grid-phased flash timing (four-deck 31): the CSS animation runs on the
  // deck's beat period, re-anchored so concurrent decks each pulse to their
  // OWN grid — a negative delay of the current beat phase replaces the old
  // fixed 1s epoch trick. Set via ref (commit phase): render stays pure;
  // the inline arrow re-runs every render, so seeks re-anchor the phase.
  const applyFlashTiming = (el: HTMLButtonElement | null, flashing: boolean) => {
    if (!el) return;
    if (!flashing) {
      el.style.animationDuration = '';
      el.style.animationDelay = '';
      return;
    }
    const period = beatFlashPeriodMs(bpm !== null ? effectiveBpm(bpm, pitchPercent) : null);
    const fraction = beatFlashFraction(engine.getPlayhead(), beatgrid?.beat_times ?? null);
    el.style.animationDuration = `${period.toFixed(1)}ms`;
    el.style.animationDelay = `-${beatFlashAnimationDelayMs(performance.now(), period, fraction).toFixed(1)}ms`;
  };

  return (
    <>
      <button
        onPointerDown={(e) => {
          if (!ready) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          engine.cueDown();
        }}
        onPointerUp={() => ready && engine.cueUp()}
        onPointerCancel={() => ready && engine.cueUp()}
        disabled={!ready}
        className={`player-button player-button-cue ${
          previewing
            ? 'player-button-cue-held'
            : playing
            ? cuePoint !== null
              ? 'player-button-cue-at-cue'
              : ''
            : loaded
            ? cuePoint !== null && atCuePoint
              ? 'player-button-cue-at-cue'
              : 'player-button-cue-away-from-cue'
            : ''
        }`}
        ref={(el) => applyFlashTiming(el, cueFlashing)}
        title={cueTitle}
      >
        CUE
        {cueKbd}
      </button>

      <button
        onClick={() => engine.togglePlay()}
        disabled={!canPlay}
        className={`player-button ${
          playing || pendingPlay
            ? 'player-button-playing'
            : playFlashing
            ? 'player-button-paused player-button-play-flash'
            : 'player-button-paused'
        }`}
        ref={(el) => applyFlashTiming(el, playFlashing)}
        title={pendingPlay ? 'Will play when loaded' : playing ? 'Pause' : 'Play'}
      >
        ⏯{playKbd}
      </button>
    </>
  );
}
