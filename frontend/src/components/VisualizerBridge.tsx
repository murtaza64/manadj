import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMixer } from '../hooks/useMixer';
import { useDecks } from '../hooks/useDeck';
import { CHANNEL_IDS } from '../playback/mixer';
import type { BeatgridResponse, MetricLadderResponse } from '../types';
import {
  aggregateBands,
  aggregateMultiband,
  logBandEdges,
  spectralCentroid,
  stepBands,
  stepImpulses,
  stepLevels,
  stepTrend,
  INITIAL_IMPULSE_STATE,
  INITIAL_TREND,
  SILENT_BANDS,
} from '../visualizer/bands';
import type { BandLevels, EnergyTrend, ImpulseState } from '../visualizer/bands';
import { energyOf } from '../visualizer/style';
import { beatPositionAt } from '../visualizer/beat';
import { deckMasterGain, isDeckAudible } from '../capture/audibility';
import { DEFAULT_DETECTOR_PARAMS } from '../capture/events';
import { meanAbsoluteToNormalized } from '../midi/levelMeter';
import {
  PING_TIMEOUT_MS,
  SPECTRUM_BAND_COUNT,
  VISUALIZER_CHANNEL,
  WAVE_POINTS,
} from '../visualizer/channel';
import type { BeatInfo, DeckStateInfo, VisualizerFrame, VisualizerMessage } from '../visualizer/channel';

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
  const impulseRef = useRef<ImpulseState>(INITIAL_IMPULSE_STATE);
  const trendRef = useRef<EnergyTrend>(INITIAL_TREND);

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
      // beatPositionAt assumes 4/4 from the first beat without them. The
      // metric-ladder cache (marks) rides alongside — passing both lets the
      // resolver hand back a Reset-mark-correct bar ordinal (rt-viz 08).
      const snapshot = best.engine.getSnapshot();
      const grid = snapshot.trackId
        ? queryClient.getQueryData<BeatgridResponse>(['beatgrid', snapshot.trackId])
        : undefined;
      const ladder = snapshot.trackId
        ? queryClient.getQueryData<MetricLadderResponse>(['metric-ladder', snapshot.trackId])
        : undefined;
      const position = beatPositionAt(
        reference.beatTimes,
        grid?.data.downbeat_times ?? [],
        reference.playhead,
        grid?.data ?? null,
        ladder ?? null
      );
      if (position === null) return null;
      return { ...position, bpm: snapshot.bpm };
    };

    const readDecks = (): DeckStateInfo[] => {
      const mixerInputs = {
        crossfader: mixer.getCrossfader(),
        crossfaderEnabled: mixer.getCrossfaderEnabled(),
      };
      return CHANNEL_IDS.map((id) => {
        const deck = decksRef.current[id];
        const playing = !!deck?.engine.isAudioRunning();
        let level = 0;
        if (playing) {
          const state = mixer.getChannelState(id);
          // While an automation overlay is engaged (editor audition /
          // Conductor, ADR 0022), the AUDIBLE fader/EQ/filter are the
          // overlay's, not base state — audibility must read what plays.
          const automation = mixer.getAutomation(id);
          const inputs = {
            playing,
            fader: automation?.fader ?? state.fader,
            trim: automation?.trim ?? state.trim,
            eq: automation?.eq ?? state.eq,
            filter: automation?.filter ?? state.filter,
            assignment: mixer.getCrossfaderAssignment(id),
          };
          // THE audibility definition (capture/audibility.ts) — its
          // audibleGain threshold + kill checks reject headphone-preview
          // decks whose fader isn't a true zero (a raw gain multiply
          // leaked them in as ghost orbs).
          if (isDeckAudible(inputs, mixerInputs, DEFAULT_DETECTOR_PARAMS)) {
            const gain = deckMasterGain(inputs, mixerInputs);
            level = meanAbsoluteToNormalized(mixer.readChannelLevel(id).meanAbsolute * gain);
          }
        }
        const snapshot = deck?.engine.getSnapshot();
        // Per-deck beat position: any running deck (asLaunchReference
        // self-gates on running + gridded).
        let beat: ReturnType<typeof beatPositionAt> = null;
        if (playing && deck) {
          const reference = deck.engine.asLaunchReference();
          if (reference) {
            const grid = snapshot?.trackId
              ? queryClient.getQueryData<BeatgridResponse>(['beatgrid', snapshot.trackId])
              : undefined;
            beat = beatPositionAt(
              reference.beatTimes,
              grid?.data.downbeat_times ?? [],
              reference.playhead
            );
          }
        }
        const state = mixer.getChannelState(id);
        const automation = mixer.getAutomation(id);
        return {
          channel: id,
          level,
          playing,
          trackId: snapshot?.trackId ?? null,
          beatPhase: beat?.phase ?? null,
          barPhase: beat?.barPhase ?? null,
          beatInBar: beat?.beatInBar ?? null,
          beatsPerBar: beat?.beatsPerBar ?? 4,
          bpm: snapshot?.bpm ?? null,
          eq: automation?.eq ?? state.eq,
          fader: automation?.fader ?? state.fader,
        };
      });
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
        impulseRef.current = INITIAL_IMPULSE_STATE;
        trendRef.current = INITIAL_TREND;
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
      // Impulses run against the RAW targets — the smoothed levels have
      // already eaten the transient the impulse detector needs.
      impulseRef.current = stepImpulses(impulseRef.current, bandTarget, dt);
      trendRef.current = stepTrend(trendRef.current, energyOf(bandTarget), dt);
      const frame: VisualizerFrame = {
        type: 'bands',
        bands: bandsRef.current,
        spectrum: spectrumRef.current,
        wave: wantsWave ? readWave() : null,
        beat: readBeat(),
        impulse: impulseRef.current.impulse,
        trend: trendRef.current,
        centroid: spectralCentroid(spectrumRef.current),
        decks: readDecks(),
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
