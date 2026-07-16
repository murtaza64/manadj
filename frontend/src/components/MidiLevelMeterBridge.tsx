import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useMixer } from '../hooks/useMixer';
import { CHANNEL_IDS } from '../playback/mixer';
import type { ChannelId } from '../playback/mixer';
import { encodeMeter, meterOffMessage } from '../midi/feedback';
import { initialMeterState, meterTick } from '../midi/levelMeter';
import type { MeterChannelState } from '../midi/levelMeter';
import { connectedOutputs, subscribeOutputs } from '../midi/outputStore';

/**
 * Headless channel level-meter glue (four-deck-performance 36). A single
 * timer loop samples each channel's live mean-absolute level off the Mixer's
 * analyser tap (post-EQ/filter, pre-fader — mixer.ts), shapes it through
 * the tested seam (midi/levelMeter.ts: VU ballistics + segment quantize +
 * per-segment rate-limit), and sends the four A–D meter CCs to every
 * connected output.
 *
 * Deliberately NOT React-rate: meter values change every frame, so routing
 * them through render/state would thrash the tree. This component holds its
 * smoothing state in a ref and drives it from an interval — the DOM never
 * re-renders on a level change (same rationale as the waveform playheads'
 * rAF poll, and the blink clock in MidiFeedbackBridge). Read-only w.r.t.
 * app state.
 *
 * Resync: the tick reads the current level every frame, so a connect/replug
 * self-heals within one interval (the device is repainted from the live
 * signal). On the output set changing to empty — and on unmount — every
 * meter is cleared to silent so no stale level lingers (the adapter's
 * all-off covers unplug/dispose; this covers "outputs went away while the
 * app keeps running").
 */

/** Sampler cadence. ~30 Hz is smooth to the eye and cheap; the levelMeter
 * ballistics are dt-driven, so the exact rate is not load-bearing. */
const SAMPLE_INTERVAL_MS = 33;

export function MidiLevelMeterBridge() {
  const mixer = useMixer();
  const outputs = useSyncExternalStore(subscribeOutputs, connectedOutputs);

  const stateRef = useRef<Record<ChannelId, MeterChannelState>>({
    A: initialMeterState(),
    B: initialMeterState(),
    C: initialMeterState(),
    D: initialMeterState(),
  });
  // The tick reads the live output set through this ref, so the interval
  // does not restart (and reset ballistics) on every connect/replug.
  const outputsRef = useRef(outputs);
  useEffect(() => {
    outputsRef.current = outputs;
    // Nothing connected: reset our smoothing so a reconnect starts clean
    // (the still-plugged-but-undriven case; unplug/dispose is the adapter's
    // all-off). The interval's own tick self-heals a reconnect from the
    // live signal within one frame.
    if (outputs.length === 0) {
      for (const channel of CHANNEL_IDS) stateRef.current[channel] = initialMeterState();
    }
  }, [outputs]);

  useEffect(() => {
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const current = outputsRef.current;
      if (current.length === 0) return;
      for (const channel of CHANNEL_IDS) {
        const sample = mixer.readChannelLevel(channel);
        // Resolution comes from the first output that meters this channel;
        // all four meters on one device share it in practice.
        const address = current
          .map((o) => o.mapping.feedback?.meters?.[channel])
          .find((a) => a != null);
        const resolution = address
          ? address.levelMaxValue - address.minValue
          : 1;
        const result = meterTick(stateRef.current[channel], sample, dt, resolution);
        stateRef.current[channel] = result.state;
        if (result.normalized === null) continue;
        for (const output of current) {
          const meter = output.mapping.feedback?.meters?.[channel];
          if (!meter) continue;
          output.send(encodeMeter(meter, result.normalized, result.peak));
        }
      }
    };
    const interval = setInterval(tick, SAMPLE_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      // Leave the hardware dark on unmount (StrictMode remount included) —
      // the adapter's all-off covers unplug/dispose, but a bridge teardown
      // while the device stays connected must not freeze a stale meter.
      for (const output of outputsRef.current) {
        for (const channel of CHANNEL_IDS) {
          const meter = output.mapping.feedback?.meters?.[channel];
          if (meter) output.send(meterOffMessage(meter));
        }
      }
    };
  }, [mixer]);

  return null;
}
