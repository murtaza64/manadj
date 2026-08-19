/**
 * g02-materia (gen-2 candidate, NOVEL) — the spectral-material study.
 *
 * One central organic form (a fbm-displaced metaball heart) whose MATERIAL
 * is the spectral shape:
 *   tonal + narrow  (flatness -> 0, spread -> 0) = liquid glass: smooth
 *     caustic refractions, slow inner flow, wet specular highlights;
 *   noisy + wide    (flatness -> 1, spread -> 1) = granular sand/static:
 *     scattering grain, fast micro-jitter, dry matte scatter.
 * The `u_material` scalar blends the two continuously, and drives geometry
 * dispersion, edge softness, texture graininess and motion speed.
 *
 * centroid = TEMPERATURE (cold indigo/teal -> hot amber/white).
 * Phrase growth: the form grows and complexifies toward the phrase boundary
 * (barIndex % 16). Section transformation: every 16 bars a dramatic regime
 * shift fires (u_section pulse) — the material inverts/erupts, the biggest
 * change in the scene. Kicks send SOLID pressure waves through the material
 * (traveling ripple that displaces AND lights what it passes), never powder.
 *
 * Engine idioms reused from voyage.ts: unsharp feedback tap (anti-mush),
 * chroma-preserving soft knee (no per-channel clamp), per-axis seed mixing
 * in hashes, traveling kick ripple that lights, gentle energy-tied decay.
 */

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
uniform float u_centroid;   // temperature 0 cold .. 1 hot
uniform float u_material;   // 0 liquid glass .. 1 granular sand
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
uniform float u_grain;      // sand-grain gain slider
uniform float u_glass;      // glass-caustic gain slider
uniform float u_specHue;    // spectral hue anchor (JS ~1s EMA of centroid) 0..1

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

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Temperature palette: cold<->hot MATERIAL identity still rides centroid, but
// the two endpoint HUE FAMILIES are now derived from spectral content
// (u_specHue) instead of a hardcoded blue<->red axis. COLD = cool family
// (teal/blue/violet), HOT = its warm complement. Per-endpoint lightness and
// the traveling wobble are preserved (chroma-only change) so the tint still
// TRAVELS with the surface field rather than reading as one flat hue.
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

  float mat = clamp(u_material, 0.0, 1.0);

  // ---- Warp / advection of the accumulated material.
  // Liquid regime: slow swirling refraction (a churn field kneads the
  // glass). Sand regime: fast, fine, jittery displacement (dry scatter).
  float churnScale = mix(2.4, 7.5, mat);
  float churnSpeed = mix(0.08, 0.9, mat);
  vec2 churn = (vec2(
    fbm(c * churnScale + u_flow + t * churnSpeed),
    fbm(c * churnScale + vec2(9.1, 4.7) - u_flow - t * churnSpeed)
  ) - 0.5) * mix(0.006, 0.02, mat) * (1.0 + 0.7 * u_mid);

  // Localized lens swirl inside the core radius — glass refraction, a hint
  // not a whirlpool (voyage's localized-lens idiom).
  float core = 0.16 + 0.12 * u_low + 0.05 * u_swell;
  float lens = (0.3 * u_low + 1.2 * u_kick) * exp(-pow(r / core, 2.0) * 1.5) * (1.0 - 0.6 * mat);
  float dcs = cos(lens * 0.4);
  float dsn = sin(lens * 0.4);
  vec2 w = mat2(dcs, -dsn, dsn, dcs) * c;

  // Traveling kick pressure wave — a solid displacement front that lights
  // the material it passes through.
  float waveFront = 0.1 + u_rippleAge * 0.85;
  float rippleWave = exp(-pow((r - waveFront) * 10.0, 2.0)) * exp(-u_rippleAge * 2.2) * u_rippleAmp;
  vec2 ripple = dir * rippleWave * 0.04;

  // Section transform: a violent radial inversion pulse — space folds
  // around the core for the duration of the pulse (the theatre beat).
  float fold = u_section * 0.06 * sin(r * 20.0 - t * 6.0) * u_flip;
  vec2 src = (w + churn + ripple + dir * fold) / vec2(aspect, 1.0) + 0.5;

  // Sample previous frame. Glass gets a chromatic refraction split; sand
  // gets none (dry). Unsharp anti-mush tap keeps caustics/grain crisp.
  vec2 ab = dir * (0.0016 + 0.006 * u_drop + 0.01 * rippleWave) * (1.0 - mat)
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
  // Sand keeps more blur (scattering, matte); glass sharpens (specular).
  float sharp = mix(1.4, 1.12, mat);
  vec3 field = max(vec3(0.0), sampled * sharp - blur * (sharp - 1.0)) * u_decay;

  // ---- The central organic form.
  // Its radius grows with the phrase and swells with sustained loudness;
  // its surface is fbm-displaced, and the displacement AMPLITUDE and
  // frequency ride the material (glass = smooth low-freq undulation, sand
  // = high-freq broken crust). Phrase growth adds surface complexity.
  float formR = 0.2 + 0.11 * u_phrase + 0.07 * u_swell + 0.05 * u_low;
  float surfFreq = mix(3.0, 11.0, mat) * (1.0 + 0.6 * u_phrase);
  float surfAmp = mix(0.045, 0.11, mat) * (0.6 + 0.7 * u_phrase);
  // Surface field (also reused as caustic/grain source).
  float surf = fbm(vec2(ang * surfFreq * 0.5 + u_flow * 0.5, r * surfFreq + t * mix(0.1, 1.4, mat)));
  float rr = r + (surf - 0.5) * surfAmp;
  // Distance to the deformed boundary; edge softness is a MATERIAL cue:
  // glass = crisp wet edge, sand = soft dusty falloff.
  float edge = mix(0.02, 0.09, mat) + 0.03 * u_buildup;
  float body = smoothstep(formR + edge, formR - edge, rr);
  float interior = smoothstep(formR, 0.0, rr);

  float temp = clamp(u_centroid, 0.0, 1.0);
  vec3 fresh = vec3(0.0);

  // GLASS look: caustic web — sharp folded bright lines refracting through
  // the interior — plus a wet specular rim highlight. Weighted by (1-mat).
  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow) ) * 6.28318 + t * 0.8)), 8.0);
  vec3 glassCol = tempPalette(surf * 1.2 + r * 0.4 + t * 0.03, temp);
  fresh += glassCol * caustic * interior * glassW * (0.6 + 1.4 * u_mid + 0.8 * u_swell);
  // Wet specular rim: a thin bright arc where light grazes the boundary.
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 spec = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.95, 0.85), temp);
  fresh += spec * rim * glassW * (0.5 + 1.0 * u_high + 0.6 * u_kick);

  // SAND look: granular scatter — high-frequency speckle whose density and
  // brightness ride the surface field; dry, matte, temperature-tinted.
  float matW = mat * u_grain;
  float g1 = hash(floor(c * mix(90.0, 240.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * 150.0 + u_flow * 3.0 + 7.3));
  float grain = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  vec3 sandCol = tempPalette(surf * 0.8 + grain * 0.5 + t * 0.02, temp);
  fresh += sandCol * grain * body * matW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  // Static shimmer: fast broadband flicker so sand reads as live static.
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += sandCol * staticN * body * matW * (0.12 + 0.5 * u_high) * (0.5 + 0.5 * mat);

  // Core glow common to both regimes — the heart, hottest at high centroid.
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick);

  // Section-transform bloom: on the pulse the whole form ERUPTS — a bright
  // radial burst tinted by the incoming regime sign, the theatre moment.
  vec3 burstCol = mix(tempPalette(t * 0.05, temp), vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);
  // Inversion flash: the interior briefly negates toward the complementary
  // temperature — a mode change you can't miss.
  fresh += tempPalette(0.5 + t * 0.04, 1.0 - temp) * interior * u_section * 0.6;

  // Kick pressure wave LIGHTS the material it crosses (reverb-of-touch).
  float reverb = 2.4 * rippleWave;
  fresh += mix(glassCol, sandCol, mat) * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // Inject fresh at (1 - decay); buildups tense-but-alive, drops bloom.
  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop);

  // Snare stamp: a mid-transient ring crossing the surface (kept as a
  // discrete hit, mid/high natured — never a low-end powder).
  if (u_snare > 0.03) {
    float sarc = exp(-pow((r - formR * 1.15) * 26.0, 2.0))
      * pow(0.5 + 0.5 * sin(ang * 4.0 + u_seed), 2.0);
    field += mix(tempPalette(0.15, temp), tempPalette(0.3, temp), 0.5) * sarc * u_snare * 0.8;
  }

  // Whole-frame kick punch — the low-end lands everywhere, solid.
  field *= 1.0 + 0.1 * u_kick;

  // Temperature grade: lean the frame toward the centroid temperature so
  // cold/hot reads at a glance without swamping the material color.
  vec3 grade = tempPalette(0.35, temp);
  field = mix(field, field * (0.45 + grade * 1.4), 0.2);
  // Buildups cool + dim slightly (tension), drops bloom.
  field *= 0.74 + 0.42 * max(u_drop, u_swell) - 0.05 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

