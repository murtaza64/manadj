# Loaded-release notes (#420)

- Source of truth: the cut-time `build-info.json` + `release-notes.json` beside the loaded backend tree, never a feed or offered package.
- Port: later (#419) for Android. macOS and Windows share this frontend and packaging contract.
- Not implemented: update checks, downloads, activation, restart, automatic landing, or applied-artifact receipts (#418/#421).

## Contract (schema 1)

`build-info.json` has exactly:

```json
{"schema":1,"version":"0.1.0","source_revision":"<40 lowercase hex commit>","notes_sha256":"<64 lowercase hex>","release_id":"<64 lowercase hex>"}
```

`release-notes.json` has exactly:

```json
{"schema":1,"release_id":"<same ID>","body":"Authored plain text notes"}
```

- `notes_sha256`: SHA-256 of body UTF-8 bytes, no implicit newline/normalization.
- `release_id`: SHA-256 of UTF-8 `json.dumps(fields, sort_keys=True, separators=(',', ':'))`, where fields are `schema`, `version`, `source_revision`, `notes_sha256` only. All identity strings are ASCII; sorted keys: `notes_sha256`, `schema`, `source_revision`, `version`.
- Body: nonblank, at most 32,768 UTF-8 bytes. File reads are bounded. Missing, malformed, inconsistent or wrong-release files expose no release.
- Backend snapshots the pair once at process startup. This binds the declared source snapshot, not a live mutable checkout or cryptographic artifact attestation. Later delivery needs artifact hashes separately.
- Frontend stamps `VITE_MANADJ_RELEASE_ID` at build time. No matching frontend ID means no automatic popup, even with valid backend metadata.

## Build inclusion

- `scripts/release/metadata.py` cuts notes from the **exact** `CHANGELOG.md` version section; no base-version/Unreleased fallback for app notes.
- Shared `build_frontend()` prepares `build/release/metadata`, stamps the frontend ID and writes `frontend/dist/build-info.json`.
- Both `build_dmg.py` and `build_windows.py` validate that frontend receipt and stage the pair at `resources/backend/{build-info,release-notes}.json`.
- `release.py` passes its pinned commit as `MANADJ_SOURCE_REVISION`; jj builds verify the same tree. Direct builds use their working-copy commit; Actions uses clean `HEAD`. These commands build packages, not an updater.
- Source/dev: explicitly freeze a pair via `cut_metadata(...)`, set backend `MANADJ_RELEASE_DIR` to its directory, and set frontend `VITE_MANADJ_RELEASE_ID` to the same ID. An operator supplying a pair asserts that loaded source snapshot. Neither environment variable applies an update.

## API and acknowledgement

- `GET /api/release?release_id=<frontend ID>` → `{"release": null}` on absence/mismatch; otherwise `{"release": {<build-info fields>, "body": "...", "seen": false}}`. `Cache-Control: no-store`.
- `POST /api/release/seen` with `{"release_id":"..."}` → `{"seen":true}` only after persistence; 409 for a different loaded release, 422 for invalid ID, 503 for a write failure.
- Receipts: `<data_root>/data/release-seen/<release_id>.json`, exactly `{"schema":1,"release_id":"..."}`. Unique temp file, fsync, atomic replace, directory fsync on POSIX. One receipt per release; rollback does not erase newer or older acknowledgements. No library schema changes.
- Receipt is written only on Done/Escape, not on fetch/display. Failure stays visible; closing without acknowledgement does not mark seen.

## Launch policy

- One startup request, no polling, reload, update offer or background modal.
- Automatic opening requires unseen matching metadata, response within 1.5 seconds, no intervening pointer/key interaction and no existing dialog. Otherwise notes remain available manually. This is a conservative launch window, not an audio/capture-idle detector.
- Manual reopen: Settings header → Release notes. Text is React-escaped, never rendered as HTML.

## Isolated review

```sh
uv run scripts/release/review.py --source-revision <candidate full commit> --state build/notes-review
```

- Prints free-port review/API URLs; serves actual components and router without `backend.main`, DB, workers, media or device access.
- Open → popup; Done → reload without popup; Release notes → reopen. The review fixture is explicitly marked as a sample.
- Logs: redirect stdout/stderr to `build/notes-review.log`. Stop: SIGTERM the review process; it terminates its Vite child.
