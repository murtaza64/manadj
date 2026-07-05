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
import { usePlayGuides } from './usePlayGuides';
import { guideScreenFraction } from './playGuideModel';
import { composeRate } from '../playback/tempo';
import { trackWindowSeconds } from '../utils/waveformZoom';
import './PlayGuideOverlay.css';

/** Where the deck waveforms pin the playhead (DeckWaveform's renderer
 * config — playMarkerPosition). */
export const PLAY_MARKER_FRACTION = 0.25;

/** Hide a guide once it leaves the canvas (small slack so the line exits
 * cleanly instead of popping at the edge). */
const VISIBLE_SLACK = 0.02;

function formatPitch(percent: number): string {
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

export function PlayGuideOverlay({ visibleSeconds }: { visibleSeconds: number }) {
  const { A, B } = useDecks();
  const frames = usePlayGuides();

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
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const container = containerRef.current;
      if (!container) return;
      const width = container.clientWidth;
      // Each direction projects on ITS outgoing Deck's timeline (both-paused
      // shows two directions at once — issue 01).
      for (const frame of framesRef.current) {
        const engine = frame.outgoing === 'A' ? engineA : engineB;
        const snapshot = engine.getSnapshot();
        // Pitch only, like the zoom scaling — a momentary bend must not
        // wobble the marker (performance-mode 06 reasoning).
        const rate = composeRate(snapshot.pitchPercent, 0);
        const windowSeconds = trackWindowSeconds(visibleRef.current, rate);
        const playhead = engine.getPlayhead();
        for (const guide of frame.guides) {
          const node = itemRefs.current.get(guide.uuid);
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
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engineA, engineB]);

  if (frames.length === 0) return null;

  return (
    <div ref={containerRef} className="perf-playguides" aria-hidden>
      {frames.map((frame) =>
        frame.guides.map((guide) => (
          <div
            key={guide.uuid}
            ref={(el) => {
              if (el) itemRefs.current.set(guide.uuid, el);
              else itemRefs.current.delete(guide.uuid);
            }}
            className={`perf-playguide incoming-${frame.incoming.toLowerCase()}${
              guide.missed ? ' missed' : ''
            }`}
            style={{ display: 'none' }}
          >
            <div className="perf-playguide-line" />
            <div className="perf-playguide-chip">
              <span className="perf-playguide-glyph">▶</span>
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
        ))
      )}
    </div>
  );
}
