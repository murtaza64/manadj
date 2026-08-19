/**
 * "g13 skyline" (genetic arena g13, NOVEL; URBAN/MECHANICAL territory).
 *
 * A flat matte NIGHT CITY. Buildings are spectrum columns; their WINDOWS are a
 * quantized per-band light grid; traffic streams at the street; a bright
 * ELEVATOR car runs a shaft locked to the beat. Every lit window has an
 * audible cause. FLAT-appetite compliant: solid matte fills, hard-edged rects,
 * binary lit/dark windows, committed city schemes, a dark-but-not-void sky. No
 * feedback buffer, no glow haze — canvas 2D, source-over.
 *
 * The grammar (DISTINCT per band, quantized where it fits):
 *   - LOW  = building HEIGHTS/mass (bandsSlow.low), quantized to integer
 *            storeys. Kick (impulse.low, gated broadband) stamps a building's
 *            whole ground row lit.
 *   - MID  = window LIT-FRACTION climbing towers (bandsSlow.mid); snare
 *            (impulse.mid) sweeps a lit-window WAVE up one building.
 *   - HIGH = top-floor SPARKLE windows (impulse.high, discrete singles) + the
 *            speed/sharpness of traffic dashes.
 *   - BEAT = elevator steps a floor + lights it; traffic dashes march one lane
 *            cell (integer positions, one-way red / one-way white streams).
 *   - BAR  = spotlight tower rotates; street lane offset micro-shifts.
 *   - PHRASE(%4) = skyline RECOMPOSES from genome (hard cut).
 *   - SECTION(%16) = night PALETTE swap across committed city schemes.
 *   - DROP = city BLAZES toward full-lit, sky flips to loud tint, traffic
 *            doubles; luminance rides max(drop, energy) (rate-limited sky flip,
 *            local window flips — photosafe).
 *   - BUILDUP = windows flicker on in a tense climbing count; elevator hunts
 *            faster — tense-but-alive.
 *
 * Genome: dominant audible deck trackId seeds building count, per-building
 * widths + storey caps, phrase recomposition sequence, and starting scheme.
 *
 * Assigned tech: 24-band spectrum, bandsSlow, per-band impulses, beat phase,
 * ladder bar/phrase/section tiers, trend drop/buildup split, trackId genome.
 */

import { energyOf } from '../../style';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const PHRASE_BARS = 4;
const SECTION_BARS = 16;
const MAX_STOREYS = 22; // window rows cap in the tallest core building
const TRAFFIC_LANES = 32; // integer street cells the dashes march across

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** splitmix32 avalanche → stable [0,1). Same key ⇒ same skyline. */
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

/**
 * Committed night city schemes. [sky, loudTint, ...lights]:
 *   sky     = flat dark background (dark floor, never void)
 *   loudTint= the DROP sky flip color (deep, still legible against lights)
 *   lights  = window / elevator / traffic colors (bright saturated, no pastel)
 */
interface Scheme {
  sky: string;
  loud: string;
  window: string;
  windowAlt: string;
  elevator: string;
  trafficRed: string;
  trafficWhite: string;
}

const SCHEMES: Scheme[] = [
  // sodium-amber on indigo
  {
    sky: '#0a0e1f',
    loud: '#241033',
    window: '#ffb019',
    windowAlt: '#ff6a00',
    elevator: '#fff2c0',
    trafficRed: '#ff2a2a',
    trafficWhite: '#fff6d8',
  },
  // miami neon on near-black
  {
    sky: '#08040f',
    loud: '#1a0630',
    window: '#ff2fb0',
    windowAlt: '#12e0e0',
    elevator: '#b6ff2f',
    trafficRed: '#ff2f5e',
    trafficWhite: '#f0fbff',
  },
  // hazard cyberpunk on deep-purple
  {
    sky: '#0c0616',
    loud: '#2a0a3a',
    window: '#ff1e6e',
    windowAlt: '#2ea8ff',
    elevator: '#ffe11e',
    trafficRed: '#ff1e3c',
    trafficWhite: '#e8f4ff',
  },
  // blueprint dawn on navy
  {
    sky: '#04101f',
    loud: '#0a2a4a',
    window: '#2fd8ff',
    windowAlt: '#ffffff',
    elevator: '#ffd23f',
    trafficRed: '#ff5a3c',
    trafficWhite: '#ffffff',
  },
];

