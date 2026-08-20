/**
 * g16-weather-fronts: the aberration fluid as WEATHER — section jumps in
 * fluid CHARACTER, delivered by visible fronts.
 *
 * Every 16-bar section draws a weather regime from the trackId genome:
 * - shear MODE: bloom (radial), cyclone (tangential), wind (one bearing),
 *   convergence (inward);
 * - fringe HUE PAIR: the rotate-select-rotate frame jumps per section;
 * - GRAIN: fine mist (noise-modulated micro-shear) vs broad smear.
 *
 * The change is theatre (materia-metric lineage): a FRONT line sweeps
 * across the screen over ~2s along the new wind bearing, lighting and
 * shearing everything it crosses; ahead of it the new weather, behind it
 * the old. Phrase starts add gusts (brief shear surges). Bass is
 * atmospheric pressure (scales all shear); kicks thunder-ripple.
 * Ungridded: one slowly drifting regime, no fronts.
 *
 * Scene: a bare horizon, a section-colored sun, sparse stars — the
 * weather is the show.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};

interface Regime {
  mode: number; // 0 bloom, 1 cyclone, 2 wind, 3 convergence
  wind: number; // bearing, radians
  fringe: number; // fringe hue pair, TURNS
  grain: number; // 0 broad smear .. 1 fine mist
  sunHue: number; // section sun palette phase
  sunX: number;
}

const regimeFor = (key: number, section: number): Regime => ({
  mode: Math.floor(splitmix01(key * 13 + section * 97) * 4),
  wind: splitmix01(key * 29 + section * 61 + 7) * Math.PI * 2,
  fringe: (splitmix01(key * 41 + section * 151 + 3) - 0.5) * 0.9,
  grain: splitmix01(key * 17 + section * 37 + 11),
  sunHue: splitmix01(key * 53 + section * 19 + 5),
  sunX: (splitmix01(key * 71 + section * 23 + 1) - 0.5) * 0.7,
});

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_lowSlow;   // motion-grade (erratic-motion law)
uniform float u_mid;
uniform float u_midSlow;   // motion-grade (erratic-motion law)
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_modeA;     // outgoing weather: shear mode
uniform float u_modeB;     // incoming weather: shear mode
uniform float u_frontMix;  // 0 old regime .. 1 new regime (front passage)
uniform float u_windA;
uniform float u_windB;
uniform float u_grainA;
uniform float u_grainB;
uniform float u_frontAge;  // seconds since the section boundary
uniform float u_frontAmp;  // front strength (0 when ungridded)
uniform float u_pressure;  // bass pressure: scales ALL shear
uniform float u_gust;      // phrase-start shear surge envelope
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_hueRot;    // per-song hue anchor, TURNS
uniform float u_fringeRot; // section fringe hue pair, TURNS (eased)
uniform float u_sunHue;
uniform float u_sunX;
uniform float u_decay;
uniform float u_zoom;
uniform float u_energy;
uniform float u_seed;
uniform float u_fluid;     // param: overall fluid scale
uniform float u_palette;

const float TAU = 6.28318530718;

vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * TAU;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

vec3 palA(float t) { return vec3(0.46, 0.3, 0.16) + vec3(0.48, 0.42, 0.35) * cos(TAU * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.14, 0.32))); }
vec3 palB(float t) { return vec3(0.2, 0.26, 0.5) + vec3(0.4, 0.45, 0.5) * cos(TAU * (vec3(0.9, 1.0, 0.75) * t + vec3(0.08, 0.3, 0.52))); }
vec3 palette(float t) {
  return mix(palA(t), palB(t), clamp(u_palette, 0.0, 1.0));
}

// Shear direction for one weather mode.
vec2 dirFor(float mode, vec2 dirW, float wa) {
  vec2 d = dirW; // 0: bloom (radial out)
  if (mode > 0.5 && mode < 1.5) d = vec2(-dirW.y, dirW.x); // cyclone
  else if (mode > 1.5 && mode < 2.5) d = vec2(cos(wa), sin(wa)); // wind
  else if (mode > 2.5) d = -dirW; // convergence
  return d;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);

  // ---- The FRONT: a line sweeping along the incoming wind bearing.
  vec2 frontDir = vec2(cos(u_windB), sin(u_windB));
  float frontPos = -1.1 + u_frontAge * 1.0;
  float proj = dot(c, frontDir);
  float frontBand = exp(-pow((proj - frontPos) * 7.0, 2.0))
    * exp(-u_frontAge * 0.9) * u_frontAmp;

  // ---- Warp: drift with the weather (wind modes push the whole field).
  vec2 w = c / u_zoom;
  vec2 windPushA = dirFor(u_modeA, dirW, u_windA);
  vec2 windPushB = dirFor(u_modeB, dirW, u_windB);
  vec2 weatherDirRaw = mix(windPushA, windPushB, u_frontMix);
  vec2 weatherDir = normalize(weatherDirRaw + vec2(1e-4, 0.0));
  float grain = mix(u_grainA, u_grainB, u_frontMix);
  vec2 churn = (vec2(
    fbm(c * mix(2.2, 4.6, grain) + t * 0.12),
    fbm(c * mix(2.2, 4.6, grain) + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.0015 + 0.012 * u_midSlow);
  float front2 = 0.12 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - front2) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 src = (w + churn + weatherDir * u_pressure * 0.0016 + dirW * rippleWave * 0.028)
    / vec2(aspect, 1.0) + 0.5;

  // ---- THE INSTRUMENT: shear character = the section's weather.
  // Fine mist: noise micro-modulates the shear direction; broad smear:
  // clean coherent shear. Pressure (bass) scales everything; gusts and
  // the front itself surge it.
  float mist = (noise(c * 24.0 + t * 0.6) - 0.5) * 2.0 * grain * 0.9;
  float mcs = cos(mist);
  float msn = sin(mist);
  vec2 shearDir = mat2(mcs, -msn, msn, mcs) * weatherDir;
  float shear = (0.0006 + 0.0085 * u_pressure + 0.006 * u_gust
    + 0.004 * u_kick + 0.016 * frontBand + 0.007 * rippleWave) * u_fluid;
  vec2 ab = shearDir * shear / vec2(aspect, 1.0);
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -u_fringeRot).r,
    hueRotate(tapC, -u_fringeRot).g,
    hueRotate(tapB, -u_fringeRot).b
  ), u_fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  // Fine mist keeps filaments crisp; broad smear softens the unsharp.
  float sharpen = mix(0.15, 0.38, grain);
  vec3 sky = max(vec3(0.0), sampled * (1.0 + sharpen) - blur * sharpen) * u_decay;

  // ---- Scene: horizon + section sun + sparse stars. Minimal on purpose.
  vec3 fresh = vec3(0.0);
  float reverb = 1.0 + 1.7 * rippleWave + 2.0 * frontBand;
  // Horizon: a low glowing band, lit by the bass.
  float horizon = exp(-pow((c.y + 0.22) * 9.0, 2.0));
  vec3 horizonColor = hueRotate(palette(0.08 + u_sunHue * 0.3), u_hueRot);
  fresh += horizonColor * horizon * (0.18 + 0.8 * u_low + 1.2 * u_kick);
  // Section sun: a solid disc whose hue and position belong to the
  // weather system (eases across during the front passage).
  vec2 sunPos = vec2(u_sunX, 0.2);
  float sunD = length(c - sunPos);
  float sunR = 0.075 + 0.02 * u_lowSlow;
  float sun = smoothstep(sunR, sunR - 0.015, sunD);
  float halo = exp(-pow(max(0.0, sunD - sunR) * 9.0, 1.4));
  vec3 sunColor = hueRotate(palette(u_sunHue), u_hueRot);
  fresh += sunColor * sun * (0.7 + 0.5 * u_low);
  fresh += sunColor * halo * (0.12 + 0.35 * u_energy);
  // Cloud deck: mid-driven wisps above the horizon — the weather's food.
  float cloud = fbm(vec2(c.x * 2.4 - t * 0.1, c.y * 3.2 + t * 0.05));
  float cloudBand = smoothstep(-0.15, 0.1, c.y) * pow(cloud, 2.2);
  vec3 cloudColor = hueRotate(palette(cloud * 1.5 + c.x * 0.3 + t * 0.012 + u_sunHue * 0.5), u_hueRot);
  float midGate = smoothstep(0.04, 0.3, u_mid);
  fresh += cloudColor * cloudBand * (0.2 + 1.0 * u_mid) * midGate * reverb;
  // Sparse stars (highs, kick-gated spawn handled TS-side via u_seed gate).
  vec2 q = c * 9.0;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(0.982, hash(sc * 1.618 + 9.7));
  fresh += vec3(0.9, 0.95, 1.0) * exp(-dot(f, f) * 520.0) * on
    * (0.3 + 1.6 * u_high) * smoothstep(0.05, 0.25, c.y + 0.1);
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.5 * u_energy);

  // The front line itself glows — the arriving weather announces itself.
  sky += hueRotate(palette(u_sunHue + 0.15), u_hueRot) * frontBand * 0.9;

  // Thunder: kick shock, localized.
  if (u_kick > 0.02) {
    float ringR = 0.09 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 40.0, 2.0));
    sky += mix(horizonColor, vec3(1.0, 0.93, 0.85), 0.5) * shock * u_kick * 0.9;
    sky *= 1.0 + 0.07 * u_kick;
  }
  if (u_snare > 0.04) {
    float arc = exp(-pow((r - 0.32) * 28.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 4.0);
    sky += hueRotate(palette(0.4 + u_sunHue * 0.3), u_hueRot) * arc * u_snare * 0.9;
  }

  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * 0.012;

  sky *= 0.75 + 0.36 * u_energy;
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

function dominantDeck(frame: VisualizerFrameData) {
  return frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
}

const preset: VisualizerPreset = {
  id: 'g16-weather-fronts',
  name: 'g16 weather-fronts',
  hiRes: true,
  params: [
    { id: 'fluid', label: 'weather strength', min: 0.2, max: 2, step: 0.05, default: 1 },
    { id: 'memory', label: 'sky memory', min: 0.5, max: 1.8, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette (dusk→storm)', min: 0, max: 1, step: 0.05, default: 0.35 },
  ],
  create: () => {
    let regimeA = regimeFor(23, 0);
    let regimeB = regimeFor(23, 0);
    let frontAge = 99;
    let frontAmp = 0;
    let frontMix = 1;
    let gustAge = 99;
    let lastSection: number | null = null;
    let lastPhrase: number | null = null;
    let driftWind = 0;
    let fringeRot = 0;
    let sunHue = 0.3;
    let sunX = 0;
    let rippleAge = 99;
    let rippleAmp = 0;
    let hueAnchor = 0;
    let hueAnchorTarget = 0;
    let lastTrack: number | null = null;
    let slowCentroid = 0.5;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const motion = frame.bandsSlow ?? frame.bands;
        const energy = energyOf(frame.bands);
        const sustained = Math.min(1, energy * 1.4);
        const deck = dominantDeck(frame);
        const key = deck?.trackId ?? 23;

        // ---- Section weather (ladder tiers so fronts land on the
        // ladder's boundaries). Ungridded: one drifting regime, no fronts.
        const beat = frame.beat;
        const bar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
        if (beat && bar !== null && beat.bpm) {
          const section = Math.floor(bar / 16);
          const phrase = Math.floor(bar / 4);
          if (lastSection === null) {
            regimeA = regimeFor(key, section);
            regimeB = regimeA;
            frontMix = 1;
          } else if (section !== lastSection) {
            regimeA = regimeB;
            regimeB = regimeFor(key, section);
            frontAge = 0;
            frontAmp = Math.min(1.2, 0.6 + 0.7 * sustained);
            frontMix = 0;
          }
          lastSection = section;
          if (lastPhrase !== null && phrase !== lastPhrase && frontAge > 4) {
            gustAge = 0; // phrase gust (skipped right after a front)
          }
          lastPhrase = phrase;
        } else {
          lastSection = null;
          lastPhrase = null;
          driftWind += dt * 0.05;
          regimeB = { ...regimeB, mode: 2, wind: driftWind };
          regimeA = regimeB;
          frontMix = 1;
          frontAmp = 0;
        }
        frontAge += dt;
        gustAge += dt;
        // Front passage: regimes crossfade over ~2s while the line sweeps.
        frontMix = Math.min(1, frontMix + dt / 2.0);
        const gust = Math.exp(-gustAge * 2.2) * (gustAge < 3 ? 1 : 0)
          * (0.3 + 0.7 * sustained);

        // Eased section characters (fringe pair, sun) follow the front.
        const fringeTarget = regimeA.fringe + (regimeB.fringe - regimeA.fringe) * frontMix;
        fringeRot += (fringeTarget - fringeRot) * (1 - Math.exp(-dt / 0.8));
        const sunHueTarget = regimeA.sunHue + (regimeB.sunHue - regimeA.sunHue) * frontMix;
        sunHue += (sunHueTarget - sunHue) * (1 - Math.exp(-dt / 1.5));
        const sunXTarget = regimeA.sunX + (regimeB.sunX - regimeA.sunX) * frontMix;
        sunX += (sunXTarget - sunX) * (1 - Math.exp(-dt / 1.5));

        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.1);
        }

        const track = deck?.trackId ?? null;
        if (track !== null && track !== lastTrack) {
          lastTrack = track;
          hueAnchorTarget = splitmix01(track);
        }
        hueAnchor += (hueAnchorTarget - hueAnchor) * (1 - Math.exp(-dt / 2.0));
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));
        const hueRot = ((((hueAnchor + (slowCentroid - 0.5) * 0.5) % 1) + 1) % 1);

        // Pressure: sustained bass scales all shear (slow lows — motion
        // law); the gate keeps quiet passages calm.
        const pressure = (0.2 + 0.8 * motion.low) * (0.35 + 0.65 * sustained);

        const memory = frame.params.memory ?? 1;
        const baseDecay = 0.989 + 0.005 * sustained;
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_lowSlow: motion.low,
          u_mid: frame.bands.mid,
          u_midSlow: motion.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_modeA: regimeA.mode,
          u_modeB: regimeB.mode,
          u_frontMix: frontMix,
          u_windA: regimeA.wind,
          u_windB: regimeB.wind,
          u_grainA: regimeA.grain,
          u_grainB: regimeB.grain,
          u_frontAge: frontAge,
          u_frontAmp: frontAmp,
          u_pressure: pressure,
          u_gust: gust,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_hueRot: hueRot,
          u_fringeRot: fringeRot,
          u_sunHue: sunHue,
          u_sunX: sunX,
          u_decay: Math.min(0.996, 1 - (1 - baseDecay) / memory),
          u_zoom: 1 + (0.02 + 0.18 * Math.min(1, energyOf(motion) * 1.4)) * dt,
          u_energy: sustained,
          u_seed: Math.floor(frame.time * 20),
          u_fluid: frame.params.fluid ?? 1,
          u_palette: frame.params.palette ?? 0.35,
        };
      },
    });
  },
};

export default preset;
