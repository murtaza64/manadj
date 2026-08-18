import { useEffect, useRef } from 'react';
import { useMixer } from '../hooks/useMixer';
import {
  aggregateBands,
  aggregateMultiband,
  logBandEdges,
  stepBands,
  stepLevels,
  SILENT_BANDS,
} from '../visualizer/bands';
import type { BandLevels } from '../visualizer/bands';
import {
  PING_TIMEOUT_MS,
  SPECTRUM_BAND_COUNT,
  VISUALIZER_CHANNEL,
} from '../visualizer/channel';
import type { VisualizerFrame, VisualizerMessage } from '../visualizer/channel';

/** Geometric 8-band edges, 40 Hz → 16 kHz (Rainmeter/cava construction). */
const SPECTRUM_EDGES = logBandEdges(40, 16000, SPECTRUM_BAND_COUNT);
const SILENT_SPECTRUM = new Array<number>(SPECTRUM_BAND_COUNT).fill(0);

/**
 * Headless visualizer feed (realtime-visualization 01). Samples the master
 * bus off the Mixer's visualizer analyser (post-program, pre-Master —
 * mixer.readMasterSpectrum), shapes it through the tested seam
 * (visualizer/bands.ts: tilt + band aggregation + ballistics), and
 * broadcasts one frame per animation frame to any open visualizer window.
 * Each frame carries both the isolator-aligned 3 bands and the geometric
 * 8-band spectrum, each with its own ballistics state.
 *
 * Deliberately NOT React-rate: band levels change every frame, so they stay
 * in a ref and never touch state (same rationale as MidiLevelMeterBridge).
 * The rAF loop only runs while a visualizer window is pinging — no window,
 * no sampling, no broadcast traffic. Read-only w.r.t. app state; the
 * analyser is a pure sink, so this can never alter audio.
 */
export function VisualizerBridge() {
  const mixer = useMixer();
  const bandsRef = useRef<BandLevels>(SILENT_BANDS);
  const spectrumRef = useRef<number[]>(SILENT_SPECTRUM);

  useEffect(() => {
    const channel = new BroadcastChannel(VISUALIZER_CHANNEL);
    let lastPingAt = -Infinity;
    let rafId: number | null = null;
    let lastFrameAt = 0;
    let disposed = false;

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
        sentAt: now,
      };
      channel.postMessage(frame);
      rafId = requestAnimationFrame(tick);
    };

    channel.onmessage = (event: MessageEvent<VisualizerMessage>) => {
      if (event.data?.type !== 'ping') return;
      lastPingAt = performance.now();
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
  }, [mixer]);

  return null;
}
