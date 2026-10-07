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
    const pendingData = new Set();
    let lastDataActivity = Date.now();
    page.on('request', (request) => {
      if (request.method() === 'GET' && /^\/api\/(tracks|waveforms|beatgrids|metric-ladders|hotcues|sessions|sets|routines|transitions|takes)(\/|$)/.test(new URL(request.url()).pathname)) {
        pendingData.add(request);
        lastDataActivity = Date.now();
      }
    });
    const dataFinished = (request) => {
      if (pendingData.delete(request)) lastDataActivity = Date.now();
    };
    page.on('requestfinished', dataFinished);
    page.on('requestfailed', dataFinished);
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
    async function dismissGuides() {
      for (let i = 0; i < 8; i++) {
        const tour = page.locator('.tour-overlay:visible');
        const skip = tour.getByRole('button', { name: 'Skip all tours', exact: true });
        const close = tour.getByRole('button', { name: 'Close', exact: true });
        const tutorial = page.getByRole('button', { name: 'Skip tutorial', exact: true });
        if (await skip.isVisible()) await skip.click();
        else if (await close.isVisible()) await close.click();
        else if (await tutorial.isVisible()) await tutorial.click();
        else break;
        await wait(500);
      }
      if (await page.locator('.tour-overlay:visible').count()) throw Error('Tour still visible');
    }
    async function dataReady() {
      const deadline = Date.now() + 180_000;
      while (pendingData.size || Date.now() - lastDataActivity < 1500) {
        if (Date.now() > deadline) throw Error(`Data still pending: ${[...pendingData].map((r) => new URL(r.url()).pathname).join(', ')}`);
        await wait(250);
      }
      await dismissGuides();
    }
    async function paintedCanvases(selector, minimum) {
      // Read real 2D pixels, not just mounted canvas elements. No pixel changes.
      await page.waitForFunction(({ selector, minimum }) => {
        let painted = 0;
        for (const canvas of document.querySelectorAll(selector)) {
          const rect = canvas.getBoundingClientRect();
          if (!canvas.checkVisibility() || rect.width < 20 || rect.height < 10 || rect.right <= 0 || rect.left >= innerWidth || rect.bottom <= 0 || rect.top >= innerHeight) continue;
          const ctx = canvas.getContext('2d');
          if (!ctx || !canvas.width || !canvas.height) continue;
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let colored = 0;
          for (let i = 0; i < data.length; i += 64) {
            if (data[i + 3] > 80 && Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 50) colored++;
          }
          if (colored > 30) painted++;
        }
        return painted >= minimum;
      }, { selector, minimum }, { timeout: 180_000, polling: 1000 });
    }
    async function go(view, extra = '') {
      await page.goto(`${base}/?view=${view}${extra}`, { waitUntil: 'domcontentloaded' });
      await wait(2500);
      await dismissGuides();
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
      // Initial library hydration can outlast the search debounce.
      await row.waitFor({ state: 'visible', timeout: 60_000 });
      if (await row.count() !== 1) throw Error(`Expected one visible track titled ${title}`);
      await row.hover();
      const button = row.getByTitle(`Load to Deck ${deck}`, { exact: true });
      if (await button.count()) await button.click();
      else {
        await row.click({ button: 'right' });
        await page.getByText(`Load to Deck ${deck}`, { exact: true }).click();
      }
      await wait(2000);
      await dismissGuides();
      const panel = page.locator(`.perf-deckpanel.deck-${deck.toLowerCase()}:visible`);
      if (await panel.count()) {
        await dataReady();
        // Minimap is WebGL; its loading/error branches do not mount this canvas.
        await panel.locator('.minimap-canvas').waitFor({ timeout: 180_000 });
        await panel.locator('.minimap-loading').waitFor({ state: 'hidden', timeout: 180_000 });
      }
    }
    async function shot(name) {
      await dataReady();
      const [x, y, width, height] = crops[name];
      let clip = { x, y, width, height };
      // Include the current topbar and complete panels/rows, not a stale fixed cut.
      if (name === 'perform' || name === 'sync') {
        const content = page.locator(name === 'perform' ? '.perf-decks' : '.uts-group').first();
        const bounds = await content.boundingBox();
        if (!bounds) throw Error(`No visible ${name} content to crop`);
        const bottom = Math.ceil(bounds.y + bounds.height);
        if (bottom > page.viewportSize().height) throw Error(`${name} content exceeds viewport`);
        clip = { x: 0, y: 0, width: page.viewportSize().width, height: bottom };
      }
      if (['follow', 'set', 'session', 'editor', 'routine'].includes(name)) {
        clip = await page.evaluate((name) => {
          const rect = (selector) => {
            const el = document.querySelector(selector);
            if (!el) throw Error(`Missing crop anchor ${selector}`);
            return el.getBoundingClientRect();
          };
          let top, bottom, left, right;
          if (name === 'session') {
            const pane = rect('.session-timeline'), stage = rect('.stl-stage');
            top = pane.top; bottom = stage.bottom; left = pane.left; right = pane.right;
          } else if (name === 'editor' || name === 'routine') {
            const header = rect('.re-header'), main = rect('.re-main');
            top = header.top; bottom = main.bottom; left = main.left; right = main.right;
          } else {
            const anchor = rect(name === 'set' ? '.set-header' : '.perf-decks');
            const rows = [...document.querySelectorAll(name === 'set' ? '.set-track-row' : '.track-row')]
              .map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0 && r.top >= anchor.bottom && r.bottom <= innerHeight);
            if (rows.length < 3) throw Error(`Not enough complete ${name} rows`);
            top = anchor.top; bottom = Math.max(...rows.map((r) => r.bottom)); left = anchor.left; right = anchor.right;
          }
          return { x: Math.floor(left), y: Math.floor(top), width: Math.floor(right) - Math.floor(left), height: Math.floor(bottom) - Math.floor(top) };
        }, name);
      }
      await page.mouse.move(1599, 999);
      await page.evaluate(() => document.fonts.ready);
      await wait(500);
      await dismissGuides();
      if (await page.locator('.tour-overlay:visible').count()) throw Error('Refusing capture with visible Tour');
      if (errors.length) throw Error(errors.join('\n'));
      // Audit only text actually intersecting the crop, including scroll clipping.
      // This reads the DOM; it never removes/relabels content or masks pixels.
      const unwanted = await page.evaluate((clip) => {
        const found = new Set();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node; (node = walker.nextNode());) {
          if (!/like a bitch|fcukers|hello world|^test$|\bLoading(?:…|\.{3}|\b)|^Track #?\d+$|^#\d{3,}$/i.test(node.textContent.trim())) continue;
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
      console.log(`${check ? 'Checked' : 'Captured'} ${name}: ${clip.width * 2}×${clip.height * 2}, crop ${JSON.stringify(clip)}`);
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
        await page.waitForFunction(() => {
          const waves = [...document.querySelectorAll('.perf-wave-row')];
          return waves.length === 4 && waves.every((row) => row.querySelector('canvas') && !row.textContent.includes('No track loaded'));
        });
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
        await page.getByRole('button', { name: '2 DECKS', exact: true }).click();
        await load('Last Time', 'A');
        await load(weeble, 'B');
        await search('');
        await followOff();
        await page.locator('button[title^="Follow Deck A"]:visible').first().click();
        await page.locator('.filter-bar-follow-btn[aria-pressed="true"]:visible').first().waitFor();
        await page.getByTitle('Follow parameters', { exact: true }).click();
        await page.getByRole('checkbox', { name: /Known only/ }).uncheck();
        await page.locator('.follow-modal-content').getByRole('button', { name: 'Close', exact: true }).click();
        await page.getByRole('slider', { name: 'Compatible temperature', exact: true }).waitFor({ timeout: 180_000 });
        await dataReady();
        await page.waitForFunction(() => document.querySelectorAll('.track-row').length >= 8, null, { timeout: 180_000 });
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
        await dismissGuides();
        await page.locator('.rt-slotpanel').nth(1).waitFor({ timeout: 180_000 });
        await dataReady();
        await paintedCanvases('.rt-wave-row > canvas', 2);
        await shot(scene);
      } else if (scene === 'set') {
        const name = process.env.SITE_SET || 'relentless groove';
        const set = one((await get('sets')).filter((row) => row.name === name), `Set named ${name}`);
        await go('library');
        await page.getByText(set.name, { exact: true }).first().click();
        await page.locator('.set-header-transport:visible').waitFor();
        await dismissGuides();
        const showTimeline = page.getByTitle('Show the set timeline', { exact: true });
        if (await showTimeline.isVisible()) await showTimeline.click();
        await page.waitForFunction(() => {
          const rows = [...document.querySelectorAll('.set-track-row')];
          return rows.length > 2 && rows.every((row) => !/\bTrack #?\d+\b/.test(row.textContent));
        }, null, { timeout: 180_000 });
        await dataReady();
        await paintedCanvases('.set-header + div canvas', 2);
        await shot(scene);
      } else if (scene === 'session' || scene === 'sessions-list') {
        await sessionsList();
        if (scene === 'sessions-list') await shot(scene);
        if (scene === 'session') {
          const startedAt = process.env.SITE_SESSION_STARTED_AT || '2026-10-06T19:10:26';
          const session = one((await get('sessions')).filter((row) => row.started_at === startedAt), `Session started ${startedAt}`);
          await page.evaluate(async (uuid) => {
            const { requestSessionMoment } = await import('/src/sessions/openSession.ts');
            requestSessionMoment({ sessionUuid: uuid, atS: null });
          }, session.uuid);
          await dismissGuides();
          await page.locator('.stl-track-label').first().waitFor({ timeout: 180_000 });
          await page.locator('.stl-loading').waitFor({ state: 'hidden', timeout: 180_000 });
          await dataReady();
          await page.waitForFunction(() => {
            const timeline = document.querySelector('.session-timeline');
            const labels = [...(timeline?.querySelectorAll('.stl-track-label') ?? [])];
            // SVG tooltips contain issue references such as (#140), not placeholders.
            return timeline && !timeline.querySelector('.stl-loading, .stl-error') && labels.length > 1
              && labels.every((label) => label.textContent.trim() && !/^(?:Track\s+)?#?\d+$/.test(label.textContent.trim()))
              && timeline.querySelectorAll('.stl-load-bar').length > 1;
          }, null, { timeout: 180_000 });
          await paintedCanvases('.stl-canvas', 1);
          await shot(scene);
        }
      } else if (scene === 'sync' || scene === 'acquisition') {
        await go('sync');
        if (scene === 'sync') {
          // Require real results: a vanished spinner can also mean an error.
          await page.locator('.uts-root').waitFor({ timeout: 120_000 });
          await page.locator('.uts-group .uts-card').first().waitFor();
          await shot('sync');
        } else await acquisition();
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
