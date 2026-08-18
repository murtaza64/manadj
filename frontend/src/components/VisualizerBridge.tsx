import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMixer } from '../hooks/useMixer';
import { useDecks } from '../hooks/useDeck';
import { CHANNEL_IDS } from '../playback/mixer';
import type { BeatgridResponse } from '../types';
import {
  aggregateBands,
  aggregateMultiband,
  logBandEdges,
  stepBands,
  stepLevels,
  SILENT_BANDS,
} from '../visualizer/bands';
import type { BandLevels } from '../visualizer/bands';
import { beatPositionAt } from '../visualizer/beat';
import {
  PING_TIMEOUT_MS,
  SPECTRUM_BAND_COUNT,
  VISUALIZER_CHANNEL,
  WAVE_POINTS,
} from '../visualizer/channel';
import type { BeatInfo, VisualizerFrame, VisualizerMessage } from '../visualizer/channel';

/** Geometric 24-band edges, 40 Hz → 16 kHz (Rainmeter/cava construction). */
const SPECTRUM_EDGES = logBandEdges(40, 16000, SPECTRUM_BAND_COUNT);
const SILENT_SPECTRUM = new Array<number>(SPECTRUM_BAND_COUNT).fill(0);

/**
 * Headless visualizer feed (realtime-visualization 01/02). Samples the
 * master bus off the Mixer's visualizer taps (post-program, pre-Master),
 * shapes it through the tested seams (visualizer/bands.ts, beat.ts), and
 * broadcasts one frame per animation frame to any open visualizer window:
 * isolator-aligned 3 bands + 24-band spectrum always; the stereo waveform
 * only while the window's ping wants it; beat phase from the dominant
 * audible deck's beatgrid (argmax channel level over audible engines —
 * grid-first per ADR 0016).
 *
 * Deliberately NOT React-rate: everything lives in refs and the rAF loop
 * only runs while a visualizer window is pinging (same rationale as
 * MidiLevelMeterBridge). Read-only w.r.t. app state; analysers are pure
 * sinks, so this can never alter audio.
 */
export function VisualizerBridge() {
  const mixer = useMixer();
  const decks = useDecks();
  const queryClient = useQueryClient();
  const decksRef = useRef(decks);
  decksRef.current = decks;
  const bandsRef = useRef<BandLevels>(SILENT_BANDS);
  const spectrumRef = useRef<number[]>(SILENT_SPECTRUM);

  useEffect(() => {
    const channel = new BroadcastChannel(VISUALIZER_CHANNEL);
    let lastPingAt = -Infinity;
    let wantsWave = false;
    let rafId: number | null = null;
    let lastFrameAt = 0;
    let disposed = false;

    const readBeat = (): BeatInfo | null => {
      // Dominant audible deck: argmax channel level among running engines.
      let best: (typeof decksRef.current)[keyof typeof decksRef.current] | null = null;
      let bestLevel = -1;
      for (const id of CHANNEL_IDS) {
        const deck = decksRef.current[id];
        if (!deck?.engine.isAudioRunning()) continue;
        const level = mixer.readChannelLevel(id).meanAbsolute;
        if (level > bestLevel) {
          bestLevel = level;
          best = deck;
        }
      }
      if (!best) return null;
      // asLaunchReference self-gates on audible + gridded (≥1 beat).
      const reference = best.engine.asLaunchReference();
      if (!reference) return null;
      // Downbeats come from the beatgrid query cache (warmed on deck load);
      // beatPositionAt assumes 4/4 from the first beat without them.
      const snapshot = best.engine.getSnapshot();
      const grid = snapshot.trackId
        ? queryClient.getQueryData<BeatgridResponse>(['beatgrid', snapshot.trackId])
        : undefined;
      const position = beatPositionAt(
        reference.beatTimes,
        grid?.data.downbeat_times ?? [],
        reference.playhead
      );
      if (position === null) return null;
      return { ...position, bpm: snapshot.bpm };
    };

    const readWave = (): { left: Float32Array; right: Float32Array } | null => {
      const waveform = mixer.readMasterWaveform();
      if (!waveform) return null;
      // Decimate the analyser window to WAVE_POINTS per side; postMessage
      // clones synchronously, but the mixer reuses its buffers, so copy.
      const stride = Math.max(1, Math.floor(waveform.left.length / WAVE_POINTS));
      const left = new Float32Array(WAVE_POINTS);
      const right = new Float32Array(WAVE_POINTS);
      for (let i = 0; i < WAVE_POINTS; i++) {
        left[i] = waveform.left[i * stride] ?? 0;
        right[i] = waveform.right[i * stride] ?? 0;
      }
      return { left, right };
    };

    const tick = (now: number) => {
      rafId = null;
      if (disposed) return;
      if (now - lastPingAt > PING_TIMEOUT_MS) {
        // Feed went quiet: park until the next ping restarts the loop.
        bandsRef.current = SILENT_BANDS;
        spectrumRef.current = SILENT_SPECTRUM;
        return;
      }
      const dt = lastFrameAt > 0 ? (now - lastFrameAt) / 1000 : 1 / 60;
      lastFrameAt = now;
      const snapshot = mixer.readMasterSpectrum();
      const bandTarget = snapshot
        ? aggregateBands(snapshot.magnitudesDb, snapshot.sampleRate, snapshot.fftSize)
        : SILENT_BANDS;
      const spectrumTarget = snapshot
        ? aggregateMultiband(
            snapshot.magnitudesDb,
            snapshot.sampleRate,
            snapshot.fftSize,
            SPECTRUM_EDGES
          )
        : SILENT_SPECTRUM;
      bandsRef.current = stepBands(bandsRef.current, bandTarget, dt);
      spectrumRef.current = stepLevels(spectrumRef.current, spectrumTarget, dt);
      const frame: VisualizerFrame = {
        type: 'bands',
        bands: bandsRef.current,
        spectrum: spectrumRef.current,
        wave: wantsWave ? readWave() : null,
        beat: readBeat(),
        sentAt: now,
      };
      channel.postMessage(frame);
      rafId = requestAnimationFrame(tick);
    };

    channel.onmessage = (event: MessageEvent<VisualizerMessage>) => {
      if (event.data?.type !== 'ping') return;
      lastPingAt = performance.now();
      wantsWave = !!event.data.wantsWave;
      if (rafId === null) {
        lastFrameAt = 0;
        rafId = requestAnimationFrame(tick);
      }
    };

    return () => {
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      channel.close();
    };
  }, [mixer, queryClient]);

  return null;
}