const PHRASE_BARS = 16;

export const g02MateriaPreset: VisualizerPreset = {
  id: 'g02-materia',
  name: 'g02 materia',
  hiRes: true,
  params: [
    { id: 'material', label: 'material bias (glass↔sand)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
    { id: 'grain', label: 'sand grain', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'glass', label: 'glass caustics', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'growth', label: 'phrase growth', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let flow = 0;
    let smoothMaterial = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothSwell = 0;
    let smoothSpecHue = 0.5;
    let section = 0;
    let flip = 0;
    let lastPhraseIndex = -1;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const persistence = frame.params.persistence ?? 1;
        const grow = frame.params.growth ?? 1;
        const bias = frame.params.material ?? 0;
        const smoothAlpha = 1 - Math.exp(-dt / 0.3);

        // MATERIAL = spectral shape: noisy+wide → sand, tonal+narrow → glass.
        // Combine flatness and spread; the manual bias nudges the balance.
        const rawMaterial = Math.min(
          1,
          Math.max(0, 0.6 * frame.flatness + 0.4 * frame.spread + bias)
        );
        smoothMaterial += (rawMaterial - smoothMaterial) * smoothAlpha;

        // Excitement split by bass presence (voyage idiom); smoothed.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const swellTarget = Math.min(1, (frame.bands.low + frame.bands.mid) * 0.7 + smoothDrop * 0.4);
        smoothSwell += (swellTarget - smoothSwell) * (1 - Math.exp(-dt / 0.5));

        // Spectral hue anchor: ~1s EMA of centroid. Feeds the tempPalette
        // endpoints so the cold<->hot axis is a spectral cool/warm pair, not
        // a hardcoded blue<->red interference axis.
        smoothSpecHue += (frame.centroid - smoothSpecHue) * (1 - Math.exp(-dt / 1.0));

        // Inner-flow phase: BPM-locked when gridded (one turn per 8 beats),
        // slow drift otherwise. Slower for glass, faster for sand.
        const flowSpeed = frame.beat?.bpm
          ? ((frame.beat.bpm / 60) * Math.PI * 2) / 8
          : 0.35;
        flow += dt * flowSpeed * (0.6 + 0.9 * smoothMaterial);

        // Phrase growth: fraction through the current 16-bar phrase.
        let phrase = 0;
        let phraseIndex = lastPhraseIndex;
        if (frame.beat) {
          const barInPhrase = ((frame.beat.barIndex % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          phrase = (barInPhrase + frame.beat.barPhase) / PHRASE_BARS;
          phraseIndex = Math.floor(frame.beat.barIndex / PHRASE_BARS);
        } else {
          // Gridless: a slow breathing growth cycle so the form still evolves.
          phrase = 0.5 - 0.5 * Math.cos(frame.time * 0.08);
        }
        phrase = Math.min(1, phrase * grow);

        // Section transformation: fire a decaying pulse on each new phrase
        // (section boundary) and flip the regime sign — the theatre beat.
        if (phraseIndex !== lastPhraseIndex && lastPhraseIndex >= 0) {
          section = 1;
          flip = -flip || 1;
        }
        lastPhraseIndex = phraseIndex;
        section = Math.max(0, section - dt / 1.1);

        // Traveling kick pressure wave: retrigger on strong kicks.
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.25);
        }

        // Gentle energy-tied decay; sand scatters a touch faster than glass.
        const energy = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
        const baseDecay =
          0.99 - 0.008 * energy - 0.006 * smoothBuildup - 0.004 * smoothMaterial;

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_material: smoothMaterial,
          u_phrase: phrase,
          u_section: Math.max(0, Math.min(1, section)),
          u_flip: flip || 1,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_decay: Math.min(0.997, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_flow: flow,
          u_swell: smoothSwell,
          u_grain: frame.params.grain ?? 1,
          u_glass: frame.params.glass ?? 1,
          u_specHue: smoothSpecHue,
        };
      },
    });
  },
};

export default g02MateriaPreset;
