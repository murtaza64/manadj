# Private feedback v2 candidate

Not deployed. No personal reports uploaded. This packet replaces the preparatory
v1 contract, not a production migration. `npm ci && npm test` uses synthetic
keys/reports and an in-memory storage double. No Cloudflare credentials needed.

## Native wire contract

POST /v2/feedback accepts only `version:2`, `id`, `kind`, `title`, optional
`description`, `transcript`, `logs`, `screenshot`. ID is lowercase UUIDv4. Kind is
bug or feature. Title is nonblank and at most 200 Unicode scalars. Description,
transcript and logs are at most 20000, 50000 and 200000 Unicode scalars.
Omit optional fields. Null is invalid. Screenshot is `{mime:"image/png",base64:...}`
with strict base64, PNG signature/IHDR, dimensions 1..8192 and <=4MiB decoded.
This validates PNG framing, not complete image decoding or image sanitization.
The whole UTF8 body is bounded at 8MiB, nesting at 16. Duplicate object keys,
including escaped-equivalent names, are rejected. Unknown fields are rejected.
Raw audio, music, stems, settings, databases and arbitrary context are excluded.
The native client must construct an allowlisted, reviewed and scrubbed envelope.

Persist the final serialized UTF8 request bytes before sending. SHA256 binds
those exact bytes, not normalized JSON. Every retry uses the same frozen bytes
and ID. Equivalent JSON with different whitespace/key order is changed content.
A changed report requires a new reviewed ID, never automatic overwrite.

201 new / 200 identical retry returns:
`{version:2,id,received:true,repeated,receivedAt,retainedUntil,sha256}`.
GET /v2/feedback/{id}/receipt returns only that receipt, or 404. It does not
return report contents. `repeated:true` on lookup identifies existing storage.
Client checks ID and digest before marking its local draft sent. Preserve
local content on 404, 409, timeout, failed auth, disabled service or mismatch.
409 indicates changed or unverifiable existing content; it is not overwrite
permission. A lost response can be reconciled by lookup followed by an
identical-byte retry if absent. No server-side listing/content-read endpoint.

R2 conditional create makes the ID immutable. Retry never rewrites the object
or extends its first receipt time. retainedUntil is first receipt plus 30 days,
after which receipt access ends; physical R2 lifecycle deletion is asynchronous.
An expired object still present causes 409 until its lifecycle deletion, so
clients must not silently reuse its ID. There is no promise of minute-exact
physical erasure. Metadata and body share the same R2 object.

## Access and rollout

Worker: manadj-private-feedback. Bucket: manadj-private-feedback, private,
r2.dev/custom public domains off. Existing lifecycle deletes after 30 days.
Config defaults uploads OFF and has no active bucket binding. OWNER_EMAIL must
be set from the verified owner account as an encrypted secret, never client data.
RS256 assertion verification pins the configured issuer and audience and exact
owner email. No bearer-only, unsigned or service-token fallback at origin.
Opaque native OAuth tokens are for Access at the exact feedback resource, not
for direct Worker verification. Access forwards the signed assertion.

Managed OAuth redirect: earth.murtaza.manadj.ios:/oauth/feedback/callback.
Exact audience/issuer are in wrangler.toml. Registration was inspected in the
dashboard but actual native PKCE/state/Keychain sign-in remains unproven.
GET /v2/status authenticates then reports whether uploads and binding are on.
It can test authentication while writes remain disabled.

Deploy and gates are separate from source preparation. Require independent
source review and a securely collected exact-Worker deployment credential;
do not reuse library/COBIS tokens. No historical workflow dispatch. First deploy
with uploads OFF. Check owner Managed OAuth through the native client, nonowner,
unsigned/opaque direct-origin rejection, exact audience, private storage and
current quota. Only then enable a temporary synthetic write gate, verify first
receipt, retry/digest conflict, lookup and R2 private readback, then remove the
synthetic object and prove absence. Keep real personal uploads off until gates
and native destination/review/outbox behavior pass. Do not print assertions,
OAuth tokens, content or secrets in logs, workflows or screenshots.

These tests do not prove deployed Access policy, native login, provider R2
conditional-write behavior, lifecycle timing or device end-to-end behavior.
