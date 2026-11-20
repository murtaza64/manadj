import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../api/client';
import { useDecks } from '../hooks/useDeck';
import { useMixer } from '../hooks/useMixer';
import { CHANNEL_IDS } from '../playback/mixer';
import { channelCrossfaderGain, masterValueToGain } from '../playback/mixerMath';

/** Explicit opt-in, ephemeral five-Hz state anchors. No recording/library mutation. */
export function LocalLiveControl() {
  const registry = useDecks(), mixer = useMixer();
  const registryRef = useRef(registry); registryRef.current = registry;
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!enabled) return;
    const stream = crypto.randomUUID(); let seq = 0, stopped = false, timer = 0;
    const controller = new AbortController();
    const publish = async () => {
      try {
      const unsupported: string[] = [];
      if (mixer.isAutomationEngaged()) unsupported.push('Automated playback');
      if (mixer.getBeatFxSection().on) unsupported.push('Beat FX');
      if (mixer.getMaster() > .5) unsupported.push('Master boost');
      const decks = CHANNEL_IDS.map(id => {
        const engine = registryRef.current[id].engine, snap = engine.getSnapshot(), channel = mixer.getChannelState(id);
        const gaps: string[] = [];
        if (snap.loop) gaps.push('Loop');
        if (Math.abs(snap.pitchPercent) > 25 || Math.abs(snap.bendPercent) > 25) gaps.push('Rate outside native range');
        if (snap.scratching || snap.slipLoopActive || snap.previewing) gaps.push('Scratch/preview/slip');
        if (snap.stemsLoaded) gaps.push('Stems');
        if (snap.audioSourceKey) gaps.push('Peer audio');
        if (snap.loadState !== 'ready' && snap.trackId != null) gaps.push('Desktop loading');
        const xf = mixer.getCrossfaderEnabled() ? channelCrossfaderGain(mixer.getCrossfaderAssignment(id), mixer.getCrossfader()) : 1;
        return { track_id: snap.trackId, position: Math.max(0, engine.getPlayhead()), playing: snap.playing,
          pitch: Math.max(-25, Math.min(25, snap.pitchPercent)), bend: Math.max(-25, Math.min(25, snap.bendPercent)),
          // Native engine has the same quadratic fader. Fold master/crossfader
          // attenuation into it and leave native crossfader neutral.
          fader: channel.fader * Math.sqrt(xf * Math.min(1, masterValueToGain(mixer.getMaster()))),
          trim: channel.trim, low: channel.eq.low, mid: channel.eq.mid, high: channel.eq.high,
          filter: channel.filter, key_lock: snap.keyLock, unsupported: gaps };
      });
        const response = await fetch(`${API_BASE}/local-live/anchor`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stream_id: stream, seq: seq++, decks, unsupported }), signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!stopped) setStatus(unsupported.length || decks.some(d => d.unsupported.length) ? 'Listener paused: unsupported controls' : 'Own paired devices · state mirror prototype');
      } catch (e) {
        if (!stopped) { setStatus(`Live stopped: ${e instanceof Error ? e.message : 'connection failed'}`); setEnabled(false); }
      }
      if (!stopped) timer = window.setTimeout(publish, 200);
    };
    void publish();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); void fetch(`${API_BASE}/local-live/${stream}`, { method: 'DELETE' }).catch(() => {}); };
  }, [enabled, mixer]);
  return <button className={`topbar-visualizer${enabled ? ' on' : ''}`} aria-pressed={enabled}
    title={status || 'Prototype: send sampled playback state to your own paired iPhone on trusted LAN. Enable Phone sync first. Not mixed-audio streaming.'}
    onClick={() => setEnabled(v => !v)}>{enabled ? '■ LOCAL LIVE' : '◉ LOCAL LIVE'}</button>;
}
