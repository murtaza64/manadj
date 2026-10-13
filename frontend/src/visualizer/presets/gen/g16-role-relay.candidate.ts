import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_motion;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_drive;
uniform float u_buildup;
uniform float u_centroid;
uniform float u_spread;
uniform float u_flatness;
uniform float u_roleShift;
uniform float u_relay;
uniform float u_barPhase;
uniform float u_eqLow;
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_deckA;
uniform float u_deckB;
uniform float u_gutter;
uniform float u_travel;
uniform float u_colorSep;
uniform float u_spectrum[24];
const float TAU = 6.2831853;
vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h) + vec3(0.0, .666667, .333333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}
float spec(float x) {
  float v = 0.0; float k = floor(clamp(x, 0.0, .999) * 24.0);
  for (int i = 0; i < 24; i++) if (abs(float(i) - k) < .5) v = u_spectrum[i];
  return v;
}
vec3 scene(float role, vec2 p, vec2 uv, float panel) {
  float hue = fract(0.02 + role * u_colorSep + panel * .07 + u_centroid * .18);
  vec3 dark = hsv(hue + .5, .75, .075);
  if (role < .5) {
    float r = length(p * vec2(.72, 1.0));
    float slab = smoothstep(.36 + u_low * .11, .34 + u_low * .11, r);
    float ring = exp(-pow((r - .34 - u_kick * .05) * 42.0, 2.0));
    return dark + hsv(hue, .95, .75) * slab + hsv(hue + .1, .8, 1.0) * ring;
  }
  if (role < 1.5) {
    float s = spec(uv.y);
    float fill = step(abs(p.x), .08 + s * .36);
    float rails = exp(-pow((abs(p.x) - (.08 + s * .36)) * 45.0, 2.0));
    return dark + hsv(hue + uv.y * .22, .95, .72) * fill + hsv(hue + .12, .7, 1.0) * rails * u_snare;
  }
  float teeth = .5 + .5 * sin((atan(p.y, p.x) * (4.0 + u_spread * 7.0) + length(p) * 17.0 - u_motion * 1.4));
  float tonal = smoothstep(.54, .72, teeth);
  float noisy = smoothstep(.25, .8, fract(teeth * 5.0 + uv.y * 3.0));
  return dark + hsv(hue + length(p) * .35, .95 - u_flatness * .25, .82) * mix(tonal, noisy, u_flatness);
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  float widths = u_deckA + u_deckB + .001;
  float seamBias = clamp((u_deckA - u_deckB) / widths, -.35, .35) * .09;
  float slide = (1.0 - u_relay) * u_travel;
  vec2 suv = uv + vec2(slide * sin((uv.y + u_roleShift) * TAU), 0.0);
  float a = .333 + seamBias;
  float b = .666 + seamBias;
  float panel = suv.x < a ? 0.0 : (suv.x < b ? 1.0 : 2.0);
  float left = panel < .5 ? 0.0 : (panel < 1.5 ? a : b);
  float right = panel < .5 ? a : (panel < 1.5 ? b : 1.0);
  vec2 local = vec2((suv.x - left) / (right - left), suv.y);
  vec2 p = local - .5;
  float role = mod(panel + u_roleShift, 3.0);
  vec3 col = scene(role, p, local, panel);
  float edge = min(local.x, 1.0 - local.x);
  float aperture = smoothstep(u_gutter, u_gutter + .012, edge) * smoothstep(.035, .055, min(local.y, 1.0 - local.y));
  col *= aperture;
  float seam = exp(-pow((min(abs(uv.x - a), abs(uv.x - b))) * 180.0, 2.0));
  col += mix(hsv(.53, .95, .75), hsv(.92, .9, .75), u_deckB / widths) * seam * (.35 + u_drive * .35);
  float stress = exp(-pow((uv.y - u_barPhase) * 45.0, 2.0));
  col += hsv(.14, .8, .9) * stress * u_buildup * .26;
  col *= .88 + .08 * u_drive + .05 * u_kick;
  float mx = max(col.r, max(col.g, col.b));
  if (mx > .92) col *= (.92 + .08 * (1.0 - exp(-(mx - .92) * 3.0))) / mx;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const preset: VisualizerPreset = {
  id: 'g16-role-relay', name: 'g16 role relay', hiRes: true,
  params: [
    { id: 'gutter', label: 'aperture gutter', min: 0.01, max: 0.12, step: 0.005, default: 0.045 },
    { id: 'travel', label: 'relay travel', min: 0.05, max: 0.35, step: 0.01, default: 0.18 },
    { id: 'colorSep', label: 'role color separation', min: 0.12, max: 0.45, step: 0.01, default: 0.29 },
  ],
  create: () => {
    let motion = 0; let relay = 1; let roleShift = 0; let lastSection = -1;
    const spectrum = new Float32Array(24);
    return createGlRenderer({ fragment: FRAGMENT, uniforms: (frame) => {
      const dt = Math.min(.1, Math.max(0, frame.dt));
      const slow = frame.bandsSlow ?? frame.bands;
      motion += dt * (.18 + slow.mid * .42 + slow.high * .12);
      const bar = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? Math.floor(frame.time / 2);
      const section = Math.floor(bar / 16);
      if (lastSection >= 0 && section !== lastSection) { roleShift = ((roleShift + 1) % 3); relay = 0; }
      lastSection = section; relay = Math.min(1, relay + dt / .75);
      for (let i = 0; i < 24; i++) spectrum[i] = Math.min(1, frame.spectrum[i] ?? 0);
      const dominant = frame.decks.find((deck) => deck.channel === frame.dominantChannel);
      const deckA = frame.decks.find((deck) => deck.channel === 'A')?.level ?? 0;
      const deckB = frame.decks.find((deck) => deck.channel === 'B')?.level ?? 0;
      return {
        u_motion: motion, u_low: frame.bands.low, u_mid: frame.bands.mid, u_high: frame.bands.high,
        u_kick: frame.impulse.low, u_snare: frame.impulse.mid, u_drive: frame.regime?.sustained ?? 0,
        u_buildup: frame.regime?.buildup ?? 0, u_centroid: frame.centroid, u_spread: frame.spread,
        u_flatness: frame.flatness, u_roleShift: roleShift, u_relay: relay, u_barPhase: frame.beat?.barPhase ?? 0,
        u_eqLow: (dominant?.eq.low ?? .5) * 2, u_eqMid: (dominant?.eq.mid ?? .5) * 2,
        u_eqHigh: (dominant?.eq.high ?? .5) * 2, u_deckA: deckA, u_deckB: deckB,
        u_gutter: frame.params.gutter ?? .045, u_travel: frame.params.travel ?? .18,
        u_colorSep: frame.params.colorSep ?? .29, u_spectrum: spectrum,
      };
    }});
  },
};
export default preset;
