# Playlist export inspector · #426

- Decision: APPROVED by Murtaza, 2026-11-01, direct direction recorded in #426: develop side inspector B, Library entry, visual destructive plans; audit connected sync flows.
- Status: source candidate; independent QA and landing/release gates remain. Not installed.
- Design source: #423, frozen `9878c1bbf2ff5b3296c2b50fb6fac2e5e02bb4cb`. No throwaway prototype code is an ancestor of this change.
- Port: never for Android external-library/USB-management controls; Android does not manage these destinations. Phone Device sync semantics are unchanged.

## Current slice

- Library's playlist Export button and Sync's playlist detail open the same production inspector. The clicked playlist name is captured; subsequent underlying selection cannot retarget the operation.
- Choose one destination: Rekordbox desktop or Engine DJ. Scope: playlist + track data, or membership/order only. No implicit all-target fan-out.
- Plan: actual before/after destination order, added/removed entries, changed common positions; per-track before/after hot-cue slots, saved grid, key, Main cue, tags and energy.
- Clear, overwrite, same-value rewrite, skip, blocked record and unknown-prior operations have distinct labels. Destination-only memory-cue deletion is disclosed separately: the current Rekordbox writer replaces the DB memory set with hot-cue mirrors plus Main cue, while its reader does not expose the full prior memory-cue set.
- Shared tag-structure updates show unknown prior structure, not “no changes”. Full export always requires explicit acknowledgement; order-only requires it when entries are removed.
- Removal means destination membership removal, not source-track or audio deletion. Track fields affect other playlists referencing the same destination records.
- Results retain every writer field, including skips on nominally exported tracks. “Needs attention” is not a green track count. Session-memory receipts reopen with the playlist; they are not durable job history.
- Playlist import buttons now explicitly import order into Library only. They no longer silently write to every other configured external library.
- Tracks' existing scope-confirm Apply runs once per plan; Apply and plan dismissal are disabled during its request. Dismiss is not cancellation.

## API and write guard

- `GET /api/sync/export/playlists/plan?playlist=…&target=rekordbox|engine&scope=full|order` is read-only.
- `POST /api/sync/export/playlists/execute?playlist=…` accepts exactly `target`, `scope`, `token`.
- Plan token binds playlist identity/order, source values/media revision, destination identity/order/reader values/file revision and tag catalogue. Execution rebuilds the plan and rejects changed or unavailable state before calling a writer.
- The writer receives the validated destination path, not a second configuration lookup that could retarget the operation.
- A per-destination process-local lease excludes concurrent inspector exports, including same-tick/different-tab duplicate requests. Legacy write endpoints and other processes are not covered by this lease.
- Export safety gate remains server-authoritative. The UI blocks loading, failed, expired (60 s), wrong-context and non-executable plans. Rechecking resets destructive acknowledgement.
- Destination application must be closed; existing writers retain their closed-app/backup behavior.
- This is revalidation, not a cross-database atomic transaction. Another writer changing a destination after revalidation is not prevented by a hash. No rollback promise.
- There is no job/progress/status/cancellation/retry API. The UI waits for the synchronous receipt and prevents closing its panel while pending. Lost/incomplete HTTP receipts remain **outcome unknown**; recheck is a new observation, not a safe retry or job-status lookup.

## Deliberate limits

- Fresh main-based source; no #417 or #422 dependency. Missing downstream records are displayed as **blocked / cannot add**, never fabricated record creation. This inspector will not submit a silently partial playlist; legacy matched-only writer endpoints are unchanged. Restore missing-record export through an explicit #417 integration slice rather than silently dropping tracks.
- Duplicate Library/destination playlist names and repeated source tracks are blocked, rather than allowing name-first selection or the existing full export's ORM de-duplication to change scope.
- Existing blank policy is preserved: no saved grid / no key → skip; unset Rekordbox Main cue / energy and empty cue set can clear destination data; unset Engine energy → skip. Existing Engine foreign tag-list memberships are preserved outside current Library tag names.
- Reader observations are not independent readback. Rekordbox Main cue and full memory-cue prior values remain unknown. Native cue files, app refresh, USB output and hardware playback are not verified by a desktop writer receipt.
- USB is not offered as an implemented destination. #97 engine and #98/#99 task/preflight/UI integration remain separate. No OneLibrary capability.
- Production adapters were not run against real libraries/devices during this task. QA uses in-memory source data and explicit fake destination seams.

