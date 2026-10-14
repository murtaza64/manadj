import { sweepResponseDb } from '../../../../../frontend/src/playback/sweepFilter';
import { DEFAULT_FILTER_SETTINGS } from '../../../../../frontend/src/playback/filterSettings';
const cases = [
  { name: 'default', s: { ...DEFAULT_FILTER_SETTINGS } },
  // backend/shipped_defaults.json manadj-filter-settings (what the desktop actually runs with).
  { name: 'shipped', s: { ...DEFAULT_FILTER_SETTINGS, resonance: 10.5, compensation: 0.1 } },
  { name: 'current', s: { ...DEFAULT_FILTER_SETTINGS, model: 'current', trim: -3 } },
  { name: 'res12', s: { ...DEFAULT_FILTER_SETTINGS, model: 'res12', resonance: 6, compensation: .5, curve: 1.5 } },
  { name: 'res48', s: { ...DEFAULT_FILTER_SETTINGS, model: 'res48', resonance: 12, lpMin: 100, hpMax: 8000, trim: 2 } },
  { name: 'dual', s: { ...DEFAULT_FILTER_SETTINGS, model: 'dual', spread: 1.4, resonance: 20, deadzone: .08, compensation: 1 } },
];
const positions = [-1, -.6, -.2, -.05, 0, .1, .45, .8, 1];
const freqs = new Float32Array([30, 80, 200, 500, 1000, 2500, 6000, 12000, 18000]);
const lines: string[] = [];
for (const c of cases) for (const p of positions) {
  const db = sweepResponseDb(c.s as any, p, freqs, 48000);
  const s = c.s as any;
  lines.push(`{${['current','res12','res24','res48','dual'].indexOf(s.model)}, ${s.resonance}, ${s.compensation}, ${s.curve}, ${s.deadzone}, ${s.lpMin}, ${s.hpMax}, ${s.spread}, ${s.trim}, ${p}, {${db.map((x) => x.toFixed(6)).join(', ')}}},`);
}
console.log(lines.join('\n'));
