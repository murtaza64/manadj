/**
 * g03-monolith-lux (gen-3 candidate, TWEAK of g02-monolith).
 *
 * Human on g02: 'needs work but interesting'. This iteration pushes two
 * axes the human called out — LEGIBILITY and SPECTACLE — while keeping
 * g02's song-genome architecture (deterministic building, rebirth, phrase
 * raise, section reconfigure) intact.
 *
 * ── LEGIBILITY (kill the mid-gray mush) ─────────────────────────────────
 * 1. RIM / SKY CONTRAST: the silhouette gets a hard rim-light (fresnel
 *    keyed against a brightened, more saturated sky) so architecture reads
 *    against the background at a glance. Ambient floor is lowered and the
 *    sky top is pushed cooler/brighter so buildings sit as dark, legible
 *    masses with lit edges instead of an even gray field.
 * 2. AO-ish contact darkening near the ground line + steeper key falloff
 *    so massing (columns vs slabs vs arches) separates by shading.
 *
 * ── SPECTACLE (the light show goes harder) ──────────────────────────────
 * 3. PER-REGISTER WINDOW LIGHTS (deck EQ strata): the dominant deck's EQ
 *    is read JS-side into u_eqLow/u_eqMid/u_eqHigh (0..1, 0.5 = flat).
 *    Buildings are split into three vertical STRATA — a low base band, a
 *    mid shaft band, a high crown band — each lit by a grid of window
 *    lights whose brightness AND color track its register: the low band
 *    answers to bands.low × u_eqLow, mid to bands.mid × u_eqMid, high to
 *    bands.high × u_eqHigh. Pulling an EQ kill (knob → 0) visibly DARKENS
 *    that stratum's windows; boosting (knob → 1) floods it.
 * 4. BEAT-LOCKED LIGHTNING: on downbeats a localized bolt cracks across
 *    the sky behind the skyline (jagged noise path, localized glow — EXEMPT
 *    from the flash floor). On strong downbeats a full-field sky FLASH is
 *    allowed but HARD RATE-LIMITED to ≤3/s (JS refractory ≥0.34 s) and
 *    smoothed (~0.09 s attack / soft decay) so it is a bloom, not a strobe,
 *    and never saturated-red.
 * 5. PHRASE FLOODS: the phrase-end anticipation drives a warm horizon
 *    flood that swells across the last bar (smoothed), so a build reads as
 *    the whole city brightening toward the boundary.
 * 6. SECTION RECONFIG harder: the section pulse both re-rolls massing (g02)
 *    and throws a brighter re-light sweep up the faces.
 *
 * ── GEN-3 responsiveness ────────────────────────────────────────────────
 * Every element answers to something musical: EQ (window strata), bands
 * (per-register light gain), impulses (kick floor-flood, snare powder,
 * high glints), spectrum bright-tilt (crown emphasis), meter (beat →
 * lightning, bar → phrase raise + flood, section → reconfigure sweep),
 * trend (drop ignite + push, buildup rising sky).
 *
 * ── Raymarch budget ─────────────────────────────────────────────────────
 * 2.5D SDF skyline, fixed 44-step sphere-trace (≤48 cap), single 12-tap
 * soft-shadow secondary march, analytic fog. GLSL ES 1.0, no backticks.
 *
 * Safety: photosensitivity floor — the ONLY full-field envelope (drop
 * ignite, rebirth flood, and the downbeat sky FLASH) are all rate-limited
 * and smoothed; the sky flash is throttled to ≤3/s JS-side and never
 * red-strobes. Localized bolts, kick floods and window lights are exempt
 * (they are spatially bounded).
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
uniform float u_kick;
uniform float u_snare;
uniform float u_glint;
uniform float u_centroid;
uniform float u_spread;
uniform float u_flatness;
uniform float u_energy;
uniform float u_drop;
uniform float u_buildup;
uniform float u_phrase;
uniform float u_section;
uniform float u_rebirth;
uniform float u_push;
uniform float u_rate;
uniform float u_sway;
uniform float u_floodAge;
uniform float u_floodAmp;
uniform float u_decay;
uniform float u_family;
uniform float u_symmetry;
uniform float u_paletteFam;
uniform float u_freqA;
uniform float u_freqB;
uniform float u_freqC;
uniform float u_lightHue;
// gen-3 additions
uniform float u_eqLow;       // dominant deck EQ low knob 0..1 (0.5 flat)
uniform float u_eqMid;       // dominant deck EQ mid knob
uniform float u_eqHigh;      // dominant deck EQ high knob
uniform float u_winLow;      // low-stratum window drive (band x eq)
uniform float u_winMid;      // mid-stratum window drive
uniform float u_winHigh;     // high-stratum window drive
uniform float u_boltAge;     // seconds since last localized bolt
uniform float u_boltSeed;    // per-bolt random seed
uniform float u_flash;       // rate-limited full-field sky flash 0..1
uniform float u_phraseFlood; // phrase-end horizon flood 0..1
uniform float u_bright;      // spectral bright-tilt (crown emphasis)

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

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

vec3 pal0(float t) { return vec3(0.24, 0.26, 0.32) + vec3(0.30, 0.32, 0.40) * cos(6.28318 * (vec3(1.0, 0.95, 0.85) * t + vec3(0.0, 0.10, 0.22))); }
vec3 pal1(float t) { return vec3(0.36, 0.28, 0.20) + vec3(0.40, 0.34, 0.24) * cos(6.28318 * (vec3(1.0, 0.90, 0.70) * t + vec3(0.0, 0.14, 0.30))); }
vec3 pal2(float t) { return vec3(0.20, 0.30, 0.34) + vec3(0.28, 0.44, 0.46) * cos(6.28318 * (vec3(0.9, 1.0, 0.85) * t + vec3(0.10, 0.28, 0.48))); }
vec3 pal3(float t) { return vec3(0.34, 0.20, 0.38) + vec3(0.44, 0.30, 0.50) * cos(6.28318 * (vec3(1.0, 0.85, 1.0) * t + vec3(0.05, 0.20, 0.42))); }

vec3 palette(float t) {
  float x = clamp(u_paletteFam, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  c += (vec3(0.10, 0.02, -0.06)) * (u_centroid - 0.5) * 2.0;
  c += vec3(0.06, 0.01, -0.03) * u_buildup;
  return c;
}

float sdBox(vec3 p, vec3 b) {
  vec3 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

// building() now returns the cell height in outH so the fragment can place
// the three EQ strata (base/shaft/crown) as fractions of the face.
float building(vec3 p, float ci, out float emissive, out float cellId, out float outH) {
  cellId = ci;
  float r0 = hash11(ci * 1.7 + u_freqA * 31.0 + 3.1);
  float r1 = hash11(ci * 2.3 + u_freqB * 17.0 + 9.7);
  float r2 = hash11(ci * 0.9 + u_freqC * 23.0 + 5.3);
  float complexity = 0.35 + 0.9 * u_spread;
  float sectShift = u_section * (r1 - 0.5) * 1.6;
  float baseH = 0.7 + complexity * (0.4 + 1.5 * r0) + sectShift;
  baseH *= 0.55 + 0.75 * u_phrase;
  baseH *= 0.9 + 0.35 * u_energy;
  outH = baseH;
  float fam = clamp(u_family, 0.0, 2.0);
  float wCol = mix(0.12, 0.34, clamp(fam, 0.0, 1.0));
  float depth = mix(0.14, 0.30, clamp(fam, 0.0, 1.0));
  float wArc = mix(wCol, 0.20 + 0.10 * r2, clamp(fam - 1.0, 0.0, 1.0));
  float width = mix(wCol, wArc, clamp(fam - 1.0, 0.0, 1.0));
  float sway = sin(u_sway + ci * 0.9) * (0.02 + 0.05 * u_low) * (1.0 - 0.5 * clamp(fam, 0.0, 1.0));
  vec3 q = p;
  q.x -= sway;
  float notch = 0.0;
  float notchF = 3.0 + 9.0 * u_freqB;
  notch = 0.03 * clamp(fam, 0.0, 1.0) * (0.5 + 0.5 * sin(q.y * notchF + ci));
  vec3 c = vec3(0.0, baseH * 0.5, 0.0);
  vec3 b = vec3(width - notch, baseH * 0.5, depth);
  float d = sdBox(q - c, b);
  float archLevel = baseH - (0.30 + 0.25 * r2);
  float archR = width * (0.9 + 0.4 * sin(u_freqC * 6.28318 + ci));
  vec3 ap = q - vec3(0.0, archLevel, 0.0);
  float arch = length(ap.xy * vec2(1.0, 1.2)) - archR;
  float archMask = clamp(fam - 1.0, 0.0, 1.0);
  d = mix(d, max(d, -arch), archMask);
  float slit = exp(-abs(q.x) * (30.0 - 10.0 * u_buildup)) * step(0.0, q.y) * step(q.y, baseH);
  float climb = smoothstep(0.0, baseH, q.y - u_buildup * baseH * 1.2 + mod(u_time * (0.4 + 0.8 * u_buildup) + ci, baseH));
  emissive = slit * (0.15 + 1.2 * u_buildup) * (0.4 + 0.6 * climb) * (0.5 + 0.5 * r0);
  return d;
}

float mapScene(vec3 p, out float emissive, out float cellId, out float outH) {
  emissive = 0.0;
  cellId = 0.0;
  outH = 1.0;
  float ground = p.y;
  float sym = 1.0 + floor(u_symmetry * 3.0);
  float bay = 2.4 / sym;
  float pz = abs(mod(p.z + bay * 0.5, bay * 2.0) - bay);
  vec3 q = vec3(p.x, p.y, pz);
  float pitch = 0.5 + 0.22 * u_freqA;
  float xi = floor(q.x / pitch + 0.5);
  q.x -= xi * pitch;
  q.y += (1.0 - u_rebirth) * 2.0;
  float em;
  float ci;
  float h1;
  float d = building(q, xi, em, ci, h1);
  vec3 q2 = q;
  q2.z += 1.1 + 0.6 * u_spread;
  q2.x -= pitch * 0.5;
  float em2;
  float ci2;
  float h2;
  float d2 = building(q2, xi + 101.0, em2, ci2, h2);
  float dCity = min(d, d2);
  float useH = h1;
  if (d2 < d) { em = em2; ci = ci2; useH = h2; }
  float dScene = min(ground, dCity);
  emissive = em;
  cellId = ci;
  outH = useH;
  return dScene;
}

float mapDist(vec3 p) {
  float e;
  float c;
  float h;
  return mapScene(p, e, c, h);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    mapDist(p + e.xyy) - mapDist(p - e.xyy),
    mapDist(p + e.yxy) - mapDist(p - e.yxy),
    mapDist(p + e.yyx) - mapDist(p - e.yyx)
  ));
}

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

// Jagged localized lightning bolt behind the skyline. Returns a bounded
// glow (exempt from the flash floor — it is spatially localized). The bolt
// descends a noisy near-vertical path; glow falls off sharply off-axis.
float bolt(vec2 p) {
  if (u_boltAge > 0.5) return 0.0;
  float life = exp(-u_boltAge * 7.0);            // fast flicker-out
  // horizontal position of the strike, jittered per bolt.
  float bx = (hash11(u_boltSeed) - 0.5) * 1.3;
  // jagged path: sum of a couple of noise octaves along y.
  float jag = (noise2(vec2(u_boltSeed * 11.0, p.y * 6.0)) - 0.5) * 0.18
            + (noise2(vec2(u_boltSeed * 23.0, p.y * 16.0)) - 0.5) * 0.07;
  float dx = abs(p.x - (bx + jag));
  float core = exp(-dx * 90.0);                  // thin hot core
  float halo = exp(-dx * 12.0) * 0.35;           // soft halo
  float topFade = smoothstep(-0.2, 0.7, p.y);    // brighter up high
  return (core + halo) * life * topFade;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 sc = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 px = 1.0 / u_res;
  float t = u_time;

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

  float tmax = 22.0;
  float tcur = 0.0;
  float hit = 0.0;
  float emAcc = 0.0;
  float cellId = 0.0;
  float cellH = 1.0;
  vec3 hitP = ro;
  for (int i = 0; i < 44; i++) {
    vec3 p = ro + rd * tcur;
    float em;
    float ci;
    float ch;
    float d = mapScene(p, em, ci, ch);
    emAcc += em * exp(-tcur * 0.35) * 0.03;
    if (d < 0.003 * tcur + 0.002) {
      hit = 1.0;
      hitP = p;
      cellId = ci;
      cellH = ch;
      break;
    }
    tcur += d;
    if (tcur > tmax) break;
  }

  vec3 col = vec3(0.0);

  // ── Sky: stronger contrast for LEGIBILITY. Cooler/brighter top, darker
  // low band, more saturated — so the silhouette reads as dark masses.
  float horizon = smoothstep(-0.15, 0.6, rd.y);
  vec3 skyLow = palette(0.12 + u_centroid * 0.3 + t * 0.01);
  vec3 skyHigh = palette(0.58 + t * 0.008) + vec3(0.02, 0.04, 0.10);
  vec3 sky = mix(skyLow * 0.32, skyHigh * 1.05, horizon);
  sky *= 0.32 + 0.5 * u_energy + 0.7 * u_buildup + 0.9 * u_drop;
  float skyLum = dot(sky, vec3(0.299, 0.587, 0.114));
  // stronger baseline saturation so mid-gray never dominates.
  sky = mix(sky, sky + (sky - vec3(skyLum)) * 1.35, 0.45 + 0.5 * u_buildup);

  // Localized lightning behind the skyline (sky-space) + rate-limited full
  // field flash (already throttled JS-side; smoothed, never red).
  vec2 skyP = vec2(sc.x, rd.y);
  float lightning = bolt(skyP);
  vec3 boltCol = vec3(0.75, 0.85, 1.0);
  sky += boltCol * lightning * 2.4;
  vec3 flashCol = mix(vec3(0.8, 0.88, 1.0), palette(0.5 + u_lightHue), 0.4);
  sky += flashCol * u_flash * 0.6;
  // Phrase-end horizon flood: warm swell near the skyline base.
  float floodBandSky = exp(-abs(rd.y + 0.02) * 5.0);
  sky += vec3(1.0, 0.8, 0.5) * u_phraseFlood * floodBandSky * 0.5;

  if (hit > 0.5) {
    vec3 n = calcNormal(hitP);
    float grain = fbm(hitP.xy * (8.0 + 40.0 * u_flatness) + hitP.z * 3.0);
    vec3 stone = palette(0.3 + cellId * 0.013 + hitP.y * 0.05);
    stone *= 0.6 + 0.4 * mix(1.0, grain, u_flatness);

    vec3 lightDir = normalize(vec3(0.4 * sin(u_rate * 0.3), 1.0, -0.3));
    vec3 liveHue = 0.5 + 0.5 * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * u_lightHue + vec3(0.0, 0.2, 0.4)));
    float diff = clamp(dot(n, lightDir), 0.0, 1.0);
    float sh = softShadow(hitP + n * 0.01, lightDir);
    // LEGIBILITY: lower ambient floor + steeper key + contact darkening so
    // masses separate. AO fades in near the ground line.
    float ao = smoothstep(0.0, 0.6, hitP.y);
    col = stone * (0.10 + 0.95 * diff * sh) * (0.5 + 0.5 * ao);

    // ── PER-REGISTER WINDOW LIGHTS (deck EQ strata) ─────────────────────
    // Split the face into three vertical strata by height fraction. Each
    // stratum is a grid of window cells lit by its own register's drive
    // (band x EQ knob). EQ kill -> that band's windows go dark.
    float hf = clamp(hitP.y / max(cellH, 0.001), 0.0, 1.0);
    float sLow = 1.0 - smoothstep(0.28, 0.40, hf);                 // base
    float sMid = smoothstep(0.28, 0.40, hf) * (1.0 - smoothstep(0.62, 0.74, hf)); // shaft
    float sHigh = smoothstep(0.62, 0.74, hf);                      // crown
    // window grid: quantize face-local coords into cells; front-face gated
    // by fresnel so windows read on the faces we see.
    vec2 wcoord = vec2(hitP.x * 22.0 + cellId * 7.0, hitP.y * 14.0);
    vec2 wcell = floor(wcoord);
    vec2 wf = fract(wcoord) - 0.5;
    float pane = smoothstep(0.42, 0.30, length(wf));              // lit pane mask
    float lit = step(0.35, hash21(wcell + cellId));               // sparse lit windows
    float winMask = pane * lit;
    // per-register window color: low warm, mid neutral live, high cool.
    vec3 lowWinCol = vec3(1.0, 0.55, 0.28);
    vec3 midWinCol = mix(vec3(0.8, 0.85, 0.6), liveHue, 0.6);
    vec3 highWinCol = vec3(0.55, 0.8, 1.0);
    float flicker = 0.7 + 0.3 * sin(u_rate * 2.0 + wcell.x * 1.7 + wcell.y * 0.9);
    vec3 windows =
        lowWinCol * (sLow * u_winLow)
      + midWinCol * (sMid * u_winMid)
      + highWinCol * (sHigh * u_winHigh * (0.7 + 0.6 * u_bright));
    col += windows * winMask * flicker * 2.4;

    // KICK FLOOD: rising vertical light wall (localized), gated on kick.
    float floodFront = u_floodAge * (2.6 + 4.0 * u_low);
    float floodBand = exp(-pow((hitP.y - floodFront) * 3.0, 2.0)) * exp(-u_floodAge * 1.6) * u_floodAmp;
    vec3 floodCol = mix(vec3(1.0, 0.85, 0.55), liveHue, 0.4);
    col += floodCol * floodBand * (1.2 + 1.4 * u_low) * (0.4 + 0.6 * sh);

    // MID EDGE-GLOW: traveling band along the silhouette (fresnel-gated).
    float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.5);
    float travel = 0.5 + 0.5 * sin(hitP.y * 4.0 - u_rate * 2.0 + cellId);
    col += liveHue * fres * travel * (0.15 + 1.6 * u_mid);

    // HARD RIM LIGHT (legibility): edges catch the sky so the silhouette
    // separates from the background even in shadow.
    float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.5);
    vec3 rimCol = mix(skyHigh * 1.4, liveHue, 0.35);
    col += rimCol * rim * (0.6 + 0.7 * u_energy + 0.8 * u_buildup);

    // HIGH GLINTS: sparse specular pops off corners.
    vec3 halfv = normalize(lightDir - rd);
    float spec = pow(clamp(dot(n, halfv), 0.0, 1.0), 60.0);
    float glintMask = step(0.72, hash21(floor(hitP.xy * 12.0) + cellId));
    col += vec3(1.0) * spec * glintMask * (0.2 + 4.0 * u_glint) * fres;

    // Emissive light-slit seams (buildup rising columns).
    col += liveHue * emAcc * 6.0;

    // SECTION reconfig sweep: brighter re-light climbing the faces.
    float sweep = smoothstep(0.0, 1.0, hf - (1.0 - u_section)) * u_section;
    col += mix(vec3(1.0, 0.9, 0.7), liveHue, 0.5) * sweep * 1.4;

    // Lightning briefly rim-lights the front faces (localized bolt bounce).
    col += boltCol * lightning * fres * 1.2;

    // DROP IGNITE: the whole edifice glows emissive — edges bloom, warm.
    col += stone * u_drop * (0.4 + 0.8 * fres) * vec3(1.1, 0.85, 0.6);

    float fog = 1.0 - exp(-tcur * (0.09 + 0.03 * u_flatness));
    col = mix(col, sky, fog);
  } else {
    col = sky;
  }

  // Emissive slit glow reaches the sky too.
  col += palette(0.5 + u_lightHue) * emAcc * (2.0 + 3.0 * u_buildup);

  // Feedback: unsharp-tapped light-trail buffer (anti-mush).
  vec2 src = uv;
  src.y -= (0.004 + 0.02 * u_buildup) * (0.5 + 0.5 * u_energy);
  vec3 fbC = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 trail = max(vec3(0.0), fbC * 1.3 - blur * 0.3) * u_decay;
  col = max(col, trail * 0.85 + col * 0.15);

  // REBIRTH flood: bright horizon wipe during track change (smoothed JS).
  float wipe = exp(-abs(uv.y - u_rebirth) * 6.0) * (1.0 - abs(u_rebirth - 0.5) * 2.0);
  col += palette(0.4 + u_lightHue) * wipe * 1.2;

  // Snare powder in the fog + film grain.
  float dust = fbm(sc * 26.0 + t * 0.5) * u_snare;
  col += vec3(0.8, 0.85, 1.0) * dust * 0.25;
  col += (hash21(gl_FragCoord.xy + fract(t) * 131.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // ── Chroma-preserving soft knee (never per-channel clamp).
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

const g03MonolithLux: VisualizerPreset = {
  id: 'g03-monolith-lux',
  name: 'g03 monolith-lux',
  hiRes: true,
  params: [
    { id: 'height', label: 'skyline height', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'lights', label: 'light intensity', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'stone palette (granite→sand→verdigris→porphyry)', min: 0, max: 3, step: 0.05, default: -1 },
    { id: 'persistence', label: 'light trails', min: 0.5, max: 1.6, step: 0.05, default: 1 },
    { id: 'fog', label: 'atmosphere', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'windows', label: 'EQ window lights', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'lightning', label: 'beat lightning', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let sCentroid = 0.5;
    let sSpread = 0.4;
    let sFlatness = 0.4;
    let sEnergy = 0.2;
    let currentSeed = -1;
    let genome = genomeOf(0);
    let targetGenome = genome;
    let prevGenome = genome;
    let rebirthT = 1;
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
    // gen-3 state.
    let eqLow = 0.5;
    let eqMid = 0.5;
    let eqHigh = 0.5;
    let winLow = 0;
    let winMid = 0;
    let winHigh = 0;
    let boltAge = 999;
    let boltSeed = 0;
    let flashVal = 0;
    let flashRefractory = 0; // seconds until the next full-field flash is allowed
    let lastBeat = -1;
    let phraseFlood = 0;
    let brightVal = 0.5;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

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

        const emaA = 1 - Math.exp(-dt / 15);
        sCentroid += (frame.centroid - sCentroid) * emaA;
        sSpread += (frame.spread - sSpread) * emaA;
        sFlatness += (frame.flatness - sFlatness) * emaA;
        sEnergy += (energyOf(frame.bands) - sEnergy) * emaA;

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
          rebirthT = 0;
        }
        if (rebirthT < 1) rebirthT = Math.min(1, rebirthT + dt / 2.2);
        const ease = rebirthT * rebirthT * (3 - 2 * rebirthT);
        genome = targetGenome.map((g, i) => prevGenome[i] + (g - prevGenome[i]) * ease);

        const bpm = frame.beat?.bpm ?? 120;
        const beatsPerSec = bpm / 60;
        ratePhase += dt * beatsPerSec * Math.PI * 0.5;
        swayPhase += dt * beatsPerSec * Math.PI * 0.25;

        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const sa = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * sa;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * sa;

        pushVal += (smoothDrop - pushVal) * (1 - Math.exp(-dt / 0.5));

        // Phrase raise + phrase-end flood.
        const bar = frame.beat?.barIndex ?? -1;
        const barPhase = frame.beat?.barPhase ?? 0;
        let anticipationTarget = 0;
        if (bar >= 0) {
          const inPhrase = ((bar % 16) + barPhase) / 16;
          const anticipation = bar % 16 === 15 ? barPhase * 0.4 : 0;
          const targetPhrase = Math.min(1, inPhrase + anticipation);
          phraseVal += (targetPhrase - phraseVal) * (1 - Math.exp(-dt / 0.6));
          // last two bars of the phrase drive a warm horizon flood.
          if (bar % 16 === 15) anticipationTarget = barPhase;
          else if (bar % 16 === 14) anticipationTarget = 0.3 * barPhase;
          if (bar !== lastBar && bar % 16 === 0 && lastBar >= 0) sectionPulse = 1;
          lastBar = bar;
        } else {
          phraseVal = 0.4 + 0.3 * Math.sin(frame.time * 0.08);
        }
        sectionPulse = Math.max(0, sectionPulse - dt / 1.4);
        phraseFlood += (anticipationTarget - phraseFlood) * (1 - Math.exp(-dt / 0.5));

        // Kick flood.
        floodAge += dt;
        if (frame.impulse.low > 0.35 && floodAge > 0.14) {
          floodAge = 0;
          floodAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        lightHue += dt * (0.02 + 0.15 * frame.bands.high + 0.05 * frame.bands.mid);
        const hueOut = lightHue + sCentroid * 0.3;

        // ── Deck EQ → window strata. Smooth the knobs so kills/boosts read
        // as a fade, not a jump. bands x eq knob = per-register drive.
        const eqA = 1 - Math.exp(-dt / 0.12);
        const domEqLow = dom?.eq.low ?? 0.5;
        const domEqMid = dom?.eq.mid ?? 0.5;
        const domEqHigh = dom?.eq.high ?? 0.5;
        eqLow += (domEqLow - eqLow) * eqA;
        eqMid += (domEqMid - eqMid) * eqA;
        eqHigh += (domEqHigh - eqHigh) * eqA;
        // EQ knob → gain: kill (0) darkens hard, flat (0.5) neutral, boost
        // (1) floods. Curve so a full kill reads as near-black windows.
        const eqGain = (k: number) => Math.max(0, k * 2) ** 1.4;
        const winA = 1 - Math.exp(-dt / 0.09);
        winLow += (frame.bands.low * eqGain(eqLow) - winLow) * winA;
        winMid += (frame.bands.mid * eqGain(eqMid) - winMid) * winA;
        winHigh += (frame.bands.high * eqGain(eqHigh) - winHigh) * winA;

        // Spectral bright-tilt: crown emphasis from the upper spectrum.
        const spec = frame.spectrum;
        let bright = 0.5;
        if (spec.length > 0) {
          const n = spec.length;
          let lo = 0;
          let hi = 0;
          for (let i = 0; i < n; i++) {
            if (i < n / 2) lo += spec[i];
            else hi += spec[i];
          }
          const tot = lo + hi;
          bright = tot > 1e-4 ? hi / tot : 0.5;
        }
        brightVal += (bright - brightVal) * (1 - Math.exp(-dt / 0.4));

        // ── Beat-locked lightning. Fire a LOCALIZED bolt on every downbeat
        // (beatInBar 0). Localized bolts are exempt from the flash floor.
        const beatInBar = frame.beat?.beatInBar ?? -1;
        const beatIndexRaw =
          bar >= 0 && frame.beat ? bar * frame.beat.beatsPerBar + beatInBar : -1;
        boltAge += dt;
        flashRefractory = Math.max(0, flashRefractory - dt);
        if (beatIndexRaw >= 0 && beatIndexRaw !== lastBeat) {
          lastBeat = beatIndexRaw;
          if (beatInBar === 0) {
            // localized bolt every downbeat (always allowed).
            boltAge = 0;
            boltSeed = (boltSeed + 0.6180339887) % 1;
            // Full-field FLASH only on strong, bass-heavy downbeats, and
            // only when the refractory window has elapsed. Refractory ≥
            // 0.34 s enforces the ≤3 flashes/s photosensitivity floor.
            const strong = frame.impulse.low > 0.45 && smoothDrop > 0.35;
            if (strong && flashRefractory <= 0) {
              flashVal = 1;
              flashRefractory = 0.34;
            }
          }
        }
        // Flash envelope: soft attack already implied by the trigger; decay
        // it so it is a bloom, not a strobe.
        flashVal = Math.max(0, flashVal - dt / 0.22);

        const heightP = frame.params.height ?? 1;
        const lightsP = frame.params.lights ?? 1;
        const paletteP = frame.params.palette ?? -1;
        const persistence = frame.params.persistence ?? 1;
        const fogP = frame.params.fog ?? 1;
        const windowsP = frame.params.windows ?? 1;
        const lightningP = frame.params.lightning ?? 1;

        const family = genome[0] * 2;
        const symmetry = genome[1];
        const paletteFam = paletteP >= 0 ? paletteP : genome[2] * 3;
        const freqA = genome[3];
        const freqB = genome[4];
        const freqC = genome[5];

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
          u_flatness: sFlatness / Math.max(0.3, fogP),
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
          u_eqLow: eqLow,
          u_eqMid: eqMid,
          u_eqHigh: eqHigh,
          u_winLow: winLow * windowsP * lightsP,
          u_winMid: winMid * windowsP * lightsP,
          u_winHigh: winHigh * windowsP * lightsP,
          u_boltAge: boltAge / Math.max(0.25, lightningP),
          u_boltSeed: boltSeed,
          u_flash: flashVal * Math.min(1, lightningP),
          u_phraseFlood: phraseFlood * lightsP,
          u_bright: brightVal,
        };
      },
    });
  },
};

export default g03MonolithLux;
