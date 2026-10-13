/**
 * "g19 strata-engine" (gen-19 NOVEL, nested-timescale abstract geometry —
 * the ACCRETION direction). A radial architecture builds outward from the
 * center over a 128-bar EPOCH: 8 concentric strata (one per 16-bar section)
 * x 16 elements (one per bar). The current bar's element assembles in four
 * QUANTIZED quarter-steps, one per beat. Even epochs accrete outward; odd
 * epochs DISASSEMBLE inward one element per bar under a shifted hue family;
 * every epoch re-shuffles which geometric vocabulary each stratum speaks —
 * the rebuild is always a different architecture.
 *
 * Two time axes at once (gen-19 focus):
 *   IMMEDIATE — every 16-bar section boundary opens a NEW ring with a NEW
 *   vocabulary + hue slam while the finished stratum snap-dims (one frame).
 *   LONG — fill fraction of the ring IS your position in the 128-bar epoch;
 *   minute-10 (a full rose disassembling) cannot be confused with minute-1
 *   (two lonely spokes).
 *
 * Element count is STATELESS from the bar ladder (robust to bar jumps and
 * deck swaps): count = bar-in-epoch, no drift possible.
 *
 * Band vocabulary: kick = whole-structure scale pump (solid, no powder);
 * snare = active-stratum outline flash; hats = glints on the newest element.
 * Stroke weights ride bandsSlow. Quantized assembly only — no eased growth.
 *
 * Flat law: dark floor, stroke-built geometry, committed saturated hues with
 * luminance parity, no dust, no feedback buffer, no blur.
 */

import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const TAU = Math.PI * 2;
const SECTION_BARS = 16;
const STRATA = 8;
const ELEMS = 16; // per stratum; EPOCH = STRATA * ELEMS = 128 bars
const EPOCH_BARS = STRATA * ELEMS;
const VOCAB_COUNT = 8;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** splitmix32 avalanche → stable [0,1). Same key ⇒ same architecture. */
function splitmix(key: number): () => number {
  let state = (Math.round(key) >>> 0) + 0x9e3779b9;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 4294967296;
  };
}

function dominantTrackId(frame: VisualizerFrameData): number | null {
  const dom = frame.decks.find((d) => d.channel === frame.dominantChannel);
  if (dom && dom.trackId != null) return dom.trackId;
  let best: number | null = null;
  let bestLevel = -1;
  for (const deck of frame.decks) {
    if (!deck.playing || deck.trackId == null) continue;
    if (deck.level > bestLevel) {
      bestLevel = deck.level;
      best = deck.trackId;
    }
  }
  return best;
}

function hsl(h: number, s: number, l: number, alpha = 1): string {
  return `hsla(${mod(h, 360).toFixed(1)}, ${s}%, ${Math.min(72, Math.max(0, l))}%, ${alpha})`;
}

interface EpochPlan {
  /** vocab index per stratum (shuffled 0..7). */
  vocab: number[];
  /** per-stratum deterministic detail seed. */
  seeds: number[];
  hueBase: number;
  hueStep: number;
  bgHue: number;
  dir: 1 | -1; // angular stagger direction
}

function planEpoch(genomeSeed: number, epoch: number): EpochPlan {
  const r = splitmix(genomeSeed ^ Math.imul(epoch + 1, 0x9e3779b1));
  const vocab: number[] = [];
  for (let i = 0; i < VOCAB_COUNT; i++) vocab.push(i);
  for (let i = vocab.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = vocab[i];
    vocab[i] = vocab[j];
    vocab[j] = t;
  }
  const seeds: number[] = [];
  for (let s = 0; s < STRATA; s++) seeds.push(Math.floor(r() * 1e9));
  const disassembling = mod(epoch, 2) === 1;
  return {
    vocab,
    seeds,
    // odd (disassembly) epochs shift the whole family — the rebuild reads new
    hueBase: r() * 360 + (disassembling ? 180 : 0),
    hueStep: 30 + r() * 22,
    bgHue: r() * 360,
    dir: r() < 0.5 ? 1 : -1,
  };
}

/** Draw element k (0..15) of a stratum in radius band [rIn, rOut] with
 * quantized assembly weight w (0.25/0.5/0.75/1). All strokes; deterministic
 * per (seed, k). */
