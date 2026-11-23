// TEMPORARY reviewed staging fixture, not the backup UI: an owner-only page for
// driving the synthetic service check with real clicks during the staged gates.
// Remove with the fixture route once the remaining gates pass. No token input,
// no file input, no configurable shapes, no writes without an explicit click.
export const CHECK_PAGE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>TEMPORARY synthetic library service check</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { background: #141414; color: #ddd; font: 14px/1.5 monospace; max-width: 720px; margin: 40px auto; padding: 0 16px; }
  .banner { border: 1px solid #a80; padding: 8px 12px; margin-bottom: 16px; }
  button { font: inherit; padding: 8px 16px; margin: 4px 8px 4px 0; cursor: pointer; }
  button:disabled { opacity: 0.4; cursor: default; }
  #log { background: #000; padding: 12px; white-space: pre-wrap; min-height: 120px; }
</style></head>
<body>
<div class="banner"><strong>TEMPORARY REVIEWED STAGING FIXTURE.</strong>
Synthetic generated metadata only. This is not the backup UI, stores nothing it
does not delete within the same run, and is removed when the gates pass.</div>
<p>Each button runs a fixed synthetic shape against this Worker with budget
preflight, full hash readback and self-cleanup. Nothing runs on page load.</p>
<button id="run-a" type="button">Run check A: worst snapshot (1 x 256 parts x 256KiB)</button>
<button id="run-b" type="button">Run check B: full ledger (10 x 8 parts x 16KiB)</button>
<pre id="log" aria-live="polite"></pre>
<script type="module" src="/v1/service-check/browser/app.js"></script>
</body></html>
`;
