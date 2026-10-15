import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PHONE_PRESETS } from './presetList';

describe('phone presets', () => {
  it('every listed id is wired to a module in main.ts', () => {
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const block = main.slice(main.indexOf('const MODULES'), main.indexOf('const PRESETS'));
    for (const [id] of PHONE_PRESETS) expect(block.includes(id.includes('-') ? `'${id}':` : `${id}:`), id).toBe(true);
  });
  it('ids are unique', () => {
    expect(new Set(PHONE_PRESETS.map(([id]) => id)).size).toBe(PHONE_PRESETS.length);
  });
});
