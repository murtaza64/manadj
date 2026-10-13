/**
 * g10-hillfog (gen-10 candidate, NOVEL — FLAT wave, Vissonance 'HillFog').
 *
 * Human ask: flat color schemes, less noisy.
 *
 * METAPHOR: layered flat HILLS at dusk. 4-5 solid-color silhouette layers
 * recede into a flat two-tone sky. HISTORY IS LANDSCAPE: the FRONT ridge's
 * silhouette IS the current low/mid spectrum (smooth interpolated ridgeline,
 * moving on bandsSlow); each layer behind it is a DELAYED snapshot of the
 * spectrum from a few beats ago (parallax recession — older spectra as
 * further hills). A flat sun/moon disc sits at a genome-chosen position;
 * highs spawn tiny flat chevron birds (<= 8, discrete — not particles).
 *
 * FLAT LAW: solid matte fills, hard ridge edges, committed 3-5 color schemes,
 * NO glow / bloom / haze / feedback smear / particles. Canvas 2D. The only
 * "depth" is flat-shaded overlapping polygons (Vissonance tradition). A flat
 * two-tone sky gradient is allowed (hard or soft boundary, no glow).
 *
 * DYNAMICS:
 *   - KICK: the front ridge bumps up one solid STEP (transform) + the sun
 *     disc pulses one size step. Both are eased-back transforms, never flashes.
 *   - SNARE: a bird flock (chevrons) crosses the sky.
 *   - PHRASE (ladderBarIndex ?? barIndex, %4): time-of-day palette advances
 *     one stop (dawn -> day -> dusk -> night), HARD CUT.
 *   - SECTION (%16): full scheme FAMILY swap (a new genome scheme set).
 *   - DROP: sky tone flips to the scheme's hottest flat color + the ridge
 *     history scrolls DOUBLE-SPEED, riding max(drop, energy) via bandsSlow.
 *   - BUILDUP: the sky's two tones CONVERGE toward one (flat tension).
 *
 * MOTION SMOOTHNESS (docs/visualizer-ga.md): ridge shape, history scroll rate,
 *   and disc drift ride frame.bandsSlow ?? frame.bands; instantaneous
 *   bands/impulse only drive pops (kick step, snare flock, hat glints). NO
 *   feedback buffer. Photosafe: every response is a transform or a hard color
 *   swap on the grid — no rate-limited flashes needed (no fullscreen luminance
 *   pulses at all).
 *
 * IDENTITY: sun/moon position + scheme families are a trackId GENOME (pattern
 *   g02-julia): a splitmix hash of the dominant audible deck's trackId seeds
 *   the disc position and the ordered time-of-day scheme set. Same song =>
 *   same sky.
 *
 * Assigned tech: 24-band spectrum (ridge silhouette + history), band
 *   envelopes (ridge on bandsSlow), impulses (kick step, snare flock, hat
 *   glints), energy trend (drop/buildup), ladder tiers (phrase palette /
 *   section family), deck trackId genome, bandsSlow motion.
 */

import { energyOf } from '../../style';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

// ---- Song genome (JS-side, pattern g02-julia) -------------------------

