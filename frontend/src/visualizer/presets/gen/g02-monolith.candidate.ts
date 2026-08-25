/**
 * g02-monolith (gen-2 candidate, NOVEL — song-genome family).
 *
 * DIRECTION: ARCHITECTURE. A monumental raymarched edifice — columns,
 * monolith slabs and cathedral arches — whose ARCHITECTURE is the song
 * genome, and whose LIGHT is the live audio layer. No two songs build the
 * same building.
 *
 * ── The song genome (spec: briefs/g02-songprint-spec.md) ────────────────
 * 1. DETERMINISTIC SEED: the dominant audible deck's trackId is splitmix-
 *    hashed (JS-side) into six stable [0,1] scalars, mixed into shader
 *    uniforms as u_family (structural family: 0 colonnade .. 1 slab wall ..
 *    2 cathedral arcade), u_symmetry (fold count of the ground plan),
 *    u_paletteFamily (which of four stone/light palettes), and three
 *    pattern-frequency scalars (column pitch jitter, slab notching, arch
 *    springing). Same song ⇒ same building, every play. No trackId ⇒ the
 *    frozen slow-stats pseudo-seed drives the same uniforms.
 * 2. SLOW STATS (EMA, tau ~15 s): centroid → base palette TEMPERATURE
 *    (cold granite .. warm sandstone), spread → SKYLINE COMPLEXITY (how
 *    many silhouette tiers/how broad the massing), flatness → surface
 *    TEXTURE (polished .. rough-hewn), energy → global light gain. bpm
 *    scales ALL motion: column-rhythm sway, edge-glow travel speed, the
 *    breathing of the arches (174 sways faster than 122).
 * 3. TRACK CHANGE = REBIRTH: JS stages a ~2.2 s re-genesis (u_rebirth 0→1
 *    ease). The old genome's SDF params cross-fade into the new ones while
 *    a bright horizon flood + a rising dust wall wipe the reconfiguration —
 *    the building visibly collapses/rises into its new form.
 * 4. LIVE LAYER — LIGHT: kicks SLAM a floor-flood of light up through the
 *    colonnade (solid, gated on impulse.low, never powder); mids run a
 *    TRAVELING edge-glow along the silhouette; highs GLINT off corners
 *    (sparse specular pops). Snare throws a soft powder haze in the fog.
 * 5. EVOLUTION: within a phrase the structure RAISES (u_phrase 0→1 across
 *    the 16-bar phrase, easing height/extrusion up) with an anticipation
 *    lift in the last bar; section boundaries RECONFIGURE (u_section pulse
 *    re-rolls the massing offsets — visible theatre).
 * 6. STRONG DROPS: the whole edifice IGNITES (emissive edges bloom, sky
 *    saturates, a ground shockwave rings out) and the camera PUSHES in
 *    (u_push shortens focal distance). drop = smoothed excitement × bass.
 * 7. VIBRANT BUILDUPS: rising light columns climb the pillars + the sky
 *    behind SATURATES and warms — tense AND vibrant, never dimmed.
 *
 * ── Raymarch budget ─────────────────────────────────────────────────────
 * The scene is a 2.5D SDF skyline: the fragment marches a fixed 44-step
 * sphere-trace against a heightfield-of-boxes city (constant-bound loop,
 * GLSL ES 1.0). 44 ≤ 48 per the brief cap. The SDF is cheap (a handful of
 * folded box distances + a ground plane), soft shadows are a single 12-tap
 * secondary march reusing the same map, and fog is analytic — so per-pixel
 * cost stays in budget at the hiRes 1440p backing. Feedback (u_prev) is an
 * unsharp-tapped light-trail buffer for the traveling glow and drop bloom.
 *
 * Engine idioms reused (voyage.ts / docs/visualizer-ga.md): unsharp
 * feedback tap (anti-mush), chroma-preserving soft knee (no per-channel
 * clamp), per-axis seed mixing in hashes, traveling kick flood that LIGHTS
 * what it passes, charged element (the kick flood decays over ~2 s),
 * gentle energy-tied feedback decay, wide-phase drifting palette.
 *
 * Safety: photosensitivity floor — the only full-field envelope (the drop
 * ignite + rebirth flood) is rate-limited and smoothed (~0.3 s attack); it
 * never saturated-red-strobes. Kick floods are localized (they rise from
 * the floor, not the whole field).
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;        // impulse.low, gated — the light flood
uniform float u_snare;       // impulse.mid — fog powder
uniform float u_glint;       // impulse.high — corner glints
uniform float u_centroid;    // temperature 0 cold .. 1 warm
uniform float u_spread;      // skyline complexity 0 .. 1
uniform float u_flatness;    // texture 0 polished .. 1 rough
uniform float u_energy;      // slow light gain
uniform float u_drop;        // excitement WITH bass — ignite + push
uniform float u_buildup;     // excitement WITHOUT bass — rising light/sky
uniform float u_phrase;      // 0 phrase start .. 1 boundary (raises)
uniform float u_section;     // section-boundary pulse (reconfigure)
uniform float u_rebirth;     // track-change re-genesis 0..1
uniform float u_push;        // camera push-in (drop)
uniform float u_rate;        // bpm-scaled motion phase
uniform float u_sway;        // bpm-scaled sway phase
uniform float u_floodAge;    // seconds since last kick flood
uniform float u_floodAmp;    // that flood's strength
uniform float u_decay;       // feedback persistence
uniform float u_family;      // 0 colonnade .. 1 slab wall .. 2 arcade
uniform float u_symmetry;    // ground-plan fold count
uniform float u_paletteFam;  // palette family blend 0..3
uniform float u_freqA;       // column pitch jitter
uniform float u_freqB;       // slab notch frequency
uniform float u_freqC;       // arch springing frequency
uniform float u_lightHue;    // live light hue drift

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

// Per-axis seed mixing (voyage idiom): distinct offsets per axis so the
// hash lattice does not align into moire diagonals.
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise2(p);
    p = p * 2.03 + vec2(19.1, 7.7);
    a *= 0.5;
  }
  return v;
}

// Four stone/light palettes; the family blend MORPHS between them so the
// per-song choice is continuous, not a hard switch. Wide phase span keeps
// the fog/sky from going monochrome (voyage lesson).
vec3 pal0(float t) { return vec3(0.24, 0.26, 0.32) + vec3(0.30, 0.32, 0.40) * cos(6.28318 * (vec3(1.0, 0.95, 0.85) * t + vec3(0.0, 0.10, 0.22))); }  // granite / steel
vec3 pal1(float t) { return vec3(0.36, 0.28, 0.20) + vec3(0.40, 0.34, 0.24) * cos(6.28318 * (vec3(1.0, 0.90, 0.70) * t + vec3(0.0, 0.14, 0.30))); }  // sandstone / amber
vec3 pal2(float t) { return vec3(0.20, 0.30, 0.34) + vec3(0.28, 0.44, 0.46) * cos(6.28318 * (vec3(0.9, 1.0, 0.85) * t + vec3(0.10, 0.28, 0.48))); }  // verdigris / teal
vec3 pal3(float t) { return vec3(0.34, 0.20, 0.38) + vec3(0.44, 0.30, 0.50) * cos(6.28318 * (vec3(1.0, 0.85, 1.0) * t + vec3(0.05, 0.20, 0.42))); }  // porphyry / violet

vec3 palette(float t) {
  float x = clamp(u_paletteFam, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  // centroid warms the whole stone; buildups saturate + warm the mood.
  c += (vec3(0.10, 0.02, -0.06)) * (u_centroid - 0.5) * 2.0;
  c += vec3(0.06, 0.01, -0.03) * u_buildup;
  return c;
}

float sdBox(vec3 p, vec3 b) {
  vec3 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

// One building cell: a box whose height/width/notching come from the genome
// and phrase/section state. Returns the SDF for the cell centered on the
// integer column index ci (folded plan coordinate).
float building(vec3 p, float ci, out float emissive, out float cellId) {
  cellId = ci;
  // Per-cell random from the genome frequencies (seed-mixed).
  float r0 = hash11(ci * 1.7 + u_freqA * 31.0 + 3.1);
  float r1 = hash11(ci * 2.3 + u_freqB * 17.0 + 9.7);
  float r2 = hash11(ci * 0.9 + u_freqC * 23.0 + 5.3);
  // Skyline complexity (spread): more spread => taller, more varied tiers.
  float complexity = 0.35 + 0.9 * u_spread;
  // Phrase RAISES the structure; the section pulse re-rolls the massing.
  float sectShift = u_section * (r1 - 0.5) * 1.6;
  float baseH = 0.7 + complexity * (0.4 + 1.5 * r0) + sectShift;
  baseH *= 0.55 + 0.75 * u_phrase;           // phrase growth
  baseH *= 0.9 + 0.35 * u_energy;            // slow energy lifts the city
  // Family morph: colonnade (thin tall columns) .. slab wall (wide slabs)
  // .. cathedral arcade (arched, springing tiers).
  float fam = clamp(u_family, 0.0, 2.0);
  float wCol = mix(0.12, 0.34, clamp(fam, 0.0, 1.0));       // width grows to slab
  float depth = mix(0.14, 0.30, clamp(fam, 0.0, 1.0));
  float wArc = mix(wCol, 0.20 + 0.10 * r2, clamp(fam - 1.0, 0.0, 1.0));
  float width = mix(wCol, wArc, clamp(fam - 1.0, 0.0, 1.0));
  // bpm-scaled sway: the colonnade breathes side to side.
  float sway = sin(u_sway + ci * 0.9) * (0.02 + 0.05 * u_low) * (1.0 - 0.5 * clamp(fam, 0.0, 1.0));
  vec3 q = p;
  q.x -= sway;
  // Slab notching (freqB): carve horizontal reveals into the face.
  float notch = 0.0;
  float notchF = 3.0 + 9.0 * u_freqB;
  notch = 0.03 * clamp(fam, 0.0, 1.0) * (0.5 + 0.5 * sin(q.y * notchF + ci));
  // The box: rises from the ground plane (y=0) up to baseH.
  vec3 c = vec3(0.0, baseH * 0.5, 0.0);
  vec3 b = vec3(width - notch, baseH * 0.5, depth);
  float d = sdBox(q - c, b);
  // Cathedral arcade: subtract a springing arch near the top (freqC).
  float archLevel = baseH - (0.30 + 0.25 * r2);
  float archR = width * (0.9 + 0.4 * sin(u_freqC * 6.28318 + ci));
  vec3 ap = q - vec3(0.0, archLevel, 0.0);
  float arch = length(ap.xy * vec2(1.0, 1.2)) - archR;
  float archMask = clamp(fam - 1.0, 0.0, 1.0);
  // Carve the arch out only for the arcade family; blend by mask so the
  // colonnade/slab keep a solid face (mask 0 leaves d untouched).
  d = mix(d, max(d, -arch), archMask);
  // Emissive seam: a vertical light-slit up the face, brightened by the
  // buildup (rising light columns) and re-lit by section changes.
  float slit = exp(-abs(q.x) * (30.0 - 10.0 * u_buildup)) * step(0.0, q.y) * step(q.y, baseH);
  float climb = smoothstep(0.0, baseH, q.y - u_buildup * baseH * 1.2 + mod(u_time * (0.4 + 0.8 * u_buildup) + ci, baseH));
  emissive = slit * (0.15 + 1.2 * u_buildup) * (0.4 + 0.6 * climb) * (0.5 + 0.5 * r0);
  return d;
}

// Fold the plane into u_symmetry repeated bays, so the ground PLAN has the
// song's symmetry. Then place a rank of buildings along x.
float mapScene(vec3 p, out float emissive, out float cellId) {
  emissive = 0.0;
  cellId = 0.0;
  // Ground plane.
  float ground = p.y;
  // Symmetry fold across z: mirror the colonnade into radial-ish bays.
  float sym = 1.0 + floor(u_symmetry * 3.0);   // 1..4 folds
  float bay = 2.4 / sym;
  float pz = abs(mod(p.z + bay * 0.5, bay * 2.0) - bay);
  vec3 q = vec3(p.x, p.y, pz);
  // Column pitch from bpm-informed rate + genome jitter.
  float pitch = 0.5 + 0.22 * u_freqA;
  float xi = floor(q.x / pitch + 0.5);
  q.x -= xi * pitch;
  // Rebirth: during re-genesis the plan lifts out of the floor.
  q.y += (1.0 - u_rebirth) * 2.0;
  float em;
  float ci;
  float d = building(q, xi, em, ci);
  // Second, offset rank for depth/skyline layering (spread widens it).
  vec3 q2 = q;
  q2.z += 1.1 + 0.6 * u_spread;
  q2.x -= pitch * 0.5;
  float em2;
  float ci2;
  float d2 = building(q2, xi + 101.0, em2, ci2);
  float dCity = min(d, d2);
  if (d2 < d) { em = em2; ci = ci2; }
  float dScene = min(ground, dCity);
  emissive = em;
  cellId = ci;
  return dScene;
}

float mapDist(vec3 p) {
  float e;
  float c;
  return mapScene(p, e, c);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    mapDist(p + e.xyy) - mapDist(p - e.xyy),
    mapDist(p + e.yxy) - mapDist(p - e.yxy),
    mapDist(p + e.yyx) - mapDist(p - e.yyx)
  ));
}

// Soft shadow: single 12-tap secondary march toward the flood light.
float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0;
  float t = 0.03;
  for (int i = 0; i < 12; i++) {
    float h = mapDist(ro + rd * t);
    if (h < 0.002) return 0.0;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.02, 0.25);
    if (t > 6.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 sc = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 px = 1.0 / u_res;
  float t = u_time;

  // ── Camera: a low hero angle looking down the colonnade. Drop pushes in
  // (focal distance shortens); slow sway rides the bpm.
  float dist = 5.2 - 1.6 * u_push - 0.4 * u_drop;
  float camY = 0.9 + 0.25 * sin(u_sway * 0.5) + 0.3 * u_phrase;
  float pan = sin(u_sway * 0.3) * 0.4;
  vec3 ro = vec3(pan, camY, -dist);
  vec3 ta = vec3(pan * 0.4, 0.9 + 0.6 * u_phrase, 0.0);
  vec3 fwd = normalize(ta - ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  float fov = 1.5 + 0.25 * u_drop;
  vec3 rd = normalize(fwd * fov + right * sc.x + up * sc.y);

  // ── Raymarch: 44 fixed steps (≤48 budget). Constant-bound loop.
  float tmax = 22.0;
  float tcur = 0.0;
  float hit = 0.0;
  float emAcc = 0.0;
  float cellId = 0.0;
  vec3 hitP = ro;
  for (int i = 0; i < 44; i++) {
    vec3 p = ro + rd * tcur;
    float em;
    float ci;
    float d = mapScene(p, em, ci);
    // Accumulate emissive light-slit glow along the ray (volumetric-ish).
    emAcc += em * exp(-tcur * 0.35) * 0.03;
    if (d < 0.003 * tcur + 0.002) {
      hit = 1.0;
      hitP = p;
      cellId = ci;
      break;
    }
    tcur += d;
    if (tcur > tmax) break;
  }

  vec3 col = vec3(0.0);

  // ── Sky / atmosphere: gradient that SATURATES + warms on buildups and
  // ignites on drops. Fog gives depth.
  float horizon = smoothstep(-0.15, 0.5, rd.y);
  vec3 skyLow = palette(0.15 + u_centroid * 0.3 + t * 0.01);
  vec3 skyHigh = palette(0.55 + t * 0.008);
  vec3 sky = mix(skyLow * 0.5, skyHigh * 0.9, horizon);
  sky *= 0.35 + 0.5 * u_energy + 0.7 * u_buildup + 0.9 * u_drop;
  // Buildup saturation: push sky chroma away from grey.
  float skyLum = dot(sky, vec3(0.299, 0.587, 0.114));
  sky = mix(sky, sky + (sky - vec3(skyLum)) * 1.2, 0.3 + 0.5 * u_buildup);

  if (hit > 0.5) {
    vec3 n = calcNormal(hitP);
    // Surface stone color from palette; flatness roughens the texture.
    float grain = fbm(hitP.xy * (8.0 + 40.0 * u_flatness) + hitP.z * 3.0);
    vec3 stone = palette(0.3 + cellId * 0.013 + hitP.y * 0.05);
    stone *= 0.6 + 0.4 * mix(1.0, grain, u_flatness);

    // ── LIGHT is the live layer.
    // Key: a warm/hued live light drifting overhead. Its HUE rides
    // u_lightHue (mid/high driven) so light color travels while stone holds.
    vec3 lightDir = normalize(vec3(0.4 * sin(u_rate * 0.3), 1.0, -0.3));
    vec3 liveHue = 0.5 + 0.5 * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * u_lightHue + vec3(0.0, 0.2, 0.4)));
    float diff = clamp(dot(n, lightDir), 0.0, 1.0);
    float sh = softShadow(hitP + n * 0.01, lightDir);
    col = stone * (0.18 + 0.9 * diff * sh);

    // KICK FLOOD: light slams UP from the floor through the colonnade —
    // a rising vertical wall of light, localized (from y=0), gated on kick.
    float floodFront = u_floodAge * (2.6 + 4.0 * u_low);
    float floodBand = exp(-pow((hitP.y - floodFront) * 3.0, 2.0)) * exp(-u_floodAge * 1.6) * u_floodAmp;
    vec3 floodCol = mix(vec3(1.0, 0.85, 0.55), liveHue, 0.4);
    col += floodCol * floodBand * (1.2 + 1.4 * u_low) * (0.4 + 0.6 * sh);

    // MID EDGE-GLOW: a traveling band of light running along the silhouette
    // (fresnel-gated), sweeping with the bpm rate.
    float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.5);
    float travel = 0.5 + 0.5 * sin(hitP.y * 4.0 - u_rate * 2.0 + cellId);
    col += liveHue * fres * travel * (0.15 + 1.6 * u_mid);

    // HIGH GLINTS: sparse specular pops off corners (curvature-ish via
    // fresnel × noise), fired by high impulses.
    vec3 halfv = normalize(lightDir - rd);
    float spec = pow(clamp(dot(n, halfv), 0.0, 1.0), 60.0);
    float glintMask = step(0.72, hash21(floor(hitP.xy * 12.0) + cellId));
    col += vec3(1.0) * spec * glintMask * (0.2 + 4.0 * u_glint) * fres;

    // Emissive light-slit seams up the faces (buildup rising columns).
    col += liveHue * emAcc * 6.0;

    // DROP IGNITE: the whole edifice glows emissive — edges bloom, warm.
    col += stone * u_drop * (0.4 + 0.8 * fres) * vec3(1.1, 0.85, 0.6);

    // Fog: exponential depth fade into the sky (atmosphere).
    float fog = 1.0 - exp(-tcur * (0.09 + 0.03 * u_flatness));
    col = mix(col, sky, fog);
  } else {
    col = sky;
  }

  // Emissive slit glow reaches the sky too (glow around the silhouette).
  col += palette(0.5 + u_lightHue) * emAcc * (2.0 + 3.0 * u_buildup);

  // ── Feedback: unsharp-tapped light-trail buffer. The traveling glow and
  // drop bloom persist and smear along the silhouette; unsharp keeps the
  // stone edges crisp against endless resampling (voyage anti-mush idiom).
  vec2 src = uv;
  // Slow drift so trails rise (light climbs the building).
  src.y -= (0.004 + 0.02 * u_buildup) * (0.5 + 0.5 * u_energy);
  vec3 fbC = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 trail = max(vec3(0.0), fbC * 1.3 - blur * 0.3) * u_decay;
  col = max(col, trail * 0.85 + col * 0.15);

  // REBIRTH flood: a bright horizon wipe during track change, smoothed so
  // it is not a strobe (JS eases u_rebirth over ~2.2 s).
  float wipe = exp(-abs(uv.y - u_rebirth) * 6.0) * (1.0 - abs(u_rebirth - 0.5) * 2.0);
  col += palette(0.4 + u_lightHue) * wipe * 1.2;

  // Fine dust/powder in the fog on snares (mid transient), plus film grain.
  float dust = fbm(sc * 26.0 + t * 0.5) * u_snare;
  col += vec3(0.8, 0.85, 1.0) * dust * 0.25;
  col += (hash21(gl_FragCoord.xy + fract(t) * 131.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // ── Chroma-preserving soft knee (never per-channel clamp): compress only
  // the luminance above the knee so bright ignites keep their hue.
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.85) {
    col *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

/** Splitmix32-style integer hash → a stable float in [0, 1). */
function splitmix(seed: number): number {
  let z = (seed + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return (z >>> 0) / 4294967296;
}

/** Six stable genome scalars in [0, 1] from a trackId (or pseudo-seed). */
function genomeOf(seed: number): number[] {
  const out: number[] = [];
  let s = Math.floor(seed) | 0;
  for (let i = 0; i < 6; i++) {
    s = (s + 0x6d2b79f5) | 0;
    out.push(splitmix(s + i * 0x2545f491));
  }
  return out;
}

const g02Monolith: VisualizerPreset = {
  id: 'g02-monolith',
  name: 'g02 monolith',
  hiRes: true,
  params: [
    { id: 'height', label: 'skyline height', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'lights', label: 'light intensity', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'stone palette (granite→sand→verdigris→porphyry)', min: 0, max: 3, step: 0.05, default: -1 },
    { id: 'persistence', label: 'light trails', min: 0.5, max: 1.6, step: 0.05, default: 1 },
    { id: 'fog', label: 'atmosphere', min: 0.3, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    // Slow stats (EMA, tau ~15 s) — the continuous genome.
    let sCentroid = 0.5;
    let sSpread = 0.4;
    let sFlatness = 0.4;
    let sEnergy = 0.2;
    // Deterministic genome (from trackId), plus the rebirth cross-fade.
    let currentSeed = -1;
    let genome = genomeOf(0);
    let targetGenome = genome;
    let prevGenome = genome;
    let rebirthT = 1; // 1 = settled
    // Live smoothing.
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let floodAge = 999;
    let floodAmp = 0;
    let ratePhase = 0;
    let swayPhase = 0;
    let phraseVal = 0;
    let sectionPulse = 0;
    let lastBar = -1;
    let lightHue = 0;
    let pushVal = 0;
    let seeded = false;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        // Dominant audible deck = highest master-audible level.
        // dominant: smoothed frame.dominantChannel (layering jitter fix)
        let dom =
          (frame.decks.find((d) => d.channel === frame.dominantChannel) ??
            null) as null | (typeof frame.decks)[number];
        if (dom === null) {
          for (const d of frame.decks) {
            if (d.playing && (dom === null || d.level > dom.level)) dom = d;
          }
        }
        const trackId = dom?.trackId ?? null;

        // Slow stats EMA (tau ~15 s).
        const emaA = 1 - Math.exp(-dt / 15);
        sCentroid += (frame.centroid - sCentroid) * emaA;
        sSpread += (frame.spread - sSpread) * emaA;
        sFlatness += (frame.flatness - sFlatness) * emaA;
        sEnergy += (energyOf(frame.bands) - sEnergy) * emaA;

        // DETERMINISTIC SEED + TRACK CHANGE = REBIRTH. When the dominant
        // trackId changes, stage a ~2.2 s re-genesis (genome cross-fade +
        // rising flood wipe). No trackId ⇒ freeze slow stats as pseudo-seed.
        const seedSource =
          trackId !== null
            ? trackId
            : Math.floor(sCentroid * 733 + sSpread * 971 + sFlatness * 613 + 1);
        if (!seeded) {
          currentSeed = seedSource;
          genome = genomeOf(seedSource);
          targetGenome = genome;
          prevGenome = genome;
          rebirthT = 1;
          seeded = true;
        } else if (trackId !== null && trackId !== currentSeed) {
          currentSeed = trackId;
          prevGenome = genome.slice();
          targetGenome = genomeOf(trackId);
          rebirthT = 0; // launch re-genesis
        }
        if (rebirthT < 1) rebirthT = Math.min(1, rebirthT + dt / 2.2);
        const ease = rebirthT * rebirthT * (3 - 2 * rebirthT);
        genome = targetGenome.map((g, i) => prevGenome[i] + (g - prevGenome[i]) * ease);

        // bpm scales ALL motion. Fall back to a mid tempo when gridless.
        const bpm = frame.beat?.bpm ?? 120;
        const beatsPerSec = bpm / 60;
        ratePhase += dt * beatsPerSec * Math.PI * 0.5;
        swayPhase += dt * beatsPerSec * Math.PI * 0.25;

        // Excitement split by bass presence (voyage idiom), smoothed ~0.35 s.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const sa = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * sa;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * sa;

        // Camera push follows the drop (smoothed release).
        pushVal += (smoothDrop - pushVal) * (1 - Math.exp(-dt / 0.5));

        // Phrase: raise the structure across the 16-bar phrase, with an
        // anticipation lift in the last bar. Section boundary = reconfigure.
        const bar = frame.beat?.barIndex ?? -1;
        const barPhase = frame.beat?.barPhase ?? 0;
        if (bar >= 0) {
          const inPhrase = ((bar % 16) + barPhase) / 16; // 0..1
          const anticipation = bar % 16 === 15 ? barPhase * 0.4 : 0;
          const targetPhrase = Math.min(1, inPhrase + anticipation);
          phraseVal += (targetPhrase - phraseVal) * (1 - Math.exp(-dt / 0.6));
          // Section boundary every 16 bars: fire a reconfigure pulse.
          if (bar !== lastBar && bar % 16 === 0 && lastBar >= 0) sectionPulse = 1;
          lastBar = bar;
        } else {
          // Gridless: slow autonomous breathing.
          phraseVal = 0.4 + 0.3 * Math.sin(frame.time * 0.08);
        }
        sectionPulse = Math.max(0, sectionPulse - dt / 1.4);

        // Kick flood: retrigger on strong kicks (gated — kick clicks are
        // broadband; the low gate keeps floods SOLID, not powder).
        floodAge += dt;
        if (frame.impulse.low > 0.35 && floodAge > 0.14) {
          floodAge = 0;
          floodAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        // Live light hue drifts with mids/highs + centroid (color travels).
        lightHue += dt * (0.02 + 0.15 * frame.bands.high + 0.05 * frame.bands.mid);
        const hueOut = lightHue + sCentroid * 0.3;

        // Params.
        const heightP = frame.params.height ?? 1;
        const lightsP = frame.params.lights ?? 1;
        const paletteP = frame.params.palette ?? -1;
        const persistence = frame.params.persistence ?? 1;
        const fogP = frame.params.fog ?? 1;

        // Genome → shader structural uniforms. Palette family is the song's
        // choice unless the slider overrides it (>= 0).
        const family = genome[0] * 2; // 0..2
        const symmetry = genome[1];
        const paletteFam = paletteP >= 0 ? paletteP : genome[2] * 3;
        const freqA = genome[3];
        const freqB = genome[4];
        const freqC = genome[5];

        // Feedback decay: gentle, energy-tied, buildups drain a touch.
        const baseDecay = 0.9 - 0.02 * sEnergy - 0.015 * smoothBuildup;
        const decay = Math.min(0.96, 1 - (1 - baseDecay) / persistence);

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_glint: frame.impulse.high,
          u_centroid: sCentroid,
          u_spread: Math.min(1, sSpread * heightP),
          u_flatness: sFlatness / Math.max(0.3, fogP) + 0,
          u_energy: sEnergy * lightsP,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_phrase: phraseVal * heightP,
          u_section: sectionPulse,
          u_rebirth: rebirthT < 1 ? rebirthT : 0,
          u_push: pushVal,
          u_rate: ratePhase,
          u_sway: swayPhase,
          u_floodAge: floodAge,
          u_floodAmp: floodAmp * lightsP,
          u_decay: decay,
          u_family: family,
          u_symmetry: symmetry,
          u_paletteFam: paletteFam,
          u_freqA: freqA,
          u_freqB: freqB,
          u_freqC: freqC,
          u_lightHue: hueOut,
        };
      },
    });
  },
};

export default g02Monolith;
