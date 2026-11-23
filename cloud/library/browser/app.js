// Browser glue for the TEMPORARY reviewed staging fixture. Attaches click
// handlers only: no fetch, no write and no check runs on page load.
import { runCheck, plannedWrites } from './check_core.mjs';

const SHAPES = {
  'run-a': { snapshots: 1, parts: 256, partBytes: 256 * 1024 },
  'run-b': { snapshots: 10, parts: 8, partBytes: 16 * 1024 },
};
const logElement = document.getElementById('log');
const log = line => { logElement.textContent += `${line}\n`; };
// Same-origin fetches only; the page's own origin completes relative paths.
const sameOriginFetch = (path, init) => fetch(new URL(path, location.href), init);

for (const [buttonId, shapes] of Object.entries(SHAPES)) {
  document.getElementById(buttonId).addEventListener('click', async event => {
    const buttons = document.querySelectorAll('button');
    for (const button of buttons) button.disabled = true;
    log(`starting ${buttonId}: ${shapes.snapshots} snapshot(s) x ${shapes.parts} parts x ${shapes.partBytes} bytes, planned writes ${plannedWrites(shapes.snapshots, shapes.parts)}`);
    try {
      const result = await runCheck({ ...shapes, log, fetchImpl: sameOriginFetch });
      log(`${buttonId} PASS (slowest request ${result.slowestMs}ms)`);
    } catch (error) {
      log(`${buttonId} FAIL: ${error.message}`);
    } finally {
      for (const button of buttons) button.disabled = false;
    }
    event.preventDefault();
  });
}
