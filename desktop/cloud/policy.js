// Main-process-only primitives. No production configuration or network side effects.
const crypto = require('node:crypto');

class CloudFailure extends Error {
  constructor(code) { super(code); this.name = 'CloudFailure'; this.code = code; }
}
function fail(code) { throw new CloudFailure(code); }
function httpsOrigin(value) {
  if (typeof value !== 'string') fail('cloud_configuration_invalid');
  let u; try { u = new URL(value); } catch { fail('cloud_configuration_invalid'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port ||
      u.pathname !== '/' || u.search || u.hash || u.origin !== value) fail('cloud_configuration_invalid');
  return value;
}
function configuration(input) {
  if (!input || input.enabled !== true) return null;
  const resource = httpsOrigin(input.resource);
  const issuer = httpsOrigin(input.issuer);
  let callback; try { callback = new URL(input.redirect); } catch { fail('cloud_configuration_invalid'); }
  if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' ||
      !callback.port || Number(callback.port) < 1024 || callback.username || callback.password ||
      callback.search || callback.href.includes('#') || callback.pathname !== '/oauth/library/callback' ||
      callback.href !== input.redirect) fail('cloud_configuration_invalid');
  return Object.freeze({ enabled: true, resource, issuer, redirect: callback.href });
}
function discovery(config, value) {
  if (!config) fail('cloud_disabled');
  if (!value || value.issuer !== config.issuer) fail('cloud_discovery_mismatch');
  for (const [key, suffix] of Object.entries({ authorization_endpoint: 'authorization', token_endpoint: 'token',
    registration_endpoint: 'registration', revocation_endpoint: 'revoke' })) {
    if (value[key] !== `${config.issuer}/cdn-cgi/access/oauth/${suffix}`) fail('cloud_discovery_mismatch');
  }
  for (const [key, needed] of Object.entries({ code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'], grant_types_supported: ['authorization_code', 'refresh_token'] })) {
    if (!Array.isArray(value[key]) || needed.some(v => !value[key].includes(v))) fail('cloud_discovery_mismatch');
  }
  return Object.freeze({ authorization_endpoint: value.authorization_endpoint, token_endpoint: value.token_endpoint,
    registration_endpoint: value.registration_endpoint, revocation_endpoint: value.revocation_endpoint });
}
function nonempty(value, max = 8192) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
class AuthorizationAttempt {
  constructor(config, metadata, clientID, { clock = () => performance.now(), lifetimeMs = 300000 } = {}) {
    if (!config) fail('cloud_disabled');
    if (!nonempty(clientID, 2048) || !Number.isFinite(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > 600000) fail('cloud_configuration_invalid');
    this.config = configuration(config); this.metadata = discovery(this.config, metadata); this.clientID = clientID;
    this.clock = clock; this.created = clock(); this.lifetimeMs = lifetimeMs; this.finished = false;
    this.state = crypto.randomBytes(32).toString('base64url');
    this.verifier = crypto.randomBytes(64).toString('base64url');
  }
  authorizationURL() {
    this.checkActive();
    const url = new URL(this.metadata.authorization_endpoint);
    url.search = new URLSearchParams({ response_type: 'code', client_id: this.clientID, redirect_uri: this.config.redirect,
      resource: this.config.resource, state: this.state, code_challenge_method: 'S256',
      code_challenge: crypto.createHash('sha256').update(this.verifier).digest('base64url') }).toString();
    return url.href;
  }
  checkActive() {
    const age = this.clock() - this.created;
    if (this.finished || age < 0 || age >= this.lifetimeMs) { this.cancel(); fail('cloud_signin_expired'); }
  }
  consume(callbackURL) {
    this.checkActive();
    let u; try { u = new URL(callbackURL); } catch { fail('cloud_callback_rejected'); }
    const expected = new URL(this.config.redirect);
    if (u.origin !== expected.origin || u.pathname !== expected.pathname || u.href.includes('#') || u.username || u.password ||
        u.searchParams.getAll('state').length !== 1 || !sameSecret(u.searchParams.get('state'), this.state)) fail('cloud_callback_rejected');
    // A matched callback is one-shot even when access was denied. Never surface provider prose.
    const verifier = this.verifier; this.cancel();
    if (u.searchParams.has('error') || (u.searchParams.has('iss') && (u.searchParams.getAll('iss').length !== 1 || u.searchParams.get('iss') !== this.config.issuer)) || u.searchParams.getAll('code').length !== 1 ||
        !nonempty(u.searchParams.get('code'))) fail('cloud_signin_declined');
    return new URLSearchParams({ grant_type: 'authorization_code', client_id: this.clientID,
      redirect_uri: this.config.redirect, resource: this.config.resource,
      code: u.searchParams.get('code'), code_verifier: verifier }).toString();
  }
  cancel() { this.finished = true; this.state = ''; this.verifier = ''; }
}
function authorizeFrame(event, webContents, targetURL) {
  let expected, frame, page;
  try { expected = new URL(targetURL); frame = new URL(event.senderFrame.url); page = new URL(webContents.getURL()); }
  catch { fail('cloud_frame_rejected'); }
  if (!['http:', 'https:'].includes(expected.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname) ||
      expected.username || expected.password || webContents.isDestroyed() || event.sender !== webContents ||
      event.senderFrame !== webContents.mainFrame || frame.origin !== expected.origin || page.origin !== expected.origin) fail('cloud_frame_rejected');
}
module.exports = { CloudFailure, configuration, discovery, AuthorizationAttempt, authorizeFrame, nonempty };
