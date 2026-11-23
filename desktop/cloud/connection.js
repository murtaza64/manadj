// Main-process-only OAuth lifecycle. No Electron/global network effects on import.
// Tokens never appear in publicState, renderer IPC, provider errors or logs.
const { configuration, discovery, AuthorizationAttempt, CloudFailure, nonempty } = require('./policy');
const { authorizeInBrowser } = require('./loopback');

const fail = code => { throw new CloudFailure(code); };
async function boundedJSON(response, maximum = 262144, withBytes = false) {
  if (!response || !response.body || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) fail('cloud_response_invalid');
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); fail('cloud_response_limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const raw = Buffer.concat(chunks.map(v => Buffer.from(v)), length);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw));
    return withBytes ? { value, raw } : value;
  }
  catch { fail('cloud_response_invalid'); }
}
function tokenSet(value, now, fallbackRefresh) {
  if (!value || value.token_type?.toLowerCase() !== 'bearer' || !nonempty(value.access_token, 32768) ||
      !Number.isSafeInteger(value.expires_in) || value.expires_in < 1 || value.expires_in > 86400 ||
      !nonempty(value.refresh_token ?? fallbackRefresh, 32768)) fail('cloud_token_response_invalid');
  return { access: value.access_token, refresh: value.refresh_token ?? fallbackRefresh,
    expiresAt: now + value.expires_in * 1000 };
}
class CloudConnection {
  constructor({ config, store, fetch: fetcher = globalThis.fetch, openExternal,
    browserAuthorize = authorizeInBrowser, clock = Date.now } = {}) {
    this.config = configuration(config); this.store = store; this.fetcher = fetcher;
    this.openExternal = openExternal; this.browserAuthorize = browserAuthorize; this.clock = clock;
    this.generation = 0; this.controller = new AbortController(); this.metadata = null;
    this.clientID = null; this.tokens = null; this.refreshing = null; this.busy = false;
    this.persistence = Promise.resolve(); this.phase = this.config ? 'disconnected' : 'disabled';
  }
  publicState() { return { phase: this.phase, enabled: !!this.config, destination: this.config?.resource ?? null }; }
  active(generation) {
    if (!this.config) fail('cloud_disabled');
    if (generation !== this.generation || this.controller.signal.aborted) fail('cloud_operation_cancelled');
  }
  restart(phase) {
    this.controller.abort(); this.controller = new AbortController(); this.generation++;
    this.refreshing = null; this.tokens = null; this.clientID = null; this.phase = phase;
    return this.generation;
  }
  persist(generation, operation) {
    const run = this.persistence.then(async () => { this.active(generation); await operation(); this.active(generation); });
    this.persistence = run.catch(() => {}); return run;
  }
  async request(url, options, generation, timeout = 15000, externalSignal, withBytes = false) {
    this.active(generation); const parent = this.controller.signal;
    const controller = new AbortController();
    const abort = () => controller.abort(); parent.addEventListener('abort', abort, { once: true });
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) abort();
    const timer = setTimeout(abort, timeout); timer.unref?.();
    try {
      const result = await this.fetcher(url, { ...options, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
      this.active(generation);
      // Consume the bounded body inside the same timeout and cancellation scope.
      const value = await boundedJSON(result, 262144, withBytes); this.active(generation);
      if (externalSignal?.aborted) fail('cloud_operation_cancelled');
      if (controller.signal.aborted) fail('cloud_network_unavailable');
      if (!result.ok) fail(result.status === 401 || result.status === 403 ? 'cloud_auth_rejected' : 'cloud_service_unavailable');
      return value;
    } catch (error) {
      if (generation !== this.generation || parent.aborted || externalSignal?.aborted) fail('cloud_operation_cancelled');
      if (error instanceof CloudFailure) throw error;
      fail('cloud_network_unavailable');
    } finally { clearTimeout(timer); parent.removeEventListener('abort', abort); externalSignal?.removeEventListener('abort', abort); }
  }
  async discover(generation) {
    const value = await this.request(`${this.config.resource}/.well-known/oauth-authorization-server`, { method: 'GET' }, generation);
    const metadata = discovery(this.config, value); this.active(generation);
    this.metadata = metadata; return metadata;
  }
  async verify(access, generation) {
    const status = await this.request(`${this.config.resource}/v1/status`, { method: 'GET', headers: { authorization: `Bearer ${access}` } }, generation);
    if (status?.authenticated !== true || typeof status.snapshotsEnabled !== 'boolean') fail('cloud_owner_check_failed');
    return status;
  }
  async connect() {
    if (!this.config) fail('cloud_disabled');
    if (this.busy) fail('cloud_connection_busy');
    this.busy = true; const generation = this.restart('connecting');
    try {
      // Verify OS storage availability before registering a client or opening login.
      this.store.assertEncryption();
      const metadata = await this.discover(generation);
      const registration = await this.request(metadata.registration_endpoint, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'manaDJ Desktop Library',
          redirect_uris: [this.config.redirect], token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) }, generation);
      if (!nonempty(registration?.client_id, 2048) || registration.client_secret ||
          registration.token_endpoint_auth_method !== 'none' || !Array.isArray(registration.redirect_uris) ||
          registration.redirect_uris.length !== 1 || registration.redirect_uris[0] !== this.config.redirect) fail('cloud_registration_invalid');
      const clientID = registration.client_id;
      const attempt = new AuthorizationAttempt(this.config, metadata, clientID);
      const form = await this.browserAuthorize({ attempt, openExternal: this.openExternal, signal: this.controller.signal });
      this.active(generation);
      const value = await this.request(metadata.token_endpoint, { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form }, generation);
      const tokens = tokenSet(value, this.clock());
      await this.verify(tokens.access, generation);
      await this.persist(generation, () => this.store.save({ clientID, refreshToken: tokens.refresh }));
      this.active(generation); this.clientID = clientID; this.tokens = tokens; this.phase = 'connected';
      return this.publicState();
    } catch (error) {
      if (generation === this.generation) { this.tokens = null; this.clientID = null; this.phase = 'disconnected'; }
      throw error instanceof CloudFailure ? error : new CloudFailure('cloud_connection_failed');
    } finally { this.busy = false; }
  }
  async resume() {
    if (!this.config) return this.publicState();
    if (this.busy) fail('cloud_connection_busy');
    this.busy = true; const generation = this.restart('connecting');
    try {
      const stored = await this.store.load(); this.active(generation);
      if (!stored) { this.phase = 'disconnected'; return this.publicState(); }
      await this.discover(generation); this.clientID = stored.clientID;
      this.tokens = { access: '', refresh: stored.refreshToken, expiresAt: 0 };
      await this.refresh(generation); this.active(generation); this.phase = 'connected'; return this.publicState();
    } catch (error) {
      if (generation === this.generation) { this.tokens = null; this.clientID = null; this.phase = 'disconnected'; }
      throw error instanceof CloudFailure ? error : new CloudFailure('cloud_connection_failed');
    } finally { this.busy = false; }
  }
  async refresh(generation = this.generation) {
    this.active(generation);
    if (this.refreshing?.generation === generation) return this.refreshing.promise;
    if (!this.tokens || !this.clientID || !this.metadata) fail('cloud_signin_required');
    const previous = this.tokens, clientID = this.clientID;
    const promise = (async () => {
      try {
        const value = await this.request(this.metadata.token_endpoint, { method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
            grant_type: 'refresh_token', client_id: clientID, refresh_token: previous.refresh, resource: this.config.resource }).toString() }, generation);
        const tokens = tokenSet(value, this.clock(), previous.refresh);
        await this.verify(tokens.access, generation);
        await this.persist(generation, () => this.store.save({ clientID, refreshToken: tokens.refresh }));
        this.active(generation); this.tokens = tokens; return tokens.access;
      } catch (error) {
        if (generation === this.generation) { this.tokens = null; this.phase = 'disconnected'; }
        throw error;
      } finally { if (this.refreshing?.generation === generation) this.refreshing = null; }
    })();
    this.refreshing = { generation, promise }; return promise;
  }
  async authenticated(pathname, { method = 'GET', body, signal, withBytes = false } = {}) {
    const generation = this.generation; this.active(generation);
    // This adapter accepts only the fixed bounded server contract, never full URLs.
    if (!/^\/v1\/(?:status|snapshots(?:\/[a-f0-9-]+(?:\/(?:commit|parts\/\d{1,3}))?)?)$/.test(pathname) ||
        !['GET', 'POST', 'PUT', 'DELETE'].includes(method) || (body !== undefined && typeof body !== 'string') ||
        // Deletion exists only for one exact stored snapshot, never a collection or part.
        (method === 'DELETE' && !/^\/v1\/snapshots\/[a-f0-9-]+$/.test(pathname))) fail('cloud_request_invalid');
    if (signal?.aborted) fail('cloud_operation_cancelled');
    if (!this.tokens) fail('cloud_signin_required');
    if (this.tokens.expiresAt - this.clock() < 30000) await this.refresh(generation);
    this.active(generation); const access = this.tokens.access;
    // Never replay a mutation after an HTTP auth/error response. The reviewed
    // upload owns exact-byte retries and must preserve its failed snapshot.
    return this.request(`${this.config.resource}${pathname}`, { method,
      headers: { authorization: `Bearer ${access}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body }) }, generation, 15000, signal, withBytes);
  }
  cancel() { this.restart(this.config ? 'disconnected' : 'disabled'); return this.publicState(); }
  async disconnect() {
    const generation = this.restart(this.config ? 'disconnected' : 'disabled');
    // Queue behind an already-running save, so a canceled login/refresh cannot
    // resurrect credentials after this explicit local sign-out.
    if (this.config) await this.persist(generation, () => this.store.clear());
    return this.publicState();
  }
}
module.exports = { CloudConnection, boundedJSON, tokenSet };
