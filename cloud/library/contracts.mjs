import { createRemoteJWKSet, jwtVerify } from 'jose';

export const LIMITS = Object.freeze({ partBytes: 256 * 1024, parts: 256, snapshotBytes: 64 * 1024 * 1024,
  snapshots: 10, storedBytes: 640 * 1024 * 1024, controlBytes: 1024 * 1024, writes: 512, reads: 4096 });
export const SCHEMA = 'manadj-library-snapshot/v1';
export class Failure extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export function reject(status, code) { throw new Failure(status, code); }
const encoder = new TextEncoder();
export const bytes = value => encoder.encode(JSON.stringify(value));
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export const validID = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
export function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
export async function readJSON(request, max = LIMITS.partBytes) {
  if (request.headers.get('content-type') !== 'application/json' ||
      (request.headers.has('content-encoding') && request.headers.get('content-encoding') !== 'identity')) reject(415, 'raw_json_required');
  const claimed = request.headers.get('content-length');
  if (claimed !== null && (!/^\d+$/.test(claimed) || !integer(Number(claimed), 1, max))) reject(413, 'body_limit');
  if (!request.body) reject(400, 'body_required');
  const reader = request.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); reject(413, 'body_limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size || (claimed !== null && Number(claimed) !== size)) reject(400, 'body_length');
  const raw = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
  let text, value;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); value = JSON.parse(text); }
  catch { reject(400, 'json_invalid'); }
  // Canonical minified JSON means duplicate/hidden keys and alternate encodings cannot
  // hide bytes from review. The frozen client exporter must use this exact format.
  if (JSON.stringify(value) !== text) reject(400, 'canonical_json_required');
  return { raw, value };
}
export function validateManifest(value) {
  if (!exact(value, ['schema', 'snapshotId', 'parts']) || value.schema !== SCHEMA || !validID(value.snapshotId) ||
      !Array.isArray(value.parts) || !integer(value.parts.length, 1, LIMITS.parts)) reject(400, 'manifest_invalid');
  let total = 0;
  for (const part of value.parts) {
    if (!exact(part, ['bytes', 'sha256']) || !integer(part.bytes, 1, LIMITS.partBytes) || !validHash(part.sha256)) reject(400, 'manifest_invalid');
    total += part.bytes;
  }
  if (total > LIMITS.snapshotBytes) reject(413, 'snapshot_limit');
  return total;
}
const resolvers = new Map();
export async function authorizeOwner(request, env, { keyResolver, now = Date.now() } = {}) {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER || '') ||
      !/^[a-f0-9]{64}$/.test(env.ACCESS_AUD || '') || typeof env.OWNER_EMAIL !== 'string' ||
      !/^[^\s@]+@[^\s@]+$/.test(env.OWNER_EMAIL)) reject(503, 'owner_configuration_missing');
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || token.length > 16384) reject(401, 'owner_auth_required');
  try {
    let keys = keyResolver;
    if (!keys) {
      if (!resolvers.has(env.ACCESS_ISSUER)) {
        // Endpoint is derived only from the deployed configuration, never from a token.
        resolvers.set(env.ACCESS_ISSUER, createRemoteJWKSet(new URL(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`),
          { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 900000 }));
      }
      keys = resolvers.get(env.ACCESS_ISSUER);
    }
    const { payload, protectedHeader } = await jwtVerify(token, keys, {
      issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUD, algorithms: ['RS256'],
      requiredClaims: ['iss', 'aud', 'exp', 'iat', 'nbf', 'email', 'sub', 'type'],
      currentDate: new Date(now), clockTolerance: 0,
    });
    if (protectedHeader.jku || protectedHeader.jwk || protectedHeader.x5u || protectedHeader.crit ||
        typeof protectedHeader.kid !== 'string' || !protectedHeader.kid || payload.type !== 'app' ||
        typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 256 ||
        payload.email !== env.OWNER_EMAIL || payload.common_name !== undefined ||
        !integer(payload.iat, 0, Math.floor(now / 1000)) || payload.exp <= payload.iat) throw new Error();
    return { sub: payload.sub };
  } catch { reject(401, 'owner_auth_required'); }
}
