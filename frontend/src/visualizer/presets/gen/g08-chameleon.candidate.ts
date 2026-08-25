/**
 * g08-chameleon (gen-8 candidate, NOVEL) — the tonality chameleon.
 *
 * Human idea (verbatim brief): a preset that is "colorful when sounds are
 * melodic and more monotone and kinetic when sounds are more percussive".
 * The scene has two poles and a CONTINUOUS blend between them (never a hard
 * flip; crossfades ride 500ms+), plus a traveling FRONT that makes the
 * transition itself the showpiece.
 *
 * Human verdict on the prior version (verbatim): "i think chameleon didnt
 * achieve the goal of 'more colorful the more tonal the audio is', almost
 * always its just a single color (and pretty boring when in that state). in
 * the percussive state, we should use extensive warp, distortion, shake,
 * other effects that are less chromatic to make it pop; in tonal sections
 * color should do most of the work."
 *
 * The rework rebuilds BOTH poles around that verdict:
 *   - TONAL: color does ALL the work. A multi-hue painterly field with a
 *     HARD guarantee that 3-4 distinct hue families are on screen at once
 *     (per-curtain hue offsets spanning >=0.35 of the color wheel, widened
 *     by spectral spread, never collapsing). Aurora curtains drift at
 *     different rates; hue travels across the frame (spatial gradient +
 *     temporal drift). Kicks BLOOM A NEW HUE into the field (color IS the
 *     kick response here). Drops are a chromatic explosion (hue diversity +
 *     saturation surge; luminance stays floored — no flash).
 *   - PERCUSSIVE: near-achromatic (one desaturated tint + black/white) but
 *     KINETIC through screen-space GEOMETRY, not color. Kick = radial WARP
 *     SLAM (displacement pump + 1-frame shake offset, decays ~150ms). Heavy
 *     bass = continuous feedback shear/warp turbulence. Snare = a hard
 *     diagonal displacement TEAR (the image rips and heals — a warp seam,
 *     not a drawn line). Buildup = accelerating shake/warp. Drop = maximum
 *     distortion frenzy (zoom pump + rotational judder + tearing) riding
 *     max(drop, energy). All displacement — no luminance flashes, photosafe
 *     by construction. The energy color carries at the tonal pole is carried
 *     by MOTION here.
 *
 * TONALITY DERIVATION (unchanged in-preset, no new seam):
 *   flatness ALREADY SHIPS (spectral flatness: 0 tonal .. 1 noisy). We take
 *   tonalRaw = 1 - flatness, EMA-smoothed over ~750ms. Then we REDUCE it by
 *   a rolling percussive-transient density: impulse.low/mid onsets are
 *   counted in a ~1s ring window (a hit registers on the RISING edge, so a
 *   sustained level does not inflate the count), normalized to a 0..1
 *   density. tonality = clamp(tonalEMA - density*w), then a SECOND slow slew
 *   (~0.6s) so the visual pole never snaps — u_tonal.
 *     u_tonal -> 1 : TONAL / MELODIC pole (multi-hue painterly).
 *     u_tonal -> 0 : PERCUSSIVE pole (monotone, warp-kinetic).
 *
 * TRANSITION (kept): a radial FRONT radius (u_front) chases the target pole;
 * pixels inside the front already belong to the new pole. Flooding to tonal
 * = COLOR floods in along the front; draining to percussive = color drains
 * while WARP energy visibly rises (the front carries a warp swell).
 *
 * Section boundary (ladderBarIndex ?? barIndex, %16) re-rolls the monotone
 * tint AND the tonal palette family. Photosafe fullscreen-flash rate limiting
 * retained (but at the percussive pole the flash is disabled — motion, not
 * light, carries the kick there).
 *
 * Feedback contraction (docs/visualizer-ga.md): whole-field grades capped at
 * min(x, 0.99); drop/buildup drama lives in the (1 - decay)-bounded FRESH
 * injection; transient accents are enveloped or (1 - decay)-normalized so no
 * constant additive term accumulates to 1/(1-decay). Chroma-preserving soft
 * knee only (never per-channel clamp).
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

// fringe fix: deterministic per-track hue anchor (dust-v3 idiom). splitmix64
// style bit mix folded to [0,1) so track ids land on distinct hues.
const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};


const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;        // impulse.low
uniform float u_snare;       // impulse.mid (diagonal warp tear at perc pole)
uniform float u_hat;         // impulse.high (crest shimmer at tonal pole)
uniform float u_tonal;       // 0 percussive/monotone .. 1 tonal/painterly (slewed)
uniform float u_front;       // travelling front radius 0..~1.7 (chases pole change)
uniform float u_frontDir;    // +1 flooding to tonal, -1 draining to percussive
uniform float u_centroid;    // tonal-pole hue bias
uniform float u_spread;      // spectral spread -> tonal-pole hue BREADTH
uniform float u_drop;        // bass-weighted excitement (smoothed)
uniform float u_buildup;     // excitement without bass (smoothed)
uniform float u_energy;      // sustained loudness (rides drop plateaus)
uniform float u_decay;
uniform float u_seed;
uniform float u_monoHue;     // percussive-pole single tint (re-rolled per section)
uniform float u_paletteSeed; // tonal-pole palette family (re-rolled per section)
uniform float u_section;     // section-boundary pulse 0..1 (decays)
uniform float u_hueBloom;    // kick hue-bloom STRENGTH at tonal pole (0..1, decays)
uniform float u_hueBloomHue; // the NEW hue that bloom injects (0..1, distinct from palette)
uniform float u_hueBloomAge; // seconds since that hue bloom fired
uniform float u_warpSlam;    // kick warp-slam envelope at perc pole (0..1, decays ~150ms)
uniform float u_shake;       // shake/judder intensity at perc pole (buildup-accelerated)
uniform vec2  u_shakeOff;    // 1-frame screen-space shake offset (perc pole)
uniform float u_tear;        // snare diagonal displacement-tear envelope (perc pole)
uniform float u_tearAng;     // that tear's diagonal angle
uniform float u_drift;       // tonal-pole aurora drift phase
uniform float u_spin;        // perc-pole rotational-judder phase
uniform float u_flash;       // rate-limited fullscreen flash envelope (photosafe, tonal-gated)

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// triangle-value noise (nimitz aurora idiom source)
float tri(float x) { return abs(fract(x) - 0.5); }

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
    p = p * 2.03 + vec2(11.7, 5.3);
    amp *= 0.5;
  }
  return v;
}

// Wide-phase multi-hue cosine palette — the tonal pole's colorful family.
// 'spanScale' widens the effective color-wheel travel per unit of t, so a
// small spatial t-range still spans many hue families (this is the multi-hue
// guarantee's per-sample half). Saturated, bright (theme, not pastel).
vec3 auroraPalette(float t, float bias, float pseed, float spanScale) {
  vec3 phase = vec3(0.0, 0.33, 0.67) + pseed;
  vec3 col = 0.5 + 0.5 * cos(6.28318 * (vec3(0.95, 1.05, 0.85) * t * spanScale + phase + bias));
  float mn = min(col.r, min(col.g, col.b));
  return mix(vec3(dot(col, vec3(0.333))), col, 1.4) - mn * 0.15;
}

// Single-hue monotone TINT for the percussive pole (hue + black/white only).
// Highlights lean only PARTWAY to white so the pole never reads as white.
vec3 monoColor(float lum, float hue) {
  vec3 tint = 0.5 + 0.5 * cos(6.28318 * (vec3(1.0) * hue + vec3(0.0, 0.33, 0.67)));
  // Desaturate the tint itself: near-achromatic, one desaturated tint.
  tint = mix(vec3(0.72), tint, 0.5);
  tint = mix(tint, vec3(1.0), 0.28 * pow(clamp(lum, 0.0, 1.0), 2.0));
  return tint * clamp(lum, 0.0, 1.0);
}

uniform float u_hueRot; // fringe fix: per-song hue anchor + slow spectral travel, TURNS 0..1

// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3
// idiom). rot is in TURNS; luminance (Y) is untouched by construction.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);

  // ---- Local pole via the TRAVELLING FRONT (kept).
  float frontEdge = 0.045 + 0.03 * u_energy;
  float inside = smoothstep(u_front + frontEdge, u_front - frontEdge, r);
  float localTonal = u_tonal;
  float crossed = (u_frontDir > 0.0) ? inside : (1.0 - inside);
  float frontActive = smoothstep(0.02, 0.2, u_front) * smoothstep(1.7, 1.3, u_front);
  localTonal = mix(localTonal, (u_frontDir > 0.0) ? 1.0 : 0.0, crossed * frontActive);
  localTonal = clamp(localTonal, 0.0, 1.0);
  float frontLine = exp(-pow((r - u_front) * 22.0, 2.0)) * frontActive;
  float percW = 1.0 - localTonal;

  // ================================================================
  // SCREEN-SPACE WARP / DISTORTION (the percussive pole's whole voice).
  // Every displacement below is gated by percW so the tonal pole stays a
  // calm painterly drift. All are DISPLACEMENTS of the feedback sample point
  // (or the shake offset) — never luminance flashes -> photosafe.
  // ================================================================

  // Painterly drift (tonal): slow curling advection so aurora washes travel.
  vec2 flowP = c * mix(2.6, 2.6, localTonal) + u_drift;
  vec2 driftFlow = (vec2(fbm(flowP), fbm(flowP + vec2(7.3, 2.1))) - 0.5)
    * 0.006 * localTonal * (1.0 + 0.5 * u_mid);

  // Kick WARP SLAM: a radial displacement pump — the field is punched
  // outward then relaxes (decays ~150ms via u_warpSlam). Enveloped, so it
  // returns to zero (no accumulation). Perc-pole only.
  float slamProfile = exp(-pow((r - 0.05 - u_warpSlam * 0.4) * 5.0, 2.0));
  vec2 warpSlam = dir * u_warpSlam * (0.06 + 0.05 * slamProfile) * percW;

  // Heavy-bass feedback SHEAR turbulence: continuous rotational + fbm warp
  // while low band is present. Perc-pole only, scaled by energy/bass.
  float bassTurb = percW * (0.008 + 0.03 * u_low + 0.02 * u_energy);
  vec2 tang = vec2(-dir.y, dir.x);
  vec2 shear = tang * bassTurb * (sin(r * 9.0 - u_spin * 1.7) + 0.6 * fbm(c * 3.5 + u_spin * 0.3));

  // Snare diagonal TEAR: a hard displacement seam along a diagonal — pixels
  // on one side jump, so the image RIPS and heals (enveloped by u_tear).
  vec2 tearN = vec2(cos(u_tearAng), sin(u_tearAng));   // seam normal
  vec2 tearT = vec2(-tearN.y, tearN.x);                // slip direction
  float sd = dot(c, tearN);
  float seam = smoothstep(0.16, 0.0, abs(sd));          // near the seam line
  float slipSide = sign(sd);
  vec2 tear = tearT * seam * slipSide * u_tear * 0.09 * percW;

  // Drop distortion FRENZY: zoom pump + rotational judder, riding
  // max(drop, energy). Zoom scales the sample about center; judder rotates.
  float frenzy = percW * max(u_drop, u_energy);
  float zoomPump = 1.0 + frenzy * 0.10 * sin(u_spin * 3.0 + r * 4.0) + u_warpSlam * 0.05 * percW;
  float judder = frenzy * 0.06 * sin(u_spin * 5.0 + r * 7.0);
  float cj = cos(judder), sj = sin(judder);
  vec2 cJud = vec2(cj * c.x - sj * c.y, sj * c.x + cj * c.y) * zoomPump;

  // Compose the sample point. Tonal keeps a gentle chromatic drift; perc
  // stacks slam + shear + tear + frenzy. Shake offset is added in UV below.
  vec2 warped = cJud + driftFlow + warpSlam + shear + tear;
  vec2 src = warped / vec2(aspect, 1.0) + 0.5 + u_shakeOff * percW;

  // Chromatic-aberration split scales with warp intensity (perc) AND drop
  // bloom (tonal) — small, decorative.
  float abAmt = (0.001 + 0.004 * u_drop) * localTonal + (0.002 + 0.01 * (u_warpSlam + frenzy)) * percW;
  vec2 ab = dir * abAmt / vec2(aspect, 1.0);
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueRot;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  float sharp = mix(1.55, 1.15, localTonal); // percussive sharper, tonal softer
  vec3 field = max(vec3(0.0), sampled * sharp - blur * (sharp - 1.0)) * u_decay;

  vec3 fresh = vec3(0.0);
  // Hue bias/breadth: centroid biases the family; spread WIDENS the phase
  // span; the multi-hue guarantee floors the span at >= 0.35 turn.
  float hueBias = (u_centroid - 0.5) * 0.6 + u_paletteSeed;
  float spanScale = max(0.35, 0.35 + 0.9 * u_spread) + 0.5 * u_drop; // wheel turns per unit t

  // ================= TONAL POLE — multi-hue aurora curtains =================
  // MULTI-HUE GUARANTEE: five curtains, each fed a DIFFERENT base hue offset
  // (band = i/4 spans 0..1 of the wheel) times spanScale (>=0.35 turn). So at
  // least 3-4 hue families are simultaneously on screen no matter the input.
  // Color travels: the palette t = hueOffset + spatial(x) + temporal(drift).
  float tonalW = localTonal;
  if (tonalW > 0.001) {
    vec3 aur = vec3(0.0);
    float yy = c.y;
    // Each curtain drifts at a DIFFERENT rate (i-scaled) -> layered parallax.
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float band = fi / 4.0;                         // 0..1 curtain id + hue slot
      float bandLevel = mix(u_low, u_high, band) + 0.5 * u_mid;
      float dph = u_drift * (0.25 + 0.22 * fi);      // per-curtain drift rate
      float rn = tri(c.x * (1.5 + fi * 0.6) + dph + fi * 1.7)
        + 0.6 * fbm(c * (2.0 + fi) + dph * 0.5 + fi * 3.1);
      float ridgeY = (band - 0.5) * 1.05 + 0.18 * sin(c.x * 2.0 + dph + fi) + 0.12 * (rn - 0.7);
      float curtain = exp(-pow((yy - ridgeY) * (7.0 - 2.5 * bandLevel), 2.0));
      // Distinct hue family per curtain (band offset) + spatial + temporal
      // travel. spanScale forces wide hue coverage; band forces separation.
      float pt = band + c.x * 0.28 + dph * 0.05 + fbm(c * 3.0 + dph * 0.2) * 0.22;
      vec3 col = auroraPalette(pt, hueBias + band, u_paletteSeed, spanScale);
      aur += col * curtain * (0.35 + 1.3 * bandLevel) * (0.7 + 0.6 * u_drop);
    }
    // High-band crest shimmer (hat): luminous iridescence riding the crests,
    // itself multi-hued via spanScale.
    float shimmer = pow(fbm(c * 22.0 + u_drift * 2.0 + u_seed), 3.0);
    aur += auroraPalette(c.x * 0.6 + u_drift * 0.1, hueBias + 0.5, u_paletteSeed, spanScale)
      * shimmer * (0.3 + 1.5 * u_hat) * (0.5 + 0.5 * u_high);
    // KICK HUE BLOOM: color IS the kick response here. A kick injects a brand
    // NEW hue as an expanding chromatic ring that floods the field — the
    // fresh hue is offset by u_hueBloom so it does NOT match the current
    // palette. Enveloped by age -> returns to zero.
    float bloomR = 0.05 + u_hueBloomAge * 0.9;
    float bloomRing = exp(-pow((r - bloomR) * 4.0, 2.0)) * exp(-u_hueBloomAge * 2.2);
    vec3 bloomCol = auroraPalette(u_hueBloomHue * 2.7 + c.x * 0.3, hueBias + u_hueBloomHue, u_paletteSeed, spanScale);
    aur += bloomCol * bloomRing * u_hueBloom * 1.6;
    // Drop = chromatic EXPLOSION: saturation surge + more hue diversity
    // (spanScale already lifted by drop). Luminance stays comparable (the
    // multiply is on fresh, not the persistent field).
    aur *= 1.0 + 1.2 * u_drop;
    fresh += aur * tonalW * (1.0 - u_decay) * 2.4;
  }

  // ================= PERCUSSIVE POLE — near-achromatic texture ==============
  // No spokes/slashes (those were color/geometry drawn ON TOP). The pole's
  // BODY is a quiet desaturated texture; ALL the punch comes from the warp/
  // shear/tear/frenzy displacement above acting on the feedback field. We
  // inject only a faint textured substrate to have something for the warp to
  // grip, plus tear/slam EDGE highlights (monotone, enveloped).
  if (percW > 0.001) {
    // Faint marbled substrate driven by bass turbulence — desaturated tint.
    float grain = fbm(c * 5.0 + u_spin * 0.2 + vec2(0.0, u_drift * 0.3));
    float body = smoothstep(0.35, 0.9, grain) * (0.18 + 0.5 * u_energy + 0.4 * u_low);
    body *= smoothstep(1.35, 0.15, r);
    fresh += monoColor(body, u_monoHue) * percW * (1.0 - u_decay) * 1.7;

    // Warp-slam EDGE glow: the punched shell reads as a monotone shockwave
    // rim (motion made visible), enveloped by u_warpSlam.
    float slamRim = exp(-pow((r - 0.05 - u_warpSlam * 0.5) * 6.0, 2.0)) * u_warpSlam;
    fresh += monoColor(0.85, u_monoHue) * slamRim * percW * 1.4;

    // Snare TEAR highlight: the seam itself flashes a thin monotone line as
    // the image rips (enveloped by u_tear) — reinforces the displacement.
    float tearGlow = smoothstep(0.05, 0.0, abs(sd)) * u_tear
      * smoothstep(1.2, 0.15, abs(dot(c, tearT)));
    fresh += monoColor(0.9, u_monoHue) * tearGlow * percW * 1.5;
  }

  // ================= TRANSITION FRONT — flood / warp-swell line ===========
  // Flooding to tonal: a COLORED flood line (color floods in). Draining to
  // percussive: a monotone line carrying a warp swell (color drains, motion
  // rises — the front's warp already ramped via u_shake on the JS side).
  vec3 frontCol = mix(monoColor(0.9, u_monoHue),
    auroraPalette(0.5 + t * 0.05 + c.x * 0.3, hueBias, u_paletteSeed, spanScale),
    step(0.0, u_frontDir));
  fresh += frontCol * frontLine * (1.1 + 0.7 * u_energy) * (1.0 - 0.5 * u_decay);

  // Section pulse: a gentle radial swell announcing the re-roll (both poles).
  float sec = exp(-pow((r - u_section * 0.7) * 4.0, 2.0)) * u_section;
  fresh += mix(monoColor(0.85, u_monoHue),
    auroraPalette(t * 0.04 + c.x * 0.4, hueBias, u_paletteSeed, spanScale), localTonal)
    * sec * (1.0 + u_drop) * (1.0 - 0.5 * u_decay);

  // Inject fresh at (1 - decay); ride max(drop, energy) so sustained states
  // hold through a drop's plateau.
  float sustain = max(u_drop, u_energy);
  field += fresh * (0.55 + 0.9 * sustain);

  // ---- SATURATION / VALUE grade by local pole (the core of the idea).
  // Toward the percussive pole, drain chroma toward the single desaturated
  // tint. Toward tonal, PUSH saturation (color does the work).
  float luma = dot(field, vec3(0.299, 0.587, 0.114));
  vec3 monoTarget = monoColor(clamp(luma * 1.05, 0.0, 1.0), u_monoHue);
  field = mix(monoTarget, field, localTonal);
  vec3 gg = vec3(luma);
  // Extra saturation at the tonal pole — stronger than before so 3-4 hue
  // families stay vivid rather than greying toward a single average.
  field = mix(field, mix(gg, field, 1.5), 0.4 * localTonal);

  // Buildups tense-but-alive; drops bloom. Capped < 1 (feedback contraction):
  // the persistent field never gets a sustained >1 multiplier.
  field *= min(0.78 + 0.36 * sustain - 0.04 * u_buildup + 0.06 * u_buildup * (0.5 + 0.5 * sin(t * 8.0)), 0.99);

  // Photosafe fullscreen flash (rate-limited on JS side) — GATED to the tonal
  // pole only (at the percussive pole, motion carries the kick, not light).
  field += vec3(0.09) * u_flash * localTonal;

  // Chroma-preserving soft knee (NEVER per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.85) {
    field *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

const SECTION_BARS = 16;

export const g08ChameleonPreset: VisualizerPreset = {
  id: 'g08-chameleon',
  name: 'g08 chameleon',
  hiRes: true,
  params: [
    { id: 'tonalBias', label: 'tonality bias (perc↔tonal)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
    { id: 'percWeight', label: 'transient weight', min: 0, max: 1.5, step: 0.05, default: 0.8 },
    { id: 'warpGain', label: 'warp gain (percussive)', min: 0.4, max: 2, step: 0.05, default: 1 },
    { id: 'colorGain', label: 'color gain (tonal)', min: 0.4, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    // fringe fix: per-song hue anchor state (dust-v3 idiom) for u_hueRot.
    let fringeCentroid = 0.5;
    let fringeAnchor = 0;
    let fringeAnchorTarget = 0;
    let fringeAnchorTrack: number | null = null;
    let lastTime = 0;
    // Tonality state.
    let tonalEMA = 0.5; // ~750ms EMA of (1 - flatness)
    let tonality = 0.5; // after transient-density reduction + second slew (u_tonal)
    // Rolling impulse-density ring (~1s), rising-edge counted.
    const HITS = 24;
    const hitTimes: number[] = [];
    let prevKick = 0;
    let prevSnare = 0;
    // Travelling front.
    let front = 0;
    let frontDir = 1;
    let lastPoleTarget = 0.5;
    // Smoothed dynamics.
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothEnergy = 0;
    // Motion phases.
    let spin = 0;   // percussive-pole judder/turbulence phase
    let drift = 0;  // tonal-pole aurora drift phase
    // Section.
    let lastSectionIndex = -1;
    let section = 0;
    let monoHue = Math.random();
    let paletteSeed = Math.random();
    // Tonal-pole kick hue bloom (a NEW hue floods on each kick).
    let hueBloom = 0;      // strength, decays
    let hueBloomAge = 999; // seconds since fired
    let hueBloomVal = Math.random();
    // Percussive-pole warp slam (radial displacement pump, ~150ms decay).
    let warpSlam = 0;
    // Shake / judder (accelerates through buildups) + 1-frame shake offset.
    let shake = 0;
    let shakeX = 0;
    let shakeY = 0;
    // Snare diagonal displacement tear.
    let tear = 0;
    let tearAng = 0;
    // Photosafe flash rate limiter (≤3 fullscreen flashes/sec, tonal-gated).
    let flash = 0;
    let lastFlashTime = -10;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const tonalBias = frame.params.tonalBias ?? 0;
        const percWeight = frame.params.percWeight ?? 0.8;
        const warpGain = frame.params.warpGain ?? 1;
        const colorGain = frame.params.colorGain ?? 1;

        // --- TONALITY: EMA(~750ms) of (1 - flatness).
        const emaAlpha = 1 - Math.exp(-dt / 0.75);
        const tonalRaw = 1 - frame.flatness;
        tonalEMA += (tonalRaw - tonalEMA) * emaAlpha;

        // --- Rolling percussive-transient density (~1s window), rising-edge.
        const kick = frame.impulse.low;
        const snare = frame.impulse.mid;
        if (kick > 0.32 && prevKick <= 0.32) hitTimes.push(frame.time);
        if (snare > 0.28 && prevSnare <= 0.28) hitTimes.push(frame.time);
        prevKick = kick;
        prevSnare = snare;
        while (hitTimes.length && frame.time - hitTimes[0] > 1.0) hitTimes.shift();
        while (hitTimes.length > HITS) hitTimes.shift();
        const density = Math.min(1, hitTimes.length / 6);

        const tonalTarget = Math.min(
          1,
          Math.max(0, tonalEMA - density * percWeight * 0.7 + tonalBias)
        );
        // Second slow slew (~0.6s) so the visual pole never snaps.
        tonality += (tonalTarget - tonality) * (1 - Math.exp(-dt / 0.6));

        // --- TRAVELLING FRONT (kept): launches a sweep on a pole crossing.
        if (front < 0.02) {
          const delta = tonality - lastPoleTarget;
          if (Math.abs(delta) > 0.14) {
            frontDir = delta > 0 ? 1 : -1;
            front = 0.001;
            lastPoleTarget = tonality;
          } else {
            lastPoleTarget += (tonality - lastPoleTarget) * (1 - Math.exp(-dt / 1.5));
          }
        }
        if (front >= 0.02 || front === 0.001) {
          front += dt / 0.7; // sweep across the frame in ~0.7s (>500ms floor)
          if (front > 1.7) {
            front = 0;
            lastPoleTarget = tonality;
          }
        }

        // --- Dynamics (voyage idiom): excitement split by bass presence.
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const energyTarget = Math.min(
          1,
          (frame.bands.low + frame.bands.mid + frame.bands.high) / 2.4
        );
        smoothEnergy += (energyTarget - smoothEnergy) * (1 - Math.exp(-dt / 0.5));

        // --- Motion phases. Percussive pole judders/turbulates FAST; tonal
        // pole drifts SLOW. BPM-locked when gridded.
        const beatHz = frame.beat?.bpm ? frame.beat.bpm / 60 : 2.0;
        const percActivity = 1 - tonality;
        const spinSpeed = (0.6 + 3.2 * percActivity) * warpGain * (0.6 + 0.8 * beatHz / 2);
        spin += dt * spinSpeed * (1 + 1.8 * smoothDrop);
        drift += dt * (0.12 + 0.5 * tonality) * (0.7 + 0.5 * smoothDrop);

        // --- Section boundary (ladderBarIndex ?? barIndex, %16): re-roll the
        // monotone tint AND the tonal palette family; fire a decaying pulse.
        let sectionIndex = lastSectionIndex;
        if (frame.beat) {
          const barOrdinal = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
          sectionIndex = Math.floor(barOrdinal / SECTION_BARS);
        }
        if (sectionIndex !== lastSectionIndex && lastSectionIndex >= 0) {
          section = 1;
          monoHue = Math.random();
          paletteSeed = Math.random();
        }
        lastSectionIndex = sectionIndex;
        section = Math.max(0, section - dt / 1.0);

        // --- TONAL-POLE kick HUE BLOOM: on a kick, inject a brand-NEW hue
        // (offset from the current palette) that floods the field. Color IS
        // the kick response at the tonal pole. Envelope returns to zero.
        hueBloomAge += dt;
        if (kick > 0.35 && hueBloomAge > 0.1) {
          hueBloomAge = 0;
          // New hue distinct from the current family (golden-ratio hop).
          hueBloomVal = (hueBloomVal + 0.38 + 0.24 * Math.random()) % 1;
          hueBloom = Math.min(1, kick * 1.2) * tonality; // only meaningful when tonal
        }
        hueBloom = Math.max(0, hueBloom - dt / 0.45);

        // --- PERCUSSIVE-POLE warp SLAM: kick punches a radial displacement
        // pump, decaying ~150ms. Scaled by warpGain and the percussive pole.
        warpSlam = Math.max(0, warpSlam - dt / 0.15);
        if (kick > 0.3) {
          warpSlam = Math.max(warpSlam, Math.min(1, kick * 1.3) * percActivity * warpGain);
        }

        // --- SHAKE / JUDDER: 1-frame screen-space shake offset. Baseline
        // rides bass turbulence + energy; ACCELERATES through buildups; peaks
        // in the drop frenzy. Percussive-pole scaled. Enveloped each frame.
        const shakeTarget =
          percActivity *
          warpGain *
          (0.15 * frame.bands.low +
            0.3 * smoothBuildup + // buildups accelerate the shake
            0.5 * smoothDrop +
            0.2 * smoothEnergy +
            0.6 * warpSlam);
        // Snappy attack, quick release.
        shake += (shakeTarget - shake) * (1 - Math.exp(-dt / 0.05));
        // Fresh random offset per frame (the "1-frame shake"), amplitude=shake.
        shakeX = (Math.random() * 2 - 1) * shake * 0.03;
        shakeY = (Math.random() * 2 - 1) * shake * 0.03;

        // --- SNARE diagonal displacement TEAR: the image rips along a fresh
        // diagonal and heals. Percussive-pole. Envelope returns to zero.
        tear = Math.max(0, tear - dt / 0.14);
        if (snare > 0.3 && percActivity > 0.2) {
          tear = Math.max(tear, Math.min(1, snare * 1.2) * percActivity * warpGain);
          tearAng = Math.random() * Math.PI; // fresh diagonal each rip
        }

        // --- Photosafe flash: small fullscreen lift on strong kicks, rate-
        // limited to ≤3/sec. GATED to the tonal pole in the shader (motion
        // carries the kick at the percussive pole).
        flash = Math.max(0, flash - dt / 0.12);
        if (kick > 0.5 && frame.time - lastFlashTime > 0.34) {
          flash = Math.min(0.5, kick * 0.5);
          lastFlashTime = frame.time;
        }

        // --- Energy-tied decay; percussive pole clears faster so warp does
        // not smear into mush.
        const baseDecay =
          0.985 - 0.01 * smoothEnergy - 0.006 * smoothBuildup - 0.022 * percActivity;
        const decay = Math.min(0.996, 1 - (1 - baseDecay));

        // fringe fix: per-song hue anchor (splitmix of the dominant deck
        // trackId, ~2s eased) + slow spectral travel -- steers the feedback
        // fringe hue (see hueRotate in the fragment).
        fringeCentroid += (frame.centroid - fringeCentroid) * (1 - Math.exp(-dt / 1.0));
        let fringeDomTrack: number | null = null;
        let fringeDomLevel = -1;
        for (const d of frame.decks) {
          if (d.level > fringeDomLevel) {
            fringeDomLevel = d.level;
            fringeDomTrack = d.trackId;
          }
        }
        if (fringeDomTrack !== null && fringeDomTrack !== fringeAnchorTrack) {
          fringeAnchorTrack = fringeDomTrack;
          fringeAnchorTarget = splitmix01(fringeDomTrack);
        }
        fringeAnchor += (fringeAnchorTarget - fringeAnchor) * (1 - Math.exp(-dt / 2.0));
        const fringeHueRot = (((fringeAnchor + (fringeCentroid - 0.5) * 0.8) % 1) + 1) % 1;
        return {
          u_hueRot: fringeHueRot,
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: kick,
          u_snare: snare,
          u_hat: frame.impulse.high,
          u_tonal: tonality,
          u_front: front,
          u_frontDir: frontDir,
          u_centroid: frame.centroid,
          u_spread: frame.spread,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_energy: smoothEnergy,
          u_decay: decay,
          u_seed: Math.floor(frame.time * 7.0) * 0.618 + paletteSeed * 10.0,
          u_monoHue: monoHue,
          u_paletteSeed: paletteSeed * colorGain,
          u_section: Math.max(0, Math.min(1, section)),
          u_hueBloom: hueBloom,
          u_hueBloomHue: hueBloomVal,
          u_hueBloomAge: hueBloomAge,
          u_warpSlam: warpSlam,
          u_shake: shake,
          u_shakeOff: [shakeX, shakeY],
          u_tear: tear,
          u_tearAng: tearAng,
          u_drift: drift,
          u_spin: spin,
          u_flash: flash,
        };
      },
    });
  },
};

export default g08ChameleonPreset;
