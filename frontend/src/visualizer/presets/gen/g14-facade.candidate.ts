/**
 * g14-facade (gen-14 NOVEL — architecture resurrection #4). Fossils
 * g02-monolith / g03-monolith-lux / g06-negative read only for the
 * autopsy: "the smoke is really bad"; haze stacking, floaty cameras, and
 * near-black illegibility killed the family.
 *
 * The remake's constitution:
 * - NO fog term, NO screen-space noise overlay, NO feedback buffer, NO
 *   volumetrics. Hard surfaces, hard light.
 * - The camera is a TRIPOD: static between SECTION-boundary cuts among 4
 *   genome vantage points (hardcut grammar). Zero translation per frame.
 * - Matte-dark towers; ALL the music lives in the WINDOWS:
 *   - lit pattern re-hashes every BAR (quantized city event),
 *   - three strata lit by low/mid/high (EQ = which floors are awake),
 *   - kick = flood wave rising the facades (localized, ~2 s decay),
 *   - snare = one hashed window cluster flashes,
 *   - hats = rooftop beacon glints,
 *   - phrase = one new tower rises (geometry),
 *   - section = cut + massing re-roll + palette bank step,
 *   - drop = citywide lit surge (held on max(drop, energy)),
 *   - buildup = light migrates UP the strata.
 * - Lit-fraction floor: the skyline never goes black.
 *
 * Photosafety: no full-field flash envelope; floods/clusters/beacons are
 * localized. Section cuts are scene changes with luminance-parity banks.
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform vec3 u_camPos;
uniform vec3 u_camTgt;
uniform float u_massing;   // section massing seed
uniform float u_barSeed;   // per-bar window re-hash seed
uniform float u_pitch;     // tower pitch (density param)
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_litFloor;
uniform float u_glowGain;
uniform float u_floodY;    // kick flood front height
uniform float u_floodAmp;
uniform float u_clusterX;  // snare cluster center (world x)
uniform float u_clusterAmp;
uniform float u_beacon;    // hat beacon envelope
uniform float u_riseCell;  // phrase-rising tower cell
uniform float u_riseAmt;   // its rise progress 0..1
uniform float u_drop;
uniform float u_buildup;
uniform float u_lift;      // max(drop, sustained)
uniform float u_bank;      // palette bank 0..3 (eased)
uniform float u_warm;      // centroid temperature EMA

const float RANK_B = 2.6;

float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453123); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

// Window-light banks: saturated, luminance-comparable (chroma events).
vec3 bank0(float t) { return vec3(0.50, 0.34, 0.16) + vec3(0.50, 0.38, 0.30) * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.12, 0.35))); }
vec3 bank1(float t) { return vec3(0.18, 0.36, 0.50) + vec3(0.30, 0.42, 0.50) * cos(6.28318 * (vec3(0.8, 1.0, 0.9) * t + vec3(0.5, 0.2, 0.0))); }
vec3 bank2(float t) { return vec3(0.44, 0.18, 0.44) + vec3(0.46, 0.34, 0.46) * cos(6.28318 * (vec3(1.0, 0.8, 0.9) * t + vec3(0.1, 0.55, 0.3))); }
vec3 bank3(float t) { return vec3(0.20, 0.46, 0.30) + vec3(0.34, 0.48, 0.40) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.35, 0.0, 0.5))); }

vec3 bankCol(float t) {
  float x = clamp(u_bank, 0.0, 3.0);
  vec3 c = mix(bank0(t), bank1(t), clamp(x, 0.0, 1.0));
  c = mix(c, bank2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, bank3(t), clamp(x - 2.0, 0.0, 1.0));
  c += vec3(0.12, 0.02, -0.10) * (u_warm - 0.5) + vec3(0.08, 0.0, -0.05) * u_drop;
  return max(c, vec3(0.0));
}

float sdBox(vec3 p, vec3 b) {
  vec3 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

float towerH(float cell, float rankOff) {
  float h = 1.0 + 2.6 * hash11(cell * 17.3 + rankOff * 5.7 + u_massing);
  // Phrase riser: one chosen rank-A cell grows a new tower.
  if (rankOff < 0.5 && abs(cell - u_riseCell) < 0.1) {
    h += u_riseAmt * 1.8;
  }
  return h;
}

float sdRank(vec3 p, float z0, float rankOff) {
  float cell = floor(p.x / u_pitch + 0.5);
  float cx = cell * u_pitch;
  float w = u_pitch * (0.26 + 0.15 * hash11(cell * 7.7 + rankOff * 3.1 + u_massing));
  float h = towerH(cell, rankOff);
  float dp = 0.45 + 0.3 * hash11(cell * 5.1 + rankOff + u_massing);
  return sdBox(vec3(p.x - cx, p.y - h * 0.5, p.z - z0), vec3(w, h * 0.5, dp));
}

float map(vec3 p) {
  float d = p.y;                       // ground plane
  d = min(d, sdRank(p, 0.0, 0.0));     // near rank
  d = min(d, sdRank(p, RANK_B, 1.0));  // far rank
  return d;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.004, -0.004);
  return normalize(
    e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx)
    + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 s = (uv - 0.5) * vec2(aspect, 1.0);

  // Tripod camera: basis from fixed pos/target (no per-frame motion).
  vec3 fw = normalize(u_camTgt - u_camPos);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * 1.35 + rt * s.x + up * s.y);
  vec3 ro = u_camPos;

  // Sphere trace (relaxed step near repeated-cell borders).
  float t = 0.0;
  float hit = -1.0;
  vec3 p = ro;
  for (int i = 0; i < 56; i++) {
    p = ro + rd * t;
    float d = map(p);
    if (d < 0.0025 * (1.0 + t)) { hit = 1.0; break; }
    t += d * 0.85;
    if (t > 34.0) break;
  }

  // ---- Sky: flat dark gradient + sparse stars. No fog anywhere.
  float skyY = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(vec3(0.030, 0.020, 0.055), vec3(0.004, 0.004, 0.014), skyY);
  sky += bankCol(0.6) * 0.03 * (1.0 - skyY);   // faint horizon color
  vec2 srd = rd.xy / max(0.2, rd.z + 1.2);
  float star = step(0.9975, hash21(floor(srd * 220.0))) * (0.3 + 0.5 * u_high);
  sky += vec3(star) * smoothstep(0.05, 0.3, rd.y);

  vec3 col = sky;
  if (hit > 0.0 && t < 34.0) {
    vec3 n = calcNormal(p);
    bool ground = n.y > 0.9 && p.y < 0.05;

    // Which rank / tower cell.
    float rankOff = p.z > RANK_B * 0.5 ? 1.0 : 0.0;
    float z0 = rankOff > 0.5 ? RANK_B : 0.0;
    float cell = floor(p.x / u_pitch + 0.5);
    float h = towerH(cell, rankOff);

    // Matte stone: dark but FORMED (diffuse moonlight + rim keeps shape).
    vec3 moon = normalize(vec3(-0.4, 0.7, -0.55));
    float diff = max(0.0, dot(n, moon));
    float rim = pow(1.0 - max(0.0, dot(n, -rd)), 3.0);
    vec3 stone = vec3(0.055, 0.055, 0.07) * (0.4 + 0.6 * diff) + vec3(0.05) * rim;
    float distFade = exp(-t * 0.045);   // shading falloff, not fog: sky never mixes in

    if (ground) {
      // Dark ground; the kick flood spills across it near the towers.
      float spill = exp(-pow((0.0 - u_floodY) * 1.6, 2.0)) * u_floodAmp;
      col = stone * 0.5 + bankCol(0.15) * spill * 0.20 * exp(-abs(p.z) * 0.3);
    } else {
      // ---- Windows: world-space grid on the facades (side faces get a
      // dimmer grid). Pattern re-hashes every BAR (u_barSeed).
      float wx = p.x * 4.2;
      float wy = p.y * 5.0;
      vec2 wid = vec2(floor(wx), floor(wy));
      vec2 wf = vec2(fract(wx), fract(wy));
      float pane = step(0.2, wf.x) * step(wf.x, 0.8) * step(0.25, wf.y) * step(wf.y, 0.78);
      float front = abs(n.z) > 0.5 ? 1.0 : (abs(n.x) > 0.5 ? 0.55 : 0.0);

      // Stratum 0/1/2 of THIS tower, lit by low/mid/high.
      float srel = clamp(p.y / max(h, 0.001), 0.0, 0.999);
      float stratum = floor(srel * 3.0);
      float bandLevel = stratum < 0.5 ? u_low : (stratum < 1.5 ? u_mid : u_high);
      // Buildup migrates light upward: lower strata dim, top climbs.
      float migrate = stratum < 0.5 ? (1.0 - 0.6 * u_buildup)
        : (stratum < 1.5 ? (1.0 - 0.25 * u_buildup) : (1.0 + 1.1 * u_buildup));

      // Lit gate: per-window hash vs a threshold from floor + band + drop.
      float wh = hash21(wid + vec2(cell * 13.7 + rankOff * 7.3, u_barSeed));
      float litFrac = clamp(u_litFloor + 0.55 * bandLevel * migrate + 0.3 * u_lift, 0.0, 0.96);
      float lit = step(1.0 - litFrac, wh);

      // Kick flood: a light band rising the facade.
      float flood = exp(-pow((p.y - u_floodY) * 2.2, 2.0)) * u_floodAmp;
      // Snare cluster: windows near the hashed center flash together.
      float cluster = exp(-pow((p.x - u_clusterX) * 0.9, 2.0)) * u_clusterAmp;

      float glow = (lit * (0.35 + 0.8 * bandLevel) + flood * (0.5 + 0.5 * lit) + cluster * lit * 1.4)
        * pane * front * u_glowGain;
      vec3 winCol = bankCol(0.1 + wh * 0.35 + stratum * 0.18);
      col = stone * distFade + winCol * glow * distFade;

      // Rooftop beacons on hats: a dot at the tower crown.
      float crown = smoothstep(0.12, 0.0, h - p.y) * step(0.6, hash11(cell * 9.9 + rankOff));
      col += bankCol(0.8) * crown * u_beacon * 1.6 * distFade;
    }
  }

  // Chroma-preserving soft knee.
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.85) {
    col *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

/** splitmix32-style scalar hash → stable [0,1). */
function splitmix(n: number): number {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x = x ^ (x >>> 15);
  return (x >>> 0) / 4294967296;
}

