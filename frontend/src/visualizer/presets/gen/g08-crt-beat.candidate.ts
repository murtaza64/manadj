/**
 * "g08 crt-beat" (genetic arena g08, tweak of g07-crt — beat-grammar study;
 * human ask: "more beat responsiveness; beat-based effects").
 *
 * Copies g07-crt WHOLESALE (four programs, channel changes, the whole tube
 * pipeline: scanlines/phosphor-triad/barrel/vignette/glow/jitter). Adds ONE
 * new thing: a BEAT GRAMMAR that turns the broadcast into a stop-motion film.
 *
 *   BEAT = STOP-MOTION. The program CONTENT does not animate continuously —
 *     its pose STEPS on each beat and HOLDS between (a broadcast of a
 *     stop-motion animation, one exposure per beat). The animation clock is
 *     a quantized "pose time" that jumps in beat-sized increments on the
 *     grid; integer poses never interpolate. EXCEPTION: during a DROP the
 *     motion goes fluid and fast — the pose clock smoothly catches up to
 *     real time on max(drop, energy), so the drop FEELS like the film
 *     catching fire (frames blur into continuous motion).
 *   BAR = TRACKING JUMP. On each bar rollover the whole image hops one line
 *     vertically (a VHS tracking glitch) with a brief chroma shift that
 *     heals. Grid-quantized on the bar ordinal.
 *   PHRASE = INTERMISSION. On each phrase (%4 bars) the tube flickers an
 *     "intermission card" (a brief desaturated interstitial swell) then
 *     settles into the next program scene (a soft program advance, distinct
 *     from the big channel change).
 *   DROP / SECTION = full CHANNEL CHANGE (parent: static swell + new palette).
 *   KICK = beam SLAM (parent) + a one-frame FREEZE-PUNCH: the pose clock
 *     holds an extra beat's worth of stillness on impact — impact felt
 *     through the ABSENCE of motion, then the next beat snaps forward.
 *   SNARE = horizontal TEAR that heals (parent).
 *
 * IDENTITY: same trackId genome as g07 (splitmix of the dominant audible
 * deck's trackId) picks the channel lineup + starting palette family.
 *
 * PHOTOSAFETY (parent envelopes kept verbatim): the only near-full-field
 * brightenings are the kick beam-slam (smoothed ~0.3 s release => a single
 * kick can't drive >3 full-field cycles/sec) and the channel-change static
 * (one-shot ~0.35 s swell, desaturated toward white). The intermission card
 * flicker rides a SMOOTHED one-shot envelope (~0.3 s) bounded well under
 * 3 Hz — a phrase is many seconds apart, so it can't strobe. Stop-motion
 * pose stepping is a spatial content change, not a luminance flash; the bar
 * tracking hop and tear are localized. No saturated-red strobing.
 *
 * Assigned tech: beat phase + beatInBar + bpm (stop-motion pose clock — the
 * STAR), ladder tiers (bar hop / phrase intermission / section channel
 * change), impulses (slam + freeze-punch + tear), trend split (drop fluidity),
 * bands, trackId genome.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

// --- GLSL --------------------------------------------------------------
// No backticks in this string. Programs animate off u_pose (the quantized
// stop-motion clock) instead of raw u_time; the drop blends toward real time.
const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_pose;        // STOP-MOTION animation clock (steps on beats)
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;        // impulse.low
uniform float u_slam;        // SMOOTHED beam-slam envelope (sub-3Hz)
uniform float u_snare;       // impulse.mid: tear trigger
uniform float u_tearY;       // tear scanline position (0..1), healing
uniform float u_tearAmt;     // tear displacement, decays as it heals
uniform float u_vhold;       // vertical-hold sag offset (bass tension)
uniform float u_barHop;      // BAR tracking jump: vertical hop offset (heals)
uniform float u_barChroma;   // BAR chroma shift on the hop (heals)
uniform float u_tracking;    // buildup VHS tracking stress 0..1
uniform float u_noiseBand;   // buildup noise band height creeping from bottom
uniform float u_static;      // SMOOTHED channel-change static burst (one-shot)
uniform float u_retrace;     // retrace line position during a channel change
uniform float u_intermission;// PHRASE intermission-card flicker (one-shot)
uniform float u_drop;        // max(drop, energy)
uniform float u_sustain;     // bass-weighted sustained loudness
uniform float u_program;     // 0..3 current program index (integer-valued)
uniform float u_progA;       // program cross-fade previous index
uniform float u_progMix;     // 0..1 fade between progA and program
uniform float u_palette;     // 0..3 palette family (continuous)
uniform float u_warm;        // centroid tint bias
uniform float u_seed;        // genome seed scalar
uniform float u_barrel;      // barrel distortion amount (kick pumps it)
uniform float u_phrase;      // phrase evolution phase for program internals

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// iq cosine palettes: four saturated families the genome selects between,
// MORPHED not switched. No pure-red two-color pairs (photosafety); bright.
vec3 pal0(float t) { return vec3(0.5, 0.3, 0.55) + vec3(0.5, 0.45, 0.45) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal1(float t) { return vec3(0.2, 0.5, 0.5)  + vec3(0.4, 0.5, 0.5)  * cos(6.28318 * (vec3(0.9, 1.0, 0.9) * t + vec3(0.15, 0.35, 0.6))); }
vec3 pal2(float t) { return vec3(0.5, 0.5, 0.25) + vec3(0.5, 0.45, 0.4) * cos(6.28318 * (vec3(1.0, 0.95, 0.75) * t + vec3(0.05, 0.25, 0.5))); }
vec3 pal3(float t) { return vec3(0.35, 0.3, 0.55) + vec3(0.45, 0.4, 0.5) * cos(6.28318 * (vec3(0.95, 0.9, 1.0) * t + vec3(0.25, 0.1, 0.6))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  c += vec3(0.14, 0.02, -0.08) * (u_warm - 0.5) * 1.2;
  return c;
}

// --- The four programs animate off u_pose (stop-motion clock), NOT u_time.
// On the plateau u_pose is a staircase (holds between beats); on a drop the
// host feeds it near-continuous so the same code goes fluid. ---

// 0: interference plasma — overlapping wave fronts stepping per beat.
vec3 progPlasma(vec2 uv) {
  float t = u_pose * (0.6 + 1.2 * u_mid) + u_phrase;
  float a = sin((uv.x * 8.0 + t) + sin(uv.y * 6.0 - t * 0.7));
  float b = sin((uv.y * 9.0 - t * 0.9) + sin(uv.x * 7.0 + t * 0.5));
  float f = (a + b) * 0.5;
  float v = 0.5 + 0.5 * f;
  return palette(v * 0.7 + 0.15 + 0.2 * u_high);
}

// 1: rolling color bars gone feral — bars warp/roll per beat.
vec3 progBars(vec2 uv) {
  float roll = u_pose * (0.15 + 0.35 * u_mid) + u_phrase * 0.5;
  float warp = 0.12 * sin(uv.y * 5.0 + u_pose * 1.3) * (0.5 + u_high);
  float x = fract(uv.x + warp + 0.05 * sin(roll + uv.y * 3.0));
  float bar = floor(x * 7.0) / 7.0;
  return palette(bar + 0.1 * sin(roll) + 0.25 * u_high);
}

// 2: tuned-static aurora — noise ridges drifting up, stepping per beat.
vec3 progAurora(vec2 uv) {
  float t = u_pose * 0.4 + u_phrase;
  float n = noise(vec2(uv.x * 4.0, uv.y * 3.0 - t)) * 0.6
          + noise(vec2(uv.x * 9.0 + t, uv.y * 6.0 - t * 1.4)) * 0.4;
  float ridge = smoothstep(0.35, 0.75, n + 0.2 * uv.y);
  float shimmer = 0.6 + 0.4 * sin(uv.x * 40.0 + t * 6.0) * u_high;
  return palette(0.2 + 0.6 * n + 0.15 * u_high) * (0.4 + ridge) * shimmer;
}

// 3: raster starburst — radial spokes pulsing per beat.
vec3 progStarburst(vec2 uv) {
  vec2 p = uv - 0.5;
  float ang = atan(p.y, p.x);
  float rad = length(p);
  float spokes = 0.5 + 0.5 * sin(ang * 12.0 + u_pose * (1.0 + 2.0 * u_mid) + u_phrase);
  float rings = 0.5 + 0.5 * sin(rad * 30.0 - u_pose * 3.0 * (0.5 + u_high));
  float v = spokes * (0.5 + 0.5 * rings) * exp(-rad * 1.2);
  return palette(0.15 + v + 0.2 * u_high) * (0.5 + 1.5 * v);
}

vec3 program(float idx, vec2 uv) {
  // Nearest-integer program (no uniform-loop): four bounded branches.
  if (idx < 0.5) return progPlasma(uv);
  if (idx < 1.5) return progBars(uv);
  if (idx < 2.5) return progAurora(uv);
  return progStarburst(uv);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;

  // ---- Barrel distortion (the tube curvature). Kick pumps it (u_barrel).
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  float barrel = 1.0 + (0.12 + u_barrel) * r2;
  vec2 tubeUv = 0.5 + cc * barrel;

  // ---- Vertical hold sag (bass) + jitter + BAR tracking hop. The bar hop is
  // a one-line vertical jump on each bar rollover (VHS tracking glitch).
  float jitter = (noise(vec2(u_time * 30.0, 0.0)) - 0.5) * 0.004 * (1.0 + 2.0 * u_tracking);
  vec2 cuv = tubeUv + vec2(jitter, u_vhold + u_barHop);

  // Off-tube region reads as the black bezel/darkness.
  float onTube = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
  cuv = clamp(cuv, 0.0, 1.0);

  // ---- Snare TEAR (parent).
  float tearDist = abs(cuv.y - u_tearY);
  float tearK = exp(-tearDist * 220.0) * u_tearAmt;
  cuv.x = fract(cuv.x + tearK * 0.15 * sign(sin(u_time * 50.0)));

  // ---- Chroma bleed: buildup tracking + a BRIEF bar-hop chroma shift.
  float bleed = (0.002 + 0.010 * u_tracking) * (1.0 + u_drop) + 0.012 * u_barChroma;
  vec2 br = cuv + vec2(bleed, 0.0);
  vec2 bb = cuv - vec2(bleed, 0.0);

  vec3 content;
  {
    // Program cross-fade (channel change eases progA -> program).
    vec3 cr = mix(program(u_progA, vec2(br.x, br.y)), program(u_program, vec2(br.x, br.y)), u_progMix);
    vec3 cg = mix(program(u_progA, cuv), program(u_program, cuv), u_progMix);
    vec3 cb = mix(program(u_progA, vec2(bb.x, bb.y)), program(u_program, vec2(bb.x, bb.y)), u_progMix);
    content = vec3(cr.r, cg.g, cb.b);
  }

  // ---- Buildup noise band creeping up from the bottom (vivid, not dim).
  float nb = step(cuv.y, u_noiseBand);
  float staticN = hash(vec2(cuv.x * 300.0 + fract(u_time) * 91.0, cuv.y * 300.0 - u_time * 53.0));
  content = mix(content, palette(0.5 + 0.3 * staticN) * (0.6 + 0.8 * staticN), nb * u_tracking * 0.7);

  // ---- Content liveliness: mids/highs keep it moving, sustain lifts it.
  content *= 0.75 + 0.6 * u_sustain + 0.5 * u_drop;

  // ---- Beam SLAM (kick): one SOLID smoothed brightening + scanline thicken.
  float slamBias = 0.6 + 0.4 * (1.0 - r2 * 1.5);
  content *= 1.0 + u_slam * 0.7 * slamBias;

  // ---- PHRASE INTERMISSION card: a brief desaturated interstitial flicker
  // (a smoothed one-shot swell). Reads as "cut to intermission" then the
  // program advances. Desaturated toward light gray (never a saturated flash).
  if (u_intermission > 0.001) {
    float card = 0.7 + 0.2 * sin(cuv.y * 8.0);
    vec3 inter = mix(content, vec3(card), 0.75);
    content = mix(content, inter, u_intermission);
  }

  // ---- CHANNEL-CHANGE static burst (parent).
  if (u_static > 0.001) {
    float sN = hash(vec2(cuv.x * 640.0 + fract(u_time) * 311.0, cuv.y * 480.0 - u_time * 197.0));
    vec3 snow = mix(vec3(sN), palette(sN) * 1.2, 0.35);
    content = mix(content, snow, u_static);
    float rl = exp(-abs(cuv.y - u_retrace) * 90.0);
    content += vec3(0.9, 0.95, 1.0) * rl * u_static * 0.8;
  }

  // ---- CRT scanlines (parent).
  float lines = 340.0;
  float scan = 0.5 + 0.5 * sin(cuv.y * lines * 6.28318);
  float scanDepth = 0.35 + 0.25 * u_slam;
  content *= 1.0 - scanDepth * (1.0 - scan);

  // ---- Phosphor RGB triad (parent).
  float col3 = mod(gl_FragCoord.x, 3.0);
  vec3 triad = vec3(step(col3, 0.5), step(0.5, col3) * step(col3, 1.5), step(1.5, col3));
  triad = mix(vec3(1.0), triad * 1.6, 0.55);
  content *= triad;

  // ---- Beam-glow bloom + feedback persistence (parent).
  vec2 pix = 1.0 / u_res;
  vec3 prev = texture2D(u_prev, uv).rgb;
  vec3 blur = (texture2D(u_prev, uv + vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, uv - vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, uv + vec2(0.0, pix.y)).rgb
    + texture2D(u_prev, uv - vec2(0.0, pix.y)).rgb) * 0.25;
  float persist = 0.28 + 0.12 * u_tracking;
  vec3 glow = max(vec3(0.0), blur - 0.35) * (0.5 + 0.7 * u_low);
  content += glow * 0.6;
  content = content + prev * persist * 0.5;

  // ---- Corner vignette (parent).
  float vig = smoothstep(0.9, 0.35, length(cc) * 1.3);
  content *= 0.35 + 0.65 * vig;

  // Bezel/darkness outside the tube.
  content *= onTube;

  // Chroma-preserving soft knee (never per-channel clamp).
  float mx = max(content.r, max(content.g, content.b));
  if (mx > 0.92) {
    content *= (0.92 + 0.08 * (1.0 - exp(-(mx - 0.92) * 3.0))) / mx;
  }
  gl_FragColor = vec4(max(content, 0.0), 1.0);
}
`;

const params: PresetParam[] = [
  { id: 'curvature', label: 'tube curvature', min: 0, max: 0.3, step: 0.01, default: 0.12 },
  { id: 'persistence', label: 'phosphor persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'stopMotion', label: 'stop-motion snap', min: 0, max: 1, step: 0.05, default: 1 },
  { id: 'glitchiness', label: 'channel-change intensity', min: 0.3, max: 2, step: 0.05, default: 1 },
  { id: 'warmth', label: 'phosphor warmth', min: 0, max: 1, step: 0.05, default: 0.5 },
];

// --- trackId genome (channel lineup) — g02-julia's splitmix pattern -----

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

interface ChannelGenome {
  /** The program order for this song's channels (permutation of 0..3). */
  lineup: number[];
  /** Starting palette family 0..3. */
  palette0: number;
  /** Seed scalar for shader hash tinting. */
  seed: number;
}

