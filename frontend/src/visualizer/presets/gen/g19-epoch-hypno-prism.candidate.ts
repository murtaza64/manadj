import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_phase;
uniform float u_zoom;
uniform float u_mode;
uniform float u_arms;
uniform float u_twist;
uniform float u_epoch;
uniform float u_hue;
uniform float u_low;
uniform float u_kick;
uniform float u_snare;
uniform float u_drive;
uniform float u_soft;
vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h) + vec3(0.0, .666667, .333333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}
void main() {
  vec2 p = (gl_FragCoord.xy - .5 * u_res) / u_res.y;
  float r = max(length(p), .002);
  float a = atan(p.y, p.x);
  float lr = log(r) - u_zoom;
  float angular = u_arms * a;
  float radial = u_twist * lr;
  float field;
  if (u_mode < .5) field = sin(angular + radial + u_phase);
  else if (u_mode < 1.5) field = sin(radial * 1.35 - u_phase) * cos(angular * .5);
  else if (u_mode < 2.5) field = sin(angular + u_phase) * sin(radial - u_phase * .7);
  else field = sin(angular + radial + u_phase) * sin(angular - radial - u_phase);
  float width = .16 + u_soft * .28;
  float band = smoothstep(-width, width, field);
  float edge = exp(-abs(field) * (8.0 + u_epoch * 8.0));
  float pixelScale = 2.0 / u_res.y;
  float frequency = (u_arms + u_twist) * pixelScale / r;
  float detail = 1.0 - smoothstep(1.2, 2.4, frequency);
  band = mix(.5, band, detail);
  edge *= detail;
  float invert = mod(u_mode, 2.0);
  band = mix(band, 1.0 - band, invert);
  float hueA = fract(u_hue + u_epoch * .58 + r * .18);
  float hueB = fract(hueA + .46 + .08 * sin(u_epoch * 6.28318));
  vec3 aCol = hsv(hueA, .95, .20 + .45 * u_drive);
  vec3 bCol = hsv(hueB, .92, .58 + .16 * u_low);
  vec3 col = mix(aCol, bCol, band);
  col += hsv(hueA + .18, .8, 1.0) * edge * (.10 + .24 * u_snare);
  col += hsv(hueB, .9, 1.0) * u_kick * exp(-abs(r - .16 - u_kick * .22) * 35.0) * .35;
  col *= .78 + .18 * u_drive;
  float mx = max(col.r, max(col.g, col.b));
  if (mx > .92) col *= (.92 + .08 * (1.0 - exp(-(mx - .92) * 3.0))) / mx;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

function seedOf(frame: VisualizerFrameData): number {
  const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
  return (((deck?.trackId ?? 1919) * 0.61803398875) % 1 + 1) % 1;
}

const preset: VisualizerPreset = {
  id: 'g19-epoch-hypno-prism',
  name: 'g19 epoch hypno prism',
  hiRes: true,
  params: [
    { id: 'density', label: 'epoch density', min: .6, max: 1.6, step: .05, default: 1 },
    { id: 'speed', label: 'glide speed', min: .35, max: 1.4, step: .05, default: .8 },
    { id: 'softness', label: 'band softness', min: 0, max: 1, step: .05, default: .3 },
  ],
  create: () => {
    let phase = 0;
    let zoom = 0;
    let smoothBpm = 120;
    let slowCentroid = .5;
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = Math.min(.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        const speed = frame.params.speed ?? .8;
        const bpm = frame.beat?.bpm;
        if (bpm && bpm > 0) smoothBpm += (bpm - smoothBpm) * (1 - Math.exp(-dt / 2));
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt));
        phase += dt * speed * (smoothBpm / 120) * (.18 + slow.mid * .28);
        zoom += dt * speed * (.025 + slow.low * .035);
        const bar = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? Math.floor(frame.time / 2);
        const section = Math.floor(bar / 16);
        const epochSection = ((section % 8) + 8) % 8;
        const epoch = epochSection / 7;
        const density = frame.params.density ?? 1;
        return {
          u_phase: phase,
          u_zoom: zoom,
          u_mode: ((section % 4) + 4) % 4,
          u_arms: Math.round((3 + epoch * 9) * density),
          u_twist: (5 + epoch * 12) * density,
          u_epoch: epoch,
          u_hue: seedOf(frame) + slowCentroid * .16,
          u_low: frame.bands.low,
          u_kick: frame.impulse.low,
          u_snare: Math.min(1, frame.impulse.mid + frame.impulse.high * .45),
          u_drive: Math.max(frame.regime?.sustained ?? 0, frame.trend.slow, frame.trend.excitement),
          u_soft: frame.params.softness ?? .3,
        };
      },
    });
  },
};

export default preset;
