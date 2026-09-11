import { AUTOMATION_COLORS, FILTER_LPF_COLOR } from '../../theme/automationColors';
import { laneFillAnchor, strokeColorAt } from '../../editor/laneShade';
import { getStyle } from '../../waveform/styles';
import type { SlotState } from '../../waveform/styleSlots';

export type KnobControl = keyof typeof AUTOMATION_COLORS;

/** Normalized values shared by deck knobs and imperative keyboard feedback. */
export function knobAppearance(control: KnobControl, value: number, ghost: number | null, waveform: SlotState) {
  const clamp = (v: number) => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  const position = clamp(ghost ?? value);
  const kind = control.startsWith('eq') ? 'eq' : control === 'filter' ? 'filter' : 'trim';
  let baseColor: string = AUTOMATION_COLORS[control];
  if (kind === 'eq') {
    const colors = waveform.params.colors ?? getStyle(waveform.styleId).defaultColors;
    const rgb = colors[control === 'eqLow' ? 0 : control === 'eqMid' ? 1 : 2];
    baseColor = '#' + rgb.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('');
  }
  const color = control === 'filter' && position < 0.5 ? FILTER_LPF_COLOR : baseColor;
  const anchor = laneFillAnchor(kind);
  const start = Math.min(anchor, position) * 270;
  const end = Math.max(anchor, position) * 270;
  // EQ reaches full color at unity; only boost adds glow, not more saturation.
  const strength = kind === 'eq' ? Math.min(1, position * 2) : position;
  const boost = kind === 'eq' ? Math.max(0, position * 2 - 1) : 0;
  return {
    angle: -135 + clamp(value) * 270,
    ghostAngle: ghost === null ? null : -135 + clamp(ghost) * 270,
    arcBackground: start === end ? 'none'
      : `conic-gradient(from 225deg, transparent 0deg ${start}deg, var(--knob-value-color) ${start}deg ${end}deg, transparent ${end}deg 360deg)`,
    style: {
      '--knob-color': baseColor,
      '--knob-value-color': strokeColorAt(kind, color, strength),
      '--knob-glow': boost > 0 ? `drop-shadow(0 0 ${boost * 4}px ${color})` : 'none',
    },
  };
}
