# 26 — DB persistence graduation: Transitions move to the app database

Status: ready-for-agent (design fully grilled 2026-07-04 — ADR 0011 is the
spec; no open decisions)

## Parent

`.scratch/mix-editor/PRD.md` (Shell graduation) +
`.scratch/transition-library/PRD.md` (persistence non-goal now due).
Decisions: `docs/adr/0011-transition-db-persistence-client-authoritative.md`
(scope, schema, API, identity, migration, cascade). ADR 0010 Amendment 3
named this the remaining prototype-era affordance.

## What to build

Saved Transitions persist in the app DB instead of localStorage. Per ADR
0011:

- **Schema**: `transitions` table — `id`, `a_track_id`/`b_track_id` FKs
  (`ON DELETE CASCADE`), `uuid` (client-generated), `position`, `name`,
  `favorite`, `data` JSON (startSec/durationSec/bInSec/tempoMatch/lanes/
  hiddenLanes), timestamps; unique `(a_track_id, b_track_id, uuid)`.
  Alembic migration per repo convention. Transitions ONLY — no Mix/
  templates/ordered-entries tables (those are their own slices).
- **API**: `GET /api/transitions` (full store, PairStore-shaped or flat —
  adapter's choice) + pair-replace `PUT` taking the pair's full item list;
  server reconciles by uuid (update matching, insert new, delete absent;
  empty list/null = delete pair). Payload order → `position`.
- **Frontend seam**: snapshot store replacing pairStore's localStorage
  I/O — `init(): Promise<void>` (gate editor entry on it), sync
  `snapshot()`, `savePair(key, entry|null)` (optimistic write-through,
  warn+log on failure, no retry), `subscribe`. `SavedTransition` gains
  `uuid`. The pure materialization rules (`isPristine`, `toStoredEntry`,
  `pruneStore`, `freshTransition`) and TransitionEditor's debounce/
  flush-before-repoint machinery are unchanged; `useTransitionIndex`
  swaps load+subscribe to snapshot+subscribe.
- **Session state stays client-side**: `active` per pair and
  `manadj-last-pair` remain localStorage; pristine Transitions never
  reach the server.
- **Migration**: one-shot on boot when DB is empty and
  `manadj-transition-pairs` exists — run existing load-time migrations,
  assign uuids, PUT each pair, rename the key to
  `manadj-transition-pairs-pre-db-backup`. DB non-empty → legacy data
  ignored, never merged. No dual-adapter architecture.

## Acceptance criteria

- [ ] Transitions survive a full browser-storage wipe (edit → wipe
      localStorage → reload → pair, names, favorites, lanes intact)
- [ ] Existing localStorage store migrates once: uuids assigned, backup
      key left behind, second reload does not re-import
- [ ] Editor behavior is indistinguishable: autosave at drag rate,
      switcher, favorite/star marks, discovery index and Library marks
      all work as today (no caller-visible API churn beyond the store
      module)
- [ ] Reconcile semantics: rename/favorite update in place (row id
      stable); delete removes only the absent uuid; delete-last removes
      the pair's rows
- [ ] Deleting a Track cascades its Transitions (and the note about
      future soft-delete stands in ADR 0011)
- [ ] Backend tests at the router seam (reconcile matrix: insert/update/
      delete/empty/idempotent re-PUT); frontend store tests against a
      fake fetch (ADR 0002 — no real network, no real localStorage)
- [ ] tsc, eslint on touched files, vitest + pytest green; alembic
      single head

## Unblocks

- mix-editor/03 (Transition templates — born in the DB schema)
- Future Mix (stable Transition row identity)
- Architecture-review candidate #3 is subsumed: the snapshot store IS the
  seam; no interim localStorage-adapter step needed

## Blocked by

None.
