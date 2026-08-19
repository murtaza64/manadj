import { useEffect, useState } from 'react';
import type { BandLevels, EnergyTrend } from './bands';
import type { BeatInfo, DeckStateInfo } from './channel';
import { DECK_COLORS } from '../theme/deckColors';

/**
 * Debug HUD (realtime-visualization 05): the visualizer's instrument
 * panel — every signal the presets consume, live. Toggled with `h` or the
 * chrome button; polls the feed ref at 10 Hz (display rate, never rAF).
 */

export interface HudSnapshot {
  bands: BandLevels;
  impulse: BandLevels;
  trend: EnergyTrend;
  centroid: number;
  beat: BeatInfo | null;
  decks: DeckStateInfo[];
  receivedAt: number;
}

function Bar({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div className="hud-bar">
      <span className="hud-bar-label">{label}</span>
      <div className="hud-bar-track">
        <div
          className="hud-bar-fill"
          style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color }}
        />
      </div>
      <span className="hud-bar-value">{value.toFixed(2)}</span>
    </div>
  );
}

export function VisualizerHud({ getSnapshot }: { getSnapshot: () => HudSnapshot }) {
  const [snap, setSnap] = useState<HudSnapshot | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setSnap({ ...getSnapshot() }), 100);
    return () => clearInterval(timer);
  }, [getSnapshot]);
  if (!snap) return null;

  const { bands, impulse, trend, centroid, beat, decks } = snap;
  const stale = performance.now() - snap.receivedAt > 1000;
  const energy = Math.min(1, bands.low * 0.5 + bands.mid * 0.3 + bands.high * 0.2);
  const lowPresence = Math.min(1, Math.max(0, (bands.low - 0.2) / 0.5));
  const drop = trend.excitement * lowPresence;
  const buildup = trend.excitement * (1 - lowPresence);
  // Phrase/section derive from the ladder-correct bar ordinal (respects
  // Reset marks, rt-viz 08); fall back to the raw first-downbeat count.
  const tierBar = beat ? beat.ladderBarIndex ?? beat.barIndex : null;
  const phrase =
    beat && tierBar !== null ? ((((tierBar % 4) + 4) % 4) + beat.barPhase) / 4 : null;
  const section =
    beat && tierBar !== null ? ((((tierBar % 16) + 16) % 16) + beat.barPhase) / 16 : null;

  return (
    <div className={`visualizer-hud${stale ? ' stale' : ''}`}>
      <div className="hud-section">
        <div className="hud-title">grid {stale ? '(NO SIGNAL)' : beat ? '' : '(no beatgrid)'}</div>
        {beat ? (
          <>
            <div className="hud-row">
              <span>{beat.bpm ? `${beat.bpm.toFixed(1)} bpm` : '— bpm'}</span>
              <span>
                bar {tierBar !== null ? (tierBar % 16) + 1 : beat.barIndex}/16 · beat{' '}
                {beat.beatInBar + 1}/{beat.beatsPerBar}
              </span>
            </div>
            <Bar value={beat.phase} color="hsl(200,100%,55%)" label="beat" />
            <Bar value={beat.barPhase} color="hsl(160,100%,45%)" label="bar" />
            {phrase !== null && <Bar value={phrase} color="hsl(45,100%,50%)" label="phrase" />}
            {section !== null && <Bar value={section} color="hsl(0,100%,55%)" label="section" />}
          </>
        ) : (
          <div className="hud-row">gridless</div>
        )}
      </div>
      <div className="hud-section">
        <div className="hud-title">bands / impulse</div>
        <Bar value={bands.low} color="rgb(255,26,26)" label="low" />
        <Bar value={impulse.low} color="rgba(255,120,120,0.9)" label="kick" />
        <Bar value={bands.mid} color="rgb(0,255,64)" label="mid" />
        <Bar value={impulse.mid} color="rgba(140,255,170,0.9)" label="snare" />
        <Bar value={bands.high} color="rgb(51,115,255)" label="high" />
        <Bar value={impulse.high} color="rgba(140,180,255,0.9)" label="hat" />
      </div>
      <div className="hud-section">
        <div className="hud-title">energy</div>
        <Bar value={energy} color="hsl(280,100%,60%)" label="energy" />
        <Bar value={trend.slow} color="hsl(280,60%,45%)" label="baseline" />
        <Bar value={trend.excitement} color="hsl(320,100%,60%)" label="excite" />
        <Bar value={drop} color="hsl(20,100%,55%)" label="drop" />
        <Bar value={buildup} color="hsl(190,100%,55%)" label="buildup" />
        <Bar value={centroid} color="hsl(60,100%,55%)" label="centroid" />
      </div>
      {decks.length > 0 && (
        <div className="hud-section">
          <div className="hud-title">decks (audible)</div>
          {decks.map((deck) => (
            <Bar
              key={deck.channel}
              value={deck.level}
              color={DECK_COLORS[deck.channel]}
              label={`${deck.channel}${deck.playing ? '▸' : ' '}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
