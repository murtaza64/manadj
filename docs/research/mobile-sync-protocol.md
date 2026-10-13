# Mobile sync protocol: postures per data class

Question: what does the existing track-scoped sync machinery already provide,
what do desktop-authoritative vs CRDT approaches cost for our data classes,
and what is the minimal v1 protocol? (gh#152, feeds map gh#65.)

Date: 2026-08-25.

## TL;DR

Desktop-authoritative hub-and-spoke, not CRDT. Two devices, one user, one
hub: the desktop stays the source of truth (ADR 0001 extends cleanly), mobile
keeps an op-log of its edits and pushes it; per-field LWW ordered by hybrid
logical clocks covers the annotation conflict zone; grids sync as **semantic
ops replayed through the existing server-side grid operations**, refused and
surfaced when the base grid moved. Evidence is append-only and unions by
uuid. Audio and analysis artifacts are pull-only. CRDT machinery (cr-sqlite,
Yjs/pycrdt, Automerge) solves N-peer convergence we don't have, at schema
and integration costs we'd pay immediately.

## Posture table

| Data class (tables) | Mutability | Edit sites | Recommended posture | Conflict handling |
|---|---|---|---|---|
| Audio files (disk files; `tracks.filename`) | Immutable content (replace = new provenance) | Desktop only | Content-addressed pull, subset selection | None possible |
| Analysis artifacts (`waveforms`, `grid_analyses`, analyzed key) | Derived, machine-written, overwritten per run | Desktop only (compute) | Desktop-authoritative pull, versioned by (track, analyzer/blob version) | None — regenerate/re-pull |
| Track metadata (`tracks`: title/artist/key/energy/main cue) | Scalar fields | Both | Per-field LWW via HLC | Newest HLC wins; overwrite of a curated value surfaced in sync report |
| Tag assignments (`track_tags`) | Add/remove set | Both | Op-log of assign/unassign, LWW per (track, tag) pair | Pair-level LWW; deletes need tombstones/ops |
| Hot cues (`hotcues`) | Slot-keyed rows | Both | Per-slot LWW via HLC (slot = natural identity) | Slot-level LWW; surfaced |
| Beatgrids (`beatgrids`, origin edited/imported) | Whole semantic artifact; edits are ops (ADR 0016/0027) | Both (mobile grid edit is in scope) | Mobile ships grid *ops* (set-downbeat, nudge, re-tempo); desktop replays through `beatgrid_ops` | Base-version check: refuse + surface pick-a-side when desktop grid moved since mobile's base. **Open decision — see map gh#65** |
| Metric ladders (`metric_ladders`) | Deviation rows | Desktop (v1) | Pull-only v1; whole-row LWW later | n/a v1 |
| Evidence (`sessions`, `session_chunks`, `takes`, `routine_candidates`) | Append-only logs / immutable rows | Desktop only (no live DJing on mobile) | Pull-only v1; union by uuid if mobile ever captures | Union on unique ids; no merge needed |
| Transitions (`transitions`, `transition_templates`) | Opaque drawn payload, uuid identity | Desktop (mobile transition editing is a *maybe*, map gh#65) | Pull-only v1 | Deferred; pair-replace write model (ADR 0011) does not survive two writers — needs per-uuid ops if mobile ever edits |
| Sets (`sets`, `set_entries`, `set_dormant_pins`) | Wholesale-replace write model | Desktop (mobile needs them read-only for Set playback) | Pull-only v1 | Deferred; whole-set LWW if mobile ever edits |
| Playlists, Links, Tag structure (`playlists`, `playlist_tracks`, `track_links`, `tags`, `tag_categories`) | Rows | Desktop (v1) | Pull-only v1 | Structure rows lack `updated_at` — needs change-log coverage |

## Part 1 — inventory: the existing track-scoped sync machinery

### What it is (and is not)

All three `sync_*` packages reconcile manadj with **external DJ software
libraries** (Engine DJ `m.db`, Rekordbox `master.db`) and the disk/file-tag
surface — confirmed: `SurfaceId = Literal["disk", "engine", "rekordbox"]`
(`backend/sync_status/models.py:13`), endpoints
`SyncEndpointId = Literal["manadj", "engine", "rekordbox"]` (models.py:23).
Nothing in the tree syncs with another *device* running manadj. But the
doctrine and several mechanisms carry over.

- **`backend/sync_common/matching.py`** — Match: two-tier path→basename
  index (`TrackIndex`, matching.py:37), `match_by_key` (generic bucketing),
  `in_sync` (all-present-sources-agree predicate). Match is *recomputed each
  run, never persisted* (CONTEXT.md "Match"); a renamed file is two rows.
  The persistent-ID association ("External Correspondence") is planned, not
  built.
- **`backend/sync_status/`** — the unified sync view aggregator: one
  `compute_sync_status(db, surfaces)` (aggregator.py:50) producing one row
  per track with presence per surface, per-field divergences, and a rollup
  status (`missing-downstream | diverged | not-in-library | unimported |
  in-sync`, models.py:28). Field vocabulary: title/artist/key/bpm/energy/
  tags/hotcues/beatgrid/maincue (models.py:25). Comparison semantics live in
  `compare.py` (BPM tolerance 0.01, cue time tolerance, whole-set hotcue
  comparison, placeholder grid reads as absent). **This is a read-only diff
  engine, not a state machine** — no per-track sync state is stored; status
  is recomputed from scratch each request.
- **`backend/sync_performance/`** — the import write path: Engine → manadj
  hot cues / beatgrid / main cue, with two verbs: `fill-empty` (never
  touches saved info) and `replace` (confirmed overwrite)
  (`apply.py:19-20`). Positions stored verbatim; imported grids get
  `origin="imported"` and clear the anchor (apply.py:94).
- **Conflict story**: there isn't one, deliberately. ADR 0001: directional
  operations, each with a clear winner; Export never overwrites downstream
  with an empty Library value (skip + warn); overwrites of saved info are
  listed and individually confirmed (performance-data-sync PRD, "no silent
  overwrites — unconditional"). The *doctrine* — automatic tier fills
  blanks, confirm tier gates overwrites, conflicts surfaced not auto-merged
  — is the most reusable thing here.

### Data classes and shapes (`backend/models.py`, 724 lines, 21 tables)

| Model | Identity | Timestamps | Notes |
|---|---|---|---|
| `Track` (:15) | int PK; `filename` unique path; `file_hash` indexed **but never populated** (`backend/library/import_manager.py:176` writes `None`) | created/updated_at, archived_at | title/artist/key(+provenance)/bpm(centibpm cache)/energy/cue_point_time/duration/codec/bitrate/filesize |
| `Waveform` (:131) | int PK, unique track_id | created/updated_at | `data_blob` deferred `LargeBinary`, multi-hundred-KB/row (models.py:141-143), 8-band style-agnostic (ADR 0014); glossary: "internal to manadj — never transferred by Sync" (CONTEXT.md "Waveform data") |
| `Beatgrid` (:236) | int PK, unique track_id | created/updated_at | `tempo_changes_json`, `origin` ∈ generated/analyzed/edited/imported, `anchor_time` |
| `MetricLadder` (:257) | int PK, unique track_id | created/updated_at | deviation-only rows; "outside Divergence, Sync, and Export" |
| `GridAnalysis` (:283) | int PK, unique track_id | created/updated_at | analyzer diagnostics, overwritten per run, no versioning |
| `HotCue` (:561) | int PK; natural key (track_id, slot 1-8) unique | created/updated_at | time/label/color |
| `Tag`/`TagCategory` (:151,:163) | int PK, name-unique | **none** | no updated_at |
| `TrackTag` (:181) | int PK; (track, tag) unique | created_at only | assignment rows; delete = hard delete, invisible to timestamp scans |
| `Playlist`/`PlaylistTrack` (:200,:214) | int PK; (playlist, track) unique | Playlist has updated_at; entries created_at only | |
| `Transition` (:307) | **client-generated uuid**, unique on (pair, uuid) | created/updated_at | opaque `data_json`; write model = client-authoritative pair-wholesale-replace (ADR 0011) |
| `TransitionTemplate` (:350) | client uuid, unique | created/updated_at | |
| `Session` (:385) | client uuid, unique | created/updated_at | thin header; events in chunks |
| `SessionChunk` (:428) | (session, seq) unique | created_at only | append-only opaque JSON event batches, ~5 s flush, never edited (ADR 0033); ~2 MB/h raw |
| `Take` (:498) | client uuid, unique | created/updated_at | immutable evidence + `promoted_transition_uuid` pointer; `session_uuid` is provenance-not-FK |
| `RoutineCandidate` (:453) | client uuid, unique | created_at only | recomputable, dies with its Session |
| `TrackLink` (:582) | (low, high) unique | created_at only | bare edge |
| `Set`/`SetEntry`/`SetDormantPin` (:616,:654,:691) | int PKs; entry identity (set, track) unique | Set/SetEntry updated_at; dormant pins created_at | pins reference Transition/Take **by uuid, deliberately not FK** — dangling degrades client-side (models.py:663-666) |

Audio serving already exists with Range support:
`GET /api/tracks/{id}/audio` → `FileResponse` (`backend/routers/tracks.py:170-193`).

### Answers to the key questions

- **Change detection**: every *mutable curated* table carries
  `updated_at = onupdate=func.now()` — usable for a "changed since cursor"
  pull today. Three caveats: (1) it's ORM-level wall clock at second
  precision — fine for pull filtering, **not** fit for conflict ordering;
  (2) `Tag`, `TagCategory`, `TrackTag`, `PlaylistTrack`, `TrackLink`,
  `SetDormantPin` have no updated_at (mostly insert/delete-only rows); (3)
  **no soft delete anywhere** — hard-deleted rows (hot cue removed, tag
  unassigned, transition dropped by pair-replace) are invisible to any
  timestamp scan. Deletion detection is the missing piece; v1 needs
  tombstones or a change log. No dirty flags, no op-log, no version
  counters exist.
- **Identity across devices**: mixed. Performance/evidence artifacts
  (Transition, Template, Session, Take, RoutineCandidate) already use
  **client-generated uuids with unique indexes** — device-sync-ready, and
  ADR 0011 records exactly why ("something must name a Transition before
  the server has seen it" — the same argument applies to a mobile device).
  Tracks, hot cues, tags, playlists, sets use autoincrement int PKs —
  stable only within one desktop DB. `tracks.file_hash` exists precisely
  for content identity but is dead (never computed). Hot cues have a
  natural key (track, slot). Track identity for external sync is
  path-based Match, explicitly flagged as fragile (unified-sync-view PRD
  "Row identity").
- **Does the sync_status pattern generalize?** As a *visibility* pattern,
  yes: a paired mobile device could be one more `SurfaceReader` and appear
  in the divergence matrix for free. As a *protocol*, no: sync_status has
  no per-track state machine, no cursors, no deltas — it's a full recompute
  diff view whose write verbs are user-driven Export/Import. Device sync
  needs cursors, deltas, and automatic application. What generalizes is the
  doctrine: fill-empty applies silently, overwrites of saved info are
  surfaced (the confirm tier), placeholder grids count as absent, empty
  never overwrites saved.
- **Grid edits are already ops with one owner** (ADR 0016/0027): BPM edit,
  set-downbeat, nudge are server-side grid operations
  (`backend/beatgrid_ops.py:26` `write_bpm`; anchor-preserving re-tempo;
  variable grids 409 scalar edits). `tracks.bpm` is a write-through cache
  of the grid projection. This is the strongest internal precedent for
  op-shipping: a mobile grid edit expressed as the same op vocabulary
  replays through the code that already owns the invariants.

### Relevant recorded postures

- ADR 0001: manadj is the source of truth; bidirectional merge machinery is
  legacy; Import is an explicit exception. A mobile *companion* is a manadj
  client, not an external library — but the shape (desktop = hub of truth,
  directional flows with clear winners) extends naturally.
- ADR 0006 (rbxml, amended) + rekordbox-usb-export PRD: exports are
  rebuild/overwrite pushes; audio is the only incrementally-synced payload
  ("incremental for audio (the big bytes), rebuild-from-scratch for the
  database" — the same big/small split mobile sync should make).
- ADR 0011: client-authoritative wholesale replace, uuid identity, "write
  failures warn and log only — no retry queue" (fine for a local client,
  not for a phone that goes offline — mobile needs a durable op journal).
- ADR 0033: Sessions are append-only chunked event logs; Takes are
  self-contained and eagerly persisted; session_uuid is provenance not
  dependency. The whole evidence layer is union-mergeable by construction.
- Waveform glossary entry says waveforms are "never transferred by Sync" —
  written about *external* Sync; device sync should overrule it (mobile
  can't compute waveforms; re-analysis on-device contradicts "desktop is
  the analysis powerhouse") rather than obey it by accident.

## Part 2 — desktop-authoritative vs CRDT

### Desktop-authoritative / hub-and-spoke

Mobile pushes edits as operations; desktop applies and reconciles; mobile
pulls snapshots/deltas. Per-field LWW needs an ordering; wall clocks across
two devices are not one. **Hybrid logical clocks** (Kulkarni, Demirbas,
Madappa, Avva, Leone, *Logical Physical Clocks and Consistent Snapshots in
Globally Distributed Databases*, OPODIS 2014,
https://cse.buffalo.edu/tech-reports/2014-04.pdf) give timestamps that
respect causality (e→f ⇒ hlc(e)<hlc(f)), stay within bounded drift of
physical time, and fit in 64 bits — the standard fix for LWW under clock
skew, with no coordination protocol.

Contrast — CouchDB-style revision trees
(https://docs.couchdb.org/en/stable/replication/conflicts.html): every
document keeps a revision tree; concurrent edits produce sibling revisions;
replication picks a *deterministic arbitrary* winner and preserves losers as
`_conflicts` for the application to resolve. What it buys: no lost writes
ever, symmetric multi-master. What it costs: whole-document granularity
(two devices editing different fields of one track = a conflict anyway,
unless you shard fields into documents), rev-tree metadata forever, and the
resolution burden lands back on the app. For a two-node hub topology this
is machinery without a payoff.

Rekordbox CloudDirectPlay / Apple Music library sync: no primary-source
documentation of their internal reconciliation models exists; skipped per
the research ground rules (nothing verifiable beyond marketing pages).

### CRDT-ish options (status verified 2026-08)

- **cr-sqlite** (https://github.com/vlcn-io/cr-sqlite): runtime-loadable
  SQLite extension; `crsql_as_crr('table')` upgrades a table to a
  conflict-free replicated relation (rows = maps of column CRDTs; LWW
  registers and fractional indexes shipped; counters/rich-text incomplete);
  `crsql_changes` virtual table yields/accepts changesets keyed by
  (pk, col, col_version, db_version, site_id). History-free — keeps only
  current state. README-reported perf: CRR inserts ~2.5× slower, reads
  unchanged. Loadable from Python via `load_extension`. Fit issues for us:
  requires stable-across-devices primary keys (our int autoincrement PKs
  collide — every synced table would need uuid PKs first), column-level LWW
  uses *its* versioning not semantic ops (a grid edit becomes "the
  tempo_changes_json blob changed", losing the ADR 0016 op semantics),
  schema changes must go through `crsql_begin_alter`/`crsql_commit_alter`
  alongside alembic, and server-side invariants (write_bpm ownership,
  silent-session sweeps) run outside the merge layer. Maintenance: commits
  continue (latest 2026-08-10) but the **last tagged release is v0.16.3,
  2024-01-17** (GitHub API) — no release in ~2.5 years; the v2 event-log
  approach remains unshipped.
- **Yjs / pycrdt** (https://pypi.org/project/pycrdt/): Python bindings to
  Yrs, owned by Project Jupyter, actively released (0.14.4 on 2026-08-23),
  classifier "4 - Beta". Healthiest Python CRDT path. But Yjs is
  document-shaped (Map/Array/Text with tombstone-bearing item metadata):
  adopting it means the Y-doc becomes the truth and the SQLAlchemy schema a
  projection — a dual-representation rewrite of the persistence layer, plus
  storage overhead per edit. Its killer feature (sequence CRDTs for
  collaborative text/order) matches nothing in our conflict zone.
- **Automerge**: Rust core with mature JS bindings; the Python package
  (`automerge` on PyPI) is stuck pre-release — 1.0.0rc1 (2024-03), dev
  builds `0.2.0.dev1..dev4` (2025-12 → 2026-04), no stable release
  (verified via PyPI JSON API 2026-08-25). Automerge also retains full
  change history by design (compressed, but growing). Not production-ready
  on the Python side.

### Verdict

CRDTs buy automatic convergence among N peers with no distinguished node.
We have one user, one hub (desktop), one spoke (phone), sync always
happening *against the hub* — the hub can just be the arbiter. The costs are
concrete and immediate: uuid-PK migration of every synced table, a merge
layer that bypasses the app's server-side op invariants, an extra native
dependency on both platforms, and (cr-sqlite) a stalled release train. The
one CRDT idea worth stealing is the *shape* of per-column LWW with
site-id'd versions — implementable in ~two plain tables + HLC without the
extension.

## Part 3 — per-data-class detail

### Audio files

Immutable content; desktop-only writes (acquisition, replace-audio).
Content-addressed transfer: populate `tracks.file_hash` (sha-256) at import
and backfill (the column and index already exist, models.py:20 — dead
today). Mobile pulls by hash; hash mismatch = re-pull; renames become
no-ops. Subset selection is required (phone storage < library): select by
Playlist/Set/Tag/recent, expressed as a device-side "wanted set"; the
existing Range-supporting audio endpoint (routers/tracks.py:170) already
serves the bytes, though a by-hash route keeps the addressing honest.

### Analysis artifacts

`Waveform` (blob), `GridAnalysis`, analyzed key: machine-derived,
overwritten per run, no user edits. Desktop-authoritative, mobile
read-mostly. Version by `(track_id, updated_at)` or a content hash of the
blob; mobile re-pulls when stale. Waveform blobs are the only large rows
(multi-hundred-KB, deferred loading, models.py:141) — pull lazily per
wanted-set track, never via relationship traversal (the 21 s sync-status
incident is the cautionary note in the model itself).

**Separate analysis output from human grid edits.** The `Beatgrid` row is
where they collide: `origin` already encodes it (analyzed/imported vs
edited vs generated-placeholder). Analyzed grids flow desktop→mobile like
any artifact; the moment either side *edits*, the row changes class — see
next section.

### Annotations / grids / cues — the conflict zone

Fields: title, artist, key, energy, main cue, tag assignments, hot cues,
beatgrid, metric ladder. Options evaluated:

1. **Per-field LWW with HLC** (recommended for scalars, tag pairs, cue
   slots). Granularity matches how edits actually happen (retitle on the
   train, set energy at the desk — different fields, no real conflict).
   Concurrent same-field edits: newest HLC wins, the overwritten value goes
   in the sync report (the confirm-tier doctrine, downgraded to
   after-the-fact visibility — with one user, a true same-field race is
   rare and either value is theirs).
2. **Full CRDT** — rejected above; nothing in this zone needs sequence
   merging, and per-field LWW *is* the CRDT register semantics without the
   dependency.
3. **Checkout / edit lease** (track-scoped lock: "this track is checked out
   to the phone"). Honest about the beatgrid problem, and trivially correct
   — but it makes offline-first mobile editing conditional on having
   remembered to lease, which is exactly the "annotate on the train"
   failure mode. Wrong default; possibly right *for grids only*.
4. **Grid ops replayed server-side** (recommended for beatgrids). A grid
   edit is not a field write — it's set-downbeat / nudge / re-tempo /
   grow-shrink, already implemented as single-owner server operations (ADR
   0016/0027, beatgrid_ops.py). Mobile records the op sequence with the
   base grid version it applied to; desktop replays ops through the same
   code (invariants — anchor preservation, bpm cache write-through,
   variable-grid refusal — for free). If the desktop grid moved since the
   base version: refuse the replay, surface pick-a-side, reusing the
   performance-data-sync overlay diff viewer pattern (one waveform, both
   grids drawn). Whole-grid LWW is the fallback if op-replay proves fussy —
   a grid is one semantic artifact, so row-level LWW is at least coherent,
   unlike field-merging tempo_changes JSON.

The grid/cue conflict posture is flagged open on the map (gh#65). This doc's
recommendation: **per-slot LWW for cues, op-replay + surface-on-conflict for
grids**; the honest alternatives are whole-grid LWW (simpler, can silently
drop a desktop edit into the report) and a grid-only edit lease (safest,
worst offline ergonomics).

### Evidence layer

Sessions/chunks/Takes/RoutineCandidates are append-only or immutable with
uuid identity (ADR 0033; models.py:385-558). Merge = union on uuid /
(session, seq). Mobile v1 produces none of it (no live DJing; Session and
Set playback on mobile are read paths), so v1 is a plain pull. If mobile
ever captures (e.g. listening-session annotations become events), union
merge is already the right shape — no design debt. One mutable edge:
`takes.promoted_transition_uuid` is set on promotion (desktop verb) —
desktop-authoritative field, no conflict.

### Sets / routines / transitions

Desktop-edited, wholesale-replace write models (ADR 0011 for transitions;
SetEntry replace per models.py:657). Mobile needs them **read-only** for Set
playback. Pull-only in v1. Flag for later: pair-wholesale-replace cannot
take writes from two clients (last replace silently drops the other's rows)
— if mobile transition editing ever lands (open on gh#65), Transitions need
per-uuid ops first. That is a reason to keep it out of v1, not to redesign
ADR 0011 now.

## Minimal v1 protocol

Desktop remains sole authority; mobile is a caching client with a durable
op journal for its own edits. Sync is one HTTPS conversation with the
desktop app (same FastAPI server, new `/api/device-sync/*` router):

1. **Pull manifest**: mobile sends its cursor; desktop returns all
   `change_log` entries since (table, row uuid/natural key, op, HLC), plus
   snapshots of changed rows for the mobile-relevant tables. Deletions
   arrive as change-log tombstone entries — the piece `updated_at` alone
   cannot provide.
2. **Pull artifacts**: waveform blobs and audio lazily, for the device's
   wanted set only; audio content-addressed by `file_hash`, Range-resumable
   (endpoint exists, routers/tracks.py:170).
3. **Push op journal**: mobile uploads its ordered ops
   (`{device_id, hlc, entity, field-or-op, payload, base_version?}`) —
   scalar field sets, tag assign/unassign, cue slot set/clear, grid op
   sequences with base grid version.
4. **Apply**: desktop applies per-field LWW against the stored last-write
   HLC per (entity, field); grid ops replay through `beatgrid_ops`;
   base-version mismatches and losing overwrites are **surfaced in a sync
   report, never silent** (the performance-data-sync confirm-tier doctrine).
5. **Ack + new cursor**: mobile trims its journal; desktop's applied ops
   enter the change log like any other write, so the next pull converges.

Derived from the inventory, this reuses: uuid-identity precedent (ADR 0011),
the fill-empty/confirm overwrite doctrine (sync_performance), the grid op
ownership (ADR 0016/0027), append-only evidence (ADR 0033), the audio Range
endpoint, and the divergence-matrix UI pattern for the report.

### Required schema additions (desktop)

- `tracks.uuid` (client-generated, unique) — device-stable track identity;
  int ids stay for internal FKs. (Alternative: lean on `file_hash` — but
  hash changes on replace-audio; a uuid survives it.)
- Populate + backfill `tracks.file_hash` (sha-256); compute at import.
- `change_log(id, table, row_key, op, hlc, device_id)` — maintained by a
  SQLAlchemy after-flush hook (or explicit calls in the write paths);
  doubles as tombstone store. SQLite's single-writer makes a monotonic log
  id a valid cursor.
- `field_versions(entity_type, entity_key, field, hlc, device_id)` — the
  LWW comparison store for the annotation fields (or fold into change_log
  queries; separate table keeps apply O(1)).
- `devices(device_id, name, paired_at, last_cursor)`.
- Beatgrid version marker for op-replay base checks — `updated_at` may
  suffice; an integer `rev` is cheaper to reason about.
- Mobile side: its own SQLite mirror of the pulled tables + `op_journal`.

Existing `updated_at` columns stay as human-facing metadata; they are not
the sync mechanism (wall clock, second precision, ORM-only, blind to
deletes).

## Open questions

- **Grid/cue conflict posture** — the map's flagged decision (gh#65).
  Recommendation above (per-slot LWW cues; grid op-replay with
  refuse+surface); alternatives: whole-grid LWW, grid-only edit lease.
  Needs a human call before v1 freezes.
- Track identity vs renames: does `tracks.uuid` land with this work, or
  does device sync inherit Match's rename-is-two-rows limit? (External
  Correspondence is planned but unbuilt.)
- Wanted-set unit: playlist / Set / tag / manual pick — and eviction policy
  when the phone fills.
- Transport & pairing: LAN-only (desktop reachable when home) vs a relay;
  auth for the sync endpoints (today the API is unauthenticated localhost).
- Does mobile ever capture evidence (annotation-while-listening events)?
  Union merge is ready either way; the product question is open.
- Whether the mobile device should also appear as a read-only Surface in
  the unified sync view (cheap observability win via the SurfaceReader
  seam, aggregator.py:41).

## Sources

- Codebase: file/line refs inline above (models.py, sync_common/matching.py,
  sync_status/{models,aggregator}.py, sync_performance/apply.py,
  beatgrid_ops.py, routers/tracks.py, library/import_manager.py:176).
- ADRs 0001, 0006 (both), 0011, 0016, 0020, 0027, 0033; PRDs
  unified-sync-view, performance-data-sync, rekordbox-usb-export, sessions,
  transition-takes; CONTEXT.md glossary (Surface, Match, Export, Import,
  Diverged, Waveform data, Session, Take).
- HLC: Kulkarni et al., OPODIS 2014 — https://cse.buffalo.edu/tech-reports/2014-04.pdf
- CouchDB conflicts — https://docs.couchdb.org/en/stable/replication/conflicts.html
- cr-sqlite — https://github.com/vlcn-io/cr-sqlite (README; release/commit
  dates via GitHub API, checked 2026-08-25)
- pycrdt — https://pypi.org/project/pycrdt/ (0.14.4, 2026-08-23)
- Automerge Python — https://pypi.org/pypi/automerge/json (1.0.0rc1
  2024-03; 0.2.0.dev4 2026-04; no stable release)

## Unverified / skipped

- Rekordbox CloudDirectPlay and Apple Music library-sync internals: no
  primary-source documentation; skipped.
- cr-sqlite production maintenance posture: commits continue (2026-08) but
  no tagged release since v0.16.3 (2024-01); interpret as "alive but not
  shipping" — not independently confirmed with maintainers.
- Waveform blob exact sizes: "multi-hundred-KB" is the model comment
  (models.py:142), not measured against the real DB (unreachable from this
  lane by policy).