function splitmix(key: number): () => number {
  let state = (key >>> 0) + 0x9e3779b9;
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
  // dominant: smoothed frame.dominantChannel (layering jitter fix)
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

function mod(x: number, n: number): number {
  return ((x % n) + n) % n;
}

// ---- Time-of-day flat schemes -----------------------------------------
// Each scheme: two flat sky tones [top, bottom], a hottest flat color (drop),
// a disc color, an ordered list of layer colors (front -> back, receding),
// and a bird color. Committed 3-5 flat colors per scheme. Bright/saturated
// (repo dislikes pastels) except the intentionally muted night/dusk stones.

interface Scheme {
  skyTop: string;
  skyBottom: string;
  hot: string; // drop sky flip
  disc: string;
  layers: string[]; // front-most first
  bird: string;
}

// Four families; each family holds the four time-of-day stops (dawn/day/
// dusk/night). Phrase advances the stop; section swaps the family.
const SCHEME_FAMILIES: Scheme[][] = [
  // Family 0 — warm/coastal
  [
    { skyTop: '#1a2a6c', skyBottom: '#ff8c42', hot: '#ff3b3b', disc: '#ffe066', layers: ['#0d1b3a', '#22366b', '#3f5aa0', '#6f86c9'], bird: '#0a1224' },
    { skyTop: '#2aa7ff', skyBottom: '#bfe9ff', hot: '#ff9d00', disc: '#fff2a8', layers: ['#0e5aa7', '#2e86d6', '#5aa9ee', '#9fd0f7'], bird: '#0a3a6b' },
    { skyTop: '#3a1c71', skyBottom: '#ff6b35', hot: '#ff2e63', disc: '#ffb347', layers: ['#1b0f3a', '#3a1c6b', '#7a2f8f', '#c05299'], bird: '#160a2e' },
    { skyTop: '#05060f', skyBottom: '#12203f', hot: '#4b2fa0', disc: '#e8eaff', layers: ['#020308', '#080d1f', '#111a3a', '#1e2b52'], bird: '#03040a' },
  ],
  // Family 1 — emerald/teal
  [
    { skyTop: '#12343b', skyBottom: '#f9d371', hot: '#ff7b54', disc: '#fff3b0', layers: ['#052e2b', '#0a4d45', '#128277', '#37b3a4'], bird: '#031c1a' },
    { skyTop: '#00c2a8', skyBottom: '#d6fff6', hot: '#ffcd3c', disc: '#ffffff', layers: ['#016d5a', '#00a58a', '#3fd0b8', '#8ff0dd'], bird: '#014236' },
    { skyTop: '#134e5e', skyBottom: '#ff9d6c', hot: '#ff5e5b', disc: '#ffd07a', layers: ['#08333e', '#125e5e', '#2e8f7a', '#5cbf8f'], bird: '#052027' },
    { skyTop: '#020c0c', skyBottom: '#0a3d3a', hot: '#0fb39a', disc: '#c8fff2', layers: ['#010606', '#052422', '#0a3d3a', '#125e58'], bird: '#010504' },
  ],
  // Family 2 — magenta/violet
  [
    { skyTop: '#2b1055', skyBottom: '#ff6ec7', hot: '#ff206e', disc: '#ffd6f5', layers: ['#180a3a', '#331a6b', '#6a2fa0', '#a95ecf'], bird: '#120730' },
    { skyTop: '#9d4edd', skyBottom: '#ffd6ff', hot: '#ff5da2', disc: '#ffffff', layers: ['#5a189a', '#7b2cbf', '#a55fe0', '#d4a5f5'], bird: '#3a0d6b' },
    { skyTop: '#3d0a52', skyBottom: '#ff477e', hot: '#ff0a54', disc: '#ffb3c6', layers: ['#26063a', '#4a0f6b', '#8a1f8f', '#c34fa9'], bird: '#1c0430' },
    { skyTop: '#0a0514', skyBottom: '#2a1052', hot: '#7b2cbf', disc: '#e6d6ff', layers: ['#050208', '#12082a', '#26124f', '#3d1f73'], bird: '#040108' },
  ],
  // Family 3 — amber/rust
  [
    { skyTop: '#3a1f0a', skyBottom: '#ffb347', hot: '#ff5722', disc: '#fff0c2', layers: ['#241203', '#4a2810', '#7a4a1f', '#b3803f'], bird: '#160a02' },
    { skyTop: '#ff9f1c', skyBottom: '#ffe8c2', hot: '#ff4d00', disc: '#ffffff', layers: ['#c25e00', '#e07b1a', '#ffa53f', '#ffd08f'], bird: '#7a3a00' },
    { skyTop: '#4a1c1c', skyBottom: '#ff7043', hot: '#e63946', disc: '#ffcc7a', layers: ['#2e0f0f', '#5e2222', '#8f3f2e', '#c26f4f'], bird: '#1c0808' },
    { skyTop: '#0f0704', skyBottom: '#3a1f0f', hot: '#c25e2a', disc: '#ffe0b3', layers: ['#080402', '#1c0f07', '#3a220f', '#5e3a1f'], bird: '#050201' },
  ],
];

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbCss(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
}

function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return rgbCss(
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t
  );
}

const params: PresetParam[] = [
  { id: 'ridgeHeight', label: 'ridge height', min: 0.4, max: 1.6, step: 0.05, default: 1 },
  { id: 'historyDepth', label: 'history scroll depth', min: 0.3, max: 2, step: 0.05, default: 1 },
  { id: 'skySoftness', label: 'sky boundary softness', min: 0, max: 1, step: 0.05, default: 0.4 },
  { id: 'birdRate', label: 'bird flock size', min: 0, max: 1.5, step: 0.05, default: 1 },
];

// A ridge snapshot: a smoothed silhouette sampled from the spectrum.
type Ridge = number[]; // heights in [0,1] across RIDGE_SAMPLES columns

const RIDGE_SAMPLES = 40;
const LAYERS = 5; // front + 4 receding history layers

interface Bird {
  x: number; // 0..1 across the sky
  y: number; // 0..1 height
  vx: number;
  size: number;
  life: number;
}

