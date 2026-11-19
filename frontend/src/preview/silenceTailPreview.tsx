/**
 * Silence-loop past-EOF tail preview (gh#424, MCR choice A): controlled
 * frontend state only — fabricated peaks + fabricated grid, real
 * WaveformRendererV2 + real grid/ladder projection. No backend, no audio.
 */
import { WaveformRendererV2 } from '../waveform/WaveformRendererV2';
import { TEX_WIDTH } from '../waveform/blob';
import type { DecodedWaveform, LodPack } from '../waveform/blob';
import { loopOverlayRegions } from '../waveform/loopOverlay';
import { gridForOverlayRegions } from '../meter/gridProjection';
import { resolveLadder } from '../meter/ladder';
import type { BeatgridData } from '../types';

const DURATION = 300; // s
const BPM = 120;
const LOOP_START = 320; // projected top-tier boundary past EOF
const LOOP_END = 352; // + 64 beats at 120bpm
const PLAYHEAD = 326; // folded just past the loop entry

function walkGrid(): BeatgridData {
  const beat_times: number[] = [];
  const downbeat_times: number[] = [];
  const interval = 60 / BPM;
  let t = 0;
  let pos = 1;
  while (t <= DURATION) {
    beat_times.push(t);
    if (pos === 1) downbeat_times.push(t);
    t += interval;
    pos = (pos % 4) + 1;
  }
  return {
    tempo_changes: [
      { start_time: 0, bpm: BPM, time_signature_num: 4, time_signature_den: 4, bar_position: 1 },
    ],
    beat_times,
    downbeat_times,
  };
}

function pack(channels: 1 | 4, count: number, fill: (i: number) => number[]): LodPack {
  const rows = Math.ceil(count / TEX_WIDTH);
  const data = new Uint8Array(rows * TEX_WIDTH * channels);
  for (let i = 0; i < count; i++) {
    const v = fill(i);
    for (let c = 0; c < channels; c++) data[i * channels + c] = v[c];
  }
  return { data, rows, levelOffsets: [0], levelCounts: [count], numLevels: 1 };
}

function fakeWaveform(): DecodedWaveform {
  const sampleRate = 44100;
  const peakHop = 256;
  const bandHop = 1024;
  const pps = sampleRate / peakHop;
  const fps = sampleRate / bandHop;
  const peakCount = Math.ceil(DURATION * pps);
  const bandCount = Math.ceil(DURATION * fps);
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const peaks = pack(1, peakCount, (i) => {
    const t = i / pps;
    const beat = t % 0.5 < 0.08 ? 1 : 0.55;
    const env = 0.55 + 0.45 * Math.sin((t / DURATION) * Math.PI * 3.1) ** 2;
    return [Math.round(255 * (0.02 + 0.35 * rand() * rand() * beat * env))];
  });
  const bandsLo = pack(4, bandCount, (i) => {
    const t = i / fps;
    const kick = t % 0.5 < 0.1 ? 240 : 130;
    return [kick, 90, 70, 60];
  });
  const bandsHi = pack(4, bandCount, () => [50, 45, 40, 35]);
  return {
    header: {
      version: 1,
      sampleRate,
      duration: DURATION,
      peakHop,
      bandHop,
      stftWindow: 2048,
      nBands: 8,
      gamma: 1.4,
      bandEdges: [20, 60, 120, 250, 500, 1000, 2500, 6000, 12000],
      peakCount,
      bandCount,
    },
    peaks,
    bandsLo,
    bandsHi,
    duration: DURATION,
  };
}

function drive(canvasId: string, minimap: boolean): string {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
  try {
    const renderer = new WaveformRendererV2(canvas, {
      isMinimapMode: minimap,
      playMarkerPosition: 0.4,
    });
    const data = fakeWaveform();
    renderer.setWaveformData(data);
    const noLoop = new URLSearchParams(location.search).has('noloop');
    const regions = noLoop
      ? []
      : loopOverlayRegions({ start: LOOP_START, end: LOOP_END, lengthBeats: 64 });
    renderer.setRegions(regions);
    const grid = gridForOverlayRegions(
      walkGrid(),
      regions.map((r) => r.end),
      DURATION,
    );
    renderer.setBeatgrid(grid.beat_times, grid.downbeat_times, resolveLadder(grid, null));
    if (!minimap) renderer.setVisibleSeconds(96);
    renderer.renderFrame({ getPlayhead: () => PLAYHEAD });
    return 'ok';
  } catch (err) {
    return `ERR: ${String(err)}`;
  }
}

const s1 = drive('main', false);
const s2 = drive('mini', true);
document.title = `${s1} / ${s2}`;
const el = document.createElement('div');
el.className = 'label';
el.textContent = `cal-3${new URLSearchParams(location.search).has('noloop') ? ' NOLOOP' : ''} | main: ${s1} | minimap: ${s2}`;
document.body.appendChild(el);
