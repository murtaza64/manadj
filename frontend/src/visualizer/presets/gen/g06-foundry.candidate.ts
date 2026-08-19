/**
 * g06-foundry (NOVEL — sol-review concept "Liquid Equalizer Foundry").
 *
 * A casting foundry, NOT a centered scene. The MOLD sits in the LOW-THIRD,
 * off-axis; three frequency-owned pours enter from the FRAME EDGES and fall
 * under vertical gravity into it. Band identity is carried by MATERIAL PHASE
 * (shape, not hue):
 *   - LOW energy  -> dense SOLID INGOTS (chunky blocks) pour from the left
 *     edge; heavy, slow, blocky.
 *   - MID energy  -> VISCOUS COLORED STREAMS (Shadertoy-style FBM flow) pour
 *     from the top edge; smooth ribboning liquid.
 *   - HIGH energy -> fine SPARKS and VAPOR WISPS (brief bright arcs + curling
 *     vapor, NOT lingering dust) from the right edge; sharp, transient.
 *
 * Interaction contract (invariants):
 *   - Deck EQ visibly opens/closes the FEED VALVES: killing a band throttles
 *     that pour to a trickle; boosting floods it.
 *   - The dominant track's 24-band spectrum selects the MOLD RIBS (the
 *     internal partition geometry of the mold basin).
 *   - flatness = melt smoothness (tonal -> glassy smooth streams; noisy ->
 *     grainy, broken flow).
 *   - kick = a solid PRESSURE / LENS wave striking the mold (localized shove
 *     of the pool surface, low-gated).
 *   - snare SPLATTERS only the MID stream (mid/high-gated liquid burst).
 *   - buildup: the mold HEATS from within, flow accelerates, traveling color
 *     bands saturate — whole-frame ceiling stays stable (never dimmer, never
 *     a flash).
 *   - drop: the mold OPENS into a large persistent CAST whose relief keeps
 *     moving with energy (no reset to idle) — derived drop = smoothed
 *     bass-weighted excitement, sustained on max(drop, energy).
 *   - section boundaries BREAK AND RECAST: the cast form family switches
 *     (bridge / mask / engine / glyph) via ladderBarIndex ?? barIndex; the
 *     cast persists and evolves rather than resetting.
 *
 * Anti-resemblance held: not materia (no full-frame sculpted relief — the
 * relief is confined to the mold/cast in the lower third), not mercury (no
 * reflective pool), no centered metaball. Composition is vertical gravity.
 * Heat bloom stays localized around the mold. Feedback used only for the
 * pours' motion trails, with chroma-preserving soft knee.
 */

import type { UniformValue } from '../glPreset';
import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const SPECTRUM_BANDS = 24;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;      // low band level (ingot flow)
uniform float u_mid;      // mid band level (stream flow)
uniform float u_high;     // high band level (spark/vapor)
uniform float u_kick;     // solid pressure/lens wave
uniform float u_snare;    // mid-stream splatter
uniform float u_valveLow; // EQ valve gate for low pour (0 closed .. ~1.6)
uniform float u_valveMid;
uniform float u_valveHigh;
uniform float u_smooth;   // melt smoothness (1 - flatness): glassy .. grainy
uniform float u_heat;     // buildup heat (localized bloom in the mold)
uniform float u_energy;   // sustained loudness floor
uniform float u_drop;     // smoothed bass-weighted excitement
uniform float u_cast;     // 0 mold closed .. 1 mold opened into the cast
uniform float u_castForm; // cast family: 0 bridge,1 mask,2 engine,3 glyph
uniform float u_flow;     // global flow phase (accelerates on buildup)
uniform float u_decay;
uniform float u_moldX;    // mold center x (off-axis, 0..1)
uniform float u_moldY;    // mold center y (low third)
uniform float u_seed;
uniform vec3 u_hueLow;    // ingot hue (traveling)
uniform vec3 u_hueMid;    // stream hue
uniform vec3 u_hueHigh;   // spark hue
uniform float u_spectrum[24]; // mold ribs from dominant track spectrum

const float PI = 3.141592653589793;

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
    p = p * 2.02 + vec2(7.9, 13.1);
    amp *= 0.5;
  }
  return v;
}

