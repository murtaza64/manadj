/**
 * Play guide wiring (play-guides PRD): subscribes the pure model to the
 * live surfaces. A rAF loop reads the pair store snapshot and both Deck
 * engines each frame, recomputes the guides, and publishes a new frame to
 * React ONLY when the derived content actually changes (signature-gated —
 * a playing Deck moves every frame, but the guides' content doesn't).
 *
 * Per-frame x-positioning of the spanning line does NOT go through React;
 * PlayGuideOverlay owns that imperatively. This hook is for the list.
 */
import { useEffect, useState } from 'react';
import { useDecks } from '../hooks/useDeck';
import { initTransitionStore, snapshotPairStore } from '../editor/pairStore';
import { computePlayGuides } from './playGuideModel';
import type { GuideDeck, PlayGuideFrame } from './playGuideModel';
import type { DeckEngine } from '../playback/DeckEngine';

function guideDeck(engine: DeckEngine): GuideDeck {
  const s = engine.getSnapshot();
  return {
    // "Loaded" means playable: a still-decoding Deck has no honest cued
    // position (playhead 0 would project a lie), so it doesn't count.
    trackId: s.loadState === 'ready' ? s.trackId : null,
    // Anything that runs (or is about to run / auditions) the deck counts
    // as playing — the transport's own notion plus pendingPlay (story 20:
    // guides vanish the moment the incoming Deck starts). A held cue/hot-cue
    // preview moves the playhead, so there is no stable cued position to
    // project from; guides return at the release, cued afresh (story 23).
    playing: s.playing || s.pendingPlay || s.previewing || s.hotCuePreviewSlot !== null,
    playhead: engine.getPlayhead(),
    bpm: s.bpm,
    pitchPercent: s.pitchPercent,
  };
}

const EMPTY_FRAMES: PlayGuideFrame[] = [];

function signature(frames: PlayGuideFrame[]): string {
  return frames
    .map(
      (frame) =>
        frame.outgoing +
        '|' +
        frame.guides
          .map(
            (g) =>
              `${g.uuid}:${g.name}:${g.favorite}:${g.missed}:` +
              `${g.requiredPitchPercent?.toFixed(1) ?? ''}:${g.aTime.toFixed(2)}`
          )
          .join('|')
    )
    .join('||');
}

/** The current Play guide frames (per direction), updated on content change. */
export function usePlayGuides(): PlayGuideFrame[] {
  const { A, B } = useDecks();
  const engineA = A.engine;
  const engineB = B.engine;
  const [frames, setFrames] = useState<PlayGuideFrame[]>(EMPTY_FRAMES);

  useEffect(() => {
    void initTransitionStore();
    let raf = 0;
    let lastSig = '';
    const tick = () => {
      const next = computePlayGuides(snapshotPairStore(), {
        A: guideDeck(engineA),
        B: guideDeck(engineB),
      });
      const sig = signature(next);
      if (sig !== lastSig) {
        lastSig = sig;
        setFrames(next.length === 0 ? EMPTY_FRAMES : next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engineA, engineB]);

  return frames;
}
