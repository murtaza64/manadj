// Capture focused Library/Follow/Sync operations from this lane's running sandbox.
// SITE_APP_URL=http://localhost:<vite> SITE_API_URL=http://localhost:<backend> \
//   node scripts/site/help-library.mjs [tags,filters,follow,performance-sync,analysis-grid,analysis-cue]
// Screenshot bytes are unmodified; actions below change only ephemeral UI state.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lane = await readFile(resolve(root, '../../../LANE.md'), 'utf8');
const ports = lane.match(/^ports:\s*backend (\d+), vite (\d+)\s*$/m);
if (!ports) throw Error('Start the lane app before capturing');
function checkedURL(name, expectedPort) {
  const raw = process.env[name];
  if (!raw) throw Error(`Set ${name} explicitly`);
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== expectedPort || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw Error(`${name} must be a loopback URL for the port assigned in LANE.md`);
  }
  return url.origin;
}
const base = checkedURL('SITE_APP_URL', ports[2]);
const api = checkedURL('SITE_API_URL', ports[1]);
const scenes = process.argv[2]?.split(',') ?? ['tags', 'filters', 'follow', 'performance-sync', 'analysis-grid', 'analysis-cue'];
for (const scene of scenes) if (!['tags', 'filters', 'follow', 'performance-sync', 'analysis-grid', 'analysis-cue'].includes(scene)) throw Error(`Unknown scene: ${scene}`);
const browser = await chromium.launch({ args: ['--mute-audio'] });
try {
  for (const scene of scenes) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, permissions: ['midi', 'midi-sysex'] });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) && (route.request().isNavigationRequest() || url.pathname.startsWith('/api/')) && ![base, api].includes(url.origin)) {
        errors.push(`Non-lane navigation/API blocked: ${url.origin}${url.pathname}`);
        await route.abort();
      } else await route.continue();
    });
    try {
      await page.goto(`${base}/?view=${scene === 'follow' || scene === 'analysis-cue' ? 'performance' : scene === 'performance-sync' ? 'sync' : 'library'}`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        localStorage.setItem('manadj-tour-state', JSON.stringify({ skippedAll: true }));
        sessionStorage.setItem('manadj-midi-boot-reloaded', '1');
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4500);
      const tour = page.getByRole('button', { name: 'Skip all tours' });
      if (await tour.isVisible()) await tour.click();
      if (['tags', 'filters', 'follow', 'analysis-grid', 'analysis-cue'].includes(scene)) {
        // A named Track lookup, never a DB ID. No write to a Track or external source.
        const search = page.locator('input[placeholder="search..."]:visible').first();
        await search.click();
        await search.pressSequentially('Last Time');
        await page.waitForTimeout(1200);
        const row = page.locator('.track-row:visible').filter({ has: page.getByText('Last Time', { exact: true }) }).first();
        await row.waitFor();
        await row.hover();
        const load = row.getByTitle('Load to Deck A');
        if (await load.count()) await load.click();
        else {
          await row.click({ button: 'right' });
          await page.getByText('Load to Deck A', { exact: true }).last().click();
        }
        await page.waitForTimeout(2000);
        await search.fill('');
        await search.blur();
      }
      if (scene === 'tags') {
        await page.locator('.tag-editor-manage-button:visible').first().click();
        await page.waitForTimeout(1000);
      } else if (scene === 'filters') {
        await page.locator('.filter-bar-tag-toggle:visible').first().click();
        const pills = page.locator('button.filter-bar-tag-pill:visible');
        if (await pills.count() < 2) throw Error('Need two actual Tags for ANY/ALL screenshot');
        await pills.nth(0).click();
        await pills.nth(1).click();
        await page.waitForTimeout(700);
      } else if (scene === 'follow') {
        await page.getByTitle(/^Follow Deck A/).first().click();
        await page.getByTitle('Follow parameters').first().click();
        await page.waitForTimeout(800);
      } else if (scene === 'analysis-cue') {
        const cue = page.locator('.perf-deckpanel.deck-a .hot-cue.set:visible').first();
        await cue.waitFor();
        await cue.click({ button: 'right' });
        await page.getByRole('dialog', { name: /^Edit Hot Cue/ }).waitFor();
      } else if (scene !== 'analysis-grid') {
        await page.locator('.uts-root').waitFor({ timeout: 120_000 });
        const expandable = page.locator('.uts-card:visible').first();
        await expandable.waitFor();
        await expandable.click();
        await page.waitForTimeout(800);
      }
      if (errors.length) throw Error(errors.join('; '));
      await page.evaluate(() => document.fonts.ready);
      const target = scene === 'tags' ? page.locator('.modal-content:visible').last()
        : scene === 'follow' ? page.locator('.follow-modal-content:visible')
          : scene === 'performance-sync' ? page.locator('.uts-root:visible')
            : scene === 'analysis-grid' ? page.locator('.tag-editor:visible').first()
              : scene === 'analysis-cue' ? page.locator('.perf-deckpanel.deck-a .hot-cue.set:visible').first()
                : page.locator('.filter-bar-tag-toggle:visible').locator('..').locator('..');
      await target.waitFor();
      let box = await target.boundingBox();
      if (scene === 'analysis-cue') {
        const popup = await page.locator('.hot-cue-editor:visible').boundingBox();
        const tempo = await page.locator('.perf-deckpanel.deck-a .perf-track-tempo:visible').boundingBox();
        if (!popup || !tempo || !box) throw Error(`Missing visible cue editor or grid row: popup=${JSON.stringify(popup)} tempo=${JSON.stringify(tempo)} pads=${JSON.stringify(box)}`);
        const left = Math.min(box.x, popup.x, tempo.x), top = Math.min(box.y, popup.y, tempo.y);
        box = { x: left, y: top,
          width: Math.max(box.x + box.width, popup.x + popup.width, tempo.x + tempo.width) - left,
          height: Math.max(box.y + box.height, popup.y + popup.height, tempo.y + tempo.height) - top };
      }
      if (!box || box.width < 300 || box.height < 50) throw Error(`Unusable ${scene} screenshot bounds ${JSON.stringify(box)}`);
      const clip = {
        x: Math.max(0, Math.floor(box.x - 12)), y: Math.max(0, Math.floor(box.y - 12)),
        width: Math.min(1600 - Math.max(0, Math.floor(box.x - 12)), scene === 'analysis-grid' ? 900 : Math.ceil(box.width + 24)),
        height: Math.min(1000 - Math.max(0, Math.floor(box.y - 12)), Math.ceil(box.height + 24)),
      };
      const unwanted = await page.evaluate(clip => {
        const text = [...document.querySelectorAll('body *')].filter(el => el.children.length === 0 && el.checkVisibility()).filter(el => {
          const r = el.getBoundingClientRect();
          return r.right > clip.x && r.left < clip.x + clip.width && r.bottom > clip.y && r.top < clip.y + clip.height;
        }).map(el => el.textContent.trim());
        return text.filter(t => /like a bitch|fcukers|hello world|^test$|\bLoading(?:…|\.\.\.)|^Track #?\d+$/i.test(t));
      }, clip);
      if (unwanted.length) throw Error(`Unwanted visible text in ${scene}: ${unwanted.join(', ')}`);
      const png = await page.screenshot({ clip, animations: 'disabled' });
      const output = resolve(root, 'site/shots', `help-library-${scene}.webp`);
      const conversion = spawnSync('uv', ['run', '--no-project', '--with', 'pillow', 'python', '-c',
        'from PIL import Image; import io,sys; Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB").save(sys.argv[1], "WEBP", quality=80, method=6)', output],
      { cwd: root, input: png, stdio: ['pipe', 'inherit', 'inherit'] });
      if (conversion.error || conversion.status !== 0) throw conversion.error ?? Error(`Conversion exited ${conversion.status}`);
      console.log(`${scene}: ${output} (${clip.width * 2}×${clip.height * 2})`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
