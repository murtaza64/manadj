/**
 * "g11 tide" (genetic arena g11, novel — bass as MASS DISPLACEMENT).
 *
 * The falsifiable win condition: bass must read as a VOLUME OF WATER rising and
 * falling — a physical liquid mass that reveals and submerges the scene — not
 * as brightness, rings or a pump. A dark shoreline seen side-on; a luminous
 * liquid fills the frame from the bottom, its LEVEL driven by the bass.
 *
 * The representation:
 *  - BASS LEVEL (bandsSlow.low) = the TIDE height. Heavy bass = high water: the
 *    liquid mass climbs the frame and SUBMERGES rocks. Bass falls = the tide
 *    recedes and the rocks are REVEALED. Bass literally changes what geometry
 *    is visible. Rides the slow bands so the water level glides physically.
 *  - KICK (impulse.low, instantaneous) = a wave SLAMS the shore. A single swell
 *    (a raised gaussian bump on the surface) is SPAWNED and travels across the
 *    frame, breaking as it goes — a moving crest with a foam line, no flash.
 *  - MIDS (bands.mid) = surface CHOP: fine wavelet texture on the water top,
 *    its density and steepness growing with mid content; colored by the palette.
 *  - HIGHS (impulse.high) = discrete SPRAY glints at breaking crests only — a
 *    hard capped set (<=16 points) of crisp sparks thrown up where the surface
 *    is steep, never a particle field / dust.
 *  - ROCKS / STRUCTURES (trackId genome) = crisp dark silhouettes placed by the
 *    song's identity; the tide submerges/reveals them. Each song = its own
 *    coastline.
 *  - DROP (bass-weighted, smoothed) = STORM SURGE: water level maxes, continuous
 *    breakers march across, luminance rides max(drop, energy).
 *  - BUILDUP = DRAWBACK: the water pulls BACK (level dips below its bass rest)
 *    before the wave — the real ocean anticipation before a big set.
 *  - SECTION (ladderBarIndex) = time-of-day palette regime + a shoreline
 *    topology reshuffle (rocks re-placed) so boundaries are theatre.
 *
 * Rendering: Canvas 2D — crisp filled water body (a polyline surface), matte
 * rock silhouettes, discrete spray dots. No feedback glow; the water is a solid
 * luminous fill with a bright surface line. FLAT-appetite compliant. The "moves
 * ride bandsSlow, punches ride impulse" law is honored: the surface base height
 * and chop RATE ride the slow bands; the swell spawn and spray spawns ride the
 * instantaneous impulses.
 *
 * Assigned tech: band envelopes (low as tide volume, mid as chop), per-band
 * impulses (kick = swell, hat = spray), trend drop/buildup split (surge vs
 * drawback), deck trackId genome (g02-julia pattern), section via
 * ladderBarIndex.
 */

import { energyOf } from '../../style';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const params: PresetParam[] = [
  { id: 'tideRange', label: 'tide range', min: 0.3, max: 1.2, step: 0.05, default: 1 },
  { id: 'swellSpeed', label: 'wave swell speed', min: 0.3, max: 2, step: 0.05, default: 1 },
  { id: 'chop', label: 'surface chop', min: 0.3, max: 2, step: 0.05, default: 1 },
  { id: 'rockCount', label: 'shoreline rocks', min: 2, max: 10, step: 1, default: 5 },
  { id: 'surgeBright', label: 'surge brightness', min: 0.5, max: 2, step: 0.05, default: 1 },
];

// --- Song genome (JS-side, g02-julia pattern) --------------------------

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

interface Rock {
  cx: number; // 0..1 across frame
  baseY: number; // 0..1 up from bottom: rock summit height above seabed
  width: number; // 0..1
  jag: number; // silhouette jaggedness seed
}

interface Genome {
  rocks: Rock[];
  bank: number;
  seed: number;
}

function hashGenome(key: number, rockCount: number): Genome {
  const next = splitmix(Math.round(key));
  const bank = Math.floor(next() * 4);
  const seed = next();
  const rocks: Rock[] = [];
  for (let i = 0; i < rockCount; i++) {
    rocks.push({
      cx: (i + 0.5) / rockCount + (next() - 0.5) * (0.6 / rockCount),
      baseY: 0.18 + next() * 0.5, // summit between seabed and mid-frame
      width: 0.06 + next() * 0.1,
      jag: next(),
    });
  }
  return { rocks, bank, seed };
}

/** Time-of-day palette banks: [waterDeep, waterBright(surface), rock, spray].
 * Bright, saturated (no pastel). */
