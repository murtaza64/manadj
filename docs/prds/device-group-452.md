# Device-group Session relay — #452

- Port: now desktop + Android #453; shared `backend/peer_sync/group_contracts.py` and `tests/fixtures/device_group_v1.json`.
- Scope: immutable Session creation and portable Track references. Curated updates/deletes, membership synchronization, automatic pairing, audio transfer and background scheduling are not implemented by v1.
- Legacy phone snapshots, pairing tokens, cached audio and edit journals remain separate and unchanged.

## Authority

- Local owner provisions group UUID and pins every member device UUID/Ed25519 public key out of band on each replica. Network messages never create or modify members. No self-granting trust documents or shared bearer token.
- Each replica has a local Ed25519 seed and stable device UUID. Desktop initially uses its explicit existing Session replica UUID; copying an initialized DB copies identity and is not enrollment.
- Revocation is local, durable and irreversible in v1; owner must apply it on every replica. Offline peers cannot know a revocation not received locally. Key rotation/rejoining requires a new device UUID.
- Reject revoked/unknown transport sender and original signer on every receive/pull. Retain stored evidence but do not forward revoked-origin operations. Friend permissions remain separate.
- Private seeds remain in the local DB, never exported; DB copies/backups need credential protection. No live group is provisioned by this change.

## Wire v1

- Signed object: `{body_b64, signature_b64}`, standard padded base64. Body is UTF-8 JSON, issuer produces RFC8785 JCS. Ed25519 signs `UTF8("manadj-device-group/v1") || 0x00 || body_bytes`. SHA256 covers body bytes only.
- Preserve issuer bytes/signature without reserialization. Receivers validate issuer JCS equality, strict schemas, duplicate keys and unknown fields; never replace received bytes with their serialization. Max decoded operation 1 MiB; max other decoded body and HTTP request 4 MiB; one operation per page. No paths, credentials or local settings in operations.
- Common signed body: `format="manadj-device-group/v1"`, `group_id`, `origin_device_id`. UUIDs use lowercase hyphenated form.
- `session-create`: `operation_id` UUID, `parents=[]`, complete existing `manadj-peer-session/v1` `bundle`. Manifest origin equals signer; Session and logical Track UUIDs preserved. Source integer Track IDs remain namespaced references, never receiving bindings.
- Create-only: nonempty parents/update/delete rejected. Independent Sessions commute. Different valid creations of one Session remain separate operations; projection preserves immutable conflicts, never overwrites or chooses by clock.
- Operation UUID binds exact bytes permanently within group. Duplicate bytes/signature are idempotent; UUID reuse with other bytes rejected. Local origin issues only one operation per Session/group; retry returns original bytes.
- `deliver`: `recipient_device_id`, `operation` signed object. Relay signs outer body, original signer signs inner operation. Receiver commits ledger before returning signed `ack`.
- `ack`: `recipient_device_id` (delivering peer), `operation_id`, `operation_sha256`. Signer attests durable metadata receipt only, not local media/readiness. Acks are per peer and persisted. Retry delivery recovers lost ack.
- `pull`: `recipient_device_id`, `request_id` UUID, `after` nonnegative safe integer. `page` echoes request UUID, names requester as recipient, includes `operations` (0 or 1), `next_after`, `more`. Cursor belongs to serving replica, not a causal clock or portable ID. Start at zero after every completed scan; retain cursor only across pages/retries of that scan. Concurrent arrivals may require another scan.
- Pull excludes requester-origin, requester-acknowledged and revoked-origin operations. Client stores each pulled operation through verified ledger seam and sends signed ack. Retries/noecho never mint operations.

## HTTP adapter

- `POST /api/device-groups/{group_id}/deliver` → signed ack.
- `POST /api/device-groups/{group_id}/pull` → signed page.
- `POST /api/device-groups/{group_id}/ack` → `{stored: true}`.
- Requests authenticate against pinned group members, never legacy phone/friend tokens. No network enrollment endpoint. Phone initiates foreground pull/push; no phone listener required. HTTP requires separately configured reachability/TLS. No discovery/daemon/install/configuration implied.
- Local source selection uses existing guarded Session export. Group operations carry that immutable export. Received evidence projects explicitly through existing validation/readiness/conflict machinery; no automatic playback/personal Library materialization.

## Verification

- Three independently migrated generated DBs A/P/B; A→P→B without A/B transport, reverse, restart/retry, exact byte/ID/provenance equality, durable per-peer acks/noecho.
- Missing/changed assets and reused local integers cannot imply readiness/bindings.
- Unknown/revoked members, forged signatures, group/recipient substitution, UUID equivocation, malformed/oversized bodies, unsupported bases and immutable conflicts reject or preserve evidence without overwrite.
