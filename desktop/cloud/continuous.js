// Main-process managed ORM bridge. No bearer or signing key enters IPC.
const { boundedJSON } = require('./connection');
const { CloudFailure } = require('./policy');
async function managedSync(handle, body, { fetch: fetcher = globalThis.fetch, signal } = {}) {
  if (!handle || handle.exited || !/^[a-f0-9]{48}$/.test(handle.token || '')) throw new CloudFailure('cloud_managed_backend_required');
  let origin; try { origin = new URL(handle.url); } catch { throw new CloudFailure('cloud_managed_backend_required'); }
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new CloudFailure('cloud_managed_backend_required');
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const timer = setTimeout(abort, 20000); timer.unref?.();
  try {
    const response = await fetcher(`${origin.origin}/api/_shell/continuous-sync`, { method: 'POST',
      headers: { 'x-manadj-shell-token': handle.token, 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new CloudFailure('continuous_backend_rejected');
    const result = await boundedJSON(response); if (controller.signal.aborted) throw new CloudFailure('continuous_stopped'); return result;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
const id = value => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
class ContinuousSync {
  constructor({ connection, backend, enabled = false, clock = Date.now }) {
    this.connection = connection; this.backend = backend; this.enabled = enabled; this.clock = clock;
    this.running = false; this.requests = 0; this.sent = 0; this.received = 0; this.error = null; this.timer = null; this.controller = null; this.verified = 0; this.busy = false;
  }
  state() { return { enabled: this.enabled, running: this.running, requests: this.requests, sent: this.sent, received: this.received, error: this.error }; }
  start(group) {
    if (!this.enabled) throw new CloudFailure('continuous_test_disabled');
    if (!id(group) || this.running || this.busy) throw new CloudFailure('continuous_invalid_start');
    if (this.connection.publicState().phase !== 'connected') throw new CloudFailure('cloud_signin_required');
    this.group = group; this.verified = 0; this.expires = this.clock() + 4 * 3600 * 1000;
    this.running = true; this.error = null; this.controller = new AbortController(); this.failures = 0;
    this.loop(); return this.state();
  }
  stop() { this.running = false; clearTimeout(this.timer); this.controller?.abort(); return this.state(); }
  async remote(origin, verb, options = {}) {
    if (!this.running || this.controller.signal.aborted) throw new CloudFailure('continuous_stopped');
    if (this.requests >= 1800 || this.clock() >= this.expires) { this.stop(); throw new CloudFailure('continuous_test_limit'); }
    this.requests++; return this.connection.syncAuthenticated(this.group, origin, verb, { ...options, signal: this.controller.signal });
  }
  async local(action, values = {}) { return this.backend({ group: this.group, action, ...values }, { signal: this.controller.signal }); }
  async tick() {
    await this.local('capture');
    const plan = await this.local('plan');
    if (!id(plan.local) || !Array.isArray(plan.origins) || plan.origins.length < 2 || plan.origins.length > 3 || plan.origins.some(x => !id(x)) || !plan.origins.includes(plan.local) || new Set(plan.origins).size !== plan.origins.length || !Number.isSafeInteger(plan.latest)) throw new CloudFailure('continuous_invalid_plan');
    const head = await this.remote(plan.local, 'head');
    if (!Number.isSafeInteger(head.sequence) || head.sequence < this.verified || head.sequence > plan.latest) throw new CloudFailure('continuous_history_mismatch');
    // One bounded prefix page per cycle. Large offline logs resume without a
    // burst. Never publish until signed local evidence matches the remote head.
    if (head.sequence > 0) {
      const after = Math.max(0, this.verified - 1);
      const page = await this.remote(plan.local, 'read', { after, limit: 1 });
      const own = await this.local('packets', { origin: plan.local, after });
      if (!Array.isArray(page.operations) || page.operations.length !== 1 || !Array.isArray(own.packets) || own.packets.length !== 1 || !same(page.operations[0], own.packets[0])) throw new CloudFailure('continuous_history_mismatch');
      this.verified = page.operations[0].body.sequence;
      // When the boundary was already checked, advance one new operation.
      if (this.verified < head.sequence) {
        const next = await this.remote(plan.local, 'read', { after: this.verified, limit: 1 });
        const local = await this.local('packets', { origin: plan.local, after: this.verified });
        if (next.operations?.length !== 1 || local.packets?.length !== 1 || !same(next.operations[0], local.packets[0])) throw new CloudFailure('continuous_history_mismatch');
        this.verified = next.operations[0].body.sequence;
      }
    }
    if (this.verified === head.sequence) {
      const own = await this.local('packets', { origin: plan.local, after: head.sequence });
      for (const packet of own.packets) {
        const receipt = await this.remote(plan.local, 'publish', { sequence: packet.body.sequence, packet });
        if (receipt.sequence !== packet.body.sequence || receipt.stored !== true) throw new CloudFailure('continuous_bad_receipt');
        this.sent++;
      }
    }
    for (const origin of plan.origins.filter(x => x !== plan.local)) {
      const after = plan.cursors?.[origin];
      if (!Number.isSafeInteger(after) || after < 0) throw new CloudFailure('continuous_invalid_cursor');
      const page = await this.remote(origin, 'read', { after, limit: 1 });
      if (!Array.isArray(page.operations) || page.operations.length > 1 || page.nextAfter !== after + page.operations.length || typeof page.more !== 'boolean') throw new CloudFailure('continuous_bad_page');
      for (const packet of page.operations) {
        if (packet.body?.origin_id !== origin || packet.body?.sequence !== after + 1) throw new CloudFailure('continuous_bad_page');
        await this.local('receive', { packet }); this.received++;
      }
    }
  }
  async loop() {
    if (!this.running || this.busy) return; this.busy = true;
    try { await this.tick(); this.error = null; this.failures = 0; }
    catch (error) { this.error = error instanceof CloudFailure ? error.code : 'continuous_cycle_failed'; this.failures++;
      if (['continuous_history_mismatch', 'cloud_auth_rejected', 'cloud_service_unavailable', 'continuous_backend_rejected'].includes(this.error)) this.stop();
    } finally { this.busy = false; }
    if (this.running) { this.timer = setTimeout(() => this.loop(), this.failures ? Math.min(300000, 10000 * 2 ** Math.min(this.failures - 1, 5)) : 30000); this.timer.unref?.(); }
  }
}
function same(a, b) {
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
module.exports = { ContinuousSync, managedSync };
