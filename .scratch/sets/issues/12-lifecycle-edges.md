# 12 — Lifecycle edges

Status: done (landed on main, change kkmpuxuw)

## Parent

.scratch/sets/PRD.md

## What to build

Graceful degradation at the Set's boundaries with the rest of the library: deleting a pinned Transition or Take turns the pin Unresolved (active or Dormant — never a broken reference); Archiving a Track that belongs to a Set flags the Set (visible in sidebar + detail) rather than silently altering it. Planner treats missing artifacts as hard cuts.

## Acceptance criteria

- [ ] Deleting a pinned Transition/Take degrades the pin to Unresolved; playback hard-cuts there
- [ ] Dormant pins referencing deleted artifacts are dropped
- [ ] A Set containing an Archived Track shows a flag; playback still works (Archived audio remains on disk)
- [ ] Router/planner tests cover all three degradations

## Blocked by

- 02-adjacency-pins-evidence

## Comments

**2026-07-05 — implemented (lane setpins, change kkmpuxuw), parked ready-for-human.**

Scope adjustment (agreed in the 08+12 handoff): the "Dormant pins
referencing deleted artifacts are dropped" criterion is deferred to
issue 07 — Dormant pins have no storage yet. Obligation recorded on 07.
Planner untouched (its hard-cut degradation already exists, other lane).

What was built:

- **Delete → Unresolved, server-consistent**: `degrade_pins` in
  `backend/routers/sets.py` nulls every Set pin referencing a deleted
  artifact (kind-aware). Hooked into `DELETE /api/takes/{uuid}` and the
  transitions pair-replace delete loop (the only Transition deletion
  path). The DB never keeps a broken reference; the client's render-time
  degradation (`adjacency.ts`, issue 02) is unchanged and now agrees with
  fresh loads. Client mirror `degradeDeletedPinsLocal` (setStore,
  additive) fires on Take delete from the history view — loaded Sets are
  client-authoritative and would otherwise push the dangling pin back.
- **Archived-track flag**: `has_archived_tracks` computed on every Set
  serialization (never stored); `archive_track` still never touches Sets.
  UI: `sets/archivedFlag.tsx` (own module) — ⚑ glyph on the sidebar Set
  row, one additive `⚑ ARCHIVED TRACKS` badge mount in the SetDetailPane
  header strip. Library archive/unarchive mutations invalidate the sets
  query. Playback of archived tracks is untouched (audio stays on disk).
- Tests: `tests/test_set_lifecycle_edges.py` (sets+takes+transitions+
  tracks mounted): take-delete nulls pins across Sets and spares others;
  pair-replace delete nulls (update keeps; kind-aware uuid namespacing);
  archive flags without altering entries/pins; per-Set flag; unarchive
  clears. Store mirror covered in `setStore.test.ts`.
- Gate: pytest 645, vitest 821, build, eslint clean on touched files
  (2 pre-existing warnings elsewhere), alembic single head (no migration).

**2026-07-05 — verification note + walkthrough (issues 08+12, ready-for-human).**

Stack parked on lane setpins (snmnnqwn → xkwwqkuv 08 → kkmpuxuw 12),
rebased onto trunk vltmzrkx and re-gated. Lane app running at
**http://localhost:5293** (backend 8120, sandbox DB clone; or
`npm --prefix desktop start -- --port 5293`). Seeded Set
**"Lifecycle demo"**: [549, 171, 600, 609, 1005, 837, 792, 665] — take
pin on 549→171, favorite-transition pin on 171→600, unresolved on
600→609, take pins down the 609→…→665 chain.

1. *Archived flag (12)*: Library → All tracks → archive track 600 (it's
   mid-set). Sidebar "Lifecycle demo" row grows an orange ⚑; open the
   set → header shows "⚑ ARCHIVED TRACKS"; entries, order, pins all
   unchanged. Unarchive (Archived view) → flag clears.
   *(Review feedback 2026-07-05, amended into kkmpuxuw: the archived
   track is now identified — its set row carries a "⚑ archived" mark
   with an unarchive/remove hint, and the header badge's tooltip names
   the archived tracks.)*
2. *Take delete degrades (12)*: open the set, note the "● take" chip on
   the 792→665 adjacency. History → Takes → delete the 792→665 take.
   Reload → that adjacency is "✕ hard cut" + red UNRESOLVED; every other
   pin intact. (Server row nulled — survives reload by construction.)
3. *Promotion re-points (08)*: the 549→171 adjacency shows "● take".
   `curl -X PATCH localhost:8120/api/takes/ec8e8fec-8c1f-4ef1-b9d4-074ad493de30/promoted -H 'content-type: application/json' -d '{"promoted_transition_uuid": "99b41306-8194-49ee-ad37-9a0c318cc638"}'`
   (promotes it into the pair's real "second drop double" Transition),
   reload → the chip is "◆ second drop double". In-app promotion (Take
   review banner → Promote) takes the same path plus the local mirror —
   no reload needed there.
4. Semantics beyond clicks are pinned by the router/store suites named
   in the Done comments above.

**2026-07-05 — approved and landed.** Human click-through (including the
archived-track row-mark feedback round, amended into kkmpuxuw); stack
rebased onto trunk, re-gated (pytest 648, vitest 919, build, single
alembic head), landed as snmnnqwn + xkwwqkuv + kkmpuxuw. Follow-up
gap (track-row context menu in the Set view) filed as issue 17.
