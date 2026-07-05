/**
 * Headless boot glue (headphone-cue 04): hands the Mixer to the routing
 * store so saved device choices apply on boot and follow plug/unplug.
 * Mounted once inside DeckProvider, beside the MIDI registrars. Hands-on-
 * verified glue (ADR 0002) — the tested seam is routing.ts.
 */
import { useEffect } from 'react';
import { useMixer } from '../hooks/useMixer';
import { initAudioRouting } from '../playback/routingStore';

export function AudioRoutingBridge() {
  const mixer = useMixer();
  useEffect(() => initAudioRouting(mixer), [mixer]);
  return null;
}
