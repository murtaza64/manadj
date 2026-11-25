# Continuous own-device slice, disabled engineering candidate

This is not enabled, deployed, installed, or released. It does not turn the
snapshot/archive feature into sync. No personal database has been used.

## Actual path under test

Two independently migrated application SQLite databases have different local
track IDs explicitly bound to one logical UUID. Existing title/main-cue writes
are captured into an application-owned durable signed outbox. A bounded Pump
publishes immutable operations through native HTTP to an independently durable
relay. The originating application can go offline. The other application pulls,
verifies against locally pinned device keys and applies to actual Track rows.

Existing committed desktop Session/SessionChunk rows are captured automatically,
including an active session before ended_at exists. Reference sites are validated
and remapped through logical bindings. Subsequent chunks and end are delivered
without copying the origin database or treating WAV audio as a session log.

## Contract for hosting review

All paths are under `/v1/sync/{groupUUID}/origins/{pinnedOriginUUID}`:

* GET `/head` returns `{sequence: integer}`.
* PUT `/operations/{sequence}` with canonical `{expectedPreviousSequence, packet: {body, signature}}`
  JSON (explicit integer comparison, not an HTTP ETag) commits the immutable operation before responding
  `{sequence, stored: true}`. Exact retry is accepted, different bytes conflict.
* GET `/operations?after=N&limit=L` returns `{operations: [...]}` in strictly
  increasing contiguous per-origin sequence, at most 32 operations and 256KiB
  TOTAL canonical response bytes including envelope/signature overhead. Response
  also includes `nextAfter` and `more`; an operation is never truncated. Signed
  body max240KiB, packet max248KiB. Genesis is sequence0; signed sequences are
  integers1..2^53-1, expected predecessor exactly sequence-1. Reused operationUUID
  at any other sequence conflicts. Exact retry201; incompatible append409.

The signed body includes protocol/group/origin/operation UUIDs, sequence, generation1,
entity/field/causal parent operation UUIDs/value. Signatures use the existing
locally provisioned and pinned own-device group, with a separate protocol domain.
The server must authorize the owner and bind write origin to that authenticated
pinned device. The reference relay takes an injected authenticated-subject policy, then verifies
server-provisioned subject/group/origin/publickey membership and Ed25519 packet
signature inside the append transaction. Local-only provision cannot replace or
un-revoke a member; revoke fences delayed writes in the same database transaction.
No HTTP enrollment, reset, rotation or pruning exists in v1. Native OAuth/Access
compatibility is NOT proven. The relay is NOT mounted in production. Its test bearer is generated fixture authority only.
Clients independently verify signatures. Enrollment or keys never come from a
remote operation or list. No client private keys or service credentials enter
renderer IPC or server operation payloads.

Server requirements: per-origin atomic compare/append and durable commit before
head/ack publication; exact retry after ambiguous response; paginated reads and
no global ordering or transaction claim based on object listing. R2 object-plus-
head CAS must prove orphan/recovery behavior before substituting for the SQLite
reference relay. A new infrastructure product is not selected by this candidate.

## Failure and conflict behavior

Local mutation capture, operation append and cursor update use bounded transactions
with SQLite synchronous FULL. Pull cursor advances only with committed application
state. Restart reads persistent state. Missing logical dependencies or origin gaps
leave the cursor unchanged. Concurrent same-field heads keep both signed values
and do not silently select a wall-clock winner. An explicit local issue consumes
all known heads to resolve; automatic capture skips unresolved conflict heads.
Track archive tombstones block stale-field resurrection. Restore is not supported
by this slice. Session chunks are immutable, ordered and bound to one recorder.

## Remaining delivery gaps

The twelve tests use actual application ORM tables and an HTTP relay, but not the
full managed Electron app or physical phone. Pump is not wired into production
startup or UI, bootstrap is explicit and no whole-library auto-enrollment exists.
Only title/main-cue and archive capture/application are the first metadata scope;
cues/grids/tags/playlists, actual audio replication/normal deck import, causal
conflict UI, pruning/device retirement, auth/refresh and OS encrypted state remain.
The iOS app needs native session-event capture, durable edit journal, signed
transport and application adapters. iOS WAV recording is not session-event capture.
No background execution guarantee is made for a suspended iOS application.

