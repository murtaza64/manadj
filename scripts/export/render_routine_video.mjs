#!/usr/bin/env node
// Headless clip export (#377): drives the app's CLIP mode (?view=clip) in
// Chromium with the clip spec saved there (localStorage) or the defaults,
// and waits for the MP4. Usage:
//   node scripts/export/render_routine_video.mjs --app http://localhost:5363 --source routine:<uuid> [--max 60] [--viz voyage] [--auto 1|'{AutoVizOptions}'] [--spec '{json partial ClipSpec}']
//   --source kinds: routine:<uuid> | transition:<uuid> | candidate:<uuid> | routine-take:<uuid> | session:<uuid>:<start>-<end>
// Uses the playwright install at $PLAYWRIGHT_MODULE (default: a sibling
// node_modules/playwright of the repo root or ~/manadj/node_modules).
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? '1'] : null)).filter(Boolean)
);
const app = args.app ?? 'http://localhost:5173';
const source = args.source ?? (args.routine ? `routine:${args.routine}` : null);
if (!source) {
  console.error('--source <kind:uuid> required');
  process.exit(2);
}
const require = createRequire(import.meta.url);
const candidates = [
  process.env.PLAYWRIGHT_MODULE,
  path.join(process.cwd(), 'node_modules', 'playwright'),
  path.join(os.homedir(), 'manadj', 'node_modules', 'playwright'),
].filter(Boolean);
let playwright = null;
for (const c of candidates) {
  try { playwright = require(c); break; } catch { /* next */ }
}
if (!playwright) {
  console.error('playwright not found; set PLAYWRIGHT_MODULE');
  process.exit(2);
}
const { chromium } = playwright;
// GPU on (ANGLE/Metal): the visualizer presets are WebGL and the scene
// leans on canvas shadows/blur — SwiftShader is ~15× slower.
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1200, height: 1100 } });
await context.addInitScript(() => {
  try {
    sessionStorage.setItem('manadj-midi-boot-reloaded', '1');
    localStorage.setItem('manadj-tour-state', JSON.stringify({ skippedAll: true }));
  } catch { /* ignore */ }
});
const page = await context.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.error(`[page ${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
const url = new URL('/', app);
url.searchParams.set('view', 'clip');
url.searchParams.set('clip', source);
url.searchParams.set('autostart', '1');
// Optional spec overrides, applied to the saved clip spec before load.
const overrides = {};
if (args.max) overrides.max = Number(args.max);
if (args.viz) overrides.viz = args.viz;
if (args.fps) overrides.fps = Number(args.fps);
if (args.spec) overrides.spec = JSON.parse(args.spec); // partial ClipSpec merged last
if (args.auto) overrides.auto = args.auto === '1' ? {} : JSON.parse(args.auto); // hypermeter-placed programme
// Same key as clipSpec.sourceKey (session spans normalise to one decimal).
const m = /^session:([^:]+):([\d.]+)-([\d.]+)$/.exec(source);
const storageKey = `manadj-clip:${m ? `session:${m[1]}:${Number(m[2]).toFixed(1)}-${Number(m[3]).toFixed(1)}` : source}`;
await context.addInitScript(({ storageKey, overrides }) => {
  try {
    if (sessionStorage.getItem('manadj-clip-overrides-applied')) return;
    sessionStorage.setItem('manadj-clip-overrides-applied', '1');
    const key = storageKey;
    const spec = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (overrides.fps) spec.fps = overrides.fps;
    if (overrides.viz) spec.viz = { cues: [{ atSec: 0, presetId: overrides.viz }], crossfadeSec: 2 };
    if (overrides.max) spec.range = { startSec: spec.range?.startSec ?? 0, endSec: (spec.range?.startSec ?? 0) + overrides.max };
    if (overrides.spec) Object.assign(spec, overrides.spec, { look: { ...(spec.look ?? {}), ...(overrides.spec.look ?? {}) } });
    if (overrides.auto) spec.viz = { ...(spec.viz ?? { cues: [], crossfadeSec: 2 }), auto: overrides.auto };
    localStorage.setItem(key, JSON.stringify(spec));
  } catch { /* ignore */ }
}, { storageKey, overrides });
console.log('open', url.toString());
await page.goto(url.toString(), { waitUntil: 'load' });
await page.waitForFunction(() => !!window.manadjClipEditor, null, { timeout: 60_000 });
const started = Date.now();
let last = '';
for (;;) {
  const s = await page.evaluate(() => window.manadjClipEditor.state());
  const line = s.progress ? `${s.progress.stage} ${(s.progress.fraction * 100).toFixed(0)}% ${s.progress.detail ?? ''}` : 'loading';
  if (line !== last) { console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s] ${line}`); last = line; }
  if (s.error) { console.error('export failed:', s.error); await browser.close(); process.exit(1); }
  if (s.result) {
    console.log(JSON.stringify({ path: s.result.path, url: s.result.url, frames: s.result.frames, seconds: s.result.seconds }));
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
await browser.close();
