/**
 * g08-chameleon (gen-8 candidate, NOVEL) — the tonality chameleon.
 *
 * Human idea (verbatim brief): a preset that is "colorful when sounds are
 * melodic and more monotone and kinetic when sounds are more percussive".
 * The scene has two poles and a CONTINUOUS blend between them (never a hard
 * flip; crossfades ride 500ms+), plus a traveling desaturation/flood FRONT
 * that makes the transition itself the showpiece.
 *
 * TONALITY DERIVATION (in-preset, no new seam):
 *   flatness ALREADY SHIPS (spectral flatness: 0 tonal .. 1 noisy). We take
 *   tonalRaw = 1 - flatness, EMA-smoothed over ~750ms. Then we REDUCE it by
 *   a rolling percussive-transient density: impulse.low/mid onsets are
 *   counted in a ~1s ring window (a hit registers on the RISING edge, so a
 *   sustained level does not inflate the count), normalized to a 0..1
 *   density. Even when flatness momentarily dips, a busy kick/snare pattern
 *   pulls the pole percussive. tonality = clamp(tonalEMA - density*w), then
 *   a SECOND slow slew (~0.6s) so the visual pole never snaps — u_tonal.
 *     u_tonal -> 1 : TONAL / MELODIC pole (painterly, colorful).
 *     u_tonal -> 0 : PERCUSSIVE pole (monotone, kinetic).
 *
 * TONAL POLE (painterly): layered aurora curtains — nimitz-style stacked
 * sine ridges modulated by triangle-value noise, a rich multi-hue palette
 * (wide-phase cosine, centroid biases the hue family) blooming and drifting
 * softly. Bands ride shape: low swells the lower curtains, mid the mid
 * ridges, high sprinkles luminous shimmer along the crests. Feedback trails
 * are soft and chroma-preserving (aurora washes).
 *
 * PERCUSSIVE POLE (kinetic, monotone): color drains to ONE hue + black/
 * white (deliberate exception to the saturated-color rule — the monotone IS
 * the point). Hard geometric strokes: a rotating fan of sharp radial spokes
 * whose motion carries the energy color no longer does. Every kick = a solid
 * white strike / expanding hard ring; every snare = a diagonal slash across
 * the field. Motion is snappy (higher advection speed, sharper edges, less
 * blur).
 *
 * TRANSITION (the showpiece): a radial FRONT radius (u_front) chases the
 * target pole. Pixels inside the front already belong to the new pole; the
 * boundary is a bright flood line (color floods outward when going tonal,
 * desaturation front sweeps outward when going percussive). So the character
 * change reads as a travelling wave, not a global fade.
 *
 * Kick = solid strike in BOTH regimes (bigger/harder at the percussive
 * pole). Drop rides max(drop, energy): tonal pole = chromatic bloom surge;
 * percussive pole = monochrome kinetic frenzy (spokes multiply + accelerate).
 * Section boundary (ladderBarIndex ?? barIndex, %16) re-rolls the monotone
 * hue AND the tonal palette family.
 *
 * Engine idioms reused (voyage/materia): unsharp feedback tap (anti-mush),
 * chroma-preserving soft knee (never per-channel clamp), per-axis seed
 * mixing in hashes, traveling kick ripple that LIGHTS what it passes,
 * bass-weighted smoothed drop, photosafe fullscreen-flash rate limiting.
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
uniform float u_kick;        // impulse.low, solid strike (both poles)
uniform float u_snare;       // impulse.mid, slash at percussive pole
uniform float u_hat;         // impulse.high, crest shimmer at tonal pole
uniform float u_tonal;       // 0 percussive/monotone .. 1 tonal/painterly (slewed)
uniform float u_front;       // travelling front radius 0..~1.6 (chases pole change)
uniform float u_frontDir;    // +1 flooding to tonal, -1 draining to percussive
uniform float u_centroid;    // tonal-pole hue bias
uniform float u_drop;        // bass-weighted excitement (smoothed)
uniform float u_buildup;     // excitement without bass (smoothed)
uniform float u_energy;      // sustained loudness (rides drop plateaus)
uniform float u_decay;
uniform float u_seed;
uniform float u_monoHue;     // percussive-pole single hue (re-rolled per section)
uniform float u_paletteSeed; // tonal-pole palette family (re-rolled per section)
uniform float u_section;     // section-boundary pulse 0..1 (decays)
uniform float u_rippleAge;   // seconds since last strong kick
uniform float u_rippleAmp;   // that kick's strength
uniform float u_spin;        // percussive-pole spoke rotation phase
uniform float u_drift;       // tonal-pole aurora drift phase
uniform float u_flash;       // rate-limited fullscreen flash envelope (photosafe)

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
// centroid + paletteSeed shift the family so different sections/timbres get
// distinct rich chords, and the phase span makes color TRAVEL across space.
vec3 auroraPalette(float t, float bias, float pseed) {
  vec3 phase = vec3(0.0, 0.33, 0.67) + pseed;
  vec3 col = 0.5 + 0.5 * cos(6.28318 * (vec3(0.95, 1.05, 0.85) * t + phase + bias));
  // Push saturation up — bright, fully saturated (theme, not pastel).
  float mn = min(col.r, min(col.g, col.b));
  return mix(vec3(dot(col, vec3(0.333))), col, 1.35) - mn * 0.15;
}

// Single-hue monotone color for the percussive pole (hue + black/white only).
vec3 monoColor(float lum, float hue) {
  vec3 tint = 0.5 + 0.5 * cos(6.28318 * (vec3(1.0) * hue + vec3(0.0, 0.33, 0.67)));
  // Lean toward white in highlights, black in shadow: monotone with value
  // range, one chroma axis. Value carries the energy, not color.
  return mix(vec3(0.0), mix(tint, vec3(1.0), pow(lum, 1.6)), clamp(lum * 1.2, 0.0, 1.0));
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

  // ---- Local pole via the TRAVELLING FRONT.
  // The front is a moving radius. When flooding to tonal (frontDir +1),
  // pixels INSIDE the front are already tonal; when draining to percussive
  // (frontDir -1), pixels inside the front are already percussive. Outside
  // still holds the old pole, so the character change sweeps as a wave.
  float frontEdge = 0.045 + 0.03 * u_energy;
  float inside = smoothstep(u_front + frontEdge, u_front - frontEdge, r);
  // Local tonality: base pole is u_tonal; the region the front has crossed
  // is pulled toward the NEW pole (frontDir picks which).
  float localTonal = u_tonal;
  float crossed = (u_frontDir > 0.0) ? inside : (1.0 - inside);
  // frontActive gauges how far a transition is mid-flight (front not resting).
  float frontActive = smoothstep(0.02, 0.2, u_front) * smoothstep(1.7, 1.3, u_front);
  localTonal = mix(localTonal, (u_frontDir > 0.0) ? 1.0 : 0.0, crossed * frontActive);
  localTonal = clamp(localTonal, 0.0, 1.0);
  // The flood/desat line itself: a bright rim on the moving boundary.
  float frontLine = exp(-pow((r - u_front) * 22.0, 2.0)) * frontActive;

  // ---- Advection / warp of the accumulated field. Painterly (tonal) = slow
  // curling drift; kinetic (percussive) = fast, snappy, straighter push.
  float warpSpeed = mix(1.1, 0.14, localTonal);
  float curl = mix(0.4, 1.0, localTonal); // tonal curls more, percussive shears
  vec2 flowP = c * mix(6.0, 2.6, localTonal) + u_drift * curl;
  vec2 flow = (vec2(fbm(flowP), fbm(flowP + vec2(7.3, 2.1))) - 0.5)
    * mix(0.004, 0.012, localTonal) * (1.0 + 0.6 * u_mid);
  // Percussive shear: a rotational push tied to the spoke spin — motion
  // carries the energy. Fades out as we go tonal.
  float shear = (1.0 - localTonal) * (0.006 + 0.02 * u_energy + 0.03 * u_drop);
  vec2 shearV = vec2(-dir.y, dir.x) * shear * sin(u_spin * 0.5);

  // Traveling kick pressure wave — solid front that LIGHTS what it passes,
  // in BOTH poles (bigger/harder at percussive pole).
  float kickReach = mix(0.9, 1.25, 1.0 - localTonal);
  float waveFront = 0.06 + u_rippleAge * kickReach;
  float rippleWave = exp(-pow((r - waveFront) * mix(9.0, 13.0, 1.0 - localTonal), 2.0))
    * exp(-u_rippleAge * 2.3) * u_rippleAmp;
  vec2 ripple = dir * rippleWave * mix(0.03, 0.05, 1.0 - localTonal);

  vec2 src = (c + flow + shearV + ripple) / vec2(aspect, 1.0) + 0.5;

  // Sample previous frame. Tonal keeps soft chromatic drift (aurora wash);
  // percussive sharpens hard (kinetic, less mush) via the unsharp tap.
  vec2 ab = dir * (0.001 + 0.004 * u_drop) * localTonal / vec2(aspect, 1.0);
  vec3 sampled = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  float sharp = mix(1.5, 1.15, localTonal); // percussive sharper, tonal softer
  vec3 field = max(vec3(0.0), sampled * sharp - blur * (sharp - 1.0)) * u_decay;

  vec3 fresh = vec3(0.0);
  float hueBias = (u_centroid - 0.5) * 0.6 + u_paletteSeed;

  // ================= TONAL POLE — aurora curtains =================
  // Layered sine ridges (nimitz idiom): stacked bands ripple across the
  // frame, each a luminous curtain; triangle-noise breaks them so they read
  // organic. Low band swells lower curtains, mid the mid, high shimmers the
  // crests. Colorful, saturated, softly drifting.
  float tonalW = localTonal;
  if (tonalW > 0.001) {
    vec3 aur = vec3(0.0);
    float yy = c.y;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float band = fi / 4.0;                         // 0..1 vertical band id
      float bandLevel = mix(u_low, u_high, band) + 0.5 * u_mid;
      // ridge: a horizontal sine curtain warped by triangle noise + fbm.
      float rn = tri(c.x * (1.5 + fi * 0.6) + u_drift * (0.3 + 0.1 * fi) + fi * 1.7)
        + 0.6 * fbm(c * (2.0 + fi) + u_drift * 0.5 + fi * 3.1);
      float ridgeY = (band - 0.5) * 1.05 + 0.18 * sin(c.x * 2.0 + u_drift + fi) + 0.12 * (rn - 0.7);
      float curtain = exp(-pow((yy - ridgeY) * (7.0 - 2.5 * bandLevel), 2.0));
      // color travels with x + band + drift so it is never one flat hue.
      float pt = c.x * 0.5 + band * 0.7 + u_drift * 0.06 + fbm(c * 3.0 + u_drift * 0.2) * 0.4;
      vec3 col = auroraPalette(pt, hueBias, u_paletteSeed);
      aur += col * curtain * (0.35 + 1.3 * bandLevel) * (0.7 + 0.6 * u_drop);
    }
    // High-band crest shimmer: luminous sparkle riding the curtains (hat).
    float shimmer = pow(fbm(c * 22.0 + u_drift * 2.0 + u_seed), 3.0);
    aur += auroraPalette(c.x * 0.6 + u_drift * 0.1, hueBias, u_paletteSeed)
      * shimmer * (0.3 + 1.5 * u_hat) * (0.5 + 0.5 * u_high);
    // Chromatic bloom surge on the drop — the whole sky blooms.
    aur *= 1.0 + 1.1 * u_drop;
    fresh += aur * tonalW * (1.0 - u_decay) * 3.4;
  }

  // ================= PERCUSSIVE POLE — kinetic monotone =================
  // Hard geometric strokes: a rotating fan of sharp radial spokes. Snappy,
  // one hue + black/white. Motion (spin, count) carries the energy.
  float percW = 1.0 - localTonal;
  if (percW > 0.001) {
    float spokes = floor(mix(6.0, 16.0, u_energy) + 4.0 * u_drop);
    float a2 = ang + u_spin;
    // hard-edged spokes (no soft falloff — kinetic, geometric).
    float spoke = step(0.62, abs(sin(a2 * spokes * 0.5)));
    // sharpen further: only bright near a radial band that pulses outward.
    float ringPos = fract(u_spin * 0.15 + r * 1.4 - u_energy * 0.3);
    float radialBar = step(0.72, abs(sin((r * mix(10.0, 22.0, u_energy) - u_spin * 2.0))));
    float stroke = max(spoke * (0.5 + 0.5 * radialBar), radialBar * 0.6);
    float lum = stroke * (0.4 + 1.4 * u_energy + 1.2 * u_drop) * smoothstep(1.3, 0.1, r);
    vec3 mono = monoColor(lum, u_monoHue);
    fresh += mono * percW * (1.0 - u_decay) * 3.0;

    // Snare SLASH: a hard diagonal bar cutting across the field.
    if (u_snare > 0.04) {
      float slashAng = u_seed * 3.14159 + 0.8;
      vec2 sd = vec2(cos(slashAng), sin(slashAng));
      float d = abs(dot(c, vec2(-sd.y, sd.x)));
      float slash = smoothstep(0.03, 0.0, d) * smoothstep(1.2, 0.2, abs(dot(c, sd)));
      fresh += monoColor(1.0, u_monoHue) * slash * u_snare * percW * 2.4;
    }
  }

  // ================= KICK STRIKE — solid, BOTH poles =================
  // A solid central strike + the kick pressure wave that lights the field.
  // Bigger/harder at the percussive pole (the human ask: every kick visible).
  float strikeR = mix(0.14, 0.26, percW);
  float strike = exp(-pow(r / strikeR, 2.0) * (7.0 - 3.0 * u_kick));
  vec3 strikeCol = mix(
    auroraPalette(0.4 + t * 0.03, hueBias, u_paletteSeed) * vec3(1.1, 1.0, 0.95),
    monoColor(1.0, u_monoHue),
    percW
  );
  strikeCol = mix(strikeCol, vec3(1.0), 0.4 * percW); // percussive kick flashes toward white
  fresh += strikeCol * strike * (0.5 + 2.2 * u_kick) * (0.7 + 0.6 * u_energy);
  // Ripple lights what it passes (voyage idiom), colored by the local pole.
  vec3 rippleCol = mix(monoColor(1.0, u_monoHue), auroraPalette(0.6, hueBias, u_paletteSeed), localTonal);
  fresh += rippleCol * rippleWave * (1.2 + 0.8 * percW);

  // ================= TRANSITION FRONT — flood / desaturation line =======
  // The moving boundary glows: flooding to tonal it is a colored flood line;
  // draining to percussive it is a white desaturation front.
  vec3 frontCol = mix(monoColor(1.0, u_monoHue), auroraPalette(0.5 + t * 0.05, hueBias, u_paletteSeed),
    step(0.0, u_frontDir));
  fresh += frontCol * frontLine * (1.6 + 1.0 * u_energy);

  // Section pulse: a gentle radial swell announcing the re-roll (both poles).
  float sec = exp(-pow((r - u_section * 0.7) * 4.0, 2.0)) * u_section;
  fresh += mix(monoColor(1.0, u_monoHue), auroraPalette(t * 0.04, hueBias, u_paletteSeed), localTonal)
    * sec * (1.0 + u_drop);

  // Inject fresh at (1 - decay); ride max(drop, energy) so sustained states
  // hold through a drop's plateau (excitement is a transition-only signal).
  float sustain = max(u_drop, u_energy);
  field += fresh * (0.55 + 0.9 * sustain);

  // ---- SATURATION / VALUE grade by local pole (the core of the idea).
  // Toward the percussive pole, drain chroma toward a single-hue monotone.
  float luma = dot(field, vec3(0.299, 0.587, 0.114));
  vec3 monoTarget = monoColor(clamp(luma * 1.3, 0.0, 1.0), u_monoHue);
  // localTonal=1 keep painterly color; localTonal=0 collapse to monotone.
  field = mix(monoTarget, field, localTonal);
  // Slight extra saturation at the tonal pole (bright, fully saturated).
  vec3 g = vec3(luma);
  field = mix(field, mix(g, field, 1.25), 0.25 * localTonal);

  // Buildups tense-but-alive (never eerily still); drops bloom.
  field *= 0.78 + 0.36 * sustain - 0.04 * u_buildup + 0.06 * u_buildup * (0.5 + 0.5 * sin(t * 8.0));

  // Photosafe fullscreen flash (rate-limited on the JS side): gentle, capped.
  field += vec3(0.16) * u_flash;

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
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'kinetics', label: 'kinetic speed', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'colorGain', label: 'color gain (tonal)', min: 0.4, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    // Tonality state.
    let tonalEMA = 0.5; // ~750ms EMA of (1 - flatness)
    let tonality = 0.5; // after transient-density reduction + second slew (u_tonal)
    // Rolling impulse-density ring (~1s), rising-edge counted.
    const HITS = 24; // ring slots; oldest expires by timestamp
    const hitTimes: number[] = [];
    let prevKick = 0;
    let prevSnare = 0;
    // Travelling front.
    let front = 0; // 0 = rested; sweeps to ~1.6 when a transition fires
    let frontDir = 1;
    let lastPoleTarget = 0.5;
    // Smoothed dynamics.
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothEnergy = 0;
    // Motion phases.
    let spin = 0;
    let drift = 0;
    // Section.
    let lastSectionIndex = -1;
    let section = 0;
    let monoHue = Math.random();
    let paletteSeed = Math.random();
    // Kick ripple.
    let rippleAge = 999;
    let rippleAmp = 0;
    // Photosafe flash rate limiter (≤3 fullscreen flashes/sec).
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
        const persistence = frame.params.persistence ?? 1;
        const kinetics = frame.params.kinetics ?? 1;
        const colorGain = frame.params.colorGain ?? 1;

        // --- TONALITY: EMA(~750ms) of (1 - flatness).
        const emaAlpha = 1 - Math.exp(-dt / 0.75);
        const tonalRaw = 1 - frame.flatness;
        tonalEMA += (tonalRaw - tonalEMA) * emaAlpha;

        // --- Rolling percussive-transient density (~1s window). Count kick
        // (impulse.low) and snare (impulse.mid) onsets on the RISING edge so
        // sustained levels do not inflate the count.
        const kick = frame.impulse.low;
        const snare = frame.impulse.mid;
        if (kick > 0.32 && prevKick <= 0.32) hitTimes.push(frame.time);
        if (snare > 0.28 && prevSnare <= 0.28) hitTimes.push(frame.time);
        prevKick = kick;
        prevSnare = snare;
        // Expire hits older than 1s; cap ring length.
        while (hitTimes.length && frame.time - hitTimes[0] > 1.0) hitTimes.shift();
        while (hitTimes.length > HITS) hitTimes.shift();
        // Density 0..1: ~6 transients/sec saturates to "very percussive".
        const density = Math.min(1, hitTimes.length / 6);

        // tonality target = smoothed tonal minus transient density (weighted),
        // plus manual bias. Busy transients pull the pole percussive even if
        // flatness dipped.
        const tonalTarget = Math.min(
          1,
          Math.max(0, tonalEMA - density * percWeight * 0.7 + tonalBias)
        );
        // Second slow slew so the visual pole never snaps (~0.6s).
        tonality += (tonalTarget - tonality) * (1 - Math.exp(-dt / 0.6));

        // --- TRAVELLING FRONT: when the pole target crosses meaningfully,
        // launch a front that sweeps the new pole across the frame (500ms+).
        // We compare the (slewed) tonality to the pole it last committed to.
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
          // Sweep across the frame in ~0.7s (well over the 500ms floor).
          front += dt / 0.7;
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

        // --- Motion phases. Percussive pole spins fast (kinetic); tonal
        // pole drifts slow (painterly). BPM-locked when gridded.
        const beatHz = frame.beat?.bpm ? frame.beat.bpm / 60 : 2.0;
        const spinSpeed = (0.4 + 2.4 * (1 - tonality)) * kinetics * (0.6 + 0.8 * beatHz / 2);
        spin += dt * spinSpeed * (1 + 1.5 * smoothDrop);
        drift += dt * (0.12 + 0.5 * tonality) * (0.7 + 0.5 * smoothDrop);

        // --- Section boundary (ladderBarIndex ?? barIndex, %16): re-roll the
        // monotone hue AND the tonal palette family; fire a decaying pulse.
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

        // --- Kick ripple retrigger (solid strike, both poles).
        rippleAge += dt;
        if (kick > 0.35 && rippleAge > 0.11) {
          rippleAge = 0;
          rippleAmp = Math.min(1, kick * 1.25);
        }

        // --- Photosafe flash: a small fullscreen lift on strong kicks,
        // rate-limited to ≤3/sec, never saturated-red (white lift only).
        flash = Math.max(0, flash - dt / 0.12);
        if (kick > 0.5 && frame.time - lastFlashTime > 0.34) {
          flash = Math.min(0.5, kick * 0.5);
          lastFlashTime = frame.time;
        }

        // --- Energy-tied decay; percussive pole clears faster (kinetic,
        // snappy) so hard strokes do not smear into mush.
        const baseDecay =
          0.985 - 0.01 * smoothEnergy - 0.006 * smoothBuildup - 0.02 * (1 - tonality);
        const decay = Math.min(0.996, 1 - (1 - baseDecay) / persistence);

        return {
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
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_energy: smoothEnergy,
          u_decay: decay,
          u_seed: Math.floor(frame.time * 7.0) * 0.618 + paletteSeed * 10.0,
          u_monoHue: monoHue,
          u_paletteSeed: paletteSeed * colorGain,
          u_section: Math.max(0, Math.min(1, section)),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_spin: spin,
          u_drift: drift,
          u_flash: flash,
        };
      },
    });
  },
};

export default g08ChameleonPreset;
