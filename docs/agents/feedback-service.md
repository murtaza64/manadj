# Feedback service

Backend for #244; integrated review belongs to #243. No library DB migration.

## Entry points

- `backend/feedback.py`: validation, origin resolution, SQLite reports/batches, delivery worker.
- `backend/feedback_transport.py`: bounded `gh` subprocesses and existing-session OpenCode HTTP adapter.
- `backend/routers/feedback.py`: standalone `/api/feedback` router.
- `backend/main.py`: service startup/shutdown; polls every five seconds.

## HTTP contract

- All requests, including reads, require `X-Manadj-Feedback: 1`.
- Local-only UX: the direct ASGI client IP must be loopback (IPv4/IPv6), even without Origin. LAN clients receive 403. `Forwarded`, `X-Forwarded-For` and `X-Real-IP` headers are rejected, including when a proxy middleware has rewritten the client address. No remote/reverse-proxy feedback access is supported; do not expose this route through an unauthenticated loopback proxy. Tests explicitly use a loopback TestClient peer.
- Browser `Origin` must be HTTP(S) loopback. Missing Origin is allowed for local CLI clients; `null`, file and foreign origins are rejected. Responses containing evidence use `Cache-Control: no-store`.
- POST bodies require `application/json`; maximum body is 4 MiB + 256 KiB + 64 KiB, enforced while streaming, including chunked requests.
- Existing context, reports, submission, filing retry, dispatch and batch retry contracts are unchanged. Mutations return HTTP 200, including persisted filing failures/uncertainty.
- Addition: `GET /api/feedback/reports/{UUID}` returns `Report` plus `snapshot`, `screenshot`, and `capture_warnings`. It is scoped to this app workspace. Lists omit evidence.
- Invalid inputs: 422; oversized body: 413; non-local peer, forwarded identity, foreign Origin or missing header: 403; wrong content type: 415; foreign/missing record: 404; stale new capture, immutable ID collision or overlapping batch: 409.
- Snapshot: prescribed top-level allowlist, 256 KiB serialized UTF-8, depth 12, 10,000 nodes, 16,384-character strings, 200-character keys, finite JSON numbers. Warnings: at most 30 strings of 1,000 characters.
- Screenshots: PNG data URL, at most 4 MiB encoded, at most 32 million pixels. PNG metadata is stripped; visible secrets cannot be automatically redacted. Preview/remove screenshots before submission.
- New captures must match `/context`: startup-pinned revision and server-resolved lane/owner, normalized to `opencode:ses_...`. A missing owner, or a record changed since capture, does not prevent recording/filing; the original capture provenance is preserved. Dispatch freezes such reports as `needs-routing`, never silently retargeting them. A genuinely stale new capture needs recapture with the draft retained. Identical UUID retries resolve the stored immutable report before checking the restarted app's revision/owner; concurrent retries may observe its still-pending filing status.

## Storage and filing

- Default: shared editspace `feedback/feedback.sqlite3`; without a sidecar, `$XDG_DATA_HOME/manadj/feedback/feedback.sqlite3` (default `~/.local/share`). `MANADJ_FEEDBACK_DIR` overrides the directory for isolated tests/deployments. All processes coordinating delivery must share it.
- Store directory is 0700; SQLite, its journals and per-workspace locks are private. A store-local `.gitignore` excludes evidence from sidecar snapshots. Evidence lives transactionally inside SQLite, not in disposable lane directories or the library DB.
- Rows are scoped to the canonical app workspace path. IDs are global UUIDs; repeated identical submissions return the immutable original. A different payload or workspace cannot reuse the ID.
- Obvious token/password/key/cookie patterns are scrubbed from text and nested snapshot values before storage. No raw logs, env files, configs or library DB are read. Screenshots remain local; redaction is heuristic, not a guarantee that arbitrary user text contains no secrets.
- Persist report/evidence before waiting for any workspace transport lock, including another report in the same workspace. Fixed destination: `murtaza64/manadj`; label: `needs-human`; hidden marker: `<!-- manadj-feedback:UUID -->`. Issue text explicitly prohibits action before dispatch. Only sanitized title/description, kind, origin/revision and local report reference leave the app.
- `filing_failed`: a pre-write/read failure; explicit retry can file. `filing_uncertain` (including a recovered `filing` state): create might have succeeded. Only explicit retry enumerates all-state GitHub issues for the marker, never issuing another create. No five-second automatic uncertain-file rescans; search indexing is not trusted.
- A crash before the first filing attempt leaves `pending`; polling can complete that already-authorized submission. It cannot dispatch it.
- A negative reconciliation cannot prove that an interrupted create failed. Such reports remain uncertain for manual investigation; there is deliberately no blind force-retry/reset endpoint. Enumeration caps at 30 seconds total, 100 pages of 100 issues and 2 MiB per response. Other gh operations have 25-second timeouts; errors are bounded static messages, never raw CLI stderr.

## Explicit delivery

