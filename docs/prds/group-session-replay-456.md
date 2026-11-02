# Exact-local-asset group replay — #456

- Port: now desktop + Android, existing backend/native owners. Source base: reviewed combined `e3e51b671431535fad28bb103bff34ef1e5d55ba`.
- Shared seam: `backend/peer_sync/replay_contracts.py`; NEW signed WAV fixture replaces neither the454 metadata fixture nor its receipts.
- Keep GroupSessionView/v1 `playable=false`; deny-only paired markers never grant replay. A separate replica-local source adapter feeds existing desktop SessionReplayDriver and native ReplayDriver/decoded-load machinery. No new engine.
- Not included: enrollment/pairing/discovery, download/transfer, automatic binding, scheduler, curated/journal merge, live installation or real Library/media/device actions.

## Explicit selection / binding

- Local owner selects a current local receiver Track/file. Selection mints a fresh UUID and opaque incarnation digest; no source/foreign integer, filename similarity, old cache position or ordinary snapshot `audio_rev` establishes binding.
- Capture current row identity/selection nonce AND stable physical file identity plus exact SHA256/length. Same bytes in a replacement file or reused row invalidate the old selection. Missing stable identity support refuses instead of degrading to path/mtime/hash equivalence.
- Desktop reuses441 current-row selection/FK-incarnation guards, adds stable dev/inode/ctime/mtime/size identity. Native selection is over an explicitly selected currently cached local file; snapshot/cache paths are locators only. Its local catalog proof includes current persisted snapshot identity/epoch plus row/file facts, so even an identical rewritten snapshot or replacement file invalidates an old binding. File-identity provider support must be measured/qualified on Android; no JDK-to-Android assumption.
- Store bindings separately by group/op/raw-body hash + logical Track UUID → selected receiver incarnation. Never mutate ordinary snapshot/journal/cache identity or overwrite a prior source recording.
- Selection and readiness DTOs are local, not group transport messages or trust documents. Never accept them from a relay/snapshot as receiver proof. Local paths, credentials and file identity facts remain local; shared DTO exposes only opaque receiver key/incarnation and exact asset descriptor.

## Candidate and decoded proof

- ReplayIdentity binds group/op/Session/original-device/receiver-device UUIDs and exact original operation body SHA256. Generation is SHA256 JCS of `{format:"manadj-group-replay-generation/v1", identity, grammar, bindings}`; bindings sort by logical Track UUID. Receiver-local selection IDs/incarnations intentionally make generations replica-local, not convergence tokens.
- Every binding must exactly match issuer SHA256-file-bytes-v1 and length. `candidate-exact` requires complete supported immutable Session, active local/group/origin authority, no UUID conflict/unknown inventory and all current selections/assets exact. Errors/missing proof refuse; never fall back to raw recorded/desktop/peer caches.
- Backend readiness always says `playable=false`: it cannot attest a client decode. Only an actual successful engine decode/load with matching group identity, generation, logical Track UUID, selected incarnation, asset SHA/length and unique load-attempt ID can satisfy that local source's prepared state. Never persist/deserialize a boolean as decoded authority.
- Revalidate on open/Play/seek/resume/every load, again after asynchronous decode and before scheduling/transport. Old decode completion cannot satisfy a new generation; source change/revoke/read error stops group replay. Desktop uses provenance audioSourceKey/bypass-cache, native reuses existing decoded proof/load bridge. No source fallback when group validation fails.
- Exact local audio reads reopen only a selected local path, compare physical identity before/after, hash/length verify and return the verified bytes, not a later mutable-path reopen. Native uses local files only; no network audio/download implied.

## Supported grammar v1

- Begin with common `load`, `tick`, `transport` actions play/pause/seek/cue and mixer controls fader/crossfader/crossfaderEnabled. All references resolve through logical UUID bindings before compilation to local replay IDs.
- Reject other captured actions/kinds/controls for this version; metadata remains inspectable. Do not silently skip init/stems/FX/scratch/preview/pitch/loop evidence and claim replay fidelity. Freeze the common subset with native before production changes.

## Proof gates

1. Freeze shared DTO/subset and deterministic NEW full two-Track Session + valid PCM WAV recipes/hash/length/signatures. Preserve previous17-byte metadata fixtures and existing generated phone stores.
2. Migrated backend and native tests: explicit exact binding; no ID fallback; same bytes/new file or row incarnation; missing/partial/changed/stale/revoked/conflicted/unknown/read errors; restart; stale async decode/load completion; unrelated original/peer behavior.
3. Actual Python A/B↔Kotlin phone full evidence relay with distinct receiver IDs/incarnations and locally generated files; no audio transport. Exact operation/asset hash equality and zero duplicate/noecho after restart/retry.
4. Real desktop replay and native-host decoded/rendered PCM/frame-position comparison through existing drivers. Real Compose controls must correspond to actual guarded playback, not a renderer-only enabled button. Android MediaCodec/JNI/Oboe/installed lifecycle/physical speaker proof stays separate.
