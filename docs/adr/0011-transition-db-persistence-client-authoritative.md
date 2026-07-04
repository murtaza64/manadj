# Transition DB persistence is client-authoritative

Status: accepted (grill 2026-07-04)

Saved Transitions graduate from localStorage to the app database: one row
per Transition (`a_track_id`/`b_track_id` FKs, client-generated `uuid`,
`position`, `name`, `favorite`, opaque `data` JSON for anchors/lanes/
tempo-match/hidden-lanes, timestamps; unique on pair+uuid). The write
model is client-authoritative: the editor's debounced autosave replaces a
whole pair's Transition set via one `PUT`, and the server reconciles rows
by `(a_track_id, b_track_id, uuid)` — update matching, insert new, delete
absent. The frontend consumes the DB through a snapshot store (async
`init()` at boot, sync `snapshot()` reads, optimistic write-through,
subscribe) so callers keep near-sync code; the in-memory transition index
stays a client-side rebuild-on-notify (ADR 0010 Amendment 3).

## Considered options

- **Per-Transition CRUD API** — rejected: the editor has no discrete
  create/update moments (a new Transition first reaches the server inside
  a debounced autosave), so CRUD forces id round-trips, call sequencing,
  and partial-failure handling with no current benefit. Revisit when Mix
  needs to address Transitions individually — identity is already stable.
- **Server-assigned identity** — rejected with CRUD: something must name
  a Transition before the server has seen it.
- **Ordinal (array-index) reconciliation** — rejected: row identity
  shifts on delete (item 2 lands on item 1's row), poisoning future
  references (Mix).
- **`max+1` seq-within-pair** — rejected: identity computed from the
  client's current view collides under a stale snapshot and the reconcile
  silently merges two Transitions. UUIDs make identity independent of
  state; ordering reverts to what it truly is — append-only payload
  order, persisted as a cosmetic `position` column nothing references.
- **Dual persistence adapters (localStorage | DB)** — rejected: once the
  DB exists there is no live role for localStorage. Migration is a
  one-shot client push on boot (DB empty + legacy key present → run the
  existing load-time migrations, assign uuids, PUT each pair, rename the
  key to `manadj-transition-pairs-pre-db-backup`; DB non-empty → legacy
  data ignored, never merged). The seam that matters is the store
  interface; tests fake the fetch layer (ADR 0002).

## Consequences

- Editor session state (`active` selection per pair, last-open pair)
  stays client-side — the DB stores the artifact, not anybody's screen.
  Pristine Transitions likewise never reach the server (existing
  materialization rules are unchanged).
- Track FKs are `ON DELETE CASCADE` — matching today's semantics (the
  index skips unknown tracks). Note: manadj barely supports deletion
  anywhere today; when a real delete feature arrives it is likelier to
  be soft-delete/hide, and this cascade must be revisited then.
- Write failures warn and log only — no retry queue. A single-user local
  app's client snapshot is legitimately the working truth between
  flushes.
- Unblocks Transition templates (mix-editor/03), which are born in the
  DB schema as their own slice, and the future Mix, which references
  stable Transition rows.
