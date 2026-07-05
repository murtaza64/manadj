import WebGLWaveform from './WebGLWaveform';
import { useDeck, useDeckReady, useDeckSnapshot } from '../hooks/useDeck';
import { useScrubTransport } from '../hooks/useScrubTransport';
import { TransportPair } from './deckControls/TransportPair';
import { HotCuePads } from './deckControls/HotCuePads';
import { BeatjumpRow } from './deckControls/BeatjumpRow';
import { LoopRow } from './deckControls/LoopRow';
import './Player.css';

/**
 * The library's view of the Deck: waveform, transport, hot cues, beatjump,
 * time. Follows the loaded Track (glossary: Load), not the selection. The
 * controls are the shared playback cluster (deck-controls PRD) — the same
 * components the Performance DeckPanel renders, minus the key-hint slots.
 */
export default function Player() {
  const { engine, loadedTrack } = useDeck();
  const ready = useDeckReady();
  const loadState = useDeckSnapshot((s) => s.loadState);
  const loadError = useDeckSnapshot((s) => s.loadError);
  const cuePoint = useDeckSnapshot((s) => s.cuePoint);
  const loop = useDeckSnapshot((s) => s.loop);
  const trackId = loadedTrack?.id ?? null;

  const scrubTransport = useScrubTransport();

  return (
    <>
      {/* Waveform with controls overlays */}
      <div style={{ position: 'relative' }}>
        <WebGLWaveform
          trackId={trackId}
          clock={engine}
          cuePoint={cuePoint}
          loop={loop}
          transport={scrubTransport}
          dimmed={trackId !== null && !ready}
        />

        {/* Controls overlay - top left: CUE / PLAY rows, then the beatjump row */}
        <div className="player-controls-overlay">
          <TransportPair cueTitle="Cue (F)" />
          <BeatjumpRow backTitleSuffix=" (A)" forwardTitleSuffix=" (S)" />
          <LoopRow titleSuffix=" (R)" />

          {/* Load state (time/bar readout is drawn on the waveform overlay) */}
          {loadState !== 'ready' && loadState !== 'empty' && (
            <div className="player-time">
              {loadState === 'error' ? (
                <span title={loadError ?? undefined}>load error</span>
              ) : (
                <span>{loadState}…</span>
              )}
            </div>
          )}
        </div>

        {/* Hot cues overlay - top right */}
        <div className="player-hotcues-overlay">
          <HotCuePads />
        </div>
      </div>
    </>
  );
}
