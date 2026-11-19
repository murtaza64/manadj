import { createRoot } from 'react-dom/client';
import '../index.css';
import '../components/Player.css';
import { installTheme } from '../theme/tokens';
import { DeckEngine } from '../playback/DeckEngine';
import type { DeckAudioPort } from '../playback/mixer';
import { putCachedBuffer } from '../playback/bufferCache';
import { DeckContext, type DeckContextValue } from '../hooks/useDeck';
import { LoopRow } from '../components/deckControls/LoopRow';
import type { BeatgridData, Track } from '../types';

installTheme();

const port: DeckAudioPort = {
  ensureAudio: () => {
    throw new Error('no audio in preview');
  },
};

const fakeBuffer = {
  duration: 180,
  sampleRate: 44100,
  numberOfChannels: 1,
  getChannelData: () => new Float32Array(44100),
} as unknown as AudioBuffer;

const grid120: BeatgridData = {
  tempo_changes: [
    { start_time: 0, bpm: 120, time_signature_num: 4, time_signature_den: 4, bar_position: 1 },
  ],
  beat_times: Array.from({ length: 360 }, (_, i) => i * 0.5),
  downbeat_times: Array.from({ length: 90 }, (_, i) => i * 2),
};

async function makeDeck(trackId: number, engageAt: number | null): Promise<DeckContextValue> {
  putCachedBuffer(trackId, fakeBuffer);
  const engine = new DeckEngine(port);
  await engine.load({
    trackId,
    audioUrl: 'about:blank',
    bpm: 120,
    beatTimes: Promise.resolve(grid120.beat_times),
  });
  engine.setMeter(trackId, grid120, null);
  if (engageAt !== null) {
    engine.seek(engageAt);
    engine.toggleLoop();
  }
  const track = { id: trackId } as unknown as Track;
  return {
    deck: 'A',
    engine,
    loadedTrack: track,
    loadTrack: () => {},
  } as unknown as DeckContextValue;
}

function Row({ value, caption }: { value: DeckContextValue; caption: string }) {
  return (
    <DeckContext.Provider value={value}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: '#999', fontSize: 11, marginBottom: 4 }}>{caption}</div>
        <LoopRow />
      </div>
    </DeckContext.Provider>
  );
}

const silence = await makeDeck(1, 179.2);
const natural = await makeDeck(2, 10.1);
const idle = await makeDeck(3, null);

createRoot(document.getElementById('root')!).render(
  <div style={{ padding: 24, background: '#1e1e1e' }}>
    <Row value={silence} caption="silence loop engaged (64 beats past EOF)" />
    <Row value={natural} caption="natural loop engaged (4 beats)" />
    <Row value={idle} caption="idle (pending 4 beats)" />
  </div>
);