No personal-data upload, live provider setup or device access is authorized by
these tests. Existing audio object code remains reusable but is not in this
branch's twelve tests. A successful generated cross-device service check is a
prerequisite, not fulfillment of whole-library/session sync.

Port: desktop + iOS now, in the same delivery outcome. Android already has edit
and session journals; its cloud transport adapter follows the same contract, not
an unrelated feature lane. No claim of Android parity from these Python tests.


## Review corrections and remaining transport limitation

Server-pinned membership and signature verification, explicit predecessor field,
group-wide UUID uniqueness and aggregate-byte pagination have generated tests.
SQLite relay transaction tests cover parallel exact retries, conflicting bytes,
failed commit visibility, missing committed reads, stale bootstrap/revocation and
same-owner forged/unpinned origin. HTTP path tests cover lost-response resume via
head, actual committed application rows, cursor durability, conflict preservation
and rejection of tampered packets. The current native adapter is a dedicated
bounded streaming Python HTTP client, not the existing Electron CloudConnection.
Its request body limit still must be reconciled with the eventual shell adapter.

R2 op-written/head-not-advanced recovery and fork/orphan/generation fencing are
NOT implemented or tested by this SQLite relay. Do not transfer its transactional
claims to an R2 multi-object algorithm. Hosted implementation awaits that review.
No service purchase or deployment is authorized. Metadata/session retry cadence,
retained-log ceiling and daily operation budget remain implementation gates, not
the unrelated audio policy's limits. No automatic destructive pruning is present.


## Second source review revision

18 focused tests, 71 combined with existing group/peer/device-edit suites pass.
Hosting's three generated probes are retained with corrected regression assertions:
reverse causal origin ordering now makes progress through per-origin continuation;
local-origin remote prefixes are byte-compared in bounded pages before resume,
with a durable verified checkpoint and boundary recheck, rejecting forks/rollback;
source SessionChunk sequence gaps are preserved rather than requiring zero-contiguous
chunks. The relay retains deferred dependency packets and cursors stay unchanged.
A local committed edit between capture and receive is journaled before projection.
A cancellable worker has bounded 5s active/60s idle and exponential offline backoff
up to 300s; this is local implementation, not an activated network polling policy.

Received continuous Session rows are currently fail-closed for playback, derivation,
mutation and peer re-export until signed asset identity/binding-aware replay exists.
Recovery skips them so another device's active session is never closed/deleted.
Denial checks signed source evidence as well as denormalized owner/origin records.
The old cloud snapshot format rejects a database containing continuous operations,
rather than flattening the new provenance. These are explicit temporary safety
limits, not a claim of playable cross-device session delivery. Foreign/group capture
is skipped. Guards and regression tests are included in this revision.

Hosting recommends a dedicated per-group SQLite Durable Object behind the existing
Worker, matching the local transactional log/registry contract. The recommendation
is not permission or evidence of a deployed namespace, binding or paid service.
Hosting is preparing an independent local reference; production integration still
needs that review plus actual owner Bearer/Access compatibility, revoke/append
rechecks, bounded retention and daily operation accounting. No R2-only protocol
will be invented in parallel. Earlier R2 alternatives above are not the chosen path.


Latest local validation also runs 126 tests including group session history,
session router/audibility, old cloud snapshot/shell tests and continuous regression
coverage, plus 63 Electron cloud tests. The main-process CloudConnection now has
fixed grammar sync head/read/publish routes with bounded request/response handling,
predecessor envelope, refresh/cancellation and no new renderer IPC or activation.
Actual Managed OAuth provider documentation specifies the opaque bearer is resolved
by Access and a signed assertion forwarded to the origin. Deployed config/native
login/refresh remain untested, so this is a documented supported path, not qualified
end-to-end authentication.
