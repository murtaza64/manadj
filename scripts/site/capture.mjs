// Real lane-app capture, not mocks. See site/README.md.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = process.env.SITE_APP_URL;
const api = process.env.SITE_API_URL;
const scenes = (process.argv[2] || 'perform,set,editor').split(',');
const raw = resolve(root, '.lane-tmp/site-capture');
const media = resolve(root, 'site/media');
const shots = resolve(root, 'site/shots');
const lane = await readFile(resolve(root, '../../../LANE.md'), 'utf8');
const ports = lane.match(/ports: backend (\d+), vite (\d+)/);
if (!ports || !base || !api) throw Error('Set SITE_APP_URL and SITE_API_URL to lane_app.py status URLs.');
for (const [url, port] of [[base, ports[2]], [api, ports[1]]]) {
  const u = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(u.hostname) || u.port !== port) {
    throw Error(`Capture refuses non-lane URL: ${url}`);
  }
}
await mkdir(raw, { recursive: true });
await mkdir(media, { recursive: true });
const get = async (path) => {
  const res = await fetch(`${api}/api/${path}`);
  if (!res.ok) throw Error(`${path}: ${res.status}`);
  return res.json();
};
const unique = (rows, name) => {
  const matches = rows.filter((r) => r.name === name);
  if (matches.length !== 1) throw Error(`Expected one artifact named ${JSON.stringify(name)}; found ${matches.length}`);
  return matches[0];
};
const browser = await chromium.launch({ args: [
  '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist',
] });
const manifest = { capturedAt: new Date().toISOString(), source: 'real lane app / sandbox Library', scenes: [] };
try {
  for (const scene of scenes) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
      permissions: ['midi', 'midi-sysex'],
      recordVideo: { dir: raw, size: { width: 1440, height: 900 } },
    });
    const page = await ctx.newPage();
    const epoch = Date.now();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const wait = (ms) => page.waitForTimeout(ms);
    const shot = (name) => page.screenshot({ path: `${raw}/${name}.png` });
    async function go(view) {
      await page.goto(`${base}/?view=${view}`, { waitUntil: 'networkidle' });
      await wait(2500);
      for (let i = 0; i < 4; i++) {
        const skip = page.getByRole('button', { name: /^(Skip all|Skip tour|Skip)$/ }).first();
        if (!await skip.isVisible()) break;
        await skip.click();
        await wait(300);
      }
      await page.keyboard.press('Escape');
      // Use available output routes, not a saved controller absent here.
      for (const select of await page.locator('select').all()) {
        const options = await select.locator('option').allTextContents();
        if (options.includes('System default')) await select.selectOption({ label: 'System default' });
        else if (options.includes('Off')) await select.selectOption({ label: 'Off' });
      }
    }
    async function search(q) {
      const box = page.locator('input[placeholder^="search"]:visible').first();
      await box.fill(q);
      await wait(900);
    }
    async function load(q, deck) {
      await search(q);
      const row = page.locator('.track-row:visible').filter({ hasText: q }).first();
      await row.hover();
      await row.getByTitle(`Load to Deck ${deck}`, { exact: true }).click();
      await wait(2000);
    }
    let start;
    let duration;
    let description;
    try {
      if (scene === 'perform') {
        await go('performance');
        const follow = page.locator('.filter-bar-follow-btn[aria-pressed="true"]:visible:enabled');
        while (await follow.count()) await follow.first().click();
        await load(process.env.SITE_LEFT_TRACK || 'Last Time', 'A');
        while (await follow.count()) await follow.first().click();
        await load(process.env.SITE_RIGHT_TRACK || 'Body Work VIP', 'B');
        await search('Circadian');
        await page.locator('input[placeholder^="search"]:visible').first().blur();
        await page.getByRole('button', { name: '2 DECKS', exact: true }).click();
        const hints = page.getByRole('button', { name: 'KBD', exact: true });
        if (await page.locator('.perf-root.kbd-hints-off').count()) await hints.click();
        await page.locator('.perf-deckpanel.deck-a .player-button-cue').click();
        start = (Date.now() - epoch) / 1000;
        await wait(600);
        await page.keyboard.press('d');
        await page.keyboard.press('k');
        await wait(2000);
        if (await page.locator('.perf-root[data-view-active="true"] .player-button-playing').count() < 2) {
          throw Error('Both Decks must actually be playing');
        }
        await wait(2000);
        // Actual on-screen gestures. Pointer-lock keyboard sweeps are not
        // simulated: Chromium may reject them in an automated window.
        const knob = await page.locator('.perf-deckpanel.deck-a .perf-knob-filter .perf-knob-dial').boundingBox();
        const x = knob.x + knob.width / 2, y = knob.y + knob.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let i = 1; i <= 35; i++) { await page.mouse.move(x, y - i * 2); await wait(40); }
        await wait(600);
        for (let i = 34; i >= 0; i--) { await page.mouse.move(x, y - i * 2); await wait(40); }
        await page.mouse.up();
        const fader = await page.locator('.perf-deckpanel.deck-b .perf-fader[title^="Channel volume:"]').boundingBox();
        await page.mouse.move(fader.x + fader.width * .85, fader.y + fader.height / 2);
        await page.mouse.down();
        for (let i = 0; i <= 30; i++) {
          await page.mouse.move(fader.x + fader.width * (.85 - i / 60), fader.y + fader.height / 2);
          await wait(40);
        }
        await page.mouse.up();
        await wait(700);
        await page.mouse.move(fader.x + fader.width * .35, fader.y + fader.height / 2);
        await page.mouse.down();
        for (let i = 0; i <= 30; i++) {
          await page.mouse.move(fader.x + fader.width * (.35 + i / 60), fader.y + fader.height / 2);
          await wait(40);
        }
        await page.mouse.up();
        await shot('perform-motion');
        await wait(3000);
        duration = (Date.now() - epoch) / 1000 - start;
        description = 'D/K start Decks A/B; on-screen filter sweep and channel-volume ride while waveforms scroll.';
      } else if (scene === 'set') {
        const set = unique(await get('sets'), process.env.SITE_SET || 'relentless groove');
        await go('performance');
        await page.getByText(set.name, { exact: true }).first().click();
        await wait(5000);
        await page.locator('.set-header-transport .set-play').click();
        await wait(4000);
        // Seek the real Conductor into its first authored handover.
        const at = await page.evaluate(async () => {
          const { getConductor } = await import('/src/sets/conductorStore.ts');
          const c = getConductor();
          if (!c) throw Error('Conductor did not start');
          const plan = c.plan;
          const adj = plan.adjacencies.find((a) => a.kind !== 'hard-cut' && a.mixEndSec - a.mixStartSec > 5);
          if (!adj) throw Error('Set needs an authored handover');
          c.seek(adj.mixStartSec + 1);
          return adj.mixStartSec + 1;
        });
        await wait(3000);
        start = (Date.now() - epoch) / 1000;
        await wait(8000);
        await shot('set-motion');
        await wait(8000);
        duration = 16;
        description = `${set.name}: Conductor playback, seek to authored handover at ${at.toFixed(1)}s.`;
      } else if (scene === 'editor') {
        const candidates = (await get('transitions')).filter((t) => t.name === (process.env.SITE_TRANSITION || 'second drop double'));
        const matches = [];
        for (const t of candidates) {
          const incoming = await get(`tracks/${t.b_track_id}`);
          if (incoming.title === (process.env.SITE_TRANSITION_INCOMING || 'Last Time')) matches.push(t);
        }
        const transition = unique(matches, process.env.SITE_TRANSITION || 'second drop double');
        await go('routine');
        await page.evaluate(async (t) => {
          const { requestMixEdit } = await import('/src/routines/openMix.ts');
          requestMixEdit({ open: { kind: 'transition', aTrackId: t.a_track_id, bTrackId: t.b_track_id, uuid: t.uuid } });
        }, transition);
        await wait(5000);
        await page.locator('.re-transport .re-play').click();
        await wait(4000);
        await page.getByTitle('Pause the audition', { exact: true }).waitFor();
        start = (Date.now() - epoch) / 1000;
        await wait(6000);
        await shot('editor-motion');
        await wait(10000);
        duration = 16;
        description = `${transition.name}: Mix editor audition through the shared Decks and Mixer.`;
      } else {
        throw Error(`Unknown scene ${scene}; use perform,set,editor`);
      }
      console.log(scene, { start, duration, errors });
      if (errors.length) throw Error(errors.join('\n'));
    } catch (e) {
      await shot(`${scene}-failed`);
      console.error(await page.locator('body').innerText());
      throw e;
    } finally {
      await ctx.close();
    }
    const video = await page.video().path();
    function ffmpeg(args) {
      const p = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
      if (p.status !== 0) throw Error(`ffmpeg failed: ${p.status}`);
    }
    ffmpeg(['-ss', String(start), '-i', video, '-t', String(duration), '-an',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', `${media}/${scene}.mp4`]);
    const poster = spawnSync('uv', ['run', '--no-project', '--with', 'pillow', 'python', '-c',
      'from PIL import Image; import sys; Image.open(sys.argv[1]).save(sys.argv[2], quality=85)',
      `${raw}/${scene}-motion.png`, `${shots}/${scene}-motion.webp`], { stdio: 'inherit' });
    if (poster.status !== 0) throw Error('Poster conversion failed');
    manifest.scenes.push({ scene, durationSeconds: duration, description, width: 1440, height: 900, audio: false });
  }
} finally {
  await browser.close();
}
await writeFile(`${raw}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Captured ${manifest.scenes.length} scenes; provenance: ${raw}/manifest.json`);
