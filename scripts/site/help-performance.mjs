// Capture actual operation states from this lane's sandbox app. No real-DB URL.
// SITE_APP_URL=http://127.0.0.1:<vite> SITE_API_URL=http://127.0.0.1:<backend> \
//   node scripts/site/help-performance.mjs [--check]
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const record = await readFile(resolve(root, '../../../LANE.md'), 'utf8');
const ports = record.match(/^ports:\s*backend (\d+), vite (\d+)\s*$/m);
if (!ports) throw Error('Start this lane app first (LANE.md has no ports)');
function localURL(name, expected) {
  const value = process.env[name];
  if (!value) throw Error(`Set ${name} to the lane_app.py status URL`);
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.port !== expected || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw Error(`${name} must use this lane's loopback port ${expected}`);
  }
  return url.origin;
}
const app = localURL('SITE_APP_URL', ports[2]);
const api = localURL('SITE_API_URL', ports[1]);
const check = process.argv.slice(2).includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw Error('Only --check is supported');
const title = process.env.SITE_PERFORM_TRACK || 'Last Time';
const result = await fetch(`${api}/api/tracks/?search=${encodeURIComponent(title)}`, { redirect: 'error' });
if (!result.ok) throw Error(`Sandbox track lookup: ${result.status}`);
const matches = (await result.json()).items.filter(t => t.title === title);
if (matches.length !== 1) throw Error(`Expected exactly one sandbox Track named ${JSON.stringify(title)}; got ${matches.length}`);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2,
    permissions: ['midi', 'midi-sysex'] });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol)
        && (route.request().isNavigationRequest() || url.pathname.startsWith('/api/'))
        && ![app, api, api.replace('127.0.0.1', 'localhost'), api.replace('localhost', '127.0.0.1')].includes(url.origin)) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('manadj-tour-state', JSON.stringify({ skippedAll: true }));
    sessionStorage.setItem('manadj-midi-boot-reloaded', '1');
  });
  await page.goto(`${app}/?view=performance`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 8; i++) {
    const skip = page.getByRole('button', { name: /^(Skip all tours|Skip tour|Skip tutorial|Skip)$/ }).first();
    if (!await skip.isVisible()) break;
    await skip.click();
  }
  // This sandbox clone can retain an unavailable controller from the real
  // Library's saved routing; reset only the sandbox preference for clear captures.
  const buses = page.locator('.topbar-routing select');
  await buses.nth(0).selectOption(''); // System default
  await buses.nth(1).selectOption(''); // Cue off, not a phantom output
  await page.getByRole('button', { name: '2 DECKS', exact: true }).click();
  const search = page.locator('.filter-bar-search:visible').first();
  await search.click();
  await search.pressSequentially(title, { delay: 45 });
  await search.blur();
  const row = page.locator('.track-row:visible').filter({ has: page.getByText(title, { exact: true }) });
  await row.waitFor({ timeout: 120000 });
  if (await row.count() !== 1) throw Error(`Expected one visible row for ${title}`);
  await row.hover();
  // Capture the selected searchable row while the hover-only Load button is visible.
  // The app can change the list to Follow candidates once a Deck is loaded.
  await shot('perform-browser-load', ['.filter-bar-search:visible', '.track-row:visible']);
  await row.getByTitle('Load to Deck A', { exact: true }).click();
  await page.locator('.perf-deckpanel.deck-a .minimap-canvas').waitFor({ timeout: 180000 });
  await page.locator('.perf-deckpanel.deck-a .minimap-loading').waitFor({ state: 'hidden', timeout: 180000 });
  await page.keyboard.press('Escape');
  if (await page.locator('.perf-root.kbd-hints-off').count()) await page.getByRole('button', { name: 'KBD', exact: true }).click();

  async function shot(name, selectors) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    if (errors.length) throw Error(errors.join('\n'));
    const bounds = await page.evaluate((selectors) => {
      const rects = selectors.map(selector => {
        const el = [...document.querySelectorAll(selector.replace(':visible', ''))].find(el => el.checkVisibility());
        if (!el || !el.checkVisibility()) throw Error(`No visible capture target ${selector}`);
        return el.getBoundingClientRect();
      });
      const x = Math.max(0, Math.floor(Math.min(...rects.map(r => r.left)) - 12));
      const y = Math.max(0, Math.floor(Math.min(...rects.map(r => r.top)) - 12));
      const right = Math.min(innerWidth, Math.ceil(Math.max(...rects.map(r => r.right)) + 12));
      const bottom = Math.min(innerHeight, Math.ceil(Math.max(...rects.map(r => r.bottom)) + 12));
      return { x, y, width: right - x, height: bottom - y };
    }, selectors);
    if (bounds.width < 100 || bounds.height < 40) throw Error(`${name}: invalid capture bounds`);
    const png = await page.screenshot({ clip: bounds, animations: 'disabled' });
    if (!check) {
      const output = resolve(root, 'site/shots', `help-${name}.webp`);
      const converted = spawnSync('uv', ['run', '--no-project', '--with', 'pillow', 'python', '-c',
        'from PIL import Image; import io, sys; Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB").save(sys.argv[1], "WEBP", quality=82, method=6)',
        output], { cwd: root, input: png, stdio: ['pipe', 'inherit', 'inherit'] });
      if (converted.error || converted.status !== 0) throw converted.error || Error(`Pillow failed for ${name}`);
    }
    console.log(`${check ? 'Checked' : 'Captured'} help-${name}.webp (${bounds.width}×${bounds.height} CSS px)`);
  }

  // Deck with actual loaded waveform, cue/play/jump/loop and on-control keyboard hints.
  await shot('perform-deck-controls', ['.perf-deckpanel.deck-a']);
  await search.fill('');
  await search.blur();
  // One shared Beat FX section: select a real effect and target B; no audio playback required.
  await page.getByRole('group', { name: 'Beat FX' }).getByRole('combobox', { name: 'Beat FX effect' }).selectOption('flanger');
  await page.getByRole('group', { name: 'Beat FX target' }).getByRole('button', { name: 'Beat FX target B', exact: true }).click();
  await shot('beat-fx-target-length', ['.perf-fx-row']);
  // Both output selectors and headphone blend; no device choice is changed.
  await shot('audio-routing-cue', ['.topbar-routing']);
  // Controller check in Settings describes connection with no phantom device.
  await page.goto(`${app}/?view=library&settings=1`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Controllers/ }).click();
  await page.getByTestId('controller-check-status').waitFor();
  await shot('controller-check', ['.settings-content']);
  await context.close();
} finally {
  await browser.close();
}
