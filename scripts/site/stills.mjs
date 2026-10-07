// Real sandbox stills. Requires the URLs assigned in ../../../LANE.md.
// SITE_APP_URL=http://localhost:<vite> SITE_API_URL=http://localhost:<backend> \
//   node scripts/site/stills.mjs [scene,scene,... | all] [--check]
// Default: library,follow,routine,acquisition,editor. --check renders without writing.
// Outputs site/shots/<scene>.webp; PNG bytes go directly to Pillow over stdin.
// Selectors: SITE_SET, SITE_TRANSITION + SITE_TRANSITION_INCOMING,
// SITE_ROUTINE (named), or SITE_ROUTINE_START + SITE_ROUTINE_SIZE (unnamed),
// SITE_SESSION_STARTED_AT (Sessions have timestamps, not names).
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const weeble = "Weeble Wobble VIP - Circadian's VIP Of The VIP";
const crops = {
  perform: [0, 0, 1600, 680],
  library: [0, 0, 1600, 760],
  follow: [0, 288, 1600, 712],
  // The unrelated artifact picker is outside these editor crops.
  routine: [0, 40, 1296, 640],
  editor: [0, 40, 1296, 672],
  set: [200, 256, 1400, 744],
  'sessions-list': [200, 168, 1400, 600],
  session: [200, 168, 1400, 440],
  sync: [0, 32, 1600, 568],
  acquisition: [0, 32, 1440, 608],
  history: [0, 32, 1600, 568],
  settings: [0, 0, 1600, 810],
  'settings-beat-fx': [0, 0, 1600, 810],
  'settings-waveforms': [0, 0, 1600, 810],
  'settings-jog-calibration': [0, 0, 1600, 810],
  waveforms: [0, 0, 1600, 810],
};
const originals = ['perform', 'library', 'follow', 'routine', 'set', 'session', 'sync', 'history', 'settings', 'editor'];
const supported = Object.keys(crops);
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: stills.mjs [scene,scene,... | all] [--check]\nScenes: ' + supported.join(', '));
  process.exit(0);
}
const check = args.includes('--check');
const positional = args.filter((arg) => arg !== '--check');
if (positional.length > 1) throw Error('Expected one comma-separated scene list and optional --check');
const scenes = positional[0] === 'all' ? originals : (positional[0] || 'library,follow,routine,acquisition,editor').split(',');
for (const scene of scenes) {
  if (!supported.includes(scene)) throw Error(`Unknown scene ${JSON.stringify(scene)}; use ${supported.join(', ')}`);
}

// Validate before launching Chromium or making any API request. No real-app defaults.
const lane = await readFile(resolve(root, '../../../LANE.md'), 'utf8');
const ports = lane.match(/^ports:\s*backend (\d+), vite (\d+)\s*$/m);
if (!ports) throw Error('LANE.md must declare backend and vite ports');
function laneURL(value, port, variable) {
  if (!value) throw Error(`Supply ${variable}; capture has no default app URL`);
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)
      || url.port !== port || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash) {
    throw Error(`${variable} refuses non-lane URL ${value}; expected loopback port ${port}`);
  }
  return url.origin;
}
const base = laneURL(process.env.SITE_APP_URL, ports[2], 'SITE_APP_URL');
const api = laneURL(process.env.SITE_API_URL, ports[1], 'SITE_API_URL');
const get = async (path) => {
  const response = await fetch(`${api}/api/${path}`, {
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  }).catch((error) => { throw Error(`${path}: ${error.message} (${error.cause?.message || 'no response'})`); });
  if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
  return response.json();
};
function one(rows, description) {
  if (rows.length !== 1) throw Error(`Expected one ${description}; found ${rows.length}`);
  return rows[0];
}
async function transition() {
  const name = process.env.SITE_TRANSITION || 'second drop double';
  const incoming = process.env.SITE_TRANSITION_INCOMING || 'Last Time';
  const candidates = (await get('transitions')).filter((row) => row.name === name);
  const matches = [];
  for (const row of candidates) {
    if ((await get(`tracks/${row.b_track_id}`)).title === incoming) matches.push(row);
  }
  return one(matches, `Transition ${JSON.stringify(name)} into ${JSON.stringify(incoming)}`);
}
async function routine() {
  const rows = await get('routines');
  if (process.env.SITE_ROUTINE) {
    return one(rows.filter((row) => row.name === process.env.SITE_ROUTINE), `Routine named ${process.env.SITE_ROUTINE}`);
  }
  const start = process.env.SITE_ROUTINE_START || 'Runaway Train';
  const size = Number(process.env.SITE_ROUTINE_SIZE || 7);
  const matches = [];
  for (const row of rows.filter((row) => !row.name && row.cast.length === size)) {
    // Cast references come from the API; no captured database IDs in the spec.
    const cast = await Promise.all(row.cast.map((id) => get(`tracks/${id}`)));
    if (cast[0].title === start) matches.push(row);
  }
  return one(matches, `unnamed ${size}-track Routine starting with ${JSON.stringify(start)}`);
}
async function requireRenames() {
  const [sets, transitions] = await Promise.all([get('sets'), get('transitions')]);
  if (sets.some((row) => row.name === 'test') || transitions.some((row) => row.name === 'hello world')) {
    throw Error('Waiting for sandbox renames: Set "test" and Transition "hello world"');
  }
}