interface Bank {
  waterDeep: [number, number, number];
  waterHi: [number, number, number];
  rock: [number, number, number];
  spray: [number, number, number];
  sky: [number, number, number];
}

const BANKS: Bank[] = [
  // Night: deep indigo water, cyan surface glow, black rocks, white spray.
  {
    waterDeep: [10, 18, 70],
    waterHi: [40, 210, 255],
    rock: [4, 6, 14],
    spray: [220, 245, 255],
    sky: [6, 8, 22],
  },
  // Dawn: teal water, gold surface, slate rocks, warm spray.
  {
    waterDeep: [8, 60, 78],
    waterHi: [255, 190, 40],
    rock: [18, 20, 26],
    spray: [255, 235, 190],
    sky: [30, 22, 34],
  },
  // Day: azure water, white-cyan surface, dark rocks, white spray.
  {
    waterDeep: [12, 90, 190],
    waterHi: [180, 255, 255],
    rock: [10, 14, 20],
    spray: [255, 255, 255],
    sky: [16, 32, 60],
  },
  // Dusk: violet water, magenta surface, black rocks, pink spray.
  {
    waterDeep: [50, 12, 90],
    waterHi: [255, 60, 200],
    rock: [8, 4, 14],
    spray: [255, 200, 240],
    sky: [26, 8, 34],
  },
];

