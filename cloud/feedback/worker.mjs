import { createRemoteJWKSet, jwtVerify } from 'jose';

const MAX_BYTES = 8 * 1024 * 1024;
const resolvers = new Map();
const reply = (status, text) => new Response(text, { status, headers: {
  'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} });

const receipt = (status, id, repeated) => new Response(JSON.stringify({ version: 1, id, received: true, repeated }), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

function configured(env) {
  if (env.UPLOADS_ENABLED !== 'true' || !env.FEEDBACK_BUCKET ||
      !env.POLICY_AUD || !env.OWNER_EMAIL || !env.TEAM_DOMAIN) return false;
  try {
    const u = new URL(env.TEAM_DOMAIN);
    return u.protocol === 'https:' && /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(u.hostname) &&
      u.origin === env.TEAM_DOMAIN && !u.username && !u.password;
  } catch { return false; }
}

async function authorize(request, env, resolve) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16000) throw new Error('denied');
  const { payload } = await jwtVerify(token, resolve, {
    issuer: env.TEAM_DOMAIN, audience: env.POLICY_AUD,
    algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'iss', 'aud', 'sub', 'email'],
    maxTokenAge: '24h', clockTolerance: 0,
  });
  if (payload.email !== env.OWNER_EMAIL || typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('denied');
  }
}

async function boundedBody(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new Error('payload');
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new Error('payload');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('payload');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('payload'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function validate(value) {
  const allowed = new Set(['version', 'id', 'title', 'description', 'transcript', 'logs', 'screenshot']);
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).some(k => !allowed.has(k)) || value.version !== 1 ||
      typeof value.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id)) throw new Error('payload');
  for (const [key, max] of [['title', 200], ['description', 20000], ['transcript', 50000], ['logs', 200000]]) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > max)) throw new Error('payload');
  }
  if (!value.title?.trim()) throw new Error('payload');
  if (value.screenshot !== undefined && value.screenshot !== null) {
    if (typeof value.screenshot !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.screenshot)) throw new Error('payload');
    const b = atob(value.screenshot.slice('data:image/png;base64,'.length));
    const signature = [137,80,78,71,13,10,26,10];
    if (b.length < 24 || signature.some((x,i) => b.charCodeAt(i) !== x)) throw new Error('payload');
  }
  return value;
}

// resolveForTest is dependency injection for synthetic signed-token tests only.
// The deployed default always constructs its resolver from pinned configuration.
export function createHandler(resolveForTest) {
  return async function fetch(request, env) {
    if (!configured(env)) return reply(503, 'Feedback uploads are disabled');
    let resolve = resolveForTest;
    if (!resolve) {
      if (!resolvers.has(env.TEAM_DOMAIN)) resolvers.set(env.TEAM_DOMAIN,
        createRemoteJWKSet(new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`)));
      resolve = resolvers.get(env.TEAM_DOMAIN);
    }
    try { await authorize(request, env, resolve); }
    catch { return reply(403, 'Forbidden'); }
    if (new URL(request.url).pathname !== '/v1/feedback' || request.method !== 'POST') return reply(404, 'Not found');
    let report;
    try { report = validate(await boundedBody(request)); }
    catch { return reply(400, 'Invalid feedback report'); }
    // No caller-chosen object key, retrieval endpoint, URLs or raw binary uploads.
    // One immutable report object keeps the 30-day lifecycle measured from Send.
    const key = `reports/${report.id}.json`;
    try {
      // Stable field order permits an exact same-content retry after a lost
      // response. Head reads only receipt metadata, never returns report data.
      // A matching UUID alone must not clear a changed draft on the phone.
      const body = JSON.stringify(Object.fromEntries(Object.keys(report).sort().map(k => [k, report[k]])));
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))),
        b => b.toString(16).padStart(2, '0')).join('');
      const stored = await env.FEEDBACK_BUCKET.put(key, body, {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { sha256: digest },
      });
      if (stored) return receipt(201, report.id, false);
      const existing = await env.FEEDBACK_BUCKET.head(key);
      if (existing?.customMetadata?.sha256 === digest) return receipt(200, report.id, true);
      return reply(409, 'Report id already exists with different or unverified content');
    } catch { return reply(503, 'Could not save report; keep the local copy'); }
  };
}

export default { fetch: createHandler() };