const browser = await chromium.launch({ args: [
  '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist',
] });
const completed = [];
const failures = [];
try {
  for (const scene of scenes) {
    // Isolate saved searches, deck state and selection between scenes.
    const context = await browser.newContext({
      viewport: scene === 'acquisition' ? { width: 1440, height: 640 } : { width: 1600, height: 1000 },
      deviceScaleFactor: 2, permissions: ['midi', 'midi-sysex'],
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Refuse accidental redirects or a frontend configured against another local backend.
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) &&
          (route.request().isNavigationRequest() || url.pathname.startsWith('/api/')) &&
          ![base, api].includes(url.origin)) {
        errors.push(`Non-lane request refused: ${url.origin}${url.pathname}`);
        await route.abort();
      } else await route.continue();
    });
    const wait = (ms) => page.waitForTimeout(ms);
    async function go(view, extra = '') {
      await page.goto(`${base}/?view=${view}${extra}`, { waitUntil: 'networkidle' });
      await wait(2500);
      for (let i = 0; i < 4; i++) {
        const skip = page.getByRole('button', { name: /^(Skip all|Skip tour|Skip)$/ }).first();
        if (!await skip.isVisible()) break;
        await skip.click();
        await wait(300);
      }
      await page.keyboard.press('Escape');
    }
    async function search(query) {
      const box = page.locator('input[placeholder^="search"]:visible').first();
      await box.fill(query);
      await box.blur();
      await wait(1200);
    }
    async function followOff() {
      const on = page.locator('.filter-bar-follow-btn[aria-pressed="true"]:visible:enabled');
      for (let i = 0; i < 4 && await on.count(); i++) {
        await on.first().click();
        await wait(400);
      }
      if (await on.count()) throw Error('Could not turn Follow off');
    }
    async function load(title, deck) {
      const result = await get(`tracks/?search=${encodeURIComponent(title)}`);
      const track = one(result.items.filter((row) => row.title === title), `Track titled ${title}`);
      await followOff();
      await search(track.title);
      const row = page.locator('.track-row:visible').filter({ has: page.getByText(track.title, { exact: true }) });
      if (await row.count() !== 1) throw Error(`Expected one visible track titled ${title}`);
      await row.hover();
      const button = row.getByTitle(`Load to Deck ${deck}`, { exact: true });
      if (await button.count()) await button.click();
      else {
        await row.click({ button: 'right' });
        await page.getByText(`Load to Deck ${deck}`, { exact: true }).click();
      }
      await wait(2000);
    }
    async function shot(name) {
      const [x, y, width, height] = crops[name];
      const clip = { x, y, width, height };
      await page.mouse.move(1599, 999);
      await page.evaluate(() => document.fonts.ready);
      await wait(500);
      if (errors.length) throw Error(errors.join('\n'));
      // Audit only text actually intersecting the crop, including scroll clipping.
      // This reads the DOM; it never removes/relabels content or masks pixels.
      const unwanted = await page.evaluate((clip) => {
        const found = new Set();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node; (node = walker.nextNode());) {
          if (!/like a bitch|fcukers|hello world|^test$/i.test(node.textContent.trim())) continue;
          const parent = node.parentElement;
          if (!parent?.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            const left = Math.max(rect.left, clip.x), right = Math.min(rect.right, clip.x + clip.width);
            const top = Math.max(rect.top, clip.y), bottom = Math.min(rect.bottom, clip.y + clip.height);
            if (right <= left || bottom <= top) continue;
            const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
            if (hit && (parent.contains(hit) || hit.contains(parent))) found.add(node.textContent.trim());
          }
        }
        return [...found];
      }, clip);
      if (unwanted.length) throw Error(`Unwanted text inside ${name} crop: ${unwanted.join(', ')}`);
      const png = await page.screenshot({ clip, type: 'png', animations: 'disabled' });
      if (!check) {
        const output = resolve(root, 'site/shots', `${name}.webp`);
        const result = spawnSync('uv', ['run', '--no-project', '--with', 'pillow', 'python', '-c',
          'from PIL import Image; import io, sys; Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB").save(sys.argv[1], "WEBP", quality=80, method=6)',
          output], { cwd: root, input: png, stdio: ['pipe', 'inherit', 'inherit'] });
        if (result.error || result.status !== 0) throw result.error || Error(`Pillow conversion failed: ${result.status}`);
      }
      completed.push(name);
      console.log(`${check ? 'Checked' : 'Captured'} ${name}: ${width * 2}×${height * 2}, crop ${JSON.stringify(clip)}`);
    }
    async function sessionsList() {
      await go('library');
      await page.getByText('▦ Sessions', { exact: true }).first().click();
      await page.locator('.session-row:visible').first().waitFor();
      await wait(2500);
    }
    async function acquisition() {
      await page.setViewportSize({ width: 1440, height: 640 });
      await page.getByRole('button', { name: 'Acquisition', exact: true }).click();
      const row = page.locator('.acquisition-list-row').filter({ has: page.getByText('Siren (feat. Cameron Hayes)', { exact: true }) });
      await row.waitFor();
      // A real scroll keeps artist metadata intact and puts the preceding row offscreen.
      await row.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await wait(1000);
      await shot('acquisition');
    }
    async function settingsTab(label, name) {
      await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
      await wait(1500);
      await shot(name);
    }
    try {
      if (['library', 'follow', 'editor'].includes(scene)) await requireRenames();
      if (scene === 'perform') {
        await go('performance');
        await page.getByRole('button', { name: '4 DECKS', exact: true }).click();
        for (const [title, deck] of [['Last Time', 'A'], ['Body Work VIP', 'B'], [weeble, 'C'], ['Calling For A Sign', 'D']]) await load(title, deck);
        await search('');
        await wait(4000);
        await shot(scene);
      } else if (scene === 'library') {
        await go('library');
        await load('Last Time', 'A');
        await search('Circadian');
        await page.locator('.track-row:visible').filter({ has: page.getByText(weeble, { exact: true }) }).click();
        await wait(2500);
        await shot(scene);
      } else if (scene === 'follow') {
        await go('performance');
        await load('Last Time', 'A');
        await load(weeble, 'B');
        await search('');
        await page.locator('button[title^="Follow Deck A"]:visible').first().click();
        await page.locator('.filter-bar-follow-btn[aria-pressed="true"]:visible').first().waitFor();
        await wait(3000);
        await shot(scene);
      } else if (scene === 'routine' || scene === 'editor') {
        const artifact = scene === 'routine' ? await routine() : await transition();
        console.log(`Resolved ${scene}: ${artifact.name || `${artifact.cast.length}-track Routine`}, ${artifact.uuid}`);
        await go('routine');
        await page.evaluate(async ({ artifact, scene }) => {
          const { requestMixEdit } = await import('/src/routines/openMix.ts');
          requestMixEdit({ open: scene === 'routine'
            ? { kind: 'routine', uuid: artifact.uuid }
            : { kind: 'transition', uuid: artifact.uuid, aTrackId: artifact.a_track_id, bTrackId: artifact.b_track_id } });
        }, { artifact, scene });
        await page.locator('.re-transport:visible').waitFor();
        await wait(6000);
        await shot(scene);
      } else if (scene === 'set') {
        const name = process.env.SITE_SET || 'relentless groove';
        const set = one((await get('sets')).filter((row) => row.name === name), `Set named ${name}`);
        await go('library');
        await page.getByText(set.name, { exact: true }).first().click();
        await page.locator('.set-header-transport:visible').waitFor();
        await wait(5000);
        await shot(scene);
      } else if (scene === 'session' || scene === 'sessions-list') {
        await sessionsList();
        await shot('sessions-list');
        if (scene === 'session') {
          const startedAt = process.env.SITE_SESSION_STARTED_AT || '2026-10-06T19:10:26';
          const session = one((await get('sessions')).filter((row) => row.started_at === startedAt), `Session started ${startedAt}`);
          await page.evaluate(async (uuid) => {
            const { requestSessionMoment } = await import('/src/sessions/openSession.ts');
            requestSessionMoment({ sessionUuid: uuid, atS: null });
          }, session.uuid);
          await wait(8000);
          await page.waitForFunction(() => !/#\d{3,}/.test(document.body.innerText), null, { timeout: 30_000 });
          await shot(scene);
        }
      } else if (scene === 'sync' || scene === 'acquisition') {
        await go('sync');
        if (scene === 'sync') {
          await page.getByText('Computing sync status…', { exact: true }).waitFor({ state: 'hidden', timeout: 60_000 });
          await shot('sync');
        }
        await acquisition();
      } else if (scene === 'history') {
        await go('history');
        await shot(scene);
      } else {
        await go('library', '&settings=1');
        if (scene === 'settings') {
          await shot(scene);
          for (const [label, name] of [['Beat FX', 'settings-beat-fx'], ['Waveforms', 'settings-waveforms'], ['Jog calibration', 'settings-jog-calibration']]) await settingsTab(label, name);
        } else {
          const label = { 'settings-beat-fx': 'Beat FX', 'settings-waveforms': 'Waveforms', waveforms: 'Waveforms', 'settings-jog-calibration': 'Jog calibration' }[scene];
          await settingsTab(label, scene);
        }
      }
    } catch (error) {
      failures.push(scene);
      console.error(`FAILED ${scene}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`Completed: ${completed.join(', ') || 'none'}. Incomplete: ${failures.join(', ') || 'none'}.`);
if (failures.length) process.exitCode = 1;
