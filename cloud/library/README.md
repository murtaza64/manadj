# Private library snapshot preparation

Status: disabled preparation, not a shipped cloud flow. No music or stems, no
release/install, no personal-data upload, no browser/native sign-in proof.
The music/stems backup MCR and independent SSD/restic backup are separate.

Port: now for the shared server protocol. The default-disabled Electron client
and reviewed Upload UI are wired into desktop Settings. They prepare a frozen,
selective snapshot through a shell-token-gated read-only exporter. This is local
preparation with synthetic tests, not a proven native sign-in or upload flow.
No Android/iOS authentication or upload UI is implied.

## First deployment

`wrangler.toml` targets the existing `manadj-private-library` Worker, has
`SNAPSHOTS_ENABLED="false"`, disables preview URLs and observability, and has
**no R2 binding, route, queue, cron or service binding**. The dedicated manual
workflow must run from main, check out one reviewed immutable source commit,
install the lockfile, run tests and a Wrangler dry-run, verify this exact disabled
configuration, then deploy. It never uses the feedback secret or feedback source.

The required deployment credential name is `CLOUDFLARE_LIBRARY_API_TOKEN`.
Create it only after the source pin, workflow and checks are ready. The verified
route is the existing library Worker's Settings > Builds > API token for external
CI/CD > Create token: fixed scope `manadj-private-library`, permission
`Individual Workers Editor`, Advanced expiry seven days. Do not use a generic
Profile/account-wide Workers Scripts Edit token. No Zone, DNS, Access Edit, R2
credential, user-wide or membership grant is intended by this no-binding deploy.
If the scoped token cannot complete a required operation, stop and inspect that
failure; never widen its permission or scope automatically.
Never paste the token into a PR, source, issue, terminal output or conversation.

`OWNER_EMAIL` is deliberately absent from source. Set it privately to the exact
owner policy identity before testing `GET /v1/status`. Missing configuration fails
closed. The auth-only route verifies the signed owner assertion and returns only
authenticated/enabled flags and fixed limits. It does not touch R2. All snapshot
routes return `503 snapshots_disabled` before body parsing or storage access in
the first deployment. The upstream Access application remains required.

Changing the switch, binding the existing private bucket as `LIBRARY_BUCKET`,
changing an owner/origin/audience, or adding a public/preview route is not part of
the initial deployment. Review and prove the gates below first. Do not buy
Workers Paid to work around a failure. The approved R2 metering does not authorize
new paid products, music upload or an account billing-cap claim.

## Native versus origin authentication

Managed OAuth returns an **opaque** access token to the native client. Send it as
Bearer only to the exact pinned resource over HTTPS. Do not decode it as a JWT,
forward it to unrelated origins, put it in the renderer, or copy browser cookies.
Access resolves that token and forwards `Cf-Access-Jwt-Assertion` to the origin,
just as it does for browser requests.

The origin validates RS256 with the pinned team's rotating JWKS, exact issuer and
application AUD, required lifetime claims, human application type, nonempty subject
and exact configured owner email. It rejects global/service/wrong-owner tokens,
missing claims, future/expired assertions and token-supplied key URLs. Identity is
never taken from an unsigned email header. JWKS errors fail closed. Owner email
is not returned to clients. Tokens, headers, request bodies and provider errors
are never logged by this code.

## Bounded v1 contract, synthetic tests only so far

Every mutating body is canonical minified UTF-8 JSON, content type exactly
`application/json`, without gzip/archives. Streams are counted even without a
Content-Length. Duplicate keys/alternate JSON encodings fail canonical validation.
The client must freeze and review the exact bytes before Upload. This is a new
wire DTO, not the earlier gzip offline-export artifact.

1. Freeze parts: `{schema:"manadj-library-snapshot/v1",table,rows}`. Tables and
   columns are allowlisted in `fields.json`, copied from the reviewed selective
   export's metadata/history vocabulary. JSON columns are structured data, not
   encoded JSON strings; only recognized numeric/control/event fields and enum
   strings are accepted. Unknown fields/strings, peer tables, binary blobs,
   settings, audio, paths and deep structures fail visibly, never get truncated.
   A field named `stems` inside capture events is a control value, not stem audio.
2. `POST /v1/snapshots` with `{schema,snapshotId,parts:[{bytes,sha256}]}`.
   snapshotId is a fresh lowercase UUIDv4. The server hashes this exact manifest,
   atomically reserves all declared bytes and one slot before accepting parts,
   and returns an incomplete receipt. Same ID plus same manifest is a retry;
   same ID with changed bytes is rejected.
3. `PUT /v1/snapshots/{id}/parts/{index}` with the exact frozen part. The server
   validates the DTO and computes SHA-256 itself, matches the reservation, counts
   the admitted write and conditionally creates the immutable object. The ledger
   marks stored only after R2 succeeds. Identical retries do not create new data.
   Ambiguous success is reconciled with the actual stored bytes, not a negative
   read or metadata alone. Changed bytes cannot overwrite a part.
4. `POST /v1/snapshots/{id}/commit` with `{}`. Every part must be stored. The
   immutable receipt contains exact part hashes/sizes, server manifest hash,
   snapshot ID and creation time. A retry returns the same receipt/ETag.