interface Building {
  x: number; // left edge, field fraction
  w: number; // width, field fraction
  cols: number; // window columns (integer)
  storeyCap: number; // max storeys this building can rise to (integer)
  hasElevator: boolean;
  elevatorCol: number; // which window column is the shaft
}

interface Genome {
  count: number; // 5..9 buildings
  widths: number[];
  storeyCaps: number[];
  colChoices: number[];
  elevatorBuilding: number;
  schemeStart: number;
  phraseSeq: number[]; // per-phrase recomposition selector
}

function makeGenome(key: number): Genome {
  const r = splitmix(key);
  const count = 5 + Math.floor(r() * 5); // 5..9
  const widths: number[] = [];
  const storeyCaps: number[] = [];
  const colChoices: number[] = [];
  for (let i = 0; i < count; i++) {
    widths.push(0.6 + r() * 0.8); // relative width weight
    storeyCaps.push(0.5 + r() * 0.5); // fraction of MAX_STOREYS
    colChoices.push(2 + Math.floor(r() * 4)); // 2..5 window columns
  }
  const phraseSeq = [0, 1, 2, 3].map(() => Math.floor(r() * 4));
  return {
    count,
    widths,
    storeyCaps,
    colChoices,
    elevatorBuilding: Math.floor(r() * count),
    schemeStart: Math.floor(r() * SCHEMES.length),
    phraseSeq,
  };
}

/** Build the concrete building layout for a phrase variant (hard cut). */
function layoutBuildings(genome: Genome, variant: number): Building[] {
  const r = splitmix(variant * 9173 + genome.count * 41 + 7);
  const gap = 0.012;
  // weighted widths → normalized fractions filling [margin, 1-margin]
  const margin = 0.03;
  const span = 1 - margin * 2 - gap * (genome.count - 1);
  let totalW = 0;
  const perm: number[] = [];
  for (let i = 0; i < genome.count; i++) perm.push(i);
  // variant reorders buildings (skyline recomposes)
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (const idx of perm) totalW += genome.widths[idx];
  const buildings: Building[] = [];
  let cursor = margin;
  for (let k = 0; k < perm.length; k++) {
    const idx = perm[k];
    const w = (genome.widths[idx] / totalW) * span;
    const cols = genome.colChoices[idx];
    const storeyCap = Math.max(
      4,
      Math.round(genome.storeyCaps[idx] * MAX_STOREYS)
    );
    buildings.push({
      x: cursor,
      w,
      cols,
      storeyCap,
      hasElevator: idx === genome.elevatorBuilding,
      elevatorCol: Math.floor(cols / 2),
    });
    cursor += w + gap;
  }
  return buildings;
}

class SkylineRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;
  private seeded = false;
  private genome: Genome = makeGenome(1);
  private buildings: Building[] = [];
  private schemeIndex = 0;

  // per-building lit-fraction (0..1) that climbs the tower (mid), plus a
  // ground-floor STAMP envelope (kick) and a rising window-WAVE (snare).
  private litFrac: number[] = [];
  private stampLife: number[] = [];
  private waveFloor: number[] = []; // current snare-wave crest floor (0..storeys)
  private waveLife: number[] = [];
  private sparkle: Array<{ col: number; row: number; life: number }> = [];

  private prevBar: number | null = null;
  private prevBeatCell: number | null = null;
  private beatCounter = 0;
  private spotlight = 0;

  private elevatorFloor = 0; // integer floor the car sits at
  private trafficOffset = 0; // integer lane cells the streams have marched
  private laneShift = 0;

  private snareLatched = false;
  private kickLatched = false;

  private smoothDrop = 0;
  private smoothBuildup = 0;
  private lastSkyFlipT = -1;
  private skyFlipOn = false;

  private pseudoBeat = 0;

  private reseed(key: number): void {
    this.genome = makeGenome(key);
    this.schemeIndex = this.genome.schemeStart;
    this.rebuild(0);
  }

  private rebuild(variant: number): void {
    this.buildings = layoutBuildings(this.genome, variant);
    const n = this.buildings.length;
    this.litFrac = new Array(n).fill(0);
    this.stampLife = new Array(n).fill(0);
    this.waveFloor = new Array(n).fill(0);
    this.waveLife = new Array(n).fill(0);
    this.sparkle = [];
    if (this.elevatorFloor > 0) this.elevatorFloor = 0;
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const beat = frame.beat;
    const bands = frame.bands;
    const slow = frame.bandsSlow ?? frame.bands;
    const energy = energyOf(bands);
    const spectrum = frame.spectrum;

    // --- Identity / genome ------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (!this.seeded) {
      const pseudo =
        trackId ??
        (Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1);
      this.reseed(pseudo);
      this.lastTrackId = trackId;
      this.seeded = true;
    } else if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }

    // --- Regime split (smoothed ~0.35 s; ride max(drop, energy)) ----------
    const lowPresence = clamp01((bands.low - 0.2) / 0.5);
    const rAlpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * rAlpha;
    this.smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    const drop = this.smoothDrop;
    const buildup = this.smoothBuildup;
    const sustain = clamp01(energy * 1.3);
    const drive = Math.max(drop, sustain);

    // --- Metric tiers -----------------------------------------------------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;

    if (hasGrid) {
      const barIndex = tierBar as number;
      const beatWithinBar = Math.floor(clamp01(beat!.barPhase) * beat!.beatsPerBar);
      const beatCell = barIndex * beat!.beatsPerBar + beatWithinBar;
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        this.onBeat();
        this.prevBeatCell = beatCell;
      }
      if (this.prevBar === null || barIndex !== this.prevBar) {
        this.onBar(barIndex);
        this.prevBar = barIndex;
      }
    } else {
      this.prevBar = null;
      this.pseudoBeat += dt * (0.6 + 2.2 * energy);
      const beatCell = Math.floor(this.pseudoBeat);
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        this.onBeat();
        if (mod(beatCell, 4) === 0) this.onBar(Math.floor(beatCell / 4));
        this.prevBeatCell = beatCell;
      }
    }

    // --- Per-building band mapping (24-band spectrum spread across towers) -
    const n = this.buildings.length;
    for (let i = 0; i < n; i++) {
      const specIdx = Math.floor((i / Math.max(1, n)) * spectrum.length);
      const specLvl = spectrum[Math.min(spectrum.length - 1, specIdx)] ?? 0;
      // lit fraction climbs with mid + this building's own band (smoothed).
      const targetLit = clamp01(slow.mid * 0.55 + specLvl * 0.6 + drive * 0.25);
      const climb = 1 - Math.exp(-dt / 0.28);
      this.litFrac[i] += (targetLit - this.litFrac[i]) * climb;
      // envelopes decay
      if (this.stampLife[i] > 0) this.stampLife[i] = Math.max(0, this.stampLife[i] - dt / 0.35);
      if (this.waveLife[i] > 0) {
        this.waveLife[i] = Math.max(0, this.waveLife[i] - dt / 0.6);
        // the wave crest climbs the tower over its life
        this.waveFloor[i] = (1 - this.waveLife[i]) * this.buildings[i].storeyCap;
      }
    }

    // --- Kick: ground-floor STAMP on a building (gated on impulse.low) -----
    if (frame.impulse.low > 0.33 && !this.kickLatched) {
      this.kickLatched = true;
      const b = n > 0 ? mod(this.beatCounter, n) : -1;
      if (b >= 0) this.stampLife[b] = 1;
    } else if (frame.impulse.low < 0.15) {
      this.kickLatched = false;
    }

    // --- Snare: a lit-window WAVE sweeps up one building -------------------
    if (frame.impulse.mid > 0.34 && !this.snareLatched) {
      this.snareLatched = true;
      const b = n > 0 ? mod(this.beatCounter + 2, n) : -1;
      if (b >= 0) this.waveLife[b] = 1;
    } else if (frame.impulse.mid < 0.15) {
      this.snareLatched = false;
    }

    // --- High: top-floor SPARKLE windows (discrete, gated) ----------------
    if (frame.impulse.high > 0.3 && this.sparkle.length < 40) {
      const b = n > 0 ? mod(this.beatCounter + Math.floor(frame.centroid * 5), n) : -1;
      if (b >= 0) {
        const bld = this.buildings[b];
        const storeys = Math.max(2, Math.round(bld.storeyCap * clamp01(0.4 + slow.low)));
        this.sparkle.push({
          col: b * 100 + Math.floor(Math.random() * bld.cols),
          row: storeys - 1 - Math.floor(Math.random() * 3),
          life: 1,
        });
      }
    }
    for (const sp of this.sparkle) sp.life -= dt / 0.18;
    this.sparkle = this.sparkle.filter((s) => s.life > 0);

    // --- Draw =============================================================
    const scheme = SCHEMES[mod(this.schemeIndex, SCHEMES.length)];

    // Sky: flat dark, drop flips to loud tint (rate-limited <= 2 Hz).
    const dropSky = drop > 0.32;
    if (dropSky) {
      if (frame.time - this.lastSkyFlipT > 0.5) {
        this.skyFlipOn = !this.skyFlipOn;
        this.lastSkyFlipT = frame.time;
      }
    } else {
      this.skyFlipOn = false;
    }
    ctx.fillStyle = dropSky && this.skyFlipOn ? scheme.loud : scheme.sky;
    ctx.fillRect(0, 0, width, height);

    const streetY = height * 0.82; // top of street band
    const skyTop = height * 0.06;
    const cityBase = streetY; // buildings stand on the street line
    const density = frame.params.density ?? 1;
    const storeyScale = frame.params.storeys ?? 1;
    const trafficParam = frame.params.traffic ?? 1;

    // ---- Buildings + windows --------------------------------------------
    for (let i = 0; i < n; i++) {
      const bld = this.buildings[i];
      const specIdx = Math.floor((i / Math.max(1, n)) * spectrum.length);
      const specLvl = spectrum[Math.min(spectrum.length - 1, specIdx)] ?? 0;
      // HEIGHT: quantized storeys from bandsSlow.low + this band + drive.
      const heightFrac = clamp01(slow.low * 0.5 + specLvl * 0.7 + drive * 0.3);
      const storeys = Math.max(
        3,
        Math.round(heightFrac * bld.storeyCap * storeyScale)
      );
      const px = bld.x * width;
      const pw = bld.w * width;
      const rowH = (cityBase - skyTop) / MAX_STOREYS;
      const bh = storeys * rowH;
      const py = cityBase - bh;

      // building mass: solid matte dark block (slightly lighter than sky).
      ctx.fillStyle = this.buildingBody(scheme);
      ctx.fillRect(Math.round(px), Math.round(py), Math.round(pw), Math.round(bh));

      // window grid: binary lit/dark squares, quantized.
      const cols = Math.max(1, Math.round(bld.cols * (0.7 + density * 0.6)));
      const cellW = pw / cols;
      const winSize = Math.min(cellW * 0.55, rowH * 0.55);
      const insetX = (cellW - winSize) / 2;
      const insetY = (rowH - winSize) / 2;
      const litN = Math.round(this.litFrac[i] * storeys);
      const stamp = this.stampLife[i];
      const wave = this.waveLife[i] > 0 ? this.waveFloor[i] : -1;
      const isSpotlight = i === mod(this.spotlight, Math.max(1, n));

      for (let row = 0; row < storeys; row++) {
        // storeys count from the ground up (row 0 = ground floor).
        // lit if: within climbing lit count, OR ground-row stamp, OR spotlight,
        // OR at the snare-wave crest, OR drop blaze.
        const groundStamp = stamp > 0.05 && row === 0;
        const inLit = row < litN;
        const atWave = wave >= 0 && Math.abs(row - wave) < 1.0;
        const blaze = drop > 0.4 && row < storeys * clamp01(0.5 + drive);
        const lit = isSpotlight || groundStamp || inLit || atWave || blaze;
        if (!lit) continue;
        const winY = cityBase - (row + 1) * rowH + insetY;
        let color = scheme.window;
        if (atWave) color = scheme.elevator;
        else if (groundStamp) color = scheme.windowAlt;
        else if ((row + i) % 3 === 0) color = scheme.windowAlt;
        ctx.fillStyle = color;
        for (let c = 0; c < cols; c++) {
          // buildup: windows flicker on in a climbing count (tense) — thin out
          // lit columns pseudo-randomly by buildup unless spotlight/blaze.
          if (buildup > 0.15 && !isSpotlight && !blaze) {
            const flick = ((row * 7 + c * 13 + this.beatCounter) % 5) / 5;
            if (flick > 1 - buildup * 0.6) continue;
          }
          const winX = px + c * cellW + insetX;
          ctx.fillRect(Math.round(winX), Math.round(winY), Math.ceil(winSize), Math.ceil(winSize));
        }
      }

      // ---- Elevator car: runs the shaft, lit block, quantized to floor ----
      if (bld.hasElevator) {
        const car = clamp01(this.elevatorFloor / Math.max(1, storeys - 1));
        const carRow = Math.round(car * (storeys - 1));
        const shaftC = Math.min(cols - 1, Math.floor(cols / 2));
        const carX = px + shaftC * cellW + insetX;
        const carY = cityBase - (carRow + 1) * rowH + insetY;
        ctx.fillStyle = scheme.elevator;
        ctx.fillRect(
          Math.round(carX - winSize * 0.15),
          Math.round(carY - rowH * 0.1),
          Math.ceil(winSize * 1.3),
          Math.ceil(winSize * 1.2)
        );
      }
    }

    // ---- Sparkle windows (discrete top-floor highs) ---------------------
    ctx.fillStyle = scheme.elevator;
    for (const sp of this.sparkle) {
      const b = Math.floor(sp.col / 100);
      if (b < 0 || b >= n) continue;
      const bld = this.buildings[b];
      const specIdx2 = Math.floor((b / Math.max(1, n)) * spectrum.length);
      const specLvl2 = spectrum[Math.min(spectrum.length - 1, specIdx2)] ?? 0;
      const heightFrac = clamp01(slow.low * 0.5 + specLvl2 * 0.7 + drive * 0.3);
      const storeys = Math.max(3, Math.round(heightFrac * bld.storeyCap * storeyScale));
      const cols = Math.max(1, Math.round(bld.cols * (0.7 + density * 0.6)));
      const px = bld.x * width;
      const pw = bld.w * width;
      const rowH = (cityBase - skyTop) / MAX_STOREYS;
      const cellW = pw / cols;
      const winSize = Math.min(cellW * 0.55, rowH * 0.55);
      const c = mod(sp.col, cols);
      const row = Math.min(storeys - 1, sp.row);
      const winX = px + c * cellW + (cellW - winSize) / 2;
      const winY = cityBase - (row + 1) * rowH + (rowH - winSize) / 2;
      const s = 1 + sp.life * 0.6;
      ctx.globalAlpha = clamp01(sp.life);
      ctx.fillRect(
        Math.round(winX - winSize * (s - 1) * 0.5),
        Math.round(winY - winSize * (s - 1) * 0.5),
        Math.ceil(winSize * s),
        Math.ceil(winSize * s)
      );
    }
    ctx.globalAlpha = 1;

    // ---- Street: flat band + one-way traffic dashes (integer lanes) -----
    ctx.fillStyle = this.streetBody(scheme);
    ctx.fillRect(0, Math.round(streetY), width, Math.ceil(height - streetY));

    const laneCount = TRAFFIC_LANES;
    const cellPx = width / laneCount;
    const dashW = cellPx * 0.5;
    const trafficDensity = Math.round(
      (0.25 + slow.high * 0.5 + (drop > 0.3 ? 0.35 : 0)) * laneCount
    );
    const rowRedY = streetY + (height - streetY) * 0.35;
    const rowWhiteY = streetY + (height - streetY) * 0.68;
    const dashH = (height - streetY) * 0.14;
    for (let l = 0; l < laneCount; l++) {
      const off = mod(l + this.trafficOffset + this.laneShift, laneCount);
      if (off >= trafficDensity) continue;
      // red stream marches right; white stream marches left (one-way each).
      const redX = mod(l * cellPx + this.trafficOffset * cellPx * trafficParam, width);
      const whiteX = mod(
        width - (l * cellPx + this.trafficOffset * cellPx * trafficParam),
        width
      );
      ctx.fillStyle = scheme.trafficRed;
      ctx.fillRect(Math.round(redX), Math.round(rowRedY), Math.ceil(dashW), Math.ceil(dashH));
      ctx.fillStyle = scheme.trafficWhite;
      ctx.fillRect(Math.round(whiteX), Math.round(rowWhiteY), Math.ceil(dashW), Math.ceil(dashH));
    }
  }

  private buildingBody(scheme: Scheme): string {
    // matte block slightly above sky luminance so silhouettes read.
    return this.mixHex(scheme.sky, '#ffffff', 0.06);
  }
  private streetBody(scheme: Scheme): string {
    return this.mixHex(scheme.sky, '#ffffff', 0.03);
  }

  private mixHex(a: string, b: string, t: number): string {
    const pa = this.parseHex(a);
    const pb = this.parseHex(b);
    const r = Math.round(lerp(pa[0], pb[0], t));
    const g = Math.round(lerp(pa[1], pb[1], t));
    const bl = Math.round(lerp(pa[2], pb[2], t));
    return `rgb(${r}, ${g}, ${bl})`;
  }
  private parseHex(h: string): [number, number, number] {
    const s = h.replace('#', '');
    return [
      parseInt(s.slice(0, 2), 16),
      parseInt(s.slice(2, 4), 16),
      parseInt(s.slice(4, 6), 16),
    ];
  }

  // --- Boundary handlers -------------------------------------------------
  private onBeat(): void {
    this.beatCounter++;
    // elevator steps a floor (quantized), bouncing at the ends.
    const dir = mod(Math.floor(this.beatCounter / 6), 2) === 0 ? 1 : -1;
    this.elevatorFloor = Math.max(0, Math.min(MAX_STOREYS - 1, this.elevatorFloor + dir));
    // traffic dashes march one lane cell.
    this.trafficOffset = mod(this.trafficOffset + 1, TRAFFIC_LANES);
  }

  private onBar(barIndex: number): void {
    // spotlight tower rotates; street lane offset micro-shifts (quantized).
    this.spotlight = mod(this.spotlight + 1, Math.max(1, this.buildings.length));
    const r = splitmix(barIndex * 3319 + this.schemeIndex * 17);
    this.laneShift = Math.floor(r() * 4);
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isPhrase) {
      const variant = this.genome.phraseSeq[
        mod(Math.floor(barIndex / PHRASE_BARS), this.genome.phraseSeq.length)
      ];
      this.rebuild(variant);
    }
    if (isSection) {
      this.schemeIndex = mod(
        this.genome.schemeStart + Math.floor(barIndex / SECTION_BARS),
        SCHEMES.length
      );
    }
  }
}

const params: PresetParam[] = [
  { id: 'density', label: 'window density', min: 0.5, max: 1.6, step: 0.05, default: 1 },
  { id: 'storeys', label: 'skyline height', min: 0.6, max: 1.3, step: 0.05, default: 1 },
  { id: 'traffic', label: 'traffic speed', min: 0, max: 2, step: 0.05, default: 1 },
];

const g13SkylinePreset: VisualizerPreset = {
  id: 'g13-skyline',
  name: 'g13 skyline',
  params,
  create: () => new SkylineRenderer(),
};

export default g13SkylinePreset;
