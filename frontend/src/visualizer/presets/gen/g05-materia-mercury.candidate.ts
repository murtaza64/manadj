/**
 * g05-materia-mercury (gen-5 TWEAK of g03-materia-deep, visual-element change).
 *
 * Identical to materia-deep in structure — one central form driven by the
 * 24-band spectrum sculpture, deck EQ region kills, trackId song genome,
 * phrase growth, section metamorphosis, solid kick pressure waves — EXCEPT
 * the SURFACE MATERIAL VOCABULARY is changed:
 *
 *   GLASS<->SAND  ->  LIQUID MERCURY. The 24-band relief becomes a pool of
 *   liquid metal. FLATNESS is VISCOSITY: tonal (low flatness) = mirror-smooth
 *   chrome ridges that slide; noisy (high flatness) = a boiling surface of
 *   fragmenting droplets. SPREAD is RIPPLE DISPERSION: a narrow sound makes
 *   tight standing waves across the pool; a wide sound broadens them into
 *   interference. Kicks slam a SOLID pressure wave across the pool. The
 *   snare KEEPS its beloved powder — now scattered as fine mercury SPRAY,
 *   mid/high gated. The palette still TRAVELS: the mercury is TINTED by the
 *   traveling temperature palette (never flat grayscale chrome). EQ region
 *   kills DENT the pool. Genome + phrase behaviour stay parent.
 *
 * Chroma-preserving soft knee, photosensitivity floor (gated non-red
 * flashes), bright saturated colors preserved from the family.
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const SPECTRUM_BANDS = 24;

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
uniform float u_centroid;   // temperature 0 cold .. 1 hot
uniform float u_viscosity;  // 1 mirror-smooth chrome .. 0 boiling droplets
uniform float u_dispersion; // ripple dispersion 0 tight .. 1 broad (spread)
uniform float u_phrase;     // phrase growth 0 (start) .. 1 (boundary)
uniform float u_section;    // section-transform pulse 0..1 (decays)
uniform float u_flip;       // section regime sign (drifts -1..1 across sections)
uniform float u_drop;       // excitement with bass
uniform float u_buildup;    // excitement without bass
uniform float u_decay;
uniform float u_seed;
uniform float u_rippleAge;  // seconds since last strong kick
uniform float u_rippleAmp;  // that kick's strength
uniform float u_flow;       // liquid inner-flow phase
uniform float u_swell;      // sustained loudness, form size
uniform float u_chrome;     // chrome-ridge gain slider
uniform float u_spray;      // mercury-spray (snare powder) gain slider
uniform float u_bar;        // bar pulse 0..1 (peaks on the downbeat)
uniform float u_rebirth;    // rebirth cross-fade 0..1 (1 = settled)
uniform float u_symmetry;   // genome: base lobe count bias 3..9
uniform float u_gSculpt;    // sculpt gain slider
uniform float u_eqLow;      // dominant deck EQ 0.5 = flat, 0 = kill
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_specHue;    // spectral hue anchor (JS ~1s EMA of centroid) 0..1
uniform float u_spectrum[24];

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
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.02 + vec2(19.7, 7.3);
    amp *= 0.5;
  }
  return v;
}

// EQ region gate: knob 0.5 = flat (1.0 gain), 0 = killed (0.0), 1 = boosted
// (up to ~1.6). A kill deletes that band's contribution — DENTS the pool.
float eqGate(float knob) {
  return clamp((knob - 0.5) * 2.0 + 1.0, 0.0, 1.7);
}

// SPECTRUM SCULPTURE: sum the 24 bands as angular harmonics. Band index maps
// to harmonic order — low bins are few large lobes, high bins many fine
// ripples. Each band is region-gated by the deck EQ. Constant-loop lookup.
float sculpt(float ang, float r, float t) {
  float disp = 0.0;
  for (int b = 0; b < 24; b++) {
    float fb = float(b);
    // Harmonic order: base symmetry + band index (low = big lobes).
    float order = u_symmetry + fb * 0.75;
    // Region gate: low third -> eqLow, mid third -> eqMid, top third -> eqHigh.
    float g = fb < 8.0 ? u_eqLow : (fb < 16.0 ? u_eqMid : u_eqHigh);
    // Amplitude falls with harmonic order (bass lobes dominate the silhouette).
    float fall = 1.0 / (1.0 + fb * 0.35);
    // Slow phase drift per band (seed-mixed) so the sculpture breathes.
    float ph = t * (0.15 + fb * 0.03) + u_seed * (0.11 + fb * 0.017)
      + r * (2.0 + fb * 0.6);
    disp += u_spectrum[b] * g * fall * sin(ang * order + ph);
  }
  return disp;
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Temperature palette: cold<->hot MATERIAL identity still rides centroid, but
// the two endpoint HUE FAMILIES are now derived from spectral content
// (u_specHue) instead of a hardcoded blue<->red axis. COLD = cool family
// (teal/blue/violet), HOT = its warm complement. Per-endpoint lightness and
// the traveling wobble are preserved (chroma-only change); the mercury borrows
// this so the chrome is TINTED metal, never flat grayscale.
vec3 tempPalette(float t, float temp) {
  float coldHue = 0.5 + 0.25 * (u_specHue - 0.5);
  float hotHue = fract(coldHue - 0.5);
  vec3 coldRip = vec3(0.2, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.55, 0.42, 0.3)));
  vec3 hotRip = vec3(0.4, 0.35, 0.2)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.1, 0.2)));
  float coldV = clamp(0.7 + (coldRip.r + coldRip.g + coldRip.b) * 0.33, 0.0, 1.3);
  float hotV = clamp(0.72 + (hotRip.r + hotRip.g + hotRip.b) * 0.33, 0.0, 1.3);
  vec3 cold = hsv2rgb(vec3(coldHue, 0.82, coldV));
  vec3 hot = hsv2rgb(vec3(hotHue, 0.88, hotV));
  return mix(cold, hot, clamp(temp, 0.0, 1.0));
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

  // Mercury "molten" scalar: high when boiling (low viscosity). Reused where
  // the parent used mat (0 = smooth metal, 1 = fragmenting droplets).
  float molten = clamp(1.0 - u_viscosity, 0.0, 1.0);

  // ---- Warp / advection of the accumulated mercury.
  // Smooth chrome: slow sliding sheet. Boiling: fast, fine, jittery churn.
  float churnScale = mix(2.4, 7.5, molten);
  float churnSpeed = mix(0.08, 0.9, molten);
  vec2 churn = (vec2(
    fbm(c * churnScale + u_flow + t * churnSpeed),
    fbm(c * churnScale + vec2(9.1, 4.7) - u_flow - t * churnSpeed)
  ) - 0.5) * mix(0.006, 0.02, molten) * (1.0 + 0.7 * u_mid);

  // Localized lens swirl inside the core radius — surface tension pull.
  float core = 0.16 + 0.12 * u_low + 0.05 * u_swell;
  float lens = (0.3 * u_low + 1.2 * u_kick) * exp(-pow(r / core, 2.0) * 1.5) * (0.4 + 0.6 * u_viscosity);
  float dcs = cos(lens * 0.4);
  float dsn = sin(lens * 0.4);
  vec2 w = mat2(dcs, -dsn, dsn, dcs) * c;

  // Traveling kick pressure wave — a SOLID slam across the pool.
  float waveFront = 0.1 + u_rippleAge * 0.85;
  float rippleWave = exp(-pow((r - waveFront) * 10.0, 2.0)) * exp(-u_rippleAge * 2.2) * u_rippleAmp;
  vec2 ripple = dir * rippleWave * 0.05;

  // Section transform: a violent radial inversion pulse — the pool folds.
  float fold = u_section * 0.06 * sin(r * 20.0 - t * 6.0) * u_flip;
  vec2 src = (w + churn + ripple + dir * fold) / vec2(aspect, 1.0) + 0.5;

  // Sample previous frame. Chrome carries a reflective chromatic split;
  // boiling loses it. Unsharp anti-mush tap keeps chrome ridges crisp.
  vec2 ab = dir * (0.0016 + 0.006 * u_drop + 0.01 * rippleWave) * u_viscosity
    / vec2(aspect, 1.0);
  vec3 sampled = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  // Chrome sharpens (mirror); boiling keeps more blur (froth).
  float sharp = mix(1.12, 1.4, u_viscosity);
  vec3 field = max(vec3(0.0), sampled * sharp - blur * (sharp - 1.0)) * u_decay;

  // ---- The central mercury pool.
  // Radius grows with phrase, swells with loudness, PULSES with the bar.
  float formR = 0.2 + 0.11 * u_phrase + 0.07 * u_swell + 0.05 * u_low
    + 0.03 * u_bar;
  float surfFreq = mix(3.0, 11.0, molten) * (1.0 + 0.6 * u_phrase);
  float surfAmp = mix(0.045, 0.11, molten) * (0.6 + 0.7 * u_phrase);
  float surf = fbm(vec2(ang * surfFreq * 0.5 + u_flow * 0.5, r * surfFreq + t * mix(1.4, 0.1, u_viscosity)));

  // SPECTRUM SCULPTURE: the 24-band displacement field is the dominant
  // shape driver — low bands push large lobes, high bands fine ripples.
  float spec = sculpt(ang, r, t) * u_gSculpt * (0.09 + 0.05 * u_phrase);

  // RIPPLE DISPERSION (spread): concentric standing waves across the pool.
  // Narrow sound -> tight high-frequency waves; wide -> broad interference.
  float rippleFreq = mix(34.0, 9.0, clamp(u_dispersion, 0.0, 1.0));
  float rippleSpeed = mix(3.0, 1.2, clamp(u_dispersion, 0.0, 1.0));
  float standing = sin(r * rippleFreq - t * rippleSpeed + u_flow * 1.5)
    * (0.5 + 0.5 * sin(ang * (2.0 + 6.0 * (1.0 - u_dispersion))));
  float pool = standing * (0.012 + 0.02 * u_mid + 0.02 * u_swell);

  float rr = r + (surf - 0.5) * surfAmp - spec * u_rebirth + pool * u_rebirth;
  // Edge softness: mirror-smooth chrome = crisp meniscus; boiling = ragged.
  float edge = mix(0.02, 0.09, molten) + 0.03 * u_buildup;
  float body = smoothstep(formR + edge, formR - edge, rr);
  float interior = smoothstep(formR, 0.0, rr);

  float temp = clamp(u_centroid, 0.0, 1.0);
  vec3 fresh = vec3(0.0);

  // MERCURY CHROME: mirror-smooth reflective ridges. Weighted by viscosity.
  // A fresnel-ish rim + specular glints ride the standing waves and the
  // spectrum relief; tinted by the traveling palette so it reads as colored
  // liquid metal, never flat gray.
  float chromeW = u_viscosity * u_chrome;
  // Reflective banding: sharp bright/dark chrome stripes off the surface
  // normal proxy (surf + standing + spectrum relief).
  float reflectPhase = (surf * 1.2 + standing * 0.6 + spec * 4.0) * 6.28318 + t * 0.5;
  float chromeBand = pow(abs(sin(reflectPhase)), 6.0);
  vec3 chromeCol = tempPalette(surf * 1.0 + r * 0.5 + t * 0.03, temp);
  fresh += chromeCol * chromeBand * interior * chromeW * (0.6 + 1.2 * u_mid + 0.9 * u_swell);
  // Fresnel meniscus: bright reflective rim where the pool edge catches sky.
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 skyCol = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.95, 0.85), temp);
  fresh += skyCol * rim * chromeW * (0.5 + 1.0 * u_high + 0.6 * u_kick);
  // Specular glints skate along the standing-wave crests (mirror pool).
  float glint = pow(max(0.0, standing), 4.0) * pow(0.5 + 0.5 * chromeBand, 2.0);
  fresh += skyCol * glint * interior * chromeW * (0.4 + 0.9 * u_high) * (0.6 + 0.8 * u_swell);
  // Sculpted ridges catch extra reflection where displacement is steep.
  fresh += skyCol * rim * chromeW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high);

  // BOILING MERCURY: a bubbling froth of fragmenting metal droplets. Weighted
  // by molten (high flatness). Bright hot bead centres, dark valleys.
  float boilW = molten * u_chrome;
  float b1 = hash(floor(c * mix(70.0, 190.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0) + u_flow * 2.0));
  float b2 = fbm(c * mix(8.0, 20.0, u_high) + u_flow * 2.5 + t * 1.6);
  float bead = pow(max(b1, b2) * (0.4 + 0.6 * surf), 1.8);
  vec3 boilCol = tempPalette(surf * 0.8 + bead * 0.5 + t * 0.02, temp);
  fresh += boilCol * bead * body * boilW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  // Micro-glints on the boiling beads (metal keeps its shine even boiling).
  float boilGlint = pow(bead, 3.0);
  fresh += skyCol * boilGlint * body * boilW * (0.3 + 0.7 * u_high);
  // Sculpted crust: high-band ripples pile beads along the relief crests.
  fresh += boilCol * bead * body * boilW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);

  // Core glow — the molten heart, hottest at high centroid, bar-pumped.
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick + 0.6 * u_bar);

  // Section-transform bloom: on the pulse the whole pool ERUPTS.
  vec3 burstCol = mix(tempPalette(t * 0.05, temp), vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);
  fresh += tempPalette(0.5 + t * 0.04, 1.0 - temp) * interior * u_section * 0.6;

  // Rebirth dissolve: track change re-genesises the pool; it scatters into
  // droplets and re-coheres (u_rebirth 0 -> 1). Bright spray during transit.
  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += mix(chromeCol, boilCol, molten) * rebirthGlow * (1.0 + u_swell);

  // Kick pressure wave LIGHTS the mercury it slams across.
  float reverb = 2.4 * rippleWave;
  fresh += mix(chromeCol, boilCol, molten) * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // Inject fresh at (1 - decay); buildups tense-but-alive, drops bloom.
  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop);

  // Snare powder — the BELOVED element, KEPT: fine mercury SPRAY flung off
  // the pool. A mid-transient ring of scattered metal droplets, mid/high
  // gated, tinted by the traveling palette (bright, never red strobe).
  if (u_snare > 0.03) {
    float sarc = exp(-pow((r - formR * 1.15) * 26.0, 2.0))
      * pow(0.5 + 0.5 * sin(ang * 4.0 + u_seed), 2.0);
    // Powder speckle: fine droplet spray riding the ring.
    float spray = hash(gl_FragCoord.xy + fract(t * 4.0) * 149.0);
    float sprayGate = clamp(0.4 * u_mid + 0.6 * u_high, 0.0, 1.0);
    vec3 sprayCol = mix(tempPalette(0.15, temp), tempPalette(0.3, temp), 0.5);
    field += sprayCol * sarc * (0.35 + 0.65 * spray) * u_snare * u_spray
      * (0.5 + 0.9 * sprayGate) * 0.9;
  }

  // Whole-frame kick + bar punch — the low-end lands everywhere, solid.
  field *= 1.0 + 0.1 * u_kick + 0.05 * u_bar;

  // Temperature grade.
  vec3 grade = tempPalette(0.35, temp);
  field = mix(field, field * (0.45 + grade * 1.4), 0.2);
  // Buildups saturate + energize (songprint-spec: tense AND vibrant).
  field *= 0.78 + 0.42 * max(u_drop, u_swell) + 0.12 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

const PHRASE_BARS = 16;

/** splitmix32-style scalar hash → stable [0,1). Same trackId ⇒ same look. */
function splitmix(seed: number): number {
  let z = (seed + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return (z >>> 0) / 4294967296;
}

/** Four stable genome scalars in [0,1] from a seed (trackId or pseudo-seed). */
function genomeOf(seed: number): [number, number, number, number] {
  let s = Math.floor(seed) | 0;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    s = (s + 0x6d2b79f5) | 0;
    out.push(splitmix(s + i * 0x2545f491));
  }
  return [out[0], out[1], out[2], out[3]];
}

