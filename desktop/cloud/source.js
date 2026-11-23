// Managed-backend-only source adapter. Called only from main, never renderer.
const { boundedJSON } = require('./connection');
const { CloudFailure } = require('./policy');
async function prepareFromManagedBackend(handle, { fetch: fetcher = globalThis.fetch, signal } = {}) {
  if (!handle || handle.exited || typeof handle.token !== 'string' || !/^[a-f0-9]{48}$/.test(handle.token)) throw new CloudFailure('cloud_managed_backend_required');
  let origin;
  try { origin = new URL(handle.url); } catch { throw new CloudFailure('cloud_managed_backend_required'); }
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.pathname !== '/' ||
      origin.search || origin.hash || origin.username || origin.password) throw new CloudFailure('cloud_managed_backend_required');
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 20000); timer.unref?.();
  try {
    if (controller.signal.aborted) throw new CloudFailure('cloud_upload_cancelled');
    const response = await fetcher(`${origin.origin}/api/_shell/cloud/prepare`, { method: 'POST',
      headers: { 'x-manadj-shell-token': handle.token }, signal: controller.signal,
      redirect: 'error', credentials: 'omit', cache: 'no-store' });
    if (signal?.aborted) throw new CloudFailure('cloud_upload_cancelled');
    if (!response.ok) throw new CloudFailure('cloud_prepare_failed');
    // The shell route returns up to 63MiB of part strings plus JSON escaping.
    const result = await boundedJSON(response, 140 * 1024 * 1024);
    if (controller.signal.aborted) throw new CloudFailure(signal?.aborted ? 'cloud_upload_cancelled' : 'cloud_prepare_timeout');
    return result;
  } catch (error) {
    if (signal?.aborted) throw new CloudFailure('cloud_upload_cancelled');
    throw error instanceof CloudFailure ? error : new CloudFailure('cloud_prepare_failed');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
module.exports = { prepareFromManagedBackend };