5. `GET /v1/snapshots` lists owner-only states, including incomplete reservations.
   `GET /v1/snapshots/{id}` and `GET .../parts/{index}` expose committed snapshots
   only. Reads count before serving data; each part is hashed against the ledger
   before returning it. The native client must independently hash downloaded
   bytes; the assistant owner-browser download must do the same.
6. `DELETE /v1/snapshots/{id}` is the explicit, consistency-safe owner deletion.
   The ledger tombstones the snapshot first (state `deleting`, all other
   operations on it rejected, retry of begin with the same ID rejected), then
   every part object is deleted and verified absent by readback, and only then
   is the ledger entry removed, releasing its slot and reserved bytes. An
   interrupted deletion stays resumable: a repeated DELETE re-runs the missing
   steps idempotently. Deleting an absent ID returns a plain confirmation, so
   an ambiguous earlier success can be retried safely. Deletion works on
   committed snapshots and incomplete reservations and consumes the same daily
   write admission as other mutations.

Limits: 256KiB per part, 256 parts/64MiB per snapshot, 10 snapshots/640MiB reserved
snapshot data total, 1MiB control bookkeeping, 512 admitted mutation requests and
4096 admitted reads per **UTC day**. Identical retries count. A failed downstream
write still consumes its admission count. Quota and incomplete reservations
survive isolate restart and concurrency. Backward clock movement fails closed.

The single small control ledger uses R2's atomic If-Match/If-None-Match writes,
with at most three bounded CAS attempts per update. A part uses create-once
If-None-Match. No in-memory-only quota, object listing to estimate capacity,
automatic expiry, cache deletion, prune, overwrite, limit expansion or silent
history truncation exists. Deletion exists only as the reviewed explicit
operation above: tombstone, verified-absent part removal, then ledger release.
No object lifecycle rule or ad hoc removal of the control ledger. External
deletion or editing of managed objects is unsupported and readback detects
missing/corrupt parts. Never delete the ledger to reset capacity or quota.

These limits are **not an account bill cap**. Authenticated retries, conditional
writes, quota checks and rejected requests can incur operations. A read updates
the persistent counter, so it also uses write operations. Compare-and-swap races
may retry. The $10 alert is a notice, not a spending stop.

## Verification

Run `npm ci --ignore-scripts && npm test` in this directory, and
`node --test desktop/cloud/*.test.js` from the root. The dedicated check also runs
`wrangler deploy --dry-run` without a credential. Local unit tests use only
synthetic fixtures and an atomic in-memory R2 model; that is not a real R2/Access
or Workers CPU proof.

### Staged synthetic real-service check

After a reviewed enabled deployment with the intended private bucket, and before
any personal data upload, run `service_check.mjs` with an owner bearer token
supplied through an environment variable (never on a command line):

```
LIBRARY_CHECK_TOKEN=... node cloud/library/service_check.mjs \
  --origin https://manadj-private-library.murtaza-javaid.workers.dev \
  --snapshots 2 --parts 256 --part-bytes 262144
```

The script stores only generated tracks-table rows, verifies receipts and
SHA-256 readback of every part, probes exact retries and immutable rejection,
then explicitly deletes each snapshot and requires an empty stored list. Worst
shape is 256 parts of 256KiB per snapshot with up to a 10-snapshot ledger; any
Workers Free CPU/resource failure appears as a non-2xx Worker error and fails
the run. Node-side wall times are reported for review but are not the CPU
measurement; the pass/fail of the real service under the worst shape is.

Before enabling personal-data upload:
- Prove auth-only owner success and unauthenticated/wrong-account denial on every
  route, including direct Worker access. No bypass, public listing or service token.
- Complete the native exact-loopback, S256, refresh, cancel/stale-generation and
  main-only OS encryption flow on a personal machine. Windows same-user threats
  and Linux plaintext/unavailable stores must remain explicit.
- Verify the prepared shell-token-gated frozen exporter and destination-visible
  reviewed Upload UI on the packaged native path. Local tests cover exclusion of
  peer/group projections and unselected data at source. This DTO is stricter than
  the offline exporter; visible rejection must remain clear and non-destructive.
- Bind only the intended private bucket in a separately reviewed change. Prove
  synthetic begin/upload/receipt/readback, retries, partial failures, concurrent
  quota admission and both owner read paths on the real service.
- Profile largest parts and a full ledger under Workers Free's 10ms CPU limit.
  Node elapsed times and a dry-run are not that measurement. Reduce bounded work
  or redesign visibly if needed; do not silently upgrade or raise limits.
- Run the staged synthetic real-service check (`service_check.mjs` below): it
  covers begin/upload/receipt/hash readback, exact retries, immutable
  rejection, and explicit deletion with verified absence on the real bucket.
- Resolve legacy/sessionless history provenance and group signed-evidence
  selection. The prepared exporter blocks those uncertain cases, not a fallback.
- Keep the app default disabled until all gates pass. No personal audio/library
  files are needed for these synthetic checks. No release cut is authorized.

## Sources checked 22 Nov 2026

- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
- https://developers.cloudflare.com/r2/reference/consistency/
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/authorization/workers/
- https://developers.cloudflare.com/r2/pricing/