// Mold rib height at horizontal position rx (0..1 across the mold basin):
// the 24-band spectrum partitions the basin into ribs; each band raises a
// wall. Constant-loop lookup (WebGL1 requires a constant bound).
float moldRibs(float rx) {
  float h = 0.0;
  for (int b = 0; b < 24; b++) {
    float fb = float(b);
    float center = (fb + 0.5) / 24.0;
    float w = exp(-pow((rx - center) * 26.0, 2.0));
    h = max(h, w * u_spectrum[b]);
  }
  return h;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 px = 1.0 / u_res;
  float t = u_time;

  // Mold center (off-axis, low third).
  vec2 mold = vec2(u_moldX, u_moldY);
  vec2 d = uv - mold;
  d.x *= aspect;
  float distMold = length(d);

  // ---- Feedback advection: pours fall under gravity, so the previous frame
  // drifts DOWNWARD toward the mold (vertical composition), with per-pour
  // lateral drift. NOT a radial warp.
  float fall = (0.006 + 0.02 * u_energy + 0.01 * u_flow * 0.0);
  vec2 grav = vec2(0.0, fall * (0.6 + 0.8 * u_mid));
  // Localized lens shove on kicks — a pressure wave centered on the mold.
  float lens = u_kick * exp(-pow(distMold * 4.0, 2.0));
  vec2 lensOff = normalize(d + 1e-4) * lens * 0.04;
  // Viscous swirl in the stream region (top), FBM flow.
  vec2 swirl = (vec2(
    fbm(uv * 4.0 + vec2(u_flow, 0.0)),
    fbm(uv * 4.0 + vec2(0.0, u_flow) + 5.3)
  ) - 0.5) * (0.004 + 0.012 * u_mid) * u_smooth;
  vec2 src = uv + grav + lensOff + swirl;

  vec3 prev = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  // Sharpen streams (glassy) vs let sparks blur out fast.
  vec3 field = max(vec3(0.0), prev * 1.2 - blur * 0.2) * u_decay;

  vec3 fresh = vec3(0.0);

  // ==== POUR 1: LOW = dense SOLID INGOTS from the LEFT edge. ====
  // Blocky chunks marching in from x~0 toward the mold; heavy, slow.
  {
    float valve = u_valveLow;
    float lane = smoothstep(0.55, 0.15, uv.y) * smoothstep(0.0, 0.5, uv.y - 0.02);
    // Ingot column near the left, arcing toward the mold under gravity.
    float colX = mix(0.06, u_moldX, smoothstep(0.0, 1.0, (0.55 - uv.y) * 1.4));
    float band = exp(-pow((uv.x - colX) * 16.0, 2.0));
    // Chunky quantized blocks (solid, not smooth).
    float march = floor((uv.y * 6.0 + t * (0.6 + 1.5 * u_low)) );
    float block = step(0.35, hash(vec2(march, 1.0)));
    float chunk = block * band * lane;
    fresh += u_hueLow * chunk * valve * (0.5 + 1.6 * u_low) * (0.7 + 0.6 * u_low);
  }

  // ==== POUR 2: MID = VISCOUS COLORED STREAMS from the TOP edge. ====
  // Smooth ribboning FBM flow descending from y~1 into the mold.
  {
    float valve = u_valveMid;
    float streamX = u_moldX + 0.12 * sin(uv.y * 5.0 + t * 1.5) * (0.5 + 0.5 * u_smooth);
    float ribbon = exp(-pow((uv.x - streamX) * 10.0, 2.0));
    float flow = fbm(vec2(uv.x * 8.0, uv.y * 5.0 - t * (0.8 + 2.0 * u_mid)));
    float grain = mix(1.0, 0.4 + 0.6 * step(0.5, flow), 1.0 - u_smooth); // noisy = broken
    float col = ribbon * (0.4 + 0.6 * flow) * grain * smoothstep(0.02, 0.4, 1.0 - uv.y);
    fresh += u_hueMid * col * valve * (0.5 + 1.7 * u_mid);
    // Snare SPLATTER — only the mid stream: a bright liquid burst.
    if (u_snare > 0.03) {
      vec2 sp = uv - vec2(streamX, mix(0.35, u_moldY + 0.1, 0.5));
      sp.x *= aspect;
      float rad = length(sp);
      float splat = exp(-rad * 10.0) * (0.5 + 0.5 * sin(atan(sp.y, sp.x) * 7.0 + u_seed));
      fresh += mix(u_hueMid, vec3(1.0), 0.4) * splat * u_snare * 1.6 * valve;
    }
  }

  // ==== POUR 3: HIGH = SPARKS + VAPOR WISPS from the RIGHT edge. ====
  // Brief bright arcs (sparks) + curling vapor — transient, NOT dust.
  {
    float valve = u_valveHigh;
    // Sparks: sharp short arcs from the right, gated by high transient.
    float sx = uv.x - mix(0.94, u_moldX, smoothstep(0.0, 1.0, (0.6 - uv.y) * 1.2));
    float sparkLane = exp(-pow(sx * 12.0, 2.0)) * smoothstep(0.6, 0.15, uv.y);
    float sparkCell = hash(vec2(floor(uv.y * 40.0 + t * 30.0), floor(uv.x * 20.0)));
    float arc = step(0.9, sparkCell) * pow(sparkLane, 1.5) * u_high;
    fresh += mix(u_hueHigh, vec3(1.0), 0.5) * arc * valve * 2.2;
    // Vapor wisps: curling FBM, brief (fades with feedback, not lingering).
    float vapor = fbm(vec2(uv.x * 6.0 - t * 0.6, uv.y * 6.0 + t * 0.8 + sin(uv.x * 10.0)));
    float wisp = smoothstep(0.55, 0.8, vapor) * exp(-pow(sx * 4.0, 2.0))
      * smoothstep(0.55, 0.2, uv.y);
    fresh += u_hueHigh * wisp * valve * u_high * 0.8;
  }

  // ==== THE MOLD (low-third basin). Spectrum-selected ribs; a molten pool
  // whose surface catches the pours. Heat bloom stays LOCALIZED here. ====
  {
    // Basin coordinate: rx across the mold width.
    float halfW = 0.28 + 0.10 * u_cast;   // widens when opened into the cast
    float halfH = 0.10 + 0.10 * u_cast;
    vec2 md = uv - mold;
    float rx = clamp(md.x / halfW * 0.5 + 0.5, 0.0, 1.0);
    float ribs = moldRibs(rx);
    // Molten pool surface: a filled basin with rib walls and a moving relief.
    float basin = smoothstep(halfH, halfH * 0.2, abs(md.y))
                * smoothstep(halfW, halfW * 0.85, abs(md.x));
    float surface = 0.5 + 0.5 * sin(rx * 30.0 + t * (1.0 + 3.0 * u_energy))
                  * (0.3 + 0.7 * u_energy);
    // Molten color = blend of the three pour hues by their current flow.
    vec3 melt = (u_hueLow * u_low + u_hueMid * u_mid + u_hueHigh * u_high)
              / max(u_low + u_mid + u_high, 0.001);
    fresh += melt * basin * (0.4 + 0.9 * surface) * (0.6 + 1.2 * u_energy);
    // Rib walls glow (spectrum-selected geometry).
    fresh += mix(melt, vec3(1.0), 0.3) * basin * ribs * (0.6 + 1.4 * u_mid);
    // Localized heat bloom (buildup): the mold glows from within — bounded
    // to the basin so the whole-frame ceiling stays stable.
    float bloom = exp(-pow(distMold * 3.2, 2.0)) * u_heat;
    fresh += mix(melt, vec3(1.0), 0.5) * bloom * (0.8 + 0.8 * u_energy);
    // Kick pressure/lens ring striking the pool surface (localized).
    float ring = exp(-pow((distMold - (0.05 + u_kick * 0.25)) * 14.0, 2.0)) * u_kick;
    fresh += mix(melt, vec3(1.0), 0.4) * ring * basin * 1.5;
  }

  // ==== THE CAST (drop): the mold OPENS into a large persistent cast whose
  // relief keeps moving. Different form family per section (break & recast).
  if (u_cast > 0.02) {
    vec2 cd = uv - mold;
    cd.y += 0.06 * u_cast; // the cast bulges upward as it opens
    cd.x *= aspect;
    float ang = atan(cd.y, cd.x);
    float rad = length(cd);
    // Form family selects the cast silhouette.
    float form = u_castForm;
    float shape;
    if (form < 0.5) {
      // bridge: broad low arch.
      shape = smoothstep(0.34, 0.30, abs(cd.y + 0.02 * sin(cd.x * 8.0)) )
            * smoothstep(0.42, 0.40, abs(cd.x));
    } else if (form < 1.5) {
      // mask: rounded lobed face.
      float lobes = 0.28 + 0.05 * cos(ang * 4.0 + t * 0.5);
      shape = smoothstep(lobes + 0.02, lobes - 0.02, rad);
    } else if (form < 2.5) {
      // engine: gear/piston radial teeth.
      float teeth = 0.26 + 0.04 * step(0.5, fract(ang / PI * 6.0 + t * 0.3));
      shape = smoothstep(teeth + 0.02, teeth - 0.02, rad);
    } else {
      // glyph: cross/rune bars.
      float bars = min(smoothstep(0.05, 0.03, abs(cd.x)), 1.0)
                 + min(smoothstep(0.05, 0.03, abs(cd.y)), 1.0);
      shape = clamp(bars, 0.0, 1.0) * smoothstep(0.34, 0.30, rad);
    }
    // Living relief on the cast surface — keeps moving with energy.
    float relief = fbm(vec2(ang * 3.0 + t * (0.4 + 1.5 * u_energy), rad * 10.0 - t * 0.6));
    vec3 castMelt = (u_hueLow + u_hueMid + u_hueHigh) / 3.0;
    fresh += castMelt * shape * u_cast * (0.6 + 0.9 * relief) * (0.7 + 1.0 * max(u_drop, u_energy));
    // Edge rim light on the cast (localized, not a field flash).
    float rim = exp(-pow((rad - 0.28) * 30.0, 2.0));
    fresh += mix(castMelt, vec3(1.0), 0.4) * rim * shape * u_cast * (0.5 + 0.9 * u_energy);
  }

  // Inject fresh; buildups tense-but-alive (heat saturates), drops bloom.
  field += fresh * (1.0 - u_decay) * (3.0 + 1.4 * u_heat + 1.2 * max(u_drop, u_energy));

  // Traveling saturation on buildup (whole-frame ceiling stable).
  field *= 0.85 + 0.35 * max(u_drop, u_energy) + 0.15 * u_heat;

  // ---- Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.85) {
    field *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

type Rgb = [number, number, number];

/** HSL (h 0..360, s/l 0..1) → chroma-true rgb 0..1. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((h % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

/** EQ knob → valve gate. 0.5 flat = 1.0; 0 kill = trickle (0.05); 1 = flood. */
function valveGate(knob: number): number {
  return Math.max(0.05, Math.min(1.6, (knob - 0.5) * 2 + 1));
}

const SECTION_BARS = 16;

export const g06FoundryPreset: VisualizerPreset = {
  id: 'g06-foundry',
  name: 'g06 foundry',
  hiRes: true,
  params: [
    { id: 'flowRate', label: 'pour flow rate', min: 0.3, max: 2.5, step: 0.05, default: 1 },
    { id: 'persistence', label: 'melt persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'heatDrive', label: 'heat / cast drive', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'moldX', label: 'mold offset', min: 0.2, max: 0.8, step: 0.02, default: 0.36 },
  ],
  create: () => {
    let lastTime = 0;
    let flow = 0;

    // Smoothed valves (avoid pops on EQ jumps / deck switches).
    let valveLow = 1;
    let valveMid = 1;
    let valveHigh = 1;

    // Drop / cast genome.
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let cast = 0;

    // Section: break & recast (form family).
    let castForm = 0;
    let lastSection = -1;

    // Persistent 24-band spectrum buffer (EXACTLY length 24, reused).
    const spectrum = new Float32Array(SPECTRUM_BANDS);

    // Traveling hue phases.
    let hueTravel = 0;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame: VisualizerFrameData): Record<string, UniformValue> => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const a = 1 - Math.exp(-dt / 0.15);

        const flowRate = frame.params.flowRate ?? 1;
        const persistence = frame.params.persistence ?? 1;
        const heatDrive = frame.params.heatDrive ?? 1;
        const moldX = frame.params.moldX ?? 0.36;

        const energy = Math.min(1, frame.bands.low * 0.5 + frame.bands.mid * 0.3 + frame.bands.high * 0.2);

        // ---- Dominant audible deck: EQ = feed valves; spectrum = mold ribs.
        let dom: (typeof frame.decks)[number] | null = null;
        for (const d of frame.decks) {
          if (d.playing && (dom === null || d.level > dom.level)) dom = d;
        }
        const targetLow = valveGate(dom?.eq.low ?? 0.5);
        const targetMid = valveGate(dom?.eq.mid ?? 0.5);
        const targetHigh = valveGate(dom?.eq.high ?? 0.5);
        valveLow += (targetLow - valveLow) * a;
        valveMid += (targetMid - valveMid) * a;
        valveHigh += (targetHigh - valveHigh) * a;

        // Fill 24-band spectrum buffer (EXACTLY length 24; clamp source).
        const srcSpec = frame.spectrum;
        for (let i = 0; i < SPECTRUM_BANDS; i++) {
          const v = i < srcSpec.length ? srcSpec[i] : 0;
          spectrum[i] = Math.min(1, Math.max(0, v));
        }

        // ---- Melt smoothness from flatness (tonal -> glassy, noisy -> grainy).
        const smoothMelt = Math.max(0, Math.min(1, 1 - frame.flatness));

        // ---- Flow phase accelerates on buildup and energy.
        flow += dt * flowRate * (0.5 + 1.5 * energy + 1.0 * smoothBuildup);

        // ---- Drop / buildup split (voyage idiom); derived drop (no
        // trend.drop field). Cast rides max(drop, energy).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * (1 - Math.exp(-dt / 0.35));
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * (1 - Math.exp(-dt / 0.35));
        const dropRide = Math.max(smoothDrop, energy);

        // Cast opens on a drop, persists (slow decay, never resets to idle).
        const castAim = Math.min(1, smoothDrop * 1.3) * heatDrive;
        if (castAim > cast) cast += (castAim - cast) * (1 - Math.exp(-dt / 0.35));
        else cast += (Math.max(0.15 * dropRide, castAim) - cast) * (1 - Math.exp(-dt / 2.5));
        cast = Math.max(0, Math.min(1, cast));

        // Heat = buildup, localized bloom drive.
        const heat = Math.min(1, smoothBuildup * heatDrive);

        // ---- Section boundary: break & recast (switch form family). Cast
        // persists across the switch (no reset).
        if (frame.beat) {
          const barIndex = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
          const section = Math.floor(barIndex / SECTION_BARS);
          if (section !== lastSection && lastSection >= 0) {
            castForm = (castForm + 1) % 4;
          }
          lastSection = section;
        }

        // ---- Traveling saturated hues (shape carried identity; hue free).
        hueTravel += dt * (0.3 + 1.2 * energy);
        const base = (frame.centroid * 60 + frame.time * 6 + hueTravel * 10) % 360;
        const hueLow = hslToRgb(base, 1, 0.5 + 0.1 * frame.bands.low);       // ingots
        const hueMid = hslToRgb(base + 130, 1, 0.55);                        // streams
        const hueHigh = hslToRgb(base + 230, 1, 0.62);                       // sparks

        // ---- Persistence-scaled decay; sparks/vapor scatter fast, melt lingers.
        const baseDecay = 0.99 - 0.01 * energy - 0.006 * smoothBuildup;
        const decay = Math.min(0.996, 1 - (1 - baseDecay) / persistence);

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_valveLow: valveLow,
          u_valveMid: valveMid,
          u_valveHigh: valveHigh,
          u_smooth: smoothMelt,
          u_heat: heat,
          u_energy: energy,
          u_drop: smoothDrop,
          u_cast: cast,
          u_castForm: castForm,
          u_flow: flow,
          u_decay: decay,
          u_moldX: moldX,
          u_moldY: 0.24,
          u_seed: 5.1,
          u_hueLow: [hueLow[0], hueLow[1], hueLow[2]],
          u_hueMid: [hueMid[0], hueMid[1], hueMid[2]],
          u_hueHigh: [hueHigh[0], hueHigh[1], hueHigh[2]],
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default g06FoundryPreset;