const candidate: VisualizerPreset = {
  id: 'g14-facade',
  name: 'g14 facade',
  hiRes: true,
  params: [
    { id: 'density', label: 'tower density', min: 0.6, max: 1.6, step: 0.05, default: 1 },
    { id: 'litFloor', label: 'quiet lit fraction', min: 0.05, max: 0.35, step: 0.01, default: 0.15 },
    { id: 'flood', label: 'kick flood', min: 0, max: 1.6, step: 0.05, default: 1 },
    { id: 'glow', label: 'window glow', min: 0.5, max: 1.8, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let lastBar = -1;
    let lastPhrase = -1;
    let lastSection = -1;
    let barSeed = 0;
    let massing = 0;
    let bankTarget = 0;
    let bankNow = 0;
    let riseCell = 2;
    let riseAmt = 1;
    let floodAge = 999;
    let floodAmp = 0;
    let clusterAmp = 0;
    let clusterX = 0;
    let beacon = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let warm = 0.5;
    let vantage = 0;
    let genomeKey = -1;
    let gridlessClock = 0;
    // 4 genome vantage points, rebuilt per track.
    let cams: Array<{ pos: [number, number, number]; tgt: [number, number, number] }> = [];
    const buildCams = (key: number) => {
      cams = [0, 1, 2, 3].map((i) => {
        const a = splitmix(key * 5 + i * 13);
        const b = splitmix(key * 7 + i * 29);
        const cc = splitmix(key * 11 + i * 41);
        return {
          pos: [
            (a - 0.5) * 7,
            1.2 + b * 2.2,
            -4.5 - cc * 2.5,
          ] as [number, number, number],
          tgt: [(a - 0.5) * 2, 1.3 + b * 0.8, 0.5] as [number, number, number],
        };
      });
    };
    buildCams(0);
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0.0001, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        let dom: (typeof frame.decks)[number] | null = null;
        for (const d of frame.decks) {
          if (d.playing && (dom === null || d.level > dom.level)) dom = d;
        }
        const key = dom?.trackId ?? 0;
        if (key !== genomeKey) {
          genomeKey = key;
          buildCams(key);
        }

        // Trend split (~0.35 s).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const energyNow = (frame.bands.low + frame.bands.mid + frame.bands.high) / 3;
        const lift = Math.max(smoothDrop, Math.min(1, energyNow * 1.4));
        warm += (frame.centroid - warm) * (1 - Math.exp(-dt / 1.0));

        // Bar clock.
        let bar: number;
        if (frame.beat) {
          bar = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
        } else {
          gridlessClock += dt;
          bar = Math.floor(gridlessClock / 2);
        }
        if (bar !== lastBar) {
          barSeed = splitmix(bar * 3 + genomeKey) * 97;   // window re-hash
          lastBar = bar;
        }
        const phrase = Math.floor(bar / 4);
        const section = Math.floor(bar / 16);
        if (phrase !== lastPhrase && lastPhrase >= 0) {
          riseCell = Math.floor((splitmix(phrase * 17 + genomeKey) - 0.5) * 8);
          riseAmt = 0;
        }
        lastPhrase = phrase;
        if (section !== lastSection && lastSection >= 0) {
          vantage = (vantage + 1) % 4;                       // camera CUT
          massing = splitmix(section * 23 + genomeKey) * 89; // re-roll
          bankTarget = (bankTarget + 1) % 4;
        }
        lastSection = section;
        riseAmt = Math.min(1, riseAmt + dt / 1.5);           // tower rises
        bankNow += (bankTarget - bankNow) * (1 - Math.exp(-dt / 0.8));

        // Kick flood: front rises up the facades, ~2 s decay.
        floodAge += dt;
        if (frame.impulse.low > 0.35 && floodAge > 0.12) {
          floodAge = 0;
          floodAmp = Math.min(1, frame.impulse.low * 1.2);
        }
        const floodY = floodAge * 2.2;
        const floodEnv = floodAmp * Math.exp(-floodAge / 0.9) * (frame.params.flood ?? 1);

        // Snare cluster + hat beacons.
        clusterAmp = clusterAmp * Math.exp(-dt / 0.25);
        if (frame.impulse.mid > 0.4 && clusterAmp < 0.3) {
          clusterAmp = Math.min(1, frame.impulse.mid);
          clusterX = (splitmix(Math.floor(frame.time * 41)) - 0.5) * 8;
        }
        beacon = Math.max(beacon * Math.exp(-dt / 0.2), Math.min(1, frame.impulse.high * 1.1));

        const cam = cams[vantage];
        return {
          u_camPos: cam.pos,
          u_camTgt: cam.tgt,
          u_massing: massing,
          u_barSeed: barSeed,
          u_pitch: 1.5 / (frame.params.density ?? 1),
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_litFloor: frame.params.litFloor ?? 0.15,
          u_glowGain: frame.params.glow ?? 1,
          u_floodY: floodY,
          u_floodAmp: floodEnv,
          u_clusterX: clusterX,
          u_clusterAmp: clusterAmp,
          u_beacon: beacon,
          u_riseCell: riseCell,
          u_riseAmt: riseAmt,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_lift: lift,
          u_bank: bankNow,
          u_warm: warm,
        };
      },
    });
  },
};

export default candidate;
