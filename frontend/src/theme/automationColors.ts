/** Parameter identity shared by editor lanes and performance knobs. */
export const AUTOMATION_COLORS = {
  trim: '#c9c9d4',
  eqLow: '#ff2d2d',
  eqMid: '#2dff6a',
  eqHigh: '#3d6aff',
  filter: '#00ffc4',
} as const;

/** Beat FX LEVEL/DEPTH wet side (grey at fully dry). */
export const FX_DEPTH_COLOR = '#ff2dd4';

/** Warm LPF against the filter's cool HPF side. */
export const FILTER_LPF_COLOR = '#ff8a00';
