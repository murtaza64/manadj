# Native private-library connection, disabled preparation

The desktop shell now has main-process connection/review/upload modules and a
Settings > Library > Private metadata snapshots section. The production target
in `target.js` is compiled OFF. That section shows an under-construction notice;
it cannot connect, prepare or upload. No environment variable, renderer option
or URL parameter enables it. This is not an installed feature or release cut.

## Boundaries

- `policy.js` pins the resource, issuer, dynamic public-client discovery,
  random state, S256 and exact one-shot expiring callback.
- `loopback.js` binds the exact loopback port before opening the browser, serves
  a static response, rejects occupied ports and cleans up on timeout/cancel.
- `connection.js` registers a public client, exchanges/rotates opaque tokens,
  checks owner-only `/v1/status` before saving, bounds bodies/timeouts and uses
  generation guards and serialized persistence. Tokens never enter renderer IPC.
- `tokenStore.js` uses Electron37 safeStorage for audience-bound encrypted refresh
  state, atomic0600replacement and no Linux basic_text/unknown fallback. Mocks do
  not establish actual OS encryption or Keychain behavior. Windows encryption
  does not isolate this app from other programs running as the same OS user.
- `source.js` accepts only the shell's actual managed backend and token, using a
  fixed loopback endpoint. Attach-only mode has no snapshot provider. It never
  accepts database paths, URLs, tables or byte payloads from the renderer.
- `backend/cloud_snapshot.py` reads this application's actual SQLite library in
  one bounded, read-only WAL-aware transaction. Fixed DTO fields only. Audio,
  paths, settings, secrets and peer/group sessions plus derived Takes are out.
  Durable received-peer UUIDs also deny export after projection removal. Group
  identity denial recovers verified signed evidence exactly like the app's own
  selector: own-issued operations verified against pinned member keys stay
  local, every other signed-body or possession claim denies exactly its
  session, and unreadable evidence fails the whole preparation. Sessionless
  pre-Sessions Takes and Takes of deleted local Sessions are local by
  construction (received/group evidence is durable, undeletable and always
  session-bound) and are counted explicitly in the review omissions.
  Unsupported values fail visibly, not by truncation, redaction or fallback.
- `upload.js` validates/canonicalizes frozen parts and recomputes row counts,
  hashes and manifest before review. Review is bound to destination/connection
  and expires after15minutes. Only an explicit reviewed Upload sends bytes.
  Partial failures keep exact bytes for explicit retry, never re-export behind
  the review. Receipt and raw downloaded parts are checked independently.
- `snapshots.js` lists stored cloud snapshots and performs explicit owner
  deletion through the reviewed server operation. A deletion is confirmed only
  after an independent listing readback shows the snapshot absent. Local review
  state is cleared on deletion but never itself claims cloud deletion.
- `ipc.js` checks the intended main frame and exposes only verbs and safe
  summaries. Top-level cross-document navigation cancels work; same-document
  history/hash routing and subframe navigation do not. Disposal always cancels. Disconnect is local only; no claim of
  remote revocation or cloud deletion. Canceling an upload keeps the connection
  and frozen review; canceling sign-in invalidates that attempt.

Exact callback: `http://127.0.0.1:53682/oauth/library/callback`. No port fallback,
broad loopback registration, browser token exposure or plaintext persistence.
Keep safeStorage version compatibility under review before Electron upgrades.

## Local proof

Use project Python3.13+; older interpreters are unsupported. Run from repository root:

```
node --test desktop/cloud/*.test.js cloud/library/*.test.mjs
python -m pytest tests/test_cloud_shell.py tests/test_cloud_snapshot_unit.py tests/test_cloud_runtime.py tests/test_build_dmg.py tests/test_serve.py
cd frontend
npx vitest run src/settings/LibraryCloudSettings.test.tsx
npx tsc -b
```

Fixtures are synthetic, temporary and local. Package-layout tests load the
native adapter and pure DTO validator from an assembled temp tree without
node_modules. Shared macOS/Windows assembly copies only the runtime and pure
schema files, not Worker auth/deployment code or test data.

## Still required before enablement

Real owner/browser and native sign-in, refresh/cancel and wrong-account denial;
actual per-OS encrypted persistence; the staged synthetic real-R2 check
(`cloud/library/service_check.mjs`: receipt/readback, retries, concurrency/partial
failures, largest-part/ledger shapes under the Free-tier CPU limit, deletion with
verified absence); independent owner-browser download verification. The
consistency-safe explicit deletion operation now exists (server tombstone plus
verified-absent part removal, main-process client, two-step Settings control) and
its real-service result still must be verified by that staged check before
relying on retention-until-the-owner-deletes.

Legacy/sessionless/pruned history provenance and verified group-ledger selection
are resolved in the exporter: local classification rests on source-verified
durability invariants (received/group evidence has no delete path, group
Sessions are undeletable, every received bundle is session-bound), group denial
uses the app's equivalent verified signed-evidence recovery, and every resolved
case is counted explicitly in the review omissions. Unreadable group evidence
still fails the whole preparation; it never infers ownership or omits history.
Daily mutation/read quotas count requests, including failed/retried writes; they
do not stop billing or replace a spending approval. The separately deployed server
remains disabled with no bucket binding. Do not treat local mocks or a successful
deployment as these proofs. No personal metadata/audio needs uploading for tests.