function drawElement(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  vocab: number,
  seed: number,
  k: number,
  w: number,
  dir: number,
  lineW: number
): void {
  const r = splitmix(seed + k * 131);
  const a = (k / ELEMS) * TAU * dir + r() * 0.08;
  const band = rOut - rIn;
  const rMid = (rIn + rOut) * 0.5;
  ctx.lineWidth = lineW;
  ctx.beginPath();
  switch (vocab) {
    case 0: {
      // SPOKES: radial line grows outward in quarters.
      ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
      const rTip = rIn + band * w;
      ctx.lineTo(cx + Math.cos(a) * rTip, cy + Math.sin(a) * rTip);
      break;
    }
    case 1: {
      // CHORDS: line between two points on the band's mid circle.
      const a2 = a + TAU * (0.16 + r() * 0.22) * dir;
      const x1 = cx + Math.cos(a) * rMid;
      const y1 = cy + Math.sin(a) * rMid;
      const x2 = cx + Math.cos(a2) * rMid;
      const y2 = cy + Math.sin(a2) * rMid;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + (x2 - x1) * w, y1 + (y2 - y1) * w);
      break;
    }
    case 2: {
      // SHELL ARCS: an arc at a staggered radius, sweep grows in quarters.
      const rr = rIn + band * (0.2 + r() * 0.6);
      const sweep = (TAU / ELEMS) * 0.92 * w * dir;
      ctx.arc(cx, cy, rr, a, a + sweep, dir < 0);
      break;
    }
    case 3: {
      // ZIGZAG: V from inner edge up to outer and back, legs by quarters.
      const aM = a + (TAU / ELEMS) * 0.5 * dir;
      const aE = a + (TAU / ELEMS) * dir;
      ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
      const leg1 = Math.min(1, w * 2);
      const mx = cx + Math.cos(aM) * rOut;
      const my = cy + Math.sin(aM) * rOut;
      const sx = cx + Math.cos(a) * rIn;
      const sy = cy + Math.sin(a) * rIn;
      ctx.lineTo(sx + (mx - sx) * leg1, sy + (my - sy) * leg1);
      if (w > 0.5) {
        const leg2 = Math.min(1, (w - 0.5) * 2);
        const ex = cx + Math.cos(aE) * rIn;
        const ey = cy + Math.sin(aE) * rIn;
        ctx.lineTo(mx + (ex - mx) * leg2, my + (ey - my) * leg2);
      }
      break;
    }
    case 4: {
      // TICKS: up to four short radial ticks fanned inside the slot.
      const n = Math.max(1, Math.round(w * 4));
      for (let t = 0; t < n; t++) {
        const at = a + (TAU / ELEMS) * ((t + 0.5) / 4) * dir;
        const r0 = rIn + band * 0.18;
        const r1 = rIn + band * 0.82;
        ctx.moveTo(cx + Math.cos(at) * r0, cy + Math.sin(at) * r0);
        ctx.lineTo(cx + Math.cos(at) * r1, cy + Math.sin(at) * r1);
      }
      break;
    }
    case 5: {
      // SQUARES: a small diamond on the mid circle, side grows in quarters.
      const px = cx + Math.cos(a + (TAU / ELEMS) * 0.5 * dir) * rMid;
      const py = cy + Math.sin(a + (TAU / ELEMS) * 0.5 * dir) * rMid;
      const s = band * (0.22 + 0.3 * w);
      ctx.moveTo(px, py - s);
      ctx.lineTo(px + s, py);
      ctx.lineTo(px, py + s);
      ctx.lineTo(px - s, py);
      ctx.closePath();
      break;
    }
    case 6: {
      // TRIANGLES: outward-pointing wedge, apex extends in quarters.
      const aL = a;
      const aR = a + (TAU / ELEMS) * 0.8 * dir;
      const aM = a + (TAU / ELEMS) * 0.4 * dir;
      ctx.moveTo(cx + Math.cos(aL) * rIn, cy + Math.sin(aL) * rIn);
      const apexR = rIn + band * w;
      ctx.lineTo(cx + Math.cos(aM) * apexR, cy + Math.sin(aM) * apexR);
      ctx.lineTo(cx + Math.cos(aR) * rIn, cy + Math.sin(aR) * rIn);
      break;
    }
    default: {
      // GATES: two parallel radial posts; the lintel arc lands on the
      // final quarter.
      const half = (TAU / ELEMS) * 0.28;
      const post = Math.min(1, w / 0.75);
      for (const s of [-1, 1]) {
        const ap = a + (TAU / ELEMS) * 0.5 * dir + half * s;
        const rTip = rIn + band * 0.9 * post;
        ctx.moveTo(cx + Math.cos(ap) * rIn, cy + Math.sin(ap) * rIn);
        ctx.lineTo(cx + Math.cos(ap) * rTip, cy + Math.sin(ap) * rTip);
      }
      if (w >= 1) {
        const aC = a + (TAU / ELEMS) * 0.5 * dir;
        ctx.moveTo(
          cx + Math.cos(aC - half) * (rIn + band * 0.9),
          cy + Math.sin(aC - half) * (rIn + band * 0.9)
        );
        ctx.arc(cx, cy, rIn + band * 0.9, aC - half, aC + half, false);
      }
      break;
    }
  }
  ctx.stroke();
}

class StrataEngineRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;
  private seeded = false;
  private genomeSeed = 1;

  private plan: EpochPlan = planEpoch(1, 0);
  private planEpochIndex = -1;

  private prevSection: number | null = null;
  private sectionFlash = 0;

  private kickEnv = 0;
  private snareEnv = 0;
  private hatEnv = 0;

  private pseudoBeat = 0;

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const bands = frame.bands;
    const slow = frame.bandsSlow ?? frame.bands;
    const energy = Math.min(1, bands.low * 0.5 + bands.mid * 0.3 + bands.high * 0.2);

    // --- Genome ------------------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (!this.seeded) {
      this.genomeSeed =
        trackId ??
        (Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1);
      this.lastTrackId = trackId;
      this.seeded = true;
    } else if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.genomeSeed = trackId;
      this.planEpochIndex = -1; // re-plan under the new genome
    }

    // --- Meter (ladder tiers; pseudo-meter fallback) ------------------------
    const beat = frame.beat;
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    let bar: number;
    let barPhase: number;
    if (beat && tierBar !== null) {
      bar = tierBar;
      barPhase = clamp01(beat.barPhase);
    } else {
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      bar = Math.floor(this.pseudoBeat / 4);
      barPhase = clamp01(mod(this.pseudoBeat, 4) / 4);
    }

    const epoch = Math.floor(bar / EPOCH_BARS);
    const barInEpoch = mod(bar, EPOCH_BARS);
    const section = Math.floor(barInEpoch / SECTION_BARS);
    const building = mod(epoch, 2) === 0;

    if (epoch !== this.planEpochIndex) {
      this.plan = planEpoch(this.genomeSeed, epoch);
      this.planEpochIndex = epoch;
    }
    const plan = this.plan;

    // Quantized quarter-step assembly: the element under construction gains
    // 0.25 weight per beat — never eased.
    const quarters = Math.floor(barPhase * 4) / 4;
    const progressF = building
      ? barInEpoch + quarters
      : EPOCH_BARS - (barInEpoch + quarters);
    const countF = Math.max(0, Math.min(EPOCH_BARS, progressF));

    // --- Section slam tracking ----------------------------------------------
    if (this.prevSection === null) this.prevSection = section;
    if (section !== this.prevSection) {
      this.sectionFlash = 1;
      this.prevSection = section;
    }
    this.sectionFlash *= Math.exp(-dt / 0.4);

    // --- Impulse envelopes (instant attack, fast decay — solid responses) ---
    this.kickEnv = Math.max(this.kickEnv * Math.exp(-dt / 0.16), frame.impulse.low);
    this.snareEnv = Math.max(this.snareEnv * Math.exp(-dt / 0.2), frame.impulse.mid);
    this.hatEnv = Math.max(this.hatEnv * Math.exp(-dt / 0.1), frame.impulse.high);

    // --- Floor ---------------------------------------------------------------
    ctx.fillStyle = hsl(plan.bgHue + section * 24, 42, 5.5);
    ctx.fillRect(0, 0, width, height);

    // --- Geometry ------------------------------------------------------------
    const cx = width * 0.5;
    const cy = height * 0.5;
    const scaleParam = frame.params.scale ?? 1;
    // Kick pumps the whole structure's SCALE (solid response, not powder).
    const R = Math.min(width, height) * 0.47 * scaleParam * (1 + 0.045 * this.kickEnv);
    const weightParam = frame.params.weight ?? 1;

    // Active stratum = where the construction/demolition edge currently sits.
    const edgeStratum = Math.min(STRATA - 1, Math.floor(Math.min(EPOCH_BARS - 1, countF) / ELEMS));

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let s = 0; s < STRATA; s++) {
      const built = clamp01((countF - s * ELEMS) / ELEMS) * ELEMS; // 0..16
      if (built <= 0) continue;
      const rIn = R * (0.1 + (0.86 * s) / STRATA);
      const rOut = R * (0.1 + (0.86 * (s + 1)) / STRATA) - R * 0.012;
      const hue = plan.hueBase + s * plan.hueStep;
      const active = s === edgeStratum;
      const lineW =
        Math.max(1.2, R * (active ? 0.016 : 0.01) * weightParam * (0.75 + 0.5 * slow.low));
      const light = active ? 58 + 6 * bands.mid : 42;
      const sat = active ? 96 : 78;
      ctx.strokeStyle = hsl(hue, sat, light, active ? 1 : 0.85);
      const fullElems = Math.floor(built);
      const partial = built - fullElems;
      for (let k = 0; k < fullElems; k++) {
        drawElement(
          ctx, cx, cy, rIn, rOut, plan.vocab[s], plan.seeds[s], k, 1, plan.dir, lineW
        );
      }
      if (partial > 0 && fullElems < ELEMS) {
        // The element under construction: quantized weight, hat glint accent.
        drawElement(
          ctx, cx, cy, rIn, rOut, plan.vocab[s], plan.seeds[s], fullElems, partial, plan.dir, lineW
        );
        if (this.hatEnv > 0.05) {
          ctx.strokeStyle = hsl(hue + 40, 100, 66, 0.7 * this.hatEnv);
          drawElement(
            ctx, cx, cy, rIn, rOut, plan.vocab[s], plan.seeds[s], fullElems, partial, plan.dir,
            Math.max(1, lineW * 0.4)
          );
          ctx.strokeStyle = hsl(hue, sat, light);
        }
      }

      // Snare: active stratum outline flash (localized ring pair).
      if (active && this.snareEnv > 0.04) {
        ctx.strokeStyle = hsl(hue + 180, 90, 60, 0.55 * this.snareEnv);
        ctx.lineWidth = Math.max(1, R * 0.005);
        ctx.beginPath();
        ctx.arc(cx, cy, rIn, 0, TAU);
        ctx.arc(cx, cy, rOut, 0, TAU);
        ctx.stroke();
      }
    }

    // Section slam: the freshly opened (or newly demolishing) stratum's band
    // guides flare for ~0.4 s — a single-frame-legible boundary.
    if (this.sectionFlash > 0.02) {
      const s = edgeStratum;
      const rIn = R * (0.1 + (0.86 * s) / STRATA);
      const rOut = R * (0.1 + (0.86 * (s + 1)) / STRATA) - R * 0.012;
      const hue = plan.hueBase + s * plan.hueStep;
      ctx.strokeStyle = hsl(hue, 100, 64, 0.85 * this.sectionFlash);
      ctx.lineWidth = Math.max(1.5, R * 0.012 * this.sectionFlash);
      ctx.beginPath();
      ctx.arc(cx, cy, rIn, 0, TAU);
      ctx.arc(cx, cy, rOut, 0, TAU);
      ctx.stroke();
    }

    // Center core: a small solid disc whose fill shows epoch parity (build =
    // filled, disassemble = hollow) — the architecture's heartbeat.
    const coreR = R * 0.055 * (1 + 0.35 * this.kickEnv);
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, TAU);
    if (building) {
      ctx.fillStyle = hsl(plan.hueBase + edgeStratum * plan.hueStep, 90, 56);
      ctx.fill();
    } else {
      ctx.strokeStyle = hsl(plan.hueBase + edgeStratum * plan.hueStep, 90, 56);
      ctx.lineWidth = Math.max(1.5, R * 0.01);
      ctx.stroke();
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'structure scale', min: 0.6, max: 1.3, step: 0.05, default: 1 },
  { id: 'weight', label: 'stroke weight', min: 0.5, max: 2.0, step: 0.05, default: 1 },
];

const g19StrataEnginePreset: VisualizerPreset = {
  id: 'g19-strata-engine',
  name: 'g19 strata-engine',
  params,
  create: () => new StrataEngineRenderer(),
};

export default g19StrataEnginePreset;
