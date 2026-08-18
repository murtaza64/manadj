// Lifecycle hook for the texture renderer (ADR 0015): construction on the
// returned canvas, data feeding (waveform, beatgrid, hot cues, cue point),
// the clock-driven render loop, and disposal. The full waveform and the
// minimap are thin configurations of this one hook (ADR 0008).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackClock } from '../playback/clock';
import type { BeatgridData, HotCue } from '../types';
import { resolveLadder, resolvedMarkTimes } from '../meter/ladder';
import type { PersistedLadder } from '../meter/ladder';
import type { DecodedWaveform } from './blob';
import { WaveformRendererV2 } from './WaveformRendererV2';
import type { OverlayRegion, WaveformRendererConfig } from './WaveformRendererV2';
import { useStyleSlot } from './styleSlots';
import type { SlotName } from './styleSlots';

interface Options {
  clock: PlaybackClock;
  waveformData: DecodedWaveform | null | undefined;
  config: WaveformRendererConfig;
  cuePoint?: number | null;
  hotCues?: HotCue[];
  beatgrid?: BeatgridData | null;
  /** Persisted Metric-ladder deviation (metric-ladder 02): Reset marks the
   * resolver applies; absent/null = the default ladder. */
  metricLadder?: PersistedLadder | null;
  /** Deck beatjump size for target guides (beatjump-guides 01); null/absent
   * hides them. */
  beatjumpBeats?: number | null;
  /** Shaded overlay regions (looping 05), e.g. the active loop. */
  regions?: OverlayRegion[];
  /** Possible-drop hypotheses (structure-analysis 02); absent/empty hides. */
  dropMarks?: Array<{ time: number; strength: number }>;
  /** Driven mode: no self-running render loop — the caller's own motion
   * clock calls the returned `draw()` once per frame. */
  driven?: boolean;
  /** Which persisted Waveform style slot this surface renders with.
   * Defaults to 'full'; minimaps pass 'minimap'. */
  slot?: SlotName;
  /** Whether the owning mode view is currently visible (performance-hardening
   * 01): false sleeps the self-driven rAF loop entirely (keep-alive views
   * stay mounted while hidden). Ignored in `driven` mode — the caller's
   * motion clock owns scheduling. Defaults to true. */
  active?: boolean;
  /** Whether the deck is currently advancing (performance-hardening 01):
   * true pins the loop at 60fps so playback is smooth, and a false→true flip
   * wakes an idle-polling loop instantly (no ≤250ms hitch at play). Playhead
   * motion alone would eventually wake it, but not on the first frame.
   * Ignored in `driven` mode. Defaults to false. */
  playing?: boolean;
  /** Any-value wake (performance-hardening 01): an identity change marks
   * the renderer dirty, repainting an idle frame immediately. For frame
   * inputs the renderer can't see through its mutators — the live mixer
   * channel state feeding `modulation` (performance-mode 09): a fader/EQ
   * move on a PAUSED deck must retint the waveform now, not a poll later. */
  wakeKey?: unknown;
}

export function useWaveformRendererV2({
  clock,
  waveformData,
  config,
  cuePoint = null,
  hotCues,
  beatgrid,
  metricLadder,
  beatjumpBeats = null,
  regions,
  dropMarks,
  driven = false,
  slot = 'full',
  active = true,
  playing = false,
  wakeKey,
}: Options) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WaveformRendererV2 | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const slotState = useStyleSlot(slot);

  useEffect(() => {
    if (!canvasRef.current || !waveformData) return;
    try {
      const renderer = new WaveformRendererV2(canvasRef.current, config);
      renderer.setWaveformData(waveformData);
      if (!driven) renderer.startRenderLoop(clock);
      rendererRef.current = renderer;
      setInitError(null);
      return () => {
        renderer.dispose();
        rendererRef.current = null;
      };
    } catch (err) {
      console.error('[useWaveformRendererV2] init failed:', err);
      setInitError('Failed to initialize waveform renderer');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveformData, clock]);

  const draw = useCallback(() => {
    rendererRef.current?.renderFrame(clock);
  }, [clock]);

  // View-visibility gating (performance-hardening 01): sleep the self-driven
  // loop while hidden. Only the self-running loop is gated — `driven`
  // surfaces schedule through their caller. Re-applied after re-init
  // (waveformData) so a fresh renderer inherits the current visibility.
  useEffect(() => {
    if (!driven) rendererRef.current?.setActive(active);
  }, [active, driven, waveformData]);

  // Playing gate (performance-hardening 01): pin the loop at 60fps while the
  // deck advances; the false→true flip also wakes an idle-polling loop
  // instantly (no play hitch). Re-applied after re-init.
  useEffect(() => {
    if (!driven) rendererRef.current?.setPlaying(playing);
  }, [playing, driven, waveformData]);

  // External wake (performance-hardening 01): repaint on wakeKey change.
  useEffect(() => {
    if (wakeKey !== undefined) rendererRef.current?.markDirty();
  }, [wakeKey]);

  // Persisted Waveform style: applied live (also after re-init).
  useEffect(() => {
    rendererRef.current?.setStyle(slotState.styleId, slotState.params);
  }, [slotState, waveformData]);

  useEffect(() => {
    rendererRef.current?.setCuePoint(cuePoint);
  }, [cuePoint, waveformData]);

  useEffect(() => {
    if (hotCues) rendererRef.current?.setHotCues(hotCues);
  }, [hotCues, waveformData]);

  useEffect(() => {
    if (beatgrid) {
      // Metric-ladder projection (metric-ladder 01/02): tier-weighted
      // gridlines with any persisted Reset marks applied; the renderer
      // never reads the ladder raw. Mark indicators draw at the RESOLVED
      // downbeats (what the count actually anchors to), not raw seconds.
      const ladder = resolveLadder(beatgrid, metricLadder);
      rendererRef.current?.setBeatgrid(
        beatgrid.beat_times,
        beatgrid.downbeat_times,
        ladder, // the projection IS the renderer's LadderGridInput slice
      );
      rendererRef.current?.setResetMarks(resolvedMarkTimes(beatgrid, metricLadder));
    }
  }, [beatgrid, metricLadder, waveformData]);

  useEffect(() => {
    if (regions) rendererRef.current?.setRegions(regions);
  }, [regions, waveformData]);

  useEffect(() => {
    rendererRef.current?.setDropMarks(dropMarks ?? []);
  }, [dropMarks, waveformData]);

  useEffect(() => {
    rendererRef.current?.setBeatjumpGuides(beatjumpBeats);
  }, [beatjumpBeats, waveformData]);

  return { canvasRef, rendererRef, initError, draw };
}
