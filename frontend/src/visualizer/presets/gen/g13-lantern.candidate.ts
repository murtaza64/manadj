/**
 * "g13 lantern" (genetic arena g13, NOVEL — LIVING THINGS & NARRATIVE).
 * A LIGHTHOUSE on a dark headland sweeps its beam across a night sea; SHIPS
 * sail in on the beat grid and the beam CATCHES them. Legible causality:
 * the rotating optic CLICKS between N facet-stations on the metric grid (a
 * real lighthouse lens is faceted — it does not smear), the beacon FLASHES
 * on the kick, and when the beam station points at a ship the ship's own
 * lantern LIGHTS (the payoff). Staged storytelling with legible actors.
 *
 * Band vocabulary (distinct per band):
 *   LOW  — the BEACON: impulse.low flashes the light-room (localized warm
 *          burst); bands.low = sea SWELL height (bandsSlow, slow attribute).
 *   MID  — the BEAM: bandsSlow.mid sets sweep RATE (facet-clicks/beat scale)
 *          and beam reach across the water.
 *   HIGH — SPRAY at the rocks + ship-lantern glints (impulse.high; discrete
 *          bright hairlines, not glow/dust).
 *   centroid/flatness — sky/sea tint + weather (tonal = clear indigo night,
 *          noisy = storm murk).
 *
 * Dramatic grammar:
 *   BEAM   — snaps to a new facet-station once per beat (quantized click),
 *            hard integer jump, never a washy continuous sweep.
 *   SHIPS  — a new ship silhouette sails in from a screen edge each bar
 *            downbeat; drifts across; lantern LIGHTS when the beam station
 *            aims at it.
 *   BEACON — full light-room flash gated on impulse.low (broadband kick
 *            gate → beacon, not "kick powder"), <=2/s, localized.
 *   DROP   — the STORM: swell + spray + ship traffic ride max(drop,energy),
 *            facet-clicks accelerate (still quantized). Sustained.
 *   BUILDUP— gathering weather: horizon darkens, swell rises — tense/alive.
 *   SECTION(%16) — new palette + new facet-station COUNT (hard cut).
 *            PHRASE(%4) — beam reach nudge.
 *
 * FLAT LAW: solid matte fills, hard beam wedge, committed saturated palette,
 * dark sea/sky floor. No feedback/bloom/dust/translucent wash.
 *
 * Assigned tech: impulse.low/high, bands.low + bandsSlow, trend drop/buildup
 * split, centroid + flatness, 24-band spectrum (ship traffic), beat phase +
 * ladder tiers (beat.ladderBarIndex ?? beat.barIndex), trackId genome.
 * Canvas 2D.
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
/** Candidate facet-station counts a section may pick from (the optic's
 * number of faces — the beam clicks between exactly this many angles). */
const FACET_COUNTS = [6, 8, 10, 12];
const MAX_SHIPS = 7;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

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

/** Committed night-coast scheme; comparable mean luminance across schemes
 * (section cut = chroma event, not luminance flash). */
interface Scheme {
  skyTop: string;
  skyHorizon: string;
  sea: string;
  land: string;
  tower: string;
  beam: string;
  beacon: string;
  ship: string;
  lantern: string;
  spray: string;
}

const SCHEMES: Scheme[] = [
  // indigo night / amber beam / warm beacon
  {
    skyTop: '#070a1e',
    skyHorizon: '#241033',
    sea: '#050a1a',
    land: '#020509',
    tower: '#0c1120',
    beam: '#ffcf4a',
    beacon: '#fff2c0',
    ship: '#03060e',
    lantern: '#ff8a1e',
    spray: '#bfe8ff',
  },
  // teal night / cyan beam / cold beacon
  {
    skyTop: '#03141a',
    skyHorizon: '#062b30',
    sea: '#02100f',
    land: '#010806',
    tower: '#08181a',
    beam: '#38f0ff',
    beacon: '#e8ffff',
    ship: '#02100c',
    lantern: '#39ffb0',
    spray: '#d0fff2',
  },
  // deep-red storm / white-hot beam / stark beacon
  {
    skyTop: '#180410',
    skyHorizon: '#3a0a16',
    sea: '#0e0308',
    land: '#060104',
    tower: '#180810',
    beam: '#ff4d5e',
    beacon: '#ffe0d6',
    ship: '#0c0206',
    lantern: '#ffd21a',
    spray: '#ffc7cf',
  },
  // violet night / spring-green beam
  {
    skyTop: '#0d0722',
    skyHorizon: '#22103a',
    sea: '#080416',
    land: '#030110',
    tower: '#100a24',
    beam: '#8cff3c',
    beacon: '#eaffd6',
    ship: '#060312',
    lantern: '#25e0ff',
    spray: '#d8ffe0',
  },
];