/** Hash a key into a channel lineup (shuffled program order) + palette. */
function hashGenome(key: number): ChannelGenome {
  const next = splitmix(Math.round(key));
  const lineup = [0, 1, 2, 3];
  for (let i = lineup.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const t = lineup[i];
    lineup[i] = lineup[j];
    lineup[j] = t;
  }
  return { lineup, palette0: next() * 3, seed: next() };
}

/** Dominant audible deck's trackId (highest level); null when unknown. */
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

const g08CrtBeatPreset: VisualizerPreset = {
  id: 'g08-crt-beat',
  name: 'g08 crt-beat',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    // Slow stats (palette warmth from centroid EMA).
    let emaCentroid = 0.5;
    // Genome / identity.
    let seededKey: number | null = null;
    let genome: ChannelGenome = hashGenome(1);
    let lastTrackId: number | null = null;
    // Regime smoothing.
    let smoothDrop = 0;
    let smoothBuildup = 0;
    // Channel state.
    let channelIdx = 0;
    let prevProgram = 0;
    let curProgram = 0;
    let progMix = 1;
    let lastSection = -1;
    let dropLatch = false;
    // Envelopes (all photosafe-smoothed).
    let slam = 0;
    let staticBurst = 0;
    let retrace = 0;
    let intermission = 0; // phrase intermission-card flicker
    // Tear (snare).
    let tearAmt = 0;
    let tearY = 0.5;
    // Vertical hold sag.
    let vhold = 0;
    let vholdVel = 0;
    // Barrel pump.
    let barrel = 0;
    // Phrase evolution phase.
    let phrasePhase = 0;
    // --- BEAT GRAMMAR state ---
    // Stop-motion pose clock: a staircase that steps in beat-sized jumps on
    // the plateau, and smoothly catches up to real time during a drop.
    let poseClock = 0;
    let lastBeatOrdinal = -1;
    let freezePunch = 0; // kick freeze-punch: holds the pose an extra beat
    // Bar tracking hop (one-line vertical jump + chroma) that heals.
    let barHop = 0;
    let barChroma = 0;
    let lastBarOrdinal = -1;
    // Phrase intermission trigger.
    let lastPhrase = -1;

    /** Trigger a channel change: advance the lineup, start the static swell. */
    const changeChannel = () => {
      prevProgram = curProgram;
      channelIdx = (channelIdx + 1) % genome.lineup.length;
      curProgram = genome.lineup[channelIdx];
      progMix = 0;
      staticBurst = 1;
      retrace = 0;
    };

    /** Soft program advance for a phrase intermission (no big static wipe). */
    const advanceProgramSoft = () => {
      prevProgram = curProgram;
      channelIdx = (channelIdx + 1) % genome.lineup.length;
      curProgram = genome.lineup[channelIdx];
      progMix = 0;
    };

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame: VisualizerFrameData) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const energy = energyOf(frame.bands);
        const slowAlpha = 1 - Math.exp(-dt / 12);
        emaCentroid += (frame.centroid - emaCentroid) * slowAlpha;

        // --- Identity (parent): dominant trackId seeds the channel lineup.
        const trackId = dominantTrackId(frame);
        const key =
          trackId != null
            ? trackId
            : Math.round((emaCentroid * 4096 + energy * 811) * 131);
        if (seededKey == null) {
          seededKey = key;
          genome = hashGenome(key);
          lastTrackId = trackId;
          curProgram = genome.lineup[0];
          prevProgram = curProgram;
        } else if (trackId != null && trackId !== lastTrackId) {
          seededKey = key;
          genome = hashGenome(key);
          lastTrackId = trackId;
          channelIdx = -1;
          changeChannel();
        }

        // --- Regime split (smoothed ~0.35 s). Drop is bass-weighted + smooth.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const rAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * rAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * rAlpha;
        const sustained = Math.min(1, energy * 1.4);
        const dropRide = Math.max(smoothDrop, sustained);

        // --- Section / phrase / bar tiers (ladder-correct with fallback).
        const barIndex = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? 0;
        const section = Math.floor(barIndex / 16);
        const phrase = Math.floor(barIndex / 4);
        const barPhase = frame.beat?.barPhase ?? 0;
        const beatsPerBar = frame.beat?.beatsPerBar ?? 4;
        const beatInBar = frame.beat?.beatInBar ?? 0;
        const bpm = frame.beat?.bpm ?? 0;
        const beatRate = bpm ? bpm / 60 : 2;
        phrasePhase += dt * beatRate * 0.05;

        // DROP = channel change (edge-triggered on the drop onset; priority).
        const dropNow = smoothDrop > 0.5;
        if (dropNow && !dropLatch) {
          changeChannel();
        }
        dropLatch = smoothDrop > 0.35;
        // SECTION boundary = channel change too (unless a drop just did one).
        if (section !== lastSection && lastSection >= 0 && !dropNow) {
          changeChannel();
        }
        lastSection = section;

        // PHRASE boundary = intermission card + soft program advance (only
        // when a bigger event didn't already fire this phrase).
        if (phrase !== lastPhrase && lastPhrase >= 0 && !dropNow && section === lastSection) {
          intermission = 1;
          advanceProgramSoft();
        }
        lastPhrase = phrase;

        // --- Program cross-fade eases in ~0.4 s (a settling channel).
        progMix = Math.min(1, progMix + dt / 0.4);

        // --- Channel static swell + retrace (parent).
        staticBurst = Math.max(0, staticBurst - dt / 0.35);
        retrace = Math.min(1.2, retrace + dt / 0.35);
        // Intermission-card flicker decays ~0.3 s (smoothed one-shot).
        intermission = Math.max(0, intermission - dt / 0.3);

        // --- Beam slam envelope: fast attack, release ~0.3 s (parent).
        const kick = frame.impulse.low;
        if (kick > slam) {
          slam = kick;
          // Freeze-punch: a strong kick holds the pose clock an extra beat.
          if (kick > 0.4) freezePunch = 1;
        }
        slam = Math.max(0, slam - dt / 0.3);

        // --- Barrel pump ~2% on the slam (eased) (parent).
        const curvature = frame.params.curvature ?? 0.12;
        barrel += (slam * 0.02 - barrel) * (1 - Math.exp(-dt / 0.12));

        // --- Snare tear (parent).
        const snare = frame.impulse.mid;
        if (snare > 0.25 && tearAmt < 0.4) {
          tearAmt = Math.min(1, snare);
          tearY = 0.15 + 0.7 * Math.random();
        }
        tearAmt = Math.max(0, tearAmt - dt / 0.25);

        // --- Vertical-hold tension (parent): heavy bass sags; springs back.
        const bassPull = -0.02 * frame.bands.low;
        const stiffness = 60;
        const damping = 9;
        vholdVel += (stiffness * (bassPull - vhold) - damping * vholdVel) * dt;
        vhold += vholdVel * dt;

        // === BEAT GRAMMAR (the study) ===
        const stopMotion = frame.params.stopMotion ?? 1;

        // BEAT = STOP-MOTION pose clock. On the plateau it JUMPS one beat's
        // worth per beat (a staircase — integer poses, no interpolation). On
        // a drop it smoothly catches up to real time (fluidity = dropRide),
        // so the film "catches fire". Freeze-punch delays the next step.
        const beatOrdinal = barIndex * beatsPerBar + beatInBar;
        const fluidity = Math.min(1, dropRide); // 0 = stop-motion, 1 = fluid
        // How much "pose time" one beat represents (seconds → pose units 1:1).
        const beatSeconds = beatRate > 0 ? 1 / beatRate : 0.5;
        if (beatOrdinal !== lastBeatOrdinal) {
          if (freezePunch > 0.5) {
            // Freeze-punch consumed: SKIP this step (hold an extra beat), then
            // the following beat snaps forward by two beats' worth.
            freezePunch = 0;
          } else {
            // Snap the pose clock forward by one beat (hard step on grid).
            poseClock += beatSeconds;
          }
          lastBeatOrdinal = beatOrdinal;
        }
        // During a drop, bleed the pose clock toward real elapsed motion so
        // stepping smooths into continuous fast motion. Blend by fluidity and
        // by (1 - stopMotion) slider (0 slider => never fully stop-motion).
        const fluidBlend = Math.max(fluidity, 1 - stopMotion);
        poseClock += dt * beatRate * fluidBlend;
        // Extra continuous drop speed so a drop reads as FAST (film on fire).
        poseClock += dt * fluidity * 2.0;

        // BAR = tracking jump: a one-line vertical hop + brief chroma shift
        // on each bar rollover, healing over ~0.2 s. Grid-quantized.
        const barOrdinal = barIndex;
        if (barOrdinal !== lastBarOrdinal && lastBarOrdinal >= 0) {
          barHop = 0.012 * (Math.random() < 0.5 ? -1 : 1);
          barChroma = 1;
        }
        lastBarOrdinal = barOrdinal;
        barHop *= Math.exp(-dt / 0.12);
        barChroma = Math.max(0, barChroma - dt / 0.2);

        // --- Buildup tracking stress + noise band creep (parent).
        const tracking = Math.min(1, smoothBuildup * 1.2);
        const noiseBand = 0.18 * smoothBuildup;

        // --- Sliders.
        const persistence = frame.params.persistence ?? 1;
        void persistence;
        const glitchiness = frame.params.glitchiness ?? 1;
        const warmth = frame.params.warmth ?? 0.5;
        const contentDrive = 1;

        return {
          u_time: frame.time,
          u_pose: poseClock,
          u_low: frame.bands.low,
          u_mid: Math.min(1, frame.bands.mid * contentDrive),
          u_high: Math.min(1, frame.bands.high * contentDrive),
          u_kick: kick,
          u_slam: slam,
          u_snare: snare,
          u_tearY: tearY,
          u_tearAmt: tearAmt,
          u_vhold: vhold,
          u_barHop: barHop,
          u_barChroma: barChroma,
          u_tracking: tracking,
          u_noiseBand: noiseBand,
          u_static: staticBurst * glitchiness,
          u_retrace: retrace,
          u_intermission: intermission,
          u_drop: dropRide,
          u_sustain: sustained,
          u_program: curProgram,
          u_progA: prevProgram,
          u_progMix: progMix,
          u_palette: genome.palette0,
          u_warm: 0.5 + (emaCentroid - 0.5) * 0.6 + (warmth - 0.5) * 0.8,
          u_seed: genome.seed,
          u_barrel: curvature - 0.12 + barrel,
          u_phrase: phrasePhase + barPhase * 0.2,
        };
      },
    });
  },
};

export default g08CrtBeatPreset;
