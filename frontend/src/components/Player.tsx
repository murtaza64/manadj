import { useCallback } from 'react';
import WebGLWaveform from './WebGLWaveform';
import { useDeck, useDeckReady, useDeckSnapshot } from '../hooks/useDeck';
import { useScrubTransport } from '../hooks/useScrubTransport';
import { TransportPair } from './deckControls/TransportPair';
import { HotCuePads } from './deckControls/HotCuePads';
import { BeatjumpRow } from './deckControls/BeatjumpRow';
import { CueWalkButton } from './deckControls/CueWalkButtons';
import './Player.css';

/**
 * The library's view of the Deck: waveform, transport, hot cues, beatjump,
 * time. Follows the loaded Track (glossary: Load), not the selection. The
 * controls are the shared playback cluster (deck-controls PRD) — the same
 * components the Performance DeckPanel renders, minus the key-hint slots.
 */
export default function Player() {
  const { engine, loadedTrack, beatjumpBeats } = useDeck();
  const ready = useDeckReady();
  const loadState = useDeckSnapshot((s) => s.loadState);
  const loadError = useDeckSnapshot((s) => s.loadError);
  const cuePoint = useDeckSnapshot((s) => s.cuePoint);
  const loop = useDeckSnapshot((s) => s.loop);
  // Audibly-advancing states pin the waveform loop at 60fps and wake it
  // instantly at play (performance-hardening 01).
  const advancing = useDeckSnapshot(
    (s) => s.playing || s.pendingPlay || s.previewing || s.hotCuePreviewSlot !== null,
  );
  const trackId = loadedTrack?.id ?? null;

  const scrubTransport = useScrubTransport();
  // Per-gesture wake (#155): paused seeks (keyboard beatjump, hot cues, MIDI
  // jog) repaint on the next frame instead of the 250ms idle poll.
  const subscribeWake = useCallback(
    (cb: () => void) => engine.addTransportEventListener(cb),
    [engine],
  );

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
          beatjumpBeats={beatjumpBeats}
          playing={advancing}
          subscribeWake={subscribeWake}
          /* Documented override of PLAY_MARKER_FRACTION (theme/markers):
             the library player trades look-ahead for look-behind. */
          playMarkerFraction={0.35}
          timeReadoutAnchor="top-left"
          /* Docked at the transport overlay's bottom edge (panel bottom
             ≈ 104px, canvas 120px — the readout box spans ~98-118px). */
          timeReadoutOffset={{ x: 14, y: 101 }}
        />

        {/* Controls overlay - top left: CUE / PLAY rows, then the beatjump row */}
        <div className="player-controls-overlay">
          <TransportPair cueTitle="Cue (F)" />
          <BeatjumpRow backTitleSuffix=" (A)" forwardTitleSuffix=" (S)" />
          {/* No on-screen loop controls here (review verdict): `r` toggles
              the loop, and the waveform's green region shows it. */}

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

        {/* Hot cues overlay - beside the transport panel. The cue-walk
            buttons flank the pads (full-height columns either side). */}
        <div className="player-hotcues-overlay">
          <CueWalkButton direction="prev" className="player-cuewalk player-cuewalk-prev" />
          <HotCuePads />
          <CueWalkButton direction="next" className="player-cuewalk player-cuewalk-next" />
        </div>
      </div>
    </>
  );
}
