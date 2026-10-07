/** Parameter identity shared by editor lanes and performance knobs. */
export const AUTOMATION_COLORS = {
  trim: '#c9c9d4',
  eqLow: '#ff2d2d',
  eqMid: '#2dff6a',
  eqHigh: '#3d6aff',
  filter: '#00ffc4',
} as const;

/** Warm LPF against the filter's cool HPF side. */
export const FILTER_LPF_COLOR = '#ff8a00';