- Dispatch atomically freezes only selected filed, unbatched reports. Repeating the same selection returns the same batch; partial overlaps are rejected. New reports stay pending. Background polling never dispatches an unbatched report.
- Lane batches target only the existing lane owner. Its persisted session directory may be the requested canonical lane workspace, that repo's default root, or its sidecar, derived from the canonical lane path. Sibling lanes/arbitrary directories are rejected. Session-by-ID lookup is directory-independent; status, questions, permissions, messages and prompts use the verified **persisted session directory**, not an assumed lane directory. Main batches require `MANADJ_FEEDBACK_TRIAGE_SESSION`; optional `MANADJ_FEEDBACK_TRIAGE_DIRECTORY` defaults to the main workspace. If the configured directory is a lane, its record must still name that session.
- Absent main configuration produces `needs-routing`. After configuration, explicitly retry that batch. A pinned recipient is never silently replaced. Missing/changed owners, missing sessions, archived sessions and directory mismatches require routing review.
- `MANADJ_FEEDBACK_DAEMON_URL` defaults to `http://127.0.0.1:4096`; only loopback HTTP(S) URLs are accepted. No redirects/proxies, session creation, `es resume`, `es loop`, owner writes or credential reads. Preserve the verified session `agent` and map session `model: {id, providerID}` to prompt `model: {modelID, providerID}`; preserve a non-default variant. Missing agent requires routing review, never a fallback to `lane`. Absent optional model is omitted so the daemon resolves the agent-configured/current/last-user/default model; malformed present metadata requires routing review.
- OpenCode 1.18.29 deletes idle entries from `/session/status`. Absent entries count as idle **only** after successful existence/unarchived lookup, verified persisted directory, successful dictionary status response and empty-for-recipient question/permission checks. Explicit idle also qualifies; busy/retry, unknown values/shapes or failed reads defer. Lane ownership and recipient metadata are revalidated before sending. Status admission is not atomic with unrelated clients' prompts; the daemon has no compare-and-send endpoint.
- Cross-process per-workspace file locks serialize filing/delivery; unrelated workspaces never share a network-duration lock. A short atomic SQLite `INSERT OR IGNORE` reserves the unique session slot, including races between different workspaces/processes. Reservation and `submitted` commit **before** `prompt_async`; HTTP acceptance is not acknowledgement. Stop older feedback backends before upgrading this lock protocol; mixed-version processes sharing one store are unsupported.
- Each background pass skips a busy workspace lock and processes at most one interrupted/pending filing and one queued/submitted batch. Batches are checked round-robin. It never automatically reconciles uncertain GitHub writes. Explicit retries remain scoped and serialized.
- Submitted retries only reconcile existing messages, never resend, even after a timeout/restart. Process loss between committing `submitted` and posting can therefore require manual routing. Lost/truncated message history also requires manual review rather than guessing.
- The prompt asks the existing agent to emit `MANADJ_FEEDBACK_ACK:BATCH_UUID` as a standalone assistant-text line before acting. Polling accepts it only in an assistant message whose `parentID` identifies a user message containing the exact standalone `MANADJ_FEEDBACK_BATCH:BATCH_UUID` marker. That persisted acknowledgement changes the batch to `delivered` and releases its session slot. There is no acknowledgement token or credential in the browser API.
- ACK polling reads one bounded page via `/session/{id}/message?limit=10&before=...`, follows only the `X-Next-Cursor` value (not arbitrary Link URLs), and persists progress privately on the batch across restarts. Pages exceeding 4 MiB are retried with `limit=1`; individual messages over 4 MiB still require manual review. Matching assistant ACKs verify the exact parent through `/session/{id}/message/{parentID}`, even across pages. Reaching history's end restarts from recent messages on the next pass. Submitted batches are never resent.
- `delivered` means acknowledged receipt, not implementation complete. A submitted batch changed to `needs-routing` retains its session reservation: manual investigation must establish the original outcome before releasing/re-routing it.
- `needs-human` is never automatically removed from filed issues, even on delivery. The authorized recipient claims/routes the issue and changes markers under tracker policy. No undispatched report enters the automatic frontier.
- Lane prompts name the exact origin workspace and require its ownership guard before code/repo operations, explicitly prohibiting default-workspace edits by root-anchored owners. Main-app prompts instead require triage into an authorized lane and its guard; the main origin stays read-only. Titles, bodies and evidence remain untrusted data; land/review policy is preserved. Authorized recipients can read `reports.evidence` from the shared SQLite store by UUID or use the origin app's scoped evidence endpoint; they do not need another lane's writable workspace or real library DB.

## Verification

Run with an existing interpreter containing FastAPI, Pillow, pytest and httpx; no GPU dependencies are needed by this service:

```sh
uv run --no-project --python /path/to/existing/python -m pytest --confcutdir=tests/feedback tests/feedback -q
uvx ruff check backend/feedback.py backend/feedback_transport.py backend/routers/feedback.py tests/feedback
uv run --no-project --python /path/to/existing/python -m alembic heads
```

Tests use temporary stores, fake gh and a loopback decoy HTTP daemon. They never file real issues or wake real agents. Read-only verification against daemon 1.18.29 confirmed health, root-anchored session agent/model, directory-scoped busy/question/permission responses, and limited message pagination with `X-Next-Cursor`. Upstream references: `session/status.ts:26-47`, `server/routes/instance/httpapi/handlers/session.ts:106-153`, `session/message-v2.ts:430-465,506-518`, `session/prompt.ts:614-646`. No real prompt was sent. #243 still owns integrated human review and live delivery approval.