export const g05MateriaMercuryPreset: VisualizerPreset = {
  id: 'g05-materia-mercury',
  name: 'g05 materia-mercury',
  hiRes: true,
  params: [
    { id: 'viscosity', label: 'viscosity bias (boil↔mirror)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
    { id: 'sculpt', label: 'spectrum sculpt', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'chrome', label: 'chrome / boil', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'spray', label: 'mercury spray (snare)', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'growth', label: 'phrase growth', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let flow = 0;
    let smoothViscosity = 1;
    let smoothDispersion = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothSwell = 0;
    let smoothSpecHue = 0.5;
    let section = 0;
    let flip = 0;
    let lastPhraseIndex = -1;
    // Song genome (structure family from trackId) + rebirth cross-fade.
    let currentSeed = -1;
    let genome: [number, number, number, number] = genomeOf(0);
    let rebirth = 1; // 1 = settled
    let seeded = false;
    // Smoothed dominant-deck EQ (avoid pops on knob jumps / deck switches).
    let eqLow = 0.5;
    let eqMid = 0.5;
    let eqHigh = 0.5;
    // Persistent 24-band spectrum buffer (EXACTLY length 24, reused).
    const spectrum = new Float32Array(SPECTRUM_BANDS);

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const persistence = frame.params.persistence ?? 1;
        const grow = frame.params.growth ?? 1;
        const bias = frame.params.viscosity ?? 0;
        const smoothAlpha = 1 - Math.exp(-dt / 0.3);

        // Dominant audible deck = highest master-audible level.
        let dom: (typeof frame.decks)[number] | null = null;
        for (const d of frame.decks) {
          if (d.playing && (dom === null || d.level > dom.level)) dom = d;
        }

        // VISCOSITY = flatness (tonal -> mirror-smooth chrome, noisy -> boil),
        // nudged by the genome's material lean and the manual bias. High
        // viscosity = mirror; low = boiling.
        const rawViscosity = Math.min(
          1,
          Math.max(0, 1 - frame.flatness + bias - (genome[1] - 0.5) * 0.3)
        );
        smoothViscosity += (rawViscosity - smoothViscosity) * smoothAlpha;

        // DISPERSION = spread (narrow -> tight standing waves, wide -> broad).
        const rawDispersion = Math.min(1, Math.max(0, frame.spread));
        smoothDispersion += (rawDispersion - smoothDispersion) * smoothAlpha;

        // Excitement split by bass presence (voyage idiom); smoothed.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const swellTarget = Math.min(1, (frame.bands.low + frame.bands.mid) * 0.7 + smoothDrop * 0.4);
        smoothSwell += (swellTarget - smoothSwell) * (1 - Math.exp(-dt / 0.5));

        // Spectral hue anchor: ~1s EMA of centroid; feeds tempPalette so the
        // cold<->hot axis is a spectral cool/warm pair, not blue<->red.
        smoothSpecHue += (frame.centroid - smoothSpecHue) * (1 - Math.exp(-dt / 1.0));

        // Inner-flow phase: BPM-locked when gridded, slow drift otherwise.
        // Boiling mercury flows faster than a settled mirror pool.
        const flowSpeed = frame.beat?.bpm
          ? ((frame.beat.bpm / 60) * Math.PI * 2) / 8
          : 0.35;
        flow += dt * flowSpeed * (0.6 + 0.9 * (1 - smoothViscosity));

        // Phrase growth + bar pulse. Phrase tiers use the ladder bar index
        // when available (ladderBarIndex ?? barIndex).
        let phrase = 0;
        let phraseIndex = lastPhraseIndex;
        let bar = 0;
        if (frame.beat) {
          const tierBar = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
          const barInPhrase = ((tierBar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          phrase = (barInPhrase + frame.beat.barPhase) / PHRASE_BARS;
          phraseIndex = Math.floor(tierBar / PHRASE_BARS);
          // Bar pulse: sharp attack on the downbeat, decays across the bar.
          bar = Math.pow(1 - frame.beat.barPhase, 2.4);
        } else {
          phrase = 0.5 - 0.5 * Math.cos(frame.time * 0.08);
          bar = 0.5 - 0.5 * Math.cos(frame.time * 1.4);
        }
        phrase = Math.min(1, phrase * grow);

        // Section transformation: fire on each new phrase, flip regime sign.
        if (phraseIndex !== lastPhraseIndex && lastPhraseIndex >= 0) {
          section = 1;
          flip = -flip || 1;
        }
        lastPhraseIndex = phraseIndex;
        section = Math.max(0, section - dt / 1.1);

        // SONG GENOME: dominant trackId → structure family. Track change =
        // rebirth (visible re-genesis). No trackId ⇒ freeze slow stats as a
        // pseudo-seed so the pool still has a stable skeleton.
        const trackId = dom?.trackId ?? null;
        const seedKey =
          trackId !== null
            ? trackId
            : Math.floor(
                (frame.centroid * 331 + frame.spread * 271 + frame.flatness * 197) * 101
              );
        if (!seeded) {
          currentSeed = seedKey;
          genome = genomeOf(seedKey);
          rebirth = 1;
          seeded = true;
        } else if (seedKey !== currentSeed) {
          currentSeed = seedKey;
          genome = genomeOf(seedKey);
          rebirth = 0; // dissolve, then re-cohere
        }
        rebirth = Math.min(1, rebirth + dt / 2.0);

        // Deck EQ kills: smooth the dominant deck's knobs (0.5 = flat). A kill
        // DENTS the pool (deletes that region's contribution to the relief).
        const eqAlpha = 1 - Math.exp(-dt / 0.15);
        const targetLow = dom?.eq.low ?? 0.5;
        const targetMid = dom?.eq.mid ?? 0.5;
        const targetHigh = dom?.eq.high ?? 0.5;
        eqLow += (targetLow - eqLow) * eqAlpha;
        eqMid += (targetMid - eqMid) * eqAlpha;
        eqHigh += (targetHigh - eqHigh) * eqAlpha;

        // Fill the 24-band spectrum buffer (EXACTLY length 24; clamp source).
        const src = frame.spectrum;
        for (let i = 0; i < SPECTRUM_BANDS; i++) {
          const v = i < src.length ? src[i] : 0;
          spectrum[i] = Math.min(1, Math.max(0, v));
        }

        // Traveling kick pressure wave: retrigger on strong kicks — SOLID
        // slam across the pool.
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.25);
        }

        // Genome: base symmetry (lobe count bias) 3..9, ripple/palette scalars.
        const symmetry = 3 + Math.floor(genome[0] * 7); // 3..9

        // Gentle energy-tied decay; boiling scatters a touch faster than a
        // settled mirror pool.
        const energy = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
        const baseDecay =
          0.99 - 0.008 * energy - 0.006 * smoothBuildup - 0.004 * (1 - smoothViscosity);

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_viscosity: smoothViscosity,
          u_dispersion: smoothDispersion,
          u_phrase: phrase,
          u_section: Math.max(0, Math.min(1, section)),
          u_flip: flip || 1,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_decay: Math.min(0.997, 1 - (1 - baseDecay) / persistence),
          u_seed: genome[3] * 100,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_flow: flow,
          u_swell: smoothSwell,
          u_chrome: frame.params.chrome ?? 1,
          u_spray: frame.params.spray ?? 1,
          u_bar: bar,
          u_rebirth: rebirth,
          u_symmetry: symmetry,
          u_gSculpt: (frame.params.sculpt ?? 1) * (0.6 + 0.8 * genome[2]),
          u_eqLow: eqLow,
          u_eqMid: eqMid,
          u_eqHigh: eqHigh,
          u_specHue: smoothSpecHue,
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default g05MateriaMercuryPreset;
