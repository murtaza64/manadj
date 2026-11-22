import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { createHandler } from './worker.mjs';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const { privateKey: wrongKey } = await generateKeyPair('RS256');
const handler = createHandler(async () => publicKey);
const issuer = 'https://synthetic-team.cloudflareaccess.com';
let puts;
function env(overrides = {}) {
  puts = [];
  return { UPLOADS_ENABLED: 'true', TEAM_DOMAIN: issuer, POLICY_AUD: 'synthetic-audience',
    OWNER_EMAIL: 'owner@example.invalid', FEEDBACK_BUCKET: { put: async (...args) => { puts.push(args); return {}; } }, ...overrides };
}
async function token(claims = {}, key = privateKey) {
  return new SignJWT({ email: 'owner@example.invalid', ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuedAt().setIssuer(claims.iss ?? issuer).setAudience(claims.aud ?? 'synthetic-audience')
    .setSubject('synthetic-owner').setExpirationTime(claims.exp ?? '5m').sign(key);
}
const report = { version: 1, id: 'b4c09bb8-aa5a-40e8-a7fd-32f8cbfc9904', title: 'Synthetic test only',
  description: 'No user data', logs: 'generated test event', transcript: 'synthetic words' };
function req(jwt, body = report, path = '/v1/feedback', method = 'POST') {
  return new Request(`https://worker.example.invalid${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
}

test('owner signed assertion stores exactly one allowlisted immutable report', async () => {
  const e = env(); const r = await handler(req(await token()), e);
  assert.equal(r.status, 201); assert.equal(puts.length, 1);
  assert.equal(puts[0][0], `reports/${report.id}.json`);
  assert.deepEqual(JSON.parse(puts[0][1]), report);
  assert.deepEqual(puts[0][2].onlyIf, { etagDoesNotMatch: '*' });
});
for (const [name, claims, key] of [
  ['other account', { email: 'other@example.invalid' }],
  ['wrong audience', { aud: 'another-app' }],
  ['wrong issuer', { iss: 'https://attacker.invalid' }],
  ['expired', { exp: 1 }],
  ['future nbf', { nbf: Math.floor(Date.now()/1000)+3600 }],
  ['wrong signature', {}, wrongKey],
]) test(`${name} denied before storage`, async () => {
  const e = env(); assert.equal((await handler(req(await token(claims, key)), e)).status, 403); assert.equal(puts.length, 0);
});
test('unauthenticated and opaque OAuth token denied at Worker', async () => {
  for (const jwt of [undefined, 'oauth:synthetic-opaque-token']) {
    const e = env(); assert.equal((await handler(req(jwt), e)).status, 403); assert.equal(puts.length, 0);
  }
});
test('disabled or missing security config fails closed', async () => {
  for (const overrides of [{ UPLOADS_ENABLED: 'false' }, { POLICY_AUD: '' }, { OWNER_EMAIL: '' }, { TEAM_DOMAIN: 'https://untrusted.invalid' }]) {
    const e = env(overrides); assert.equal((await handler(req(await token()), e)).status, 503); assert.equal(puts.length, 0);
  }
});
test('reject raw voice, music, arbitrary context, paths and non-PNG attachments', async () => {
  for (const extra of [{ voice: 'raw' }, { music: 'raw' }, { context: {} }, { path: '../../x' }, { screenshot: 'data:audio/wav;base64,AAAA' }, { screenshot: 'data:image/png;base64,AAAA' }, { id: '../../x' }]) {
    const e = env(); assert.equal((await handler(req(await token(), { ...report, ...extra }), e)).status, 400); assert.equal(puts.length, 0);
  }
});
test('body cap, string cap and route restrictions precede storage', async () => {
  for (const body of [{ ...report, logs: 'a'.repeat(200001) }, { ...report, title: '' }, { ...report, description: 'a'.repeat(9 * 1024 * 1024) }]) {
    const e = env(); assert.equal((await handler(req(await token(), body), e)).status, 400); assert.equal(puts.length, 0);
  }
  for (const [path, method] of [['/other', 'POST'], ['/v1/feedback', 'GET']]) {
    const e = env(); assert.equal((await handler(req(await token(), report, path, method), e)).status, 404); assert.equal(puts.length, 0);
  }
});
test('duplicate and failed writes do not claim a new receipt', async () => {
  for (const [result, expected] of [[null, 409], ['throw', 503]]) {
    const e = env({ FEEDBACK_BUCKET: { put: async () => { if (result === 'throw') throw new Error('synthetic'); return result; } } });
    assert.equal((await handler(req(await token()), e)).status, expected);
  }
});
