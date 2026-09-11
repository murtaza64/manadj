# Feedback service

Backend for #244; integrated review belongs to #243. No library DB migration.

## Entry points

- `backend/feedback.py`: validation, origin resolution, SQLite reports/batches, delivery worker.
- `backend/feedback_transport.py`: bounded `gh` subprocesses and existing-session OpenCode HTTP adapter.
- `backend/routers/feedback.py`: standalone `/api/feedback` router.
- `backend/main.py`: service startup/shutdown; polls every five seconds.

## HTTP contract

- All requests, including reads, require `X-Manadj-Feedback: 1`.
- Browser `Origin` must be HTTP(S) loopback. Missing Origin is allowed for local CLI clients; `null`, file and foreign origins are rejected. Responses containing evidence use `Cache-Control: no-store`.
- POST bodies require `application/json`; maximum body is 4 MiB + 256 KiB + 64 KiB, enforced while streaming, including chunked requests.
- Existing context, reports, submission, filing retry, dispatch and batch retry contracts are unchanged. Mutations return HTTP 200, including persisted filing failures/uncertainty.
- Addition: `GET /api/feedback/reports/{UUID}` returns `Report` plus `snapshot`, `screenshot`, and `capture_warnings`. It is scoped to this app workspace. Lists omit evidence.
- Invalid inputs: 422; oversized body: 413; foreign Origin/missing header: 403; wrong content type: 415; foreign/missing record: 404; stale capture, immutable ID collision or overlapping batch: 409.
- Snapshot: prescribed top-level allowlist, 256 KiB serialized UTF-8, depth 12, 10,000 nodes, 16,384-character strings, 200-character keys, finite JSON numbers. Warnings: at most 30 strings of 1,000 characters.
- Screenshots: PNG data URL, at most 4 MiB encoded, at most 32 million pixels. PNG metadata is stripped; visible secrets cannot be automatically redacted. Preview/remove screenshots before submission.
- Capture origin must exactly match `/context`, including the startup-pinned jj commit ID. Owner is normalized to `opencode:ses_...`; lane/owner are resolved from the canonical lane record, not UI input. Stale captures require recapture; ownership changes require app restart and routing review.

## Storage and filing

- Default: shared editspace `feedback/feedback.sqlite3`; without a sidecar, `$XDG_DATA_HOME/manadj/feedback/feedback.sqlite3` (default `~/.local/share`). `MANADJ_FEEDBACK_DIR` overrides the directory for isolated tests/deployments. All processes coordinating delivery must share it.
- Store directory is 0700; SQLite, its journals and the operations lock are private. A store-local `.gitignore` excludes evidence from sidecar snapshots. Evidence lives transactionally inside SQLite, not in disposable lane directories or the library DB.
- Rows are scoped to the canonical app workspace path. IDs are global UUIDs; repeated identical submissions return the immutable original. A different payload or workspace cannot reuse the ID.
- Obvious token/password/key/cookie patterns are scrubbed from text and nested snapshot values before storage. No raw logs, env files, configs or library DB are read. Screenshots remain local; redaction is heuristic, not a guarantee that arbitrary user text contains no secrets.
- Persist report/evidence before GitHub. Fixed destination: `murtaza64/manadj`; label: `needs-human`; hidden marker: `<!-- manadj-feedback:UUID -->`. Issue text explicitly prohibits action before dispatch. Only sanitized title/description, kind, origin/revision and local report reference leave the app.
- `filing_failed`: a pre-write/read failure; explicit retry can file. `filing_uncertain` (including a recovered `filing` state): create might have succeeded. Retry/poll enumerates all-state GitHub issues for the marker, never issues another create. Search indexing is not trusted.
- A crash before the first filing attempt leaves `pending`; polling can complete that already-authorized submission. It cannot dispatch it.
- A negative reconciliation cannot prove that an interrupted create failed. Such reports remain uncertain for manual investigation; there is deliberately no blind force-retry/reset endpoint. Enumeration caps at 100 pages of 100 issues and 2 MiB per response; transport errors are bounded static messages, never raw CLI stderr.

## Explicit delivery

- Dispatch atomically freezes only selected filed, unbatched reports. Repeating the same selection returns the same batch; partial overlaps are rejected. New reports stay pending. Background polling never dispatches an unbatched report.
- Lane batches target only the existing lane owner, at the canonical repo workspace. Main batches require `MANADJ_FEEDBACK_TRIAGE_SESSION`; optional `MANADJ_FEEDBACK_TRIAGE_DIRECTORY` defaults to the main workspace. If the configured directory is a lane, its record must still name that session.
- Absent main configuration produces `needs-routing`. After configuration, explicitly retry that batch. A pinned recipient is never silently replaced. Missing/changed owners, missing sessions, archived sessions and directory mismatches require routing review.
- `MANADJ_FEEDBACK_DAEMON_URL` defaults to `http://127.0.0.1:4096`; only loopback HTTP(S) URLs are accepted. No redirects/proxies, session creation, `es resume`, `es loop`, owner writes or credential reads. POST always specifies `agent: lane` and one correctly encoded `directory` parameter.
- Admission requires an explicit `idle` status and successful empty-for-recipient question/permission checks. Busy, retry, absent/unknown status or offline daemon defers. The upstream daemon may omit idle entries: this intentionally defers rather than inferring idle. Status admission is not atomic with other clients' prompts; the daemon has no compare-and-send endpoint.
- A cross-process file lock serializes writes. A durable unique session slot prevents multiple in-flight feedback batches even across app workspaces. `submitted` and the slot commit **before** `prompt_async`; HTTP acceptance is not acknowledgement.
- Submitted retries only reconcile existing messages, never resend, even after a timeout/restart. Process loss between committing `submitted` and posting can therefore require manual routing. Lost/truncated message history also requires manual review rather than guessing.
- The prompt asks the existing agent to emit `MANADJ_FEEDBACK_ACK:BATCH_UUID` as a standalone assistant-text line before acting. Polling accepts it only in an assistant message whose `parentID` identifies a user message containing the exact standalone `MANADJ_FEEDBACK_BATCH:BATCH_UUID` marker. That persisted acknowledgement changes the batch to `delivered` and releases its session slot. There is no acknowledgement token or credential in the browser API.
- `delivered` means acknowledged receipt, not implementation complete. A submitted batch changed to `needs-routing` retains its session reservation: manual investigation must establish the original outcome before releasing/re-routing it.
- `needs-human` is never automatically removed from filed issues, even on delivery. The authorized recipient claims/routes the issue and changes markers under tracker policy. No undispatched report enters the automatic frontier.
- Prompts identify report titles, bodies and evidence as untrusted data, preserve land/review policy, and include only refs/summaries. Authorized recipients can read `reports.evidence` from the shared SQLite store by UUID or use the origin app's scoped evidence endpoint; they do not need another lane's writable workspace or real library DB.

## Verification

Run with an existing interpreter containing FastAPI, Pillow, pytest and httpx; no GPU dependencies are needed by this service:

```sh
uv run --no-project --python /path/to/existing/python -m pytest --confcutdir=tests/feedback tests/feedback -q
uvx ruff check backend/feedback.py backend/feedback_transport.py backend/routers/feedback.py tests/feedback
uv run --no-project --python /path/to/existing/python -m alembic heads
```

Tests use temporary stores, fake gh and a loopback decoy HTTP daemon. They never file real issues or wake real agents. Integrated desktop/browser walkthrough and real-daemon compatibility verification remain with #243; do not treat fake-transport delivery tests as a completed live feature rollout.
