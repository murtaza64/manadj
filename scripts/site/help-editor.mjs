// Capture actual UI operations on this lane's sandbox app. No fixed database IDs.
// SITE_APP_URL=http://localhost:<lane-vite> SITE_API_URL=http://localhost:<lane-backend> \
//   node scripts/site/help-editor.mjs [editor,set,capture | all]
// Optional: SITE_TRANSITION, SITE_TRANSITION_INCOMING, SITE_ROUTINE_START,
// SITE_ROUTINE_SIZE, SITE_SET, SITE_SESSION_STARTED_AT, SITE_DEMO_TRACK.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lane = await readFile(resolve(root, '../../../LANE.md'), 'utf8');
const ports = lane.match(/^ports:\s*backend (\d+), vite (\d+)\s*$/m);
if (!ports) throw Error('Lane ports unavailable');
function ownURL(key, port) {
  const value = process.env[key];
  if (!value) throw Error(`${key} required`);
  const u = new URL(value);
  if (u.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(u.hostname)
    || u.port !== port || u.pathname !== '/' || u.search || u.hash) throw Error(`${key} is not this lane: ${value}`);
  return u.origin;
}
const base = ownURL('SITE_APP_URL', ports[2]);
const api = ownURL('SITE_API_URL', ports[1]);
const get = async (path) => {
  const r = await fetch(`${api}/api/${path}`);
  if (!r.ok) throw Error(`${path}: ${r.status}`);
  return r.json();
};
const one = (rows, description) => {
  if (rows.length !== 1) throw Error(`Expected exactly one ${description}; found ${rows.length}`);
  return rows[0];
};
const transition = async () => {
  const name = process.env.SITE_TRANSITION || 'second drop double';
  const incoming = process.env.SITE_TRANSITION_INCOMING || 'Last Time';
  const rows = (await get('transitions')).filter(t => t.name === name);
  const matches = [];
  for (const t of rows) if ((await get(`tracks/${t.b_track_id}`)).title === incoming) matches.push(t);
  return one(matches, `Transition ${name} into ${incoming}`);
};
const routine = async () => {
  const start = process.env.SITE_ROUTINE_START || 'Runaway Train';
  const size = Number(process.env.SITE_ROUTINE_SIZE || 7);
  const rows = (await get('routines')).filter(r => r.cast.length === size);
  const matches = [];
  for (const r of rows) {
    const track = await get(`tracks/${r.cast[0]}`);
    if (track.title === start) matches.push(r);
  }
  return one(matches, `${size}-Track Routine starting with ${start}`);
};
const reviewTake = async () => {
  for (const row of await get('takes')) {
    if (row.kind === 'guest' || row.promoted_transition_uuid || row.window_end_s - row.window_start_s < 5) continue;
    try {
      const [outgoing, incoming] = await Promise.all([get(`tracks/${row.a_track_id}`), get(`tracks/${row.b_track_id}`)]);
      if (outgoing.title && incoming.title && outgoing.bpm && incoming.bpm) return row;
    } catch { /* Old captures may refer to Tracks no longer present in this sandbox. */ }
  }
  throw Error('No unpromoted handover Take with two available Tracks');
};
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const modes = process.argv[2] === 'all' || !process.argv[2] ? ['editor', 'set', 'capture'] : process.argv[2].split(',');
const output = [];
try {
  for (const mode of modes) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, permissions: ['midi', 'midi-sysex'] });
    await context.addInitScript(() => {
      localStorage.setItem('manadj-tour-state', JSON.stringify({ skippedAll: true }));
      sessionStorage.setItem('manadj-midi-boot-reloaded', '1');
    });
    await context.route('**/*', async route => {
      const u = new URL(route.request().url());
      if ((route.request().isNavigationRequest() || u.pathname.startsWith('/api/')) && ![base, api].includes(u.origin)) await route.abort();
      else await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    async function dismiss() {
      for (let i = 0; i < 8; i++) {
        const overlay = page.locator('.tour-overlay:visible');
        if (!await overlay.count()) break;
        const skip = overlay.getByRole('button', { name: /^(Skip all tours|Skip tour|Skip|Close)$/ }).first();
        if (!await skip.isVisible()) throw Error('A Tour blocks capture and has no close control');
        await skip.click();
        await page.waitForTimeout(250);
      }
    }
    async function go(view) {
      await page.goto(`${base}/?view=${view}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      await dismiss();
      for (let i = 0; i < 6; i++) {
        const skip = page.getByRole('button', { name: /^(Skip all tours|Skip tutorial|Skip tour|Skip)$/ }).first();
        if (!await skip.isVisible()) break;
        await skip.click();
      }
    }
    async function shot(name, selector) {
      await page.locator(selector).first().waitFor({ state: 'visible' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1100);
      await dismiss();
      if (errors.length) throw Error(`${name}: ${errors.join('; ')}`);
      const anchor = selector === '.set-header' ? page.locator(selector).first().locator('..') : page.locator(selector).first();
      const bounds = await anchor.boundingBox();
      if (!bounds) throw Error(`${name}: anchor has no bounds`);
      const clip = {
        x: Math.max(0, Math.floor(bounds.x - 12)), y: Math.max(0, Math.floor(bounds.y - 12)),
        width: Math.min(1600 - Math.max(0, Math.floor(bounds.x - 12)), Math.ceil(bounds.width + 24)),
        height: Math.min(
          selector === '.re-main' ? 440 : selector === '.session-timeline' ? 530 : selector === '.take-history' ? 670 : 680,
          1000 - Math.max(0, Math.floor(bounds.y - 12)), Math.ceil(bounds.height + 24)),
      };
      if (clip.width < 180 || clip.height < 80) throw Error(`${name}: crop too small ${JSON.stringify(clip)}`);
      const png = await page.screenshot({ clip, animations: 'disabled' });
      const file = resolve(root, 'site/shots', `help-editor-${name}.webp`);
      const p = spawnSync('uv', ['run', '--no-project', '--with', 'pillow', 'python', '-c',
        'from PIL import Image; import io, sys; Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB").save(sys.argv[1], "WEBP", quality=82, method=6)',
        file], { cwd: root, input: png, stdio: ['pipe', 'inherit', 'inherit'] });
      if (p.error || p.status !== 0) throw p.error || Error(`WebP conversion failed: ${p.status}`);
      console.log(name, clip);
      output.push(name);
    }
    async function open(kind, artifact) {
      await page.evaluate(async ({ kind, artifact }) => {
        const { requestMixEdit } = await import('/src/routines/openMix.ts');
        requestMixEdit({ open: kind === 'routine'
          ? { kind, uuid: artifact.uuid }
          : { kind, uuid: artifact.uuid, aTrackId: artifact.a_track_id, bTrackId: artifact.b_track_id } });
      }, { kind, artifact });
      await page.locator('.rt-wave-row canvas').first().waitFor();
      await page.waitForTimeout(3000);
    }
    try {
      if (mode === 'editor') {
        const t = await transition();
        await go('routine');
        await open('transition', t);
        await shot('picker', '.routine-editor');
        const take = await reviewTake();
        await page.evaluate(async row => {
          const { requestPairTakeEdit } = await import('/src/routines/openMix.ts');
          requestPairTakeEdit(row);
        }, take);
        await page.locator('.re-promote').waitFor({ state: 'visible' });
        await page.locator('.rt-wave-row canvas').first().waitFor();
        await shot('review', '.routine-editor');
        const r = await routine();
        await open('routine', r);
        await shot('routine', '.re-main');
        // All edits below occur on a NEW single-slot draft; it never persists.
        while (await page.locator('.mp-chipx').count()) await page.locator('.mp-chipx').last().click();
        await page.locator('.mp-panel').getByText('New blank mix', { exact: true }).first().click();
        await shot('blank', '.re-main');
        const title = process.env.SITE_DEMO_TRACK || 'Last Time';
        const track = one((await get(`tracks/?search=${encodeURIComponent(title)}`)).items.filter(x => x.title === title), `Track ${title}`);
        // Seed via the real picker, then work the actual canvas; no fake DOM.
        while (await page.locator('.mp-chipx').count()) await page.locator('.mp-chipx').last().click();
        const search = page.locator('input.mp-search').first();
        await search.fill(track.title);
        await page.locator('.mp-row').filter({ hasText: track.title }).first().click();
        await page.locator('.mp-panel').getByText('New blank mix', { exact: true }).first().click();
        await page.locator('.rt-wave-row canvas').first().waitFor();
        await page.waitForTimeout(1800);
        await page.locator('.re-modebar button').filter({ hasText: 'J' }).click();
        const wave = page.locator('.rt-wave-row canvas').first();
        const box = await wave.boundingBox();
        await page.mouse.click(box.x + box.width * .55, box.y + box.height * .5);
        await shot('jump', '.re-main');
        await page.keyboard.press('Escape');
        const expand = page.locator('.rt-lanestrip .rt-laneauthor').first();
        if (await expand.isVisible()) await expand.click();
        const laneHit = page.locator('.editor-lanehit').first();
        await laneHit.waitFor({ state: 'visible' });
        const b = await laneHit.boundingBox();
        await page.keyboard.down('Shift');
        await page.mouse.move(b.x + b.width * .40, b.y + b.height * .55);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width * .55, b.y + b.height * .55, { steps: 12 });
        await page.mouse.up();
        await page.keyboard.up('Shift');
        await shot('chop', '.re-main');
        // Two name-resolved Tracks form a fresh blank pair; move its incoming row.
        // Writes, if any, target only the lane-app sandbox, never a source asset.
        const secondTitle = process.env.SITE_SECOND_TRACK || 'Body Work VIP';
        one((await get(`tracks/?search=${encodeURIComponent(secondTitle)}`)).items.filter(x => x.title === secondTitle), `Track ${secondTitle}`);
        await page.locator('input.mp-search').fill(secondTitle);
        await page.locator('.mp-row').filter({ hasText: secondTitle }).first().click();
        await page.locator('.mp-panel').getByText('New blank mix', { exact: true }).first().click();
        await page.locator('.rt-wave-row').nth(1).waitFor();
        const popup = page.locator('.rt-jump-popover:visible');
        if (await popup.count()) await popup.first().locator('button').last().click();
        await page.locator('.re-modebar button').filter({ hasText: 'V' }).click();
        const incoming = await page.locator('.rt-wave-row').nth(1).boundingBox();
        await page.mouse.move(incoming.x + incoming.width * .4, incoming.y + incoming.height * .5);
        await page.mouse.down();
        await page.mouse.move(incoming.x + incoming.width * .47, incoming.y + incoming.height * .5, { steps: 14 });
        await page.mouse.up();
        await shot('alignment', '.re-main');
      } else if (mode === 'set') {
        const set = one((await get('sets')).filter(x => x.name === (process.env.SITE_SET || 'relentless groove')), 'named Set');
        await go('library');
        await page.getByText(set.name, { exact: true }).first().click();
        await page.locator('.set-track-row').nth(2).waitFor();
        await page.waitForTimeout(3000);
        await dismiss();
        await shot('set-pins', '.set-header');
        await page.locator('.set-header-transport .set-play').click();
        await page.waitForTimeout(3000);
        await shot('set-playback', '.set-header');
        // Leave no automated playback running after closing the context.
      } else if (mode === 'capture') {
        await go('library');
        await page.getByText('▦ Sessions', { exact: true }).first().click();
        await page.locator('.session-row').first().waitFor();
        const started = process.env.SITE_SESSION_STARTED_AT || '2026-10-06T19:10:26';
        const session = one((await get('sessions')).filter(x => x.started_at === started), `Session started ${started}`);
        await page.evaluate(async uuid => {
          const { requestSessionMoment } = await import('/src/sessions/openSession.ts');
          requestSessionMoment({ sessionUuid: uuid, atS: null });
        }, session.uuid);
        await page.locator('.stl-track-label').first().waitFor();
        await page.locator('.stl-loading').waitFor({ state: 'hidden' });
        await page.waitForTimeout(6000);
        await page.locator('.stl-take-chip').first().click();
        await page.getByRole('button', { name: /Take .*open in editor/ }).first().waitFor();
        await shot('session-timeline', '.session-timeline');
        await go('history');
        await page.waitForFunction(() => {
          const groups = [...document.querySelectorAll('.take-kin-header')];
          return groups.length > 0 && groups.some(el => !/track \d+/i.test(el.textContent || ''));
        }, null, { timeout: 90_000 });
        await page.evaluate(() => {
          const groups = [...document.querySelectorAll('.take-kin-header')];
          const named = groups.find(el => !/track \d+/i.test(el.textContent || ''));
          named.scrollIntoView({ block: 'start' });
        });
        await shot('take-history', '.take-history');
      } else throw Error(`Unknown mode ${mode}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`Real lane-app screenshots: ${output.join(', ')}`);
