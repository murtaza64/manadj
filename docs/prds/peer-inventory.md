# Read-only peer inventory

- Issue: #440, child of #427. Follow-up: #441 immutable Session exchange, blocked by #440.
- Source base: clean main `3defc5e189f91f899a427bd3934b0307d876a8c6`.
- Port: now — desktop/backend contract with POSIX/Windows adapters; Android Device sync snapshot/journal/listener behavior preserved. No native peer UI in this checkpoint.
- Scope: compare explicit inventory bytes against local DB facts. No migration, persistent identity assignment, merges, listeners, Syncthing changes or media access.

## API

- `POST /api/peer-inventory/export`: `{replica_id: UUID, roots: [{key, flavor: "posix"|"windows", path: absolute-local-root}], logical_ids?: {local_integer_as_string: UUID}}`.
- `POST /api/peer-inventory/compare`: `{local: <same local export configuration>, remote: <exported inventory>}`. Import is parse/compare only; nothing is staged or applied.
- Both routes require loopback and reject foreign Origin/cross-site browser calls. Not mounted on own-phone listener; no friend keys, device tokens, network contact or transport reuse.
- Inventory: required `format: "manadj-peer-inventory"`, integer `version: 1`, caller-explicit replica UUID, Track rows. Root configuration is local-only; wire locations contain a root key and portable relative path segments, never the absolute local root/filename.
- Each row carries source-local integer, optional supplied logical UUID claim, source-created-at text, snapshot token, location/null, legacy hash hint/null, `availability: "not_checked"` and recorded facts. BPM is explicitly the DB centiBPM cache, not a claim of current analyzed/playback readiness.
- Snapshot token is SHA256 of the canonical public row facts excluding the token. It detects inconsistent snapshot content; it is neither a signature, byte fingerprint, persistent row-incarnation ID nor logical Track identity.
- Limits: 4MiB request, 3MiB exported inventory, 5000 Tracks, 16 explicit roots. Repeated JSON keys, duplicate source IDs, non-integer/unknown versions, unknown fields, unsafe path segments and invalid mappings reject422; size limits reject413. Candidates are capped20 per source row, with uncapped-within-inventory `candidate_total` retaining ambiguity.

## Identity and location decisions

- Existing Track IDs remain machine-local. Namespace them by an explicit caller replica UUID; do not auto-create/guess a global identity. The caller must reuse its intended replica namespace; this checkpoint does not persist or authenticate that namespace.
- Logical UUID claims require an explicit input map. Default is null. Neither same bytes, legacy hash, title/artist, path nor phone audio_rev establishes logical identity. Multiple local rows can legitimately represent different logical Tracks despite identical audio.
- Compare reports all matching hint classes: supplied logical-ID claim, root-key/relative-path hint, legacy hash hint, nonempty title/artist metadata. All are candidates, including a single supplied UUID claim; `resolved_local_id` is always null.
- Legacy file_hash has unknown algorithm/currency. Do not label it SHA256 or use it to infer playable source availability. No file reads/stat/hash scan occur here; missing audio is deliberately `not_checked`.
- Windows roots use drive/UNC-aware lexical paths; POSIX roots use POSIX lexical paths. Longest configured root wins. Equal-specificity aliases, outside-root locations, traversal or nonportable segments produce no inferred mapping. No symlink/case/realpath availability guarantee is made.
- `local_id_overlap` is informational, never a match. Same-replica/local-ID rows with changed public facts expose `origin_row_changed`; that is a changed snapshot, not proof of a particular delete/recreate history.
- Metadata disagreements are listed per candidate; multiple candidates remain ambiguous. Missing remote rows are not tombstones. Creation/update wall clocks do not choose a merge winner.
- Report also lists local IDs with no candidate hint anywhere in the remote inventory and local IDs outside configured roots. Neither list is a deletion or automatic mapping plan.

## Preservation / next checkpoint

- Export and compare run SELECTs only and never commit application changes. Tests compare complete independent SQLite dumps and before/after phone snapshots, as well as phone edit/listener regressions.
- Existing Android snapshot version1, local integer references, journal UUID/old-new/newest-wins policy, pairing and change-log/revert remain unchanged (ADR0045).
- #441 must deliberately add persistent replica/logical Track bindings before accepting immutable Session references. This inventory is not a resolver or phone protocol migration. Session UUID/chunk collisions need content comparison and conflict receipts, not integer substitution.
- Syncthing remains suitable file/immutable-artifact transport. Live SQLite/WAL, credentials, mutable DB backups and external Engine/Rekordbox DBs are not peer exchange artifacts.
- Capabilities merge/session_import/audio_transfer remain false. Curated record reconciliation and native peer-management UI are outside #440.

## Verification

- `uv run pytest tests/test_peer_inventory.py -q`: independent Alembic-migrated SQLite roots, production routers, different POSIX/Windows/UNC roots, reused/colliding IDs, optional UUID claims, missing/unknown hash, divergence/ambiguity, bounded candidates, malformed/oversized imports, local-only gate, unchanged DB dumps and phone snapshot/listener isolation.
- Phone regressions: `tests/test_device_sync.py`, `tests/test_device_edits.py`, `tests/test_device_listener.py`.
- No live database/media/share, own-phone pairing, credentials, listener configuration or merge exercised. API tests use only disposable generated roots.