## Connected-flow audit and next slices

| Priority | Existing surface / evidence | Next bounded slice |
|---|---|---|
| 1 | Missing destination records; current inspector blocks, #417 clean candidate creates them | Integrate #417 explicitly. Plan record creation separately from membership addition, media readiness and native analysis; show skipped cue/grid prerequisites. Do not stack #422's unresolved loop→point ordering change. |
| 2 | `UnifiedTracksSync.tsx` Engine/Rekordbox presence exports and tag assignments still operate at whole-library/all-missing scope; existing copy discloses this | Coordinate existing #266 owner. Add exact track-ID/path scope and a real read-only plan before reusing inspector visuals. Do not relabel a whole-library operation as selected-track Export. Duplicate confirmation Apply is fixed in this slice. |
| 3 | Track metadata/Disk writes and refresh use existing scope-confirm/per-field actions | Add typed before/after field outcomes and explicit empty-value skip policy. Disk file changes are not desktop external-library writes; do not attach “quit Rekordbox” requirements to them. Keep current inbox rather than adding a dashboard. |
| 4 | Engine performance import already has automatic blank-fill, saved-field overwrite confirmation, textual conflict list and waveform diff | Link bulk conflict entries directly to the existing visual diff; retain per-field choice and exact positions. Do not replace waveform judgment with counts or import saved fields silently. Playlist import's missing-match/error recovery needs a typed preview/result slice, not another confirm loop. |
| 5 | `sync/status` compares reader values; Rekordbox cues can agree in DB while native analysis differs | Surface comparison layer versus actual writer/readback layer. Integrate corrected #422 separately; do not label DB agreement as player-visible readiness. |
| 6 | Phone Device sync (ADR 0045), future desktop peer/Syncthing architecture | Keep external Export, two-way edit reconciliation and file availability separate. Coda/Rook own read-only peer architecture discovery; no peer-state UI or shared conflict policy is implemented here. |

## Verification seams

- Public inspector service: real Alembic-built in-memory source + fake destination observations/writes. Covers visual destructive/unknown/blank policy, exact source/target/scope token, changed destination/source rejection, ambiguous names, missing records, execution lease and export gate.
- Factory seam: validated path is passed to only the chosen destination; a later config lookup cannot retarget it.
- UI/API: clicked context capture, explicit destination, no old-target submission, pending/error/stale guards, destructive acknowledgement, skipped-field receipt, unknown outcome, duplicate Apply and retained session receipt.
- Browser: actual production entry/inspector and routes against in-memory fixtures; desktop/narrow layout, keyboard focus trap/restore, Escape/pending close guard. No real backend ports or destination writers.
- Full frontend suite and production build run. Isolated backend full-suite results and baseline reproduction are recorded in #426; pre-existing config/export-gate and nested-sidecar feedback failures are not weakened to make the suite green.
- Alembic: one head; no migration added.

## Review app

- Live LAN: http://192.168.1.235:5426/
- Notes: http://192.168.1.235:5426/review-notes
- Original comparison remains at http://192.168.1.235:5424/?variant=B
- Personal artifact: no Work Surface fits its audience.
- Build from `frontend/`: `npm exec vite -- build --config scripts/review-export426/vite.config.ts`.
- Run from repository root: `uv run scripts/agent/review_export_inspector.py --host 192.168.1.235 --port 5426`.
- Browser QA: `uv run scripts/agent/check_export_inspector.py --url http://192.168.1.235:5426/` (requires an installed Playwright Chromium). The checker refuses servers without the fixture identity before interacting.
- Independent review: use a free port and a separate `MANADJ_REVIEW_EXPORT_OUT` build path, passed back as server `--assets`; do not replace the live review bundle.
- Fixture server exposes only the new guarded routes plus fixture controls; it never mounts production app startup or legacy destination-writing routes. All mutation/verification controls affect memory only.
- Log: `/tmp/opencode/manadj-export-inspector-426.log`; owned PID/stop command and exact source revision are recorded in #426's walkthrough.
