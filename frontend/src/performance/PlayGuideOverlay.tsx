/**
 * Play guide rendering (play-guides PRD): one vertical line per guide
 * spanning BOTH stacked Performance waveforms, with the label chip in the
 * gutter between them. Derived and view-only — never stored, never
 * clickable (pointer-events: none throughout).
 *
 * Geometry: both rows pin their playhead at the same screen fraction and
 * share one wall-clock zoom, so a guide is ONE screen x across the pair
 * (guideScreenFraction). The x moves every frame with the playing Deck, so
 * positioning is imperative (rAF + transform on refs) — React renders only
 * when the guide LIST changes (usePlayGuides' signature gate).
 *
 * Identity colors only (glossary: Deck color): the line and chip carry the
 * PAUSED Deck's color — the guide is about the other Deck ("press play on
 * B here"). State colors never appear. A missed guide stays visible,
 * dimmed, scrolling away behind the playhead.
 */
import { useEffect, useRef } from 'react';
import { useDecks } from '../hooks/useDeck';
import { useViewActive } from '../contexts/viewActive';
import { usePlayGuides } from './usePlayGuides';
import { guideScreenFraction } from './playGuideModel';
import { composeRate } from '../playback/tempo';
import { trackWindowSeconds } from '../utils/waveformZoom';
import {
  waveformRowCenterPercent,
  waveformRowTopPercent,
} from '../components/performance/waveformOrder';
import './PlayGuideOverlay.css';

/** Where the deck waveforms pin the playhead (DeckWaveform's renderer
 * config — playMarkerPosition). */
export const PLAY_MARKER_FRACTION = 0.25;

/** Hide a guide once it leaves the canvas (small slack so the line exits
 * cleanly instead of popping at the edge). */
const VISIBLE_SLACK = 0.02;

/** Idle-poll cadence when no outgoing deck advances (performance-hardening
 * 01) — the shared motion-clock idiom (usePlayGuides, DawTimeline). */
const IDLE_TICK_MS = 250;

function formatPitch(percent: number): string {
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

export function PlayGuideOverlay({ visibleSeconds }: { visibleSeconds: number }) {
  const { A, B, C, D } = useDecks();
  const frames = usePlayGuides();
  const viewActive = useViewActive();

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  // The rAF reads these without re-subscribing.
  const framesRef = useRef(frames);
  const visibleRef = useRef(visibleSeconds);
  useEffect(() => {
    framesRef.current = frames;
    visibleRef.current = visibleSeconds;
  });

  const engineA = A.engine;
  const engineB = B.engine;
  const engineC = C.engine;
  const engineD = D.engine;
  // Idle-gated positioning loop (performance-hardening 01): schedules
  // NOTHING with zero guides or a hidden view (the effect gates on both, so
  // frames arriving / re-activation restart it and paint immediately); with
  // guides up it runs rAF only while an outgoing Deck advances or the
  // computed positions changed (paused seek/zoom), else a 250ms idle poll.
  // Depending on `frames` (identity changes only on content change — the
  // signature gate) restarts the loop when the guide LIST changes, so a new
  // guide is positioned on its first painted frame, not an idle poll later.
  useEffect(() => {
    if (frames.length === 0 || !viewActive) return;
    let raf = 0;
    let idleTimer = 0;
    let lastKey = '';
    const schedule = (active: boolean) => {
      if (active) raf = requestAnimationFrame(tick);
      else idleTimer = window.setTimeout(tick, IDLE_TICK_MS);
    };
    const tick = () => {
      const container = containerRef.current;
      if (!container) {
        schedule(false);
        return;
      }
      const width = container.clientWidth;
      let anyAdvancing = false;
      let key = `${width}:${visibleRef.current}`;
      // Each direction projects on ITS outgoing Deck's timeline (both-paused
      // shows two directions at once — issue 01).
      for (const frame of framesRef.current) {
        const engine =
          frame.outgoing === 'A'
            ? engineA
            : frame.outgoing === 'B'
              ? engineB
              : frame.outgoing === 'C'
                ? engineC
                : engineD;
        const snapshot = engine.getSnapshot();
        // Same "advancing" set as usePlayGuides — anything that moves the
        // outgoing playhead keeps the loop at 60fps.
        anyAdvancing ||=
          snapshot.playing ||
          snapshot.pendingPlay ||
          snapshot.previewing ||
          snapshot.hotCuePreviewSlot !== null;
        // Pitch only, like the zoom scaling — a momentary bend must not
        // wobble the marker (performance-mode 06 reasoning).
        const rate = composeRate(snapshot.pitchPercent, 0);
        const windowSeconds = trackWindowSeconds(visibleRef.current, rate);
        const playhead = engine.getPlayhead();
        key += `|${frame.outgoing}:${playhead}:${rate}`;
        for (const guide of frame.guides) {
          const guideKey = `${frame.outgoing}>${frame.incoming}:${guide.uuid}`;
          const node = itemRefs.current.get(guideKey);
          if (!node) continue;
          const frac = guideScreenFraction(
            guide.aTime,
            playhead,
            windowSeconds,
            PLAY_MARKER_FRACTION
          );
          if (frac < -VISIBLE_SLACK || frac > 1 + VISIBLE_SLACK) {
            node.style.display = 'none';
            continue;
          }
          node.style.display = '';
          node.style.transform = `translateX(${frac * width}px)`;
        }
      }
      const changed = key !== lastKey;
      lastKey = key;
      schedule(anyAdvancing || changed);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
    };
  }, [engineA, engineB, engineC, engineD, frames, viewActive]);

  if (frames.length === 0) return null;

  return (
    <div ref={containerRef} className="perf-playguides" aria-hidden>
      {frames.map((frame) =>
        frame.guides.map((guide) => {
          const key = `${frame.outgoing}>${frame.incoming}:${guide.uuid}`;
          return (
            <div
              key={key}
              ref={(el) => {
                if (el) itemRefs.current.set(key, el);
                else itemRefs.current.delete(key);
              }}
              className={`perf-playguide incoming-${frame.incoming.toLowerCase()}${
                guide.missed ? ' missed' : ''
              }`}
              style={{ display: 'none' }}
            >
              <div
                className="perf-playguide-line"
                style={{ top: `${waveformRowTopPercent(frame.outgoing)}%` }}
              />
              <div
                className="perf-playguide-line"
                style={{ top: `${waveformRowTopPercent(frame.incoming)}%` }}
              />
              <div
                className="perf-playguide-chip"
                style={{ top: `${waveformRowCenterPercent(frame.incoming)}%` }}
              >
                <span className="perf-playguide-glyph">▶</span>
                <span className="perf-playguide-pair">
                  {frame.outgoing}→{frame.incoming}
                </span>
                {guide.favorite && <span className="perf-playguide-star">★</span>}
                <span className="perf-playguide-name">{guide.name}</span>
                {guide.requiredPitchPercent !== null && (
                  <span
                    className="perf-playguide-pitch"
                    title="Set the paused deck's pitch to this for the alignment to hold"
                  >
                    {formatPitch(guide.requiredPitchPercent)}
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
