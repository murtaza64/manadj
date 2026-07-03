import { useEffect, useState } from 'react';
import WebGLWaveform from './WebGLWaveform';
import type { ScrubTransport } from './WebGLWaveform';
import { useDeck, useDeckSnapshot } from '../hooks/useDeck';
import { useHotCueActions } from '../hooks/useHotCueActions';
import { BEATJUMP_BEATS } from '../playback/constants';
import HotCue from './HotCue';
import './Player.css';

/**
 * The library's view of the Deck: waveform, transport, hot cues, time.
 * Follows the loaded Track (glossary: Load), not the selection.
 */
export default function Player() {
  const { engine, loadedTrack } = useDeck();
  const snapshot = useDeckSnapshot((s) => s);
  const ready = snapshot.loadState === 'ready';
  const trackId = loadedTrack?.id ?? null;

  const hotCues = useHotCueActions(trackId);

  // At-cue styling: polled coarsely, but setState only on boolean flips so
  // steady playback causes zero re-renders.
  const [atCuePoint, setAtCuePoint] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => {
      const s = engine.getSnapshot();
      const next =
        s.cuePoint !== null && Math.abs(engine.getPlayhead() - s.cuePoint) < 0.1;
      setAtCuePoint((prev) => (prev === next ? prev : next));
    }, 100);
    return () => clearInterval(interval);
  }, [engine]);

  const scrubTransport: ScrubTransport = {
    isPlaying: () => engine.isAudioRunning(),
    pause: () => engine.pause(),
    play: () => engine.play(),
    seek: (t) => engine.seek(t),
  };

  return (
    <>
      {/* Waveform with controls overlays */}
      <div style={{ position: 'relative' }}>
        <WebGLWaveform
          trackId={trackId}
          clock={engine}
          cuePoint={snapshot.cuePoint}
          transport={scrubTransport}
        />

        {/* Controls overlay - top left */}
        <div className="player-controls-overlay">
          {/* Row 1: CUE button spanning all columns */}
          <button
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              engine.cueDown();
            }}
            onPointerUp={() => engine.cueUp()}
            onPointerCancel={() => engine.cueUp()}
            disabled={!ready}
            className={`player-button player-button-cue ${
              snapshot.previewing
                ? 'player-button-cue-held'
                : !snapshot.playing && snapshot.cuePoint !== null
                ? atCuePoint
                  ? 'player-button-cue-at-cue'
                  : 'player-button-cue-away-from-cue'
                : ''
            }`}
            title="Cue (F)"
          >
            CUE
          </button>

          {/* Row 2: PLAY button spanning all columns */}
          <button
            onClick={() => engine.togglePlay()}
            disabled={!ready}
            className={`player-button ${snapshot.playing ? 'player-button-playing' : 'player-button-paused'}`}
            title={snapshot.playing ? 'Pause' : 'Play'}
          >
            ⏯
          </button>

          {/* Row 3: Jump back and forward buttons */}
          <button
            onClick={() => engine.jumpBeats(-BEATJUMP_BEATS)}
            disabled={!ready}
            className="player-button"
            title={`Jump back ${BEATJUMP_BEATS} beats (A)`}
          >
            ◄◄
          </button>

          <button
            onClick={() => engine.jumpBeats(BEATJUMP_BEATS)}
            disabled={!ready}
            className="player-button"
            title={`Jump forward ${BEATJUMP_BEATS} beats (S)`}
          >
            ►►
          </button>

          {/* Row 4: Load state (time/bar readout is drawn on the waveform overlay) */}
          {snapshot.loadState !== 'ready' && snapshot.loadState !== 'empty' && (
            <div className="player-time">
              {snapshot.loadState === 'error' ? (
                <span title={snapshot.loadError ?? undefined}>load error</span>
              ) : (
                <span>{snapshot.loadState}…</span>
              )}
            </div>
          )}
        </div>

        {/* Hot cues overlay - top right */}
        <div className="player-hotcues-overlay">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(slot => (
            <HotCue
              key={slot}
              slotNumber={slot}
              hotCue={hotCues.bySlot.get(slot)}
              disabled={!hotCues.enabled}
              isPreviewing={snapshot.hotCuePreviewSlot === slot}
              onDown={hotCues.down}
              onUp={hotCues.up}
              onDelete={hotCues.remove}
            />
          ))}
        </div>
      </div>
    </>
  );
}


