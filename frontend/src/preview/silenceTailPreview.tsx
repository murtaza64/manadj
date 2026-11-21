/**
 * Silence-loop past-EOF tail preview (gh#424, MCR choice A): controlled
 * loop/grid state over REAL analysis data — the fixture blob comes from
 * backend/waveform_data.generate_blob on a synthesized 300s track, parsed
 * by the production decodeWaveformBlob. Real WaveformRendererV2 +
 * real grid/ladder projection. No backend server, no audio playback.
 */
import { WaveformRendererV2 } from '../waveform/WaveformRendererV2';
import { decodeWaveformBlob } from '../waveform/blob';
import { loopOverlayRegions } from '../waveform/loopOverlay';
import { gridForOverlayRegions } from '../meter/gridProjection';
import { resolveLadder } from '../meter/ladder';
import type { BeatgridData } from '../types';

const BPM = 120;
const LOOP_START = 320; // projected top-tier boundary past EOF
const LOOP_END = 352; // + 64 beats at 120bpm
const PLAYHEAD = 326; // folded just past the loop entry

function walkGrid(duration: number): BeatgridData {
  const beat_times: number[] = [];
  const downbeat_times: number[] = [];
  const interval = 60 / BPM;
  let t = 0;
  let pos = 1;
  while (t <= duration) {
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

async function main(): Promise<void> {
  const noLoop = new URLSearchParams(location.search).has('noloop');
  const buf = await (await fetch('/preview/silence-tail-fixture.mwf')).arrayBuffer();
  const waveform = decodeWaveformBlob(buf);
  const duration = waveform.duration;

  const drive = (canvasId: string, minimap: boolean): string => {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    try {
      const renderer = new WaveformRendererV2(canvas, {
        isMinimapMode: minimap,
        playMarkerPosition: 0.4,
      });
      renderer.setWaveformData(waveform);
      const regions = noLoop
        ? []
        : loopOverlayRegions({ start: LOOP_START, end: LOOP_END, lengthBeats: 64 });
      renderer.setRegions(regions);
      const grid = gridForOverlayRegions(
        walkGrid(duration),
        regions.map((r) => r.end),
        duration,
      );
      renderer.setBeatgrid(grid.beat_times, grid.downbeat_times, resolveLadder(grid, null));
      if (!minimap) renderer.setVisibleSeconds(96);
      renderer.renderFrame({ getPlayhead: () => PLAYHEAD });
      return 'ok';
    } catch (err) {
      return `ERR: ${String(err)}`;
    }
  };

  const s1 = drive('main', false);
  const s2 = drive('mini', true);
  document.title = `${s1} / ${s2}`;
  const mainLabel = document.getElementById('main-label');
  if (mainLabel) {
    mainLabel.textContent = noLoop
      ? 'MAIN waveform — no loop regions (baseline)'
      : 'MAIN waveform — silence loop engaged past EOF, playhead folded mid-loop';
  }
  const miniLabel = document.getElementById('mini-label');
  if (miniLabel) {
    miniLabel.textContent = noLoop
      ? 'MINIMAP — domain ends at end of audio'
      : 'MINIMAP — domain extends to cover the loop past EOF';
  }
  const el = document.createElement('div');
  el.className = 'label';
  el.textContent =
    `real-blob cal-1${noLoop ? ' NOLOOP' : ''} | duration ${duration}s ` +
    `(peak hop ${waveform.header.peakHop}, gamma ${waveform.header.gamma}) | main: ${s1} | minimap: ${s2}`;
  document.body.appendChild(el);
}

void main();