class HillFogRenderer implements PresetRenderer {
  private lastTime = 0;
  // Ridge history ring: newest first. Each layer reads a delayed snapshot.
  private history: Ridge[] = [];
  private smoothRidge: Ridge = new Array(RIDGE_SAMPLES).fill(0.2);
  private scrollAccum = 0; // fractional-snapshot scroll position
  // Dynamics.
  private smoothDrop = 0;
  private smoothBuildup = 0;
  private smoothEnergy = 0;
  // Kick step (front ridge bump + disc pulse), eased back.
  private ridgeStep = 0;
  private discStep = 0;
  // Identity + scheme.
  private seededKey: number | null = null;
  private lastTrackId: number | null = null;
  private family = 0;
  private discX = 0.7;
  private discY = 0.3;
  private lastPhrase = -1;
  private lastSection = -1;
  private todStop = 2; // dawn=0 day=1 dusk=2 night=3 (start at dusk)
  // Birds.
  private birds: Bird[] = [];
  private prevSnare = 0;

  private applyGenome(key: number): void {
    const rnd = splitmix(Math.round(key));
    this.family = Math.floor(rnd() * SCHEME_FAMILIES.length);
    this.discX = 0.15 + rnd() * 0.7;
    this.discY = 0.12 + rnd() * 0.4;
  }

