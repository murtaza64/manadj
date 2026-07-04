# 26 — DB persistence graduation: Transitions move to the app database

Status: ready-for-human (implemented, change rowxlzpw — verify in the
browser: open the editor once (this runs the one-shot migration of your
real localStorage store; check the pairs/names/stars survive), then wipe
site data and reload to confirm everything comes back from the DB)

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
      — BY EYE (store tests cover the logic; the wipe run is the human
      check)
- [x] Existing localStorage store migrates once: uuids assigned, backup
      key left behind, second reload does not re-import (tested incl.
      failed-push retry and PROTOTYPE-era keys)
- [ ] Editor behavior is indistinguishable — BY EYE (drag autosave,
      switcher, stars, Library marks)
- [x] Reconcile semantics: rename/favorite update in place (row id
      stable); delete removes only the absent uuid; delete-last removes
      the pair's rows (router-seam tests)
- [x] Deleting a Track cascades its Transitions (ORM cascade tested; no
      track-delete feature exists today — SQLite FK PRAGMA is off, so the
      DB-level ondelete markers are declarative; ADR 0011 note stands)
- [x] Backend tests at the router seam (9: reconcile matrix, direction
      isolation, 404/400); frontend store tests against fake fetch +
      localStorage (14: boot, migration matrix, optimistic writes)
- [x] tsc, eslint on touched files, vitest 179 + pytest 433 green;
      alembic single head 0009_rowxlzpw; backend boots + auto-migrates,
      GET/PUT exercised live

## Unblocks

- mix-editor/03 (Transition templates — born in the DB schema)
- Future Mix (stable Transition row identity)
- Architecture-review candidate #3 is subsumed: the snapshot store IS the
  seam; no interim localStorage-adapter step needed

## Blocked by

None.

## Comments

**2026-07-04 — INCIDENT during rollout (data recovered, fix included).**
First real-store migration pushed successfully, then every saved
Transition for the loaded pair vanished. Root cause: a pre-existing race
in TransitionEditor that the DB store ARMED. On the commit where
`pairKey` becomes set, the debounced-persist effect runs before the
pair-seed effect (declaration order) and stamped `pendingSaveRef` with
the new pairKey + the still-pristine unseeded session; the seed effect's
flush-before-repoint then materialized that to null → `savePairEntry(key,
null)` → empty-items PUT → DB rows deleted → seed read the now-deleted
snapshot → blank session. The OLD code had the same race but self-healed:
its seed effect read the store from a STALE CLOSURE (`pairStore[pairKey]`
component state captured pre-delete), re-seeded the real items, and the
next debounce re-wrote them within 300ms. The live `snapshotPairStore()`
read removed the accidental heal. The same mechanism also caused latent
cross-pair contamination on in-editor pair switches (old session briefly
stamped onto the new pairKey), likewise self-healed before, likewise
fixed now.

Fix: the persist effect only arms when `pairKey === loadedPairKey.current`
(the session provably belongs to the loaded pair). Recovery: data was
intact in `manadj-transition-pairs-pre-db-backup`; copying it back to the
legacy key and reloading re-ran the one-shot migration (3 rows verified
in the DB, favorite intact).

Lesson recorded: this wiring (seed/flush/debounce ordering) is exactly
the untestable-at-component-seam logic the architecture review's editor
store (candidate #2) would make testable — the store-interface test
"flush-before-switch never deletes an unseeded pair" should be written
when that lands.
