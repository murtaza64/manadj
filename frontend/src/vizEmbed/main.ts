/**
 * Android visualizer embed (#394 spike). Built as one classic IIFE script
 * (vite.viz-embed.config.ts) into the Android app's assets and loaded in a
 * WebView behind the performance UI. The host (Kotlin VizHost, exposed as
 * `window.ManadjVizHost`) is PULLED once per rendered frame for deck
 * features; the host drives preset/options through `window.manadjViz`.
 */
import type { PresetRenderer, VisualizerPreset } from '../visualizer/presets/types';
import { voyagePreset } from '../visualizer/presets/voyage';
import { tunnelPreset } from '../visualizer/presets/tunnel';
import g02VoyagePrime from '../visualizer/presets/gen/g02-voyage-prime.candidate';
import g05MateriaShards from '../visualizer/presets/gen/g05-materia-shards.candidate';
import g02Materia from '../visualizer/presets/gen/g02-materia.candidate';
import g03MateriaDeep from '../visualizer/presets/gen/g03-materia-deep.candidate';
import g07MateriaMetric from '../visualizer/presets/gen/g07-materia-metric.candidate';
import g03SolarCrown from '../visualizer/presets/gen/g03-solar-crown.candidate';
import g04TunnelSaga from '../visualizer/presets/gen/g04-tunnel-saga.candidate';
import g07SeasonsNeon from '../visualizer/presets/gen/g07-seasons-neon.candidate';
import { createAndroidFeed, type HostFrame } from './feed';

interface HostBridge {
  frame(): string;
  stats(json: string): void;
}
declare global {
  interface Window {
    ManadjVizHost?: HostBridge;
    manadjViz?: VizApi;
  }
}

/** Top-rated genepool presets (score v3, genepool.json) — voyage and the materia line first. */
const PRESETS: Array<[string, VisualizerPreset]> = [
  ['voyage', voyagePreset],
  ['g02-voyage-prime', g02VoyagePrime],
  ['g05-materia-shards', g05MateriaShards],
  ['g02-materia', g02Materia],
  ['g03-materia-deep', g03MateriaDeep],
  ['g07-materia-metric', g07MateriaMetric],
  ['g03-solar-crown', g03SolarCrown],
  ['g07-seasons-neon', g07SeasonsNeon],
  ['tunnel', tunnelPreset],
  ['g04-tunnel-saga', g04TunnelSaga],
];

export interface VizOptions {
  /** Backing-store scale relative to CSS px × devicePixelRatio. */
  scale: number;
  fps: number;
  debug: boolean;
  /** Feed level trim in dB (calibration). */
  gainDb: number;
  /** Canvas opacity over black (UI readability). */
  opacity: number;
}

interface VizApi {
  presets(): string;
  setPreset(id: string): void;
  setOptions(json: string): void;
}

const canvas = document.getElementById('viz') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const hud = document.getElementById('hud') as HTMLDivElement;
const feed = createAndroidFeed();
const options: VizOptions = { scale: 0.5, fps: 30, debug: false, gainDb: 0, opacity: 0.7 };
let current: { id: string; preset: VisualizerPreset; renderer: PresetRenderer; params: Record<string, number> } | null = null;

function select(id: string): void {
  const entry = PRESETS.find(([pid]) => pid === id) ?? PRESETS[0];
  current?.renderer.dispose?.();
  const preset = entry[1];
  const params: Record<string, number> = {};
  for (const p of preset.params ?? []) params[p.id] = p.default;
  current = { id: entry[0], preset, renderer: preset.create(), params };
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr * options.scale));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr * options.scale));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

/**
 * Frosted glass (VH6): the UI's glass panes sit over this canvas, so blur the canvas's own pixels inside each
 * pane. One shared blur per frame: downsample ×4 with a small CSS blur (cheap, wide), then draw it back clipped
 * to the union of the panes' rounded rects.
 */
/** Frosted glass (VH6): one absolutely-placed div per UI glass pane with CSS backdrop-filter, so the
 * compositor blurs the canvas under each pane on the GPU (canvas-to-canvas copies read back from the GPU in
 * Android WebView: ~14 ms/frame). Divs are reused; only changed rects touch the DOM. */