function rgb(c: [number, number, number], a = 1): string {
  return `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
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

interface Swell {
  x: number; // 0..1 position of the crest
  dir: number; // travel direction
  age: number; // seconds
  strength: number;
}

class TideRenderer implements PresetRenderer {
  private lastTime = 0;
  private seededKey: number | null = null;
  private genome: Genome = hashGenome(1, 5);
  private lastTrackId: number | null = null;
  private lastSection = -999;
  private smoothDrop = 0;
  private smoothBuildup = 0;
  private waterLevel = 0.3; // smoothed physical level (0..1)
  private swells: Swell[] = [];
  private phase = 0; // slow surface animation clock (rides slow bands)
  // Discrete spray points: {x, y, vy, age}.
  private spray: Array<{ x: number; y: number; vy: number; age: number }> = [];

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = this.lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - this.lastTime)) : 1 / 60;
    this.lastTime = frame.time;

    const bandsSlow = frame.bandsSlow ?? frame.bands;
    const energy = energyOf(frame.bands);

    const rockCount = Math.round(frame.params.rockCount ?? 5);

    // --- Identity: dominant trackId seeds coastline + palette.
    const trackId = dominantTrackId(frame);
    const key =
      trackId != null
        ? trackId
        : Math.round((energy * 4096 + frame.centroid * 811 + frame.spread * 173) * 131);
    if (this.seededKey == null) {
      this.seededKey = key;
      this.genome = hashGenome(key, rockCount);
      this.lastTrackId = trackId;
    } else if (trackId != null && trackId !== this.lastTrackId) {
      this.seededKey = key;
      this.genome = hashGenome(key, rockCount);
      this.lastTrackId = trackId;
    }

    // --- Regime split (smoothed ~0.35 s; bass-weighted drop).
    const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
    const rAlpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * rAlpha;
    this.smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    const sustained = Math.min(1, energy * 1.4);

    // --- Section: time-of-day palette + shoreline topology reshuffle.
    const barIndex = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? 0;
    const section = Math.floor(barIndex / 16);
    if (section !== this.lastSection) {
      this.lastSection = section;
      if (this.seededKey != null) {
        // Reshuffle coastline with a section-mixed key (theatre boundary).
        this.genome = hashGenome(this.seededKey + section * 1013, rockCount);
      }
    }
    const bank = BANKS[(this.genome.bank + section) % BANKS.length];

    // --- Bass TIDE level. Heavy bass raises the water; drop = storm surge to
    // max; buildup = DRAWBACK (water pulls back below rest before the wave).
    // Rides the SLOW bands (physical glide, no jerk).
    const tideRange = frame.params.tideRange ?? 1;
    const restLevel =
      0.16 + 0.55 * tideRange * bandsSlow.low + 0.3 * this.smoothDrop - 0.22 * this.smoothBuildup;
    const targetLevel = Math.max(0.05, Math.min(0.92, restLevel));
    // A little extra inertia so the mass reads as heavy water, not a slider.
    const lAlpha = 1 - Math.exp(-dt / 0.5);
    this.waterLevel += (targetLevel - this.waterLevel) * lAlpha;

    // --- KICK spawns a traveling swell (a wave slams the shore). Solid
    // response gated by impulse.low. Direction alternates so waves cross.
    const swellSpeed = frame.params.swellSpeed ?? 1;
    if (frame.impulse.low > 0.16) {
      const dir = this.swells.length % 2 === 0 ? 1 : -1;
      this.swells.push({
        x: dir > 0 ? -0.1 : 1.1,
        dir,
        age: 0,
        strength: Math.min(1, frame.impulse.low * 1.3),
      });
      if (this.swells.length > 6) this.swells.shift();
    }
    // Storm surge: continuous breakers on a strong drop.
    if (this.smoothDrop > 0.35 && Math.random() < this.smoothDrop * 0.35) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.swells.push({ x: dir > 0 ? -0.1 : 1.1, dir, age: 0, strength: 0.5 + 0.5 * this.smoothDrop });
      if (this.swells.length > 8) this.swells.shift();
    }
    // Advance swells across the frame; retire off-screen / old.
    const swellV = (0.35 + 0.4 * bandsSlow.low) * swellSpeed;
    for (const s of this.swells) {
      s.x += s.dir * swellV * dt;
      s.age += dt;
    }
    this.swells = this.swells.filter((s) => s.x > -0.25 && s.x < 1.25 && s.age < 6);

    // --- Surface animation clock rides the SLOW bands (chop RATE is a
    // velocity term — never the 8ms bands).
    const chop = frame.params.chop ?? 1;
    this.phase += dt * (0.6 + 1.4 * bandsSlow.mid) * chop;

    // ========================= DRAW =========================
    // Sky / backdrop: a flat matte fill (dark), slightly lifted by drop so the
    // storm sky glows a touch. Luminance rides max(drop, energy).
    const surgeBright = frame.params.surgeBright ?? 1;
    const lum = 0.75 + 0.45 * Math.max(this.smoothDrop, sustained) * surgeBright + 0.1 * this.smoothBuildup;
    const skyC = mix(bank.sky, bank.waterDeep, 0.15 + 0.25 * this.smoothDrop);
    ctx.fillStyle = rgb(skyC, 1);
    ctx.fillRect(0, 0, width, height);

    // --- Rocks: crisp dark silhouettes, drawn BEHIND the water so a rising
    // tide submerges them. Seabed at bottom.
    const seabedY = height; // bottom of frame
    for (const r of this.genome.rocks) {
      const rx = r.cx * width;
      const summitY = height - r.baseY * height; // higher baseY => taller rock
      const halfW = r.width * width;
      ctx.beginPath();
      ctx.moveTo(rx - halfW, seabedY);
      // Jagged silhouette: a few points up to the summit and back.
      const jn = 5;
      for (let j = 0; j <= jn; j++) {
        const t = j / jn;
        const jx = rx - halfW + t * halfW * 2;
        const bump = Math.sin(t * Math.PI); // arch profile
        const jitter = (Math.sin(j * 12.9 + r.jag * 40) * 0.5 + 0.5) * 0.35;
        const jy = seabedY - bump * (seabedY - summitY) * (0.7 + jitter);
        ctx.lineTo(jx, jy);
      }
      ctx.lineTo(rx + halfW, seabedY);
      ctx.closePath();
      ctx.fillStyle = rgb(bank.rock, 1);
      ctx.fill();
    }

    // --- The WATER BODY: a filled polygon whose top edge is the surface line.
    // Surface height = tide level + traveling swell bumps + chop wavelets.
    const cols = Math.max(48, Math.floor(width / 6));
    const surfaceY = (xn: number): number => {
      const baseLevel = this.waterLevel;
      // Traveling swells: a gaussian crest bump per swell.
      let swellLift = 0;
      let steep = 0; // surface steepness accumulator (for spray gating)
      for (const s of this.swells) {
        const d = xn - s.x;
        const g = Math.exp(-(d * d) / 0.004) * s.strength;
        swellLift += g * 0.14;
        // Steepness ~ derivative magnitude near the crest front.
        steep += Math.abs(d) < 0.08 ? g : 0;
      }
      // Chop wavelets: mid-driven fine ripples, riding the slow clock.
      const chopAmp = (0.01 + 0.05 * frame.bands.mid) * chop;
      const wavelet =
        Math.sin(xn * (26 + 30 * bandsSlow.mid) + this.phase * 6) * chopAmp +
        Math.sin(xn * 61 - this.phase * 9) * chopAmp * 0.4;
      const level = Math.min(0.98, baseLevel + swellLift + wavelet);
      // stash steepness on a side channel via closure return through map below
      void steep;
      return height - level * height;
    };

    // Build the surface path.
    ctx.beginPath();
    ctx.moveTo(0, height);
    const surfPts: Array<[number, number]> = [];
    for (let i = 0; i <= cols; i++) {
      const xn = i / cols;
      const sx = xn * width;
      const sy = surfaceY(xn);
      surfPts.push([sx, sy]);
      ctx.lineTo(sx, sy);
    }
    ctx.lineTo(width, height);
    ctx.closePath();

    // Fill with a vertical gradient: bright luminous surface fading to the
    // deep. The bright band at the top is where the "luminous liquid mass"
    // reads. Clamp gradient to the current water range.
    const topY = Math.min(...surfPts.map((p) => p[1]));
    const grad = ctx.createLinearGradient(0, topY, 0, height);
    const hi = mix(bank.waterHi, [255, 255, 255], 0.25 * this.smoothDrop);
    grad.addColorStop(0, rgb(hi.map((v) => Math.min(255, v * lum)) as [number, number, number], 0.95));
    grad.addColorStop(0.14, rgb(mix(bank.waterHi, bank.waterDeep, 0.4), 0.95));
    grad.addColorStop(1, rgb(bank.waterDeep, 0.98));
    ctx.fillStyle = grad;
    ctx.fill();

    // --- Bright crisp SURFACE LINE (the surface tension highlight) — a hard
    // 2px stroke along the top edge, brighter on the swell crests.
    ctx.lineWidth = Math.max(1.5, height * 0.0022);
    ctx.strokeStyle = rgb(hi.map((v) => Math.min(255, v * lum)) as [number, number, number], 0.9);
    ctx.beginPath();
    for (let i = 0; i <= cols; i++) {
      const [sx, sy] = surfPts[i];
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // --- FOAM lines at breaking crests: a short bright dash at each swell
    // front (no flash — localized moving crest).
    for (const s of this.swells) {
      const cx = s.x * width;
      if (cx < -20 || cx > width + 20) continue;
      const cyn = surfaceY(s.x);
      ctx.fillStyle = rgb(bank.spray, 0.85 * s.strength);
      const fw = width * 0.05;
      ctx.fillRect(cx - fw * 0.5, cyn - 3, fw, Math.max(2, height * 0.004));
    }

    // --- HIGHS: discrete SPRAY glints at breaking crests only. Spawn a small,
    // CAPPED number of points where a swell crest is steep + a hat impulse
    // lands. They arc up and fall (ballistic), then expire. Not dust.
    if (frame.impulse.high > 0.14 && this.swells.length > 0) {
      const budget = Math.min(6, Math.ceil(frame.impulse.high * 6));
      for (let k = 0; k < budget && this.spray.length < 16; k++) {
        // Pick a swell crest to spray from.
        const s = this.swells[(Math.random() * this.swells.length) | 0];
        const xn = s.x + (Math.random() - 0.5) * 0.04;
        const sy = surfaceY(xn);
        this.spray.push({
          x: xn * width,
          y: sy,
          vy: -(120 + Math.random() * 180) * (0.5 + 0.5 * s.strength),
          age: 0,
        });
      }
    }
    // Integrate + draw spray (crisp small squares, no glow).
    const gAcc = 520;
    ctx.fillStyle = rgb(bank.spray, 1);
    const nextSpray: typeof this.spray = [];
    for (const p of this.spray) {
      p.vy += gAcc * dt;
      p.y += p.vy * dt;
      p.age += dt;
      const surf = surfaceY(p.x / width);
      if (p.age < 1.2 && p.y < surf + 4) {
        const sz = Math.max(1.5, height * 0.003);
        const a = Math.max(0, 1 - p.age / 1.2);
        ctx.globalAlpha = a;
        ctx.fillRect(p.x - sz * 0.5, p.y - sz * 0.5, sz, sz);
        nextSpray.push(p);
      }
    }
    ctx.globalAlpha = 1;
    this.spray = nextSpray;

    // --- Buildup DRAWBACK cue: a faint receding wet line below the surface
    // when the water pulls back (dread). Localized, not a flash.
    if (this.smoothBuildup > 0.15) {
      const wetY = height - (this.waterLevel - 0.04) * height;
      ctx.strokeStyle = rgb(bank.waterHi, 0.12 * this.smoothBuildup);
      ctx.lineWidth = Math.max(1, height * 0.0015);
      ctx.beginPath();
      ctx.moveTo(0, wetY);
      ctx.lineTo(width, wetY);
      ctx.stroke();
    }
  }
}

const g11TidePreset: VisualizerPreset = {
  id: 'g11-tide',
  name: 'g11 tide',
  params,
  create: () => new TideRenderer(),
};

export default g11TidePreset;