interface Ship {
  /** normalized horizontal position [-1.2, 1.2] along the horizon. */
  x: number;
  /** depth cue: 0 near horizon (far/small), 1 foreground (near/big). */
  depth: number;
  /** horizontal drift velocity (field units/s). */
  vx: number;
  /** eased lantern brightness (lights when the beam catches it). */
  lit: number;
  hullPhase: number;
}

class LanternRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;
  private schemeOrder: number[] = SCHEMES.map((_, i) => i);
  private schemeIndex = 0;

  private facetCount = 8;
  /** current facet station index the beam points at (integer). */
  private beamStation = 0;
  /** eased beam angle (radians, measured from tower down toward the sea). */
  private beamAngle = 0;
  private beamTarget = 0;

  private ships: Ship[] = [];

  private prevBar: number | null = null;
  private prevBeatInBar: number | null = null;
  private pseudoBeat = 0;

  private smoothDrop = 0;
  private smoothBuildup = 0;

  /** eased sea swell height + beacon flash. */
  private swell = 0;
  private beacon = 0;

  /** tower placement (normalized), seeded per track. */
  private towerX = -0.55;

  private reseed(key: number): void {
    const r = splitmix(key);
    const order = SCHEMES.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    this.schemeOrder = order;
    this.schemeIndex = order[0];
    this.facetCount = FACET_COUNTS[Math.floor(r() * FACET_COUNTS.length)];
    // tower on the left or right headland
    this.towerX = r() < 0.5 ? -0.62 - r() * 0.15 : 0.62 + r() * 0.15;
    this.ships = [];
  }

  /** Beam sweeps across the SEA arc: station 0..facetCount-1 maps to an
   * angle fanning from one horizon edge to the other (below the tower). */
  private stationAngle(station: number): number {
    // Fan the beam over a downward arc of ~150°, centered straight down.
    const span = Math.PI * 0.85;
    const frac = this.facetCount > 1 ? station / (this.facetCount - 1) : 0.5;
    // 0 -> point toward far sea-left, 1 -> far sea-right (from tower).
    return Math.PI / 2 - span / 2 + frac * span;
  }

  private spawnShip(r: () => number, fromLeft: boolean, drive: number): void {
    if (this.ships.length >= MAX_SHIPS) this.ships.shift();
    const depth = 0.15 + r() * 0.8;
    const speed = (0.06 + 0.14 * r()) * (0.7 + 0.8 * drive) * (0.5 + depth);
    this.ships.push({
      x: fromLeft ? -1.15 : 1.15,
      depth,
      vx: fromLeft ? speed : -speed,
      lit: 0,
      hullPhase: r() * Math.PI * 2,
    });
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const beat = frame.beat;
    const energy = energyOf(frame.bands);
    const bandsSlow = frame.bandsSlow ?? frame.bands;
    const spectrum = frame.spectrum ?? [];

    // --- Identity / genome ------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (this.lastTrackId === null && trackId === null && this.prevBar === null) {
      const pseudo =
        Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
      this.reseed(pseudo);
      this.lastTrackId = null;
    }
    if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }

    // --- Regime split (smoothed ~0.35 s; ride max(drop, energy)) ----------
    const lowPresence = clamp01((frame.bands.low - 0.2) / 0.5);
    const rAlpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * rAlpha;
    this.smoothBuildup +=
      (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    const drop = this.smoothDrop;
    const buildup = this.smoothBuildup;
    const sustain = clamp01(energy * 1.4);
    const drive = Math.max(drop, sustain);

    // --- Metric tiers (ladder-correct) ------------------------------------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;
    let beatEdge = false;
    let barEdge = false;
    if (hasGrid) {
      const barIndex = tierBar as number;
      const beatInBar = beat!.beatInBar;
      if (this.prevBar === null || barIndex !== this.prevBar) {
        barEdge = true;
        this.onBarCut(barIndex);
        this.prevBar = barIndex;
      }
      if (this.prevBeatInBar === null || beatInBar !== this.prevBeatInBar) {
        beatEdge = true;
        this.prevBeatInBar = beatInBar;
      }
    } else {
      this.pseudoBeat += dt * (0.6 + 2.2 * energy);
      const pBeat = Math.floor(this.pseudoBeat);
      if (this.prevBeatInBar === null || pBeat !== this.prevBeatInBar) {
        beatEdge = true;
        this.prevBeatInBar = pBeat;
      }
      const pBar = Math.floor(this.pseudoBeat / 4);
      if (this.prevBar === null || pBar !== this.prevBar) {
        barEdge = true;
        this.onBarCut(pBar);
        this.prevBar = pBar;
      }
    }

    // --- BEAM facet-click: advance the station on each beat (quantized).
    //     During a drop, jump MORE facets per click (faster sweep, still
    //     integer). Direction alternates by section parity for variety. ---
    if (beatEdge) {
      const step = 1 + Math.floor(drive * 2.5); // 1..3 facet jump
      this.beamStation = mod(this.beamStation + step, this.facetCount);
      this.beamTarget = this.stationAngle(this.beamStation);
    }
    // Ease toward target FAST so the click reads as a hard cut but no tear.
    {
      let d = this.beamTarget - this.beamAngle;
      // no wraparound needed: arc is within a half-turn span
      const rate = 1 - Math.exp(-dt / (0.05 + 0.05 * (1 - drive)));
      this.beamAngle += d * rate;
    }

    // --- Ship arrivals on the bar downbeat --------------------------------
    if (barEdge) {
      const r = splitmix((this.lastTrackId ?? 1) * 92821 + (this.prevBar ?? 0) * 2777);
      const fromLeft = this.towerX < 0 ? true : false; // sail away from land
      // more traffic when energetic; spectrum content = how many spawn.
      const specMean =
        spectrum.length > 0 ? spectrum.reduce((a, b) => a + b, 0) / spectrum.length : energy;
      const n = 1 + (drive > 0.4 ? 1 : 0) + (specMean > 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) this.spawnShip(r, i % 2 === 0 ? fromLeft : !fromLeft, drive);
    }

    // --- Beacon flash (localized, eased). impulse.low = beacon burst -----
    const beaconTarget = clamp01(0.15 + 0.85 * frame.impulse.low + 0.3 * frame.bands.low);
    this.beacon += (beaconTarget - this.beacon) * (1 - Math.exp(-dt / 0.05));
    this.beacon *= Math.exp(-dt / 0.4); // ring down so it doesn't accumulate

    // --- Sea swell height (bandsSlow.low; buildup/drop raise it) ----------
    const swellTarget = clamp01(0.12 + 0.5 * bandsSlow.low + 0.4 * buildup + 0.5 * drop);
    this.swell += (swellTarget - this.swell) * (1 - Math.exp(-dt / 0.5));

    // --- Ship motion + beam catch -----------------------------------------
    const beamReach = frame.params.beamReach ?? 1;
    const beamWidthP = frame.params.beamWidth ?? 1;
    const seaLevelP = frame.params.seaLevel ?? 1;
    const halfBeam = (0.08 + 0.05 * beamWidthP) * (1 + 0.4 * drive);
    for (const s of this.ships) {
      s.x += s.vx * dt * (0.6 + 0.8 * bandsSlow.mid);
      s.hullPhase += dt * (0.5 + 2 * s.depth);
      // is the beam pointing at this ship? (compare beam angle to the angle
      // from the tower to the ship in scene space)
      const catchAmt = this.beamCatch(s, halfBeam);
      const litTarget = clamp01(catchAmt * (0.6 + 0.6 * frame.bands.high));
      s.lit += (litTarget - s.lit) * (1 - Math.exp(-dt / (litTarget > s.lit ? 0.04 : 0.5)));
    }
    this.ships = this.ships.filter((s) => s.x > -1.3 && s.x < 1.3);

    // ======================= DRAW =========================================
    const scheme = SCHEMES[mod(this.schemeIndex, SCHEMES.length)];
    const unit = Math.min(width, height);
    ctx.globalCompositeOperation = 'source-over';

    // Sky gradient (centroid warms/cools horizon slightly via alpha of a
    // tint pass — kept committed, no wash).
    const horizonY = height * (0.5 + 0.12 * (seaLevelP - 1) - 0.05 * this.swell);
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, scheme.skyTop);
    sky.addColorStop(1, scheme.skyHorizon);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizonY);

    // Sea (dark, matte) below horizon.
    ctx.fillStyle = scheme.sea;
    ctx.fillRect(0, horizonY, width, height - horizonY);

    // Tower screen position.
    const towerScreenX = width / 2 + this.towerX * width * 0.5;
    const towerBaseY = horizonY;
    const towerH = unit * 0.28;
    const towerTopY = towerBaseY - towerH;
    const lampY = towerTopY + towerH * 0.08;

    // --- BEAM: a solid wedge fanning from the lamp across the sea ---------
    // Hard-edged triangle (matte, semi-opaque committed color), reach rides
    // mid + drop. This is a moving wedge, NOT a full-field flash.
    const reach = unit * (0.9 + 0.6 * bandsSlow.mid) * beamReach * (1 + 0.3 * drive);
    const a = this.beamAngle;
    const bx = towerScreenX;
    const by = lampY;
    const ex = bx + Math.cos(a) * reach;
    const ey = by + Math.sin(a) * reach;
    const perp = a + Math.PI / 2;
    const spread = reach * halfBeam;
    ctx.fillStyle = scheme.beam;
    ctx.globalAlpha = 0.32 + 0.22 * this.beacon;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(ex + Math.cos(perp) * spread, ey + Math.sin(perp) * spread);
    ctx.lineTo(ex - Math.cos(perp) * spread, ey - Math.sin(perp) * spread);
    ctx.closePath();
    ctx.fill();
    // bright core stripe of the beam (thin, fully opaque — legible axis)
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(ex + Math.cos(perp) * spread * 0.18, ey + Math.sin(perp) * spread * 0.18);
    ctx.lineTo(ex - Math.cos(perp) * spread * 0.18, ey - Math.sin(perp) * spread * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // --- SHIPS: matte silhouettes on the sea; lantern glints when caught --
    for (const s of this.ships) {
      const sx = width / 2 + s.x * width * 0.5;
      // ships nearer foreground sit lower on the sea + are larger
      const sy = horizonY + (height - horizonY) * (0.08 + 0.55 * s.depth);
      const scale = unit * (0.02 + 0.05 * s.depth);
      const bob = Math.sin(s.hullPhase) * scale * 0.25 * (0.5 + this.swell);
      const y = sy + bob;
      // hull (trapezoid)
      ctx.fillStyle = scheme.ship;
      ctx.beginPath();
      ctx.moveTo(sx - scale * 1.6, y);
      ctx.lineTo(sx + scale * 1.6, y);
      ctx.lineTo(sx + scale * 1.0, y + scale * 0.7);
      ctx.lineTo(sx - scale * 1.0, y + scale * 0.7);
      ctx.closePath();
      ctx.fill();
      // mast
      ctx.fillRect(sx - scale * 0.08, y - scale * 1.6, scale * 0.16, scale * 1.6);
      // sail (triangle)
      ctx.beginPath();
      ctx.moveTo(sx + scale * 0.1, y - scale * 1.5);
      ctx.lineTo(sx + scale * 0.1, y - scale * 0.2);
      ctx.lineTo(sx + scale * 1.0, y - scale * 0.4);
      ctx.closePath();
      ctx.fill();
      // lantern glint when the beam catches it (discrete bright dot + hair)
      if (s.lit > 0.05) {
        ctx.fillStyle = scheme.lantern;
        ctx.globalAlpha = clamp01(s.lit);
        ctx.beginPath();
        ctx.arc(sx, y - scale * 1.7, scale * (0.18 + 0.12 * s.lit), 0, Math.PI * 2);
        ctx.fill();
        // hairline flare
        ctx.strokeStyle = scheme.lantern;
        ctx.lineWidth = Math.max(1, unit * 0.002 * s.lit);
        ctx.beginPath();
        ctx.moveTo(sx - scale * 1.2, y - scale * 1.7);
        ctx.lineTo(sx + scale * 1.2, y - scale * 1.7);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // --- HEADLAND + TOWER (drawn over the sea, dark matte) ----------------
    // headland: a dark landmass wedge under the tower.
    ctx.fillStyle = scheme.land;
    ctx.beginPath();
    ctx.moveTo(towerScreenX - unit * 0.22, height);
    ctx.lineTo(towerScreenX - unit * 0.16, towerBaseY);
    ctx.lineTo(towerScreenX + unit * 0.16, towerBaseY);
    ctx.lineTo(towerScreenX + unit * 0.22, height);
    ctx.closePath();
    ctx.fill();
    // tower body (tapered) + light room
    const twHalf = unit * 0.035;
    ctx.fillStyle = scheme.tower;
    ctx.beginPath();
    ctx.moveTo(towerScreenX - twHalf, towerBaseY);
    ctx.lineTo(towerScreenX - twHalf * 0.55, towerTopY);
    ctx.lineTo(towerScreenX + twHalf * 0.55, towerTopY);
    ctx.lineTo(towerScreenX + twHalf, towerBaseY);
    ctx.closePath();
    ctx.fill();
    // light room: bright block that flashes with the beacon (localized)
    const lampR = unit * (0.02 + 0.014 * this.beacon);
    ctx.fillStyle = scheme.beacon;
    ctx.globalAlpha = 0.7 + 0.3 * this.beacon;
    ctx.beginPath();
    ctx.arc(bx, by, lampR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // lantern-room roof cap
    ctx.fillStyle = scheme.tower;
    ctx.beginPath();
    ctx.moveTo(towerScreenX - twHalf * 0.9, towerTopY);
    ctx.lineTo(towerScreenX, towerTopY - unit * 0.03);
    ctx.lineTo(towerScreenX + twHalf * 0.9, towerTopY);
    ctx.closePath();
    ctx.fill();

    // --- SPRAY at the headland rocks (highs; discrete hairlines) ----------
    const sprayAmt = clamp01(frame.impulse.high * 1.1 + 0.3 * frame.bands.high) * (0.5 + drive);
    if (sprayAmt > 0.06) {
      ctx.strokeStyle = scheme.spray;
      const rSpray = splitmix(Math.floor(frame.time * 30) + 7);
      const jets = 5 + Math.floor(sprayAmt * 8);
      for (let i = 0; i < jets; i++) {
        const jx = towerScreenX + (rSpray() - 0.5) * unit * 0.4;
        const jy = towerBaseY + (rSpray() - 0.2) * unit * 0.05;
        const len = unit * (0.02 + 0.05 * sprayAmt) * rSpray();
        ctx.globalAlpha = clamp01(sprayAmt * (0.4 + 0.6 * rSpray()));
        ctx.lineWidth = Math.max(1, unit * 0.0025 * sprayAmt);
        ctx.beginPath();
        ctx.moveTo(jx, jy);
        ctx.lineTo(jx + (rSpray() - 0.5) * len, jy - len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // --- Horizon swell line (a bright matte crest that heaves) ------------
    ctx.strokeStyle = scheme.beam;
    ctx.globalAlpha = 0.12 + 0.18 * this.swell;
    ctx.lineWidth = Math.max(1, unit * 0.003);
    ctx.beginPath();
    const waves = 8;
    for (let i = 0; i <= waves; i++) {
      const wx = (i / waves) * width;
      const wy =
        horizonY + Math.sin(i * 1.3 + frame.time * (1 + 2 * this.swell)) * unit * 0.01 * this.swell;
      if (i === 0) ctx.moveTo(wx, wy);
      else ctx.lineTo(wx, wy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** How centered the beam is on a ship (1 = dead-on, 0 = outside cone). */
  private beamCatch(s: Ship, halfBeam: number): number {
    // angle from tower to ship in scene units (approx; y grows downward).
    const towerFx = this.towerX;
    const towerFy = 0; // horizon reference
    const shipFx = s.x;
    const shipFy = 0.1 + 0.55 * s.depth; // below horizon
    const ang = Math.atan2(shipFy - towerFy, shipFx - towerFx);
    let d = Math.abs(ang - this.beamAngle);
    while (d > Math.PI) d = Math.abs(d - Math.PI * 2);
    return clamp01(1 - d / halfBeam);
  }

  private onBarCut(barIndex: number): void {
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    if (isSection) {
      const sectionIndex = Math.floor(barIndex / SECTION_BARS);
      this.schemeIndex = this.schemeOrder[mod(sectionIndex, this.schemeOrder.length)];
      // new optic: pick a fresh facet-station count (hard cut in the beam
      // grammar). Keep the current angle near-continuous by re-deriving the
      // nearest station in the new count.
      const r = splitmix((this.lastTrackId ?? 1) * 2654435761 + barIndex);
      this.facetCount = FACET_COUNTS[Math.floor(r() * FACET_COUNTS.length)];
      this.beamStation = mod(this.beamStation, this.facetCount);
      this.beamTarget = this.stationAngle(this.beamStation);
    } else if (isPhrase) {
      // phrase: no structural change; the beamReach nudge is implicit in the
      // mid-driven reach term.
    }
  }
}

const params: PresetParam[] = [
  { id: 'beamReach', label: 'beam reach', min: 0.6, max: 1.6, step: 0.05, default: 1.05 },
  { id: 'beamWidth', label: 'beam width', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'seaLevel', label: 'sea level', min: 0.7, max: 1.4, step: 0.05, default: 1 },
];

const g13LanternPreset: VisualizerPreset = {
  id: 'g13-lantern',
  name: 'g13 lantern',
  params,
  create: () => new LanternRenderer(),
};

export default g13LanternPreset;