  private sampleRidge(frame: VisualizerFrameData, bandsSlow: {
    low: number;
    mid: number;
    high: number;
  }): Ridge {
    // The front ridge IS the low/mid spectrum: use the 24-band spectrum's
    // lower half for the silhouette, interpolated smooth across columns.
    const spec = frame.spectrum;
    const n = spec.length;
    const ridge: Ridge = new Array(RIDGE_SAMPLES);
    // Use lower ~60% of the spectrum (low/mid) for the ridge body.
    const usable = Math.max(4, Math.floor(n * 0.6));
    for (let i = 0; i < RIDGE_SAMPLES; i++) {
      const f = i / (RIDGE_SAMPLES - 1);
      const sp = f * (usable - 1);
      const i0 = Math.floor(sp);
      const i1 = Math.min(usable - 1, i0 + 1);
      const frac = sp - i0;
      const v = (spec[i0] ?? 0) * (1 - frac) + (spec[i1] ?? 0) * frac;
      ridge[i] = v;
    }
    // Fold in bandsSlow low/mid so the overall silhouette moves smoothly.
    const lift = 0.15 + 0.5 * bandsSlow.low + 0.35 * bandsSlow.mid;
    for (let i = 0; i < RIDGE_SAMPLES; i++) {
      ridge[i] = Math.min(1, ridge[i] * 0.8 + lift * 0.4);
    }
    // Smooth the silhouette (3-tap) so it's a rolling ridgeline, not spikes.
    const out: Ridge = new Array(RIDGE_SAMPLES);
    for (let i = 0; i < RIDGE_SAMPLES; i++) {
      const a = ridge[Math.max(0, i - 1)];
      const b = ridge[i];
      const c = ridge[Math.min(RIDGE_SAMPLES - 1, i + 1)];
      out[i] = (a + 2 * b + c) / 4;
    }
    return out;
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt =
      this.lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - this.lastTime)) : 1 / 60;
    this.lastTime = frame.time;

    const ridgeHeight = frame.params.ridgeHeight ?? 1;
    const historyDepth = frame.params.historyDepth ?? 1;
    const skySoftness = frame.params.skySoftness ?? 0.4;
    const birdRate = frame.params.birdRate ?? 1;

    const bandsSlow = frame.bandsSlow ?? frame.bands;

    // ---- Dynamics (voyage idiom) ----
    const smoothAlpha = 1 - Math.exp(-dt / 0.35);
    const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * smoothAlpha;
    this.smoothBuildup +=
      (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * smoothAlpha;
    const energy = energyOf(frame.bands);
    this.smoothEnergy += (Math.min(1, energy * 1.4) - this.smoothEnergy) * (1 - Math.exp(-dt / 0.5));
    const sustain = Math.max(this.smoothDrop, this.smoothEnergy);

    // ---- Identity: trackId genome (disc position + scheme family) ----
    const trackId = dominantTrackId(frame);
    const key =
      trackId != null
        ? trackId
        : Math.round((frame.centroid * 4096 + frame.spread * 811 + this.smoothEnergy * 173) * 131);
    if (this.seededKey == null) {
      this.seededKey = key;
      this.lastTrackId = trackId;
      this.applyGenome(key);
    } else if (trackId != null && trackId !== this.lastTrackId) {
      this.seededKey = key;
      this.lastTrackId = trackId;
      this.applyGenome(key);
    }

    // ---- Metric ladder: phrase = palette stop, section = family swap ----
    const beat = frame.beat;
    const barOrdinal = beat ? (beat.ladderBarIndex ?? beat.barIndex) : 0;
    const phrase = Math.floor(barOrdinal / 4);
    const section = Math.floor(barOrdinal / 16);
    if (phrase !== this.lastPhrase && this.lastPhrase >= 0) {
      this.todStop = mod(this.todStop + 1, 4); // dawn->day->dusk->night, hard cut
    }
    this.lastPhrase = phrase;
    if (section !== this.lastSection && this.lastSection >= 0) {
      this.family = mod(this.family + 1 + Math.floor(this.smoothEnergy * 2), SCHEME_FAMILIES.length);
    }
    this.lastSection = section;

    const scheme = SCHEME_FAMILIES[this.family][this.todStop];

    // ---- Ridge sampling + history ring ----
    const fresh = this.sampleRidge(frame, bandsSlow);
    // Smooth the live front ridge toward the fresh sample (bandsSlow-paced).
    const ridgeAlpha = 1 - Math.exp(-dt / 0.12);
    for (let i = 0; i < RIDGE_SAMPLES; i++) {
      this.smoothRidge[i] += (fresh[i] - this.smoothRidge[i]) * ridgeAlpha;
    }

    // Push snapshots into the history ring at a rate scaled by bandsSlow +
    // drop (drop = double-speed scroll). Snapshot spacing is a fixed cadence.
    const scrollHz =
      (0.6 + 1.4 * bandsSlow.mid + 0.8 * bandsSlow.low) *
      historyDepth *
      (1 + 1.0 * sustain); // drop scrolls history double-speed via max(drop,energy)
    this.scrollAccum += dt * scrollHz;
    while (this.scrollAccum >= 1) {
      this.scrollAccum -= 1;
      this.history.unshift(this.smoothRidge.slice());
      if (this.history.length > LAYERS * 6 + 4) this.history.pop();
    }
    if (this.history.length === 0) this.history.push(this.smoothRidge.slice());

    // ---- Kick: front ridge bumps one step + disc pulses one step ----
    const kick = frame.impulse.low;
    if (kick > 0.3) {
      this.ridgeStep = Math.max(this.ridgeStep, Math.min(1, kick * 1.2));
      this.discStep = Math.max(this.discStep, Math.min(1, kick * 1.2));
    }
    this.ridgeStep = Math.max(0, this.ridgeStep - dt / 0.22);
    this.discStep = Math.max(0, this.discStep - dt / 0.3);

    // ---- Snare: spawn a bird flock crossing the sky ----
    const snare = frame.impulse.mid;
    if (snare > 0.3 && this.prevSnare <= 0.3) {
      const n = Math.min(8, 3 + Math.floor(snare * 5 * birdRate));
      const dir = Math.random() < 0.5 ? 1 : -1;
      const y0 = 0.12 + Math.random() * 0.3;
      for (let i = 0; i < n; i++) {
        this.birds.push({
          x: dir > 0 ? -0.05 - i * 0.04 : 1.05 + i * 0.04,
          y: y0 + (Math.random() - 0.5) * 0.08,
          vx: dir * (0.12 + Math.random() * 0.06),
          size: 0.012 + Math.random() * 0.01,
          life: 1,
        });
      }
    }
    this.prevSnare = snare;
    // Advance + cull birds.
    for (const b of this.birds) {
      b.x += b.vx * dt;
      b.y += Math.sin(frame.time * 3 + b.x * 20) * 0.004;
      b.life -= dt / 8;
    }
    this.birds = this.birds.filter((b) => b.life > 0 && b.x > -0.15 && b.x < 1.15);
    if (this.birds.length > 40) this.birds.splice(0, this.birds.length - 40);

    // =================================================================
    // DRAW — flat sky, flat-shaded receding hill polygons, flat disc + birds.
    // =================================================================

    // ---- Sky: two flat tones. Buildup CONVERGES them (flat tension). Drop
    // flips the bottom to the scheme's hottest color. Boundary soft/hard.
    const converge = Math.min(0.85, this.smoothBuildup * 0.9);
    const skyTop = scheme.skyTop;
    let skyBottom = scheme.skyBottom;
    // Drop: bottom flips to hot flat color, ride max(drop,energy).
    const dropHot = Math.min(1, Math.max(0, (sustain - 0.35) / 0.4));
    skyBottom = mixHex(skyBottom, scheme.hot, dropHot);
    const skyTopC = mixHex(skyTop, skyBottom, converge * 0.5);
    const skyBotC = mixHex(skyBottom, skyTop, converge * 0.5);

    const horizon = height * 0.62;
    if (skySoftness < 0.08) {
      // Hard two-tone: solid top block + solid bottom block.
      ctx.fillStyle = skyTopC;
      ctx.fillRect(0, 0, width, horizon * 0.75);
      ctx.fillStyle = skyBotC;
      ctx.fillRect(0, horizon * 0.75, width, height - horizon * 0.75);
    } else {
      // Soft (but not glowy) flat gradient between the two committed tones.
      const grad = ctx.createLinearGradient(0, 0, 0, horizon);
      grad.addColorStop(0, skyTopC);
      grad.addColorStop(Math.max(0.05, 0.6 - skySoftness * 0.3), skyTopC);
      grad.addColorStop(1, skyBotC);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, horizon);
      ctx.fillStyle = skyBotC;
      ctx.fillRect(0, horizon, width, height - horizon);
    }

    // ---- Sun/moon disc: flat, genome-positioned, pulses one size step on
    // kick. Solid fill, hard edge (no glow).
    const discBaseR = Math.min(width, height) * 0.06;
    const discR = discBaseR * (1 + 0.18 * this.discStep + 0.08 * sustain);
    const dcx = this.discX * width + Math.sin(frame.time * 0.05) * width * 0.01;
    const dcy = this.discY * horizon;
    ctx.fillStyle = scheme.disc;
    ctx.beginPath();
    ctx.arc(dcx, dcy, discR, 0, Math.PI * 2);
    ctx.fill();

    // ---- Birds (chevrons): tiny flat V shapes, hard-edged, not particles.
    ctx.strokeStyle = scheme.bird;
    ctx.lineWidth = Math.max(1.5, Math.min(width, height) * 0.003);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const b of this.birds) {
      const bx = b.x * width;
      const by = b.y * horizon;
      const s = b.size * width * (0.7 + 0.3 * Math.sin(frame.time * 8 + b.x * 30));
      ctx.beginPath();
      ctx.moveTo(bx - s, by);
      ctx.lineTo(bx, by - s * 0.5);
      ctx.lineTo(bx + s, by);
      ctx.stroke();
    }

    // ---- Hill layers: front + receding history. Each layer reads a delayed
    // history snapshot (parallax recession). Flat-shaded solid polygons, hard
    // ridge edges, drawn back-to-front so nearer hills overlap farther ones.
    const drawRidge = (ridge: Ridge, baseY: number, amp: number, color: string, extraStep: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let i = 0; i < RIDGE_SAMPLES; i++) {
        const x = (i / (RIDGE_SAMPLES - 1)) * width;
        const h = ridge[i] * amp * ridgeHeight;
        const y = baseY - h * height - extraStep;
        if (i === 0) ctx.lineTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
    };

    // Back layers first (index LAYERS-1 furthest). Each layer i reads history
    // delayed by i * spacing snapshots; further layers sit higher (recession)
    // and use the darker/receding layer colors.
    const spacing = 4; // snapshots between adjacent layers
    for (let li = LAYERS - 1; li >= 0; li--) {
      const histIdx = Math.min(this.history.length - 1, li * spacing);
      const ridge = li === 0 ? this.smoothRidge : this.history[histIdx];
      // Recession: further layers sit higher on screen and shorter amplitude.
      const t = li / (LAYERS - 1);
      // BUGFIX (human: "hillfog is still bugged"): recession was inverted —
      // far layers sat LOWEST and the front polygon (which fills to the
      // bottom edge, drawn last) covered every other layer, killing the
      // parallax entirely. Far ridgelines belong near the horizon; the front
      // ridge belongs at the bottom so nearer hills correctly overlap
      // farther ones.
      const baseY = horizon + (height - horizon) * (0.15 + 0.85 * (1 - t));
      const amp = 0.16 * (1 - 0.35 * t);
      // Layer color: front-most uses layers[0] (darkest silhouette), back
      // layers fade toward the sky bottom (atmospheric recession, flat mix).
      const layerCol = scheme.layers[Math.min(scheme.layers.length - 1, li)];
      const recede = t * 0.45;
      const col = mixHex(layerCol, skyBotC, recede);
      // Front ridge gets the kick step bump (transform).
      const extraStep = li === 0 ? this.ridgeStep * height * 0.03 : 0;
      drawRidge(ridge, baseY, amp, col, extraStep);
    }
  }
}

const g10HillFogPreset: VisualizerPreset = {
  id: 'g10-hillfog',
  name: 'g10 hillfog',
  params,
  create: () => new HillFogRenderer(),
};

export default g10HillFogPreset;