const frostLayer = document.createElement('div');
frostLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;';
document.body.appendChild(frostLayer);
const frostDivs: HTMLDivElement[] = [];
const frostKeys: string[] = [];
let frostDownMs = 0;
const frostDrawMs = 0;
function frost(panes: number[][]): void {
  const t0 = performance.now();
  const dpr = window.devicePixelRatio || 1;
  for (let i = 0; i < panes.length; i++) {
    let div = frostDivs[i];
    if (!div) {
      div = document.createElement('div');
      div.style.cssText = 'position:absolute;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);';
      frostLayer.appendChild(div);
      frostDivs.push(div);
      frostKeys.push('');
    }
    const [x, y, w, h, r] = panes[i];
    const key = `${x},${y},${w},${h},${r}`;
    if (frostKeys[i] !== key) {
      frostKeys[i] = key;
      div.style.left = `${x / dpr}px`; div.style.top = `${y / dpr}px`;
      div.style.width = `${w / dpr}px`; div.style.height = `${h / dpr}px`;
      div.style.borderRadius = `${r / dpr}px`;
      div.style.display = 'block';
    }
  }
  for (let i = panes.length; i < frostDivs.length; i++) if (frostKeys[i] !== '') { frostKeys[i] = ''; frostDivs[i].style.display = 'none'; }
  frostDownMs += (performance.now() - t0 - frostDownMs) * 0.05;
}

const SILENT: HostFrame = { decks: [] };
function pull(): HostFrame {
  try {
    const raw = window.ManadjVizHost?.frame();
    return raw ? (JSON.parse(raw) as HostFrame) : SILENT;
  } catch { return SILENT; }
}

let last = 0;
let costAvg = 0;
let pullAvg = 0;
let frames = 0;
let statsAt = 0;
function tick(now: number): void {
  requestAnimationFrame(tick);
  const interval = 1000 / options.fps;
  if (now - last < interval - 2) return;
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / options.fps;
  last = now;
  if (!current) return;
  resize();
  const t0 = performance.now();
  const host = pull();
  const gain = Math.pow(10, options.gainDb / 20);
  if (gain !== 1) for (const d of host.decks) d.gain *= gain;
  const t1 = performance.now();
  const frame = feed.frameAt(host, dt, current.params);
  current.renderer.render(ctx, canvas.width, canvas.height, frame);
  frost(host.panes ?? []);
  const t2 = performance.now();
  costAvg += (t2 - t1 - costAvg) * 0.05;
  pullAvg += (t1 - t0 - pullAvg) * 0.05;
  frames++;
  if (options.debug) {
    const b = frame.bands;
    hud.textContent = `${current.id} ${canvas.width}x${canvas.height} render ${costAvg.toFixed(1)}ms pull ${pullAvg.toFixed(1)}ms\n` +
      `L ${b.low.toFixed(2)} M ${b.mid.toFixed(2)} H ${b.high.toFixed(2)} imp ${frame.impulse.low.toFixed(2)} exc ${frame.trend.excitement.toFixed(2)}\n` +
      `dom ${frame.dominantChannel ?? '-'} beat ${frame.beat ? `${frame.beat.beatInBar + 1}/${frame.beat.barIndex} ${frame.beat.bpm?.toFixed(1)}` : '-'}`;
  }
  if (now - statsAt > 2000) {
    const fps = (frames * 1000) / (now - statsAt || 1);
    statsAt = now; frames = 0;
    window.ManadjVizHost?.stats(JSON.stringify({ preset: current.id, renderMs: costAvg, pullMs: pullAvg, frostDownMs, frostDrawMs, fps, w: canvas.width, h: canvas.height }));
  }
}

window.manadjViz = {
  presets: () => JSON.stringify(PRESETS.map(([id, p]) => ({ id, name: p.name }))),
  setPreset: (id) => { if (current?.id !== id) select(id); },
  setOptions: (json) => {
    Object.assign(options, JSON.parse(json) as Partial<VizOptions>);
    hud.style.display = options.debug ? 'block' : 'none';
    canvas.style.opacity = String(options.opacity);
  },
};
select(PRESETS[0][0]);
requestAnimationFrame(tick);
