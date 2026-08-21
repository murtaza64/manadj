# ADR 0036: Issue tracker on GitHub Issues

Date: 2026-08-19
Status: accepted

## Decision

The manadj issue tracker moves from the sidecar markdown floor
(`.editspace/issues/`, ADR 0028) to **GitHub Issues on `murtaza64/manadj`**,
operated with raw `gh`/`gh api` per `~/dotfiles/docs/tracker-ops/gh.md`
(dotfiles is the reference deployment). `es issue` has no gh backend and is
retired for manadj.

## Details

- **Visibility**: the repo stays public; issue contents were audited —
  credential-clean (the one borderline item lives in a terminal sidecar issue
  that did not migrate).
- **Migration** (2026-08-19): all 134 open issues → gh #1–#134, bodies
  verbatim + provenance footer, `feature:<slug>` labels + who-acts-next
  markers, claims carried as `agent:<lane>` labels (on claimed AND parked
  issues), `Blocked by:` → native dependencies. Kit + mapping:
  `.editspace/notes/gh-migration/`; tombstone + mapping table:
  `.editspace/issues/README.md`. Terminal sidecar issues remain on disk as
  history.
- **Blocked-by semantics tighten**: a parked blocker still blocks its
  dependents until reviewed and landed (native deps clear only on close).
  The markdown floor's parked-unblocks rule is deliberately dropped — no
  building on unreviewed work.
- **`## Comments` history** migrated inside issue bodies, not replayed as gh
  comments; append-only comments resume natively post-migration.
- The sidecar remains for handoffs, lane records, and notes — only the
  tracker moved.

## Consequences

- Tracker state is recoverable from gh alone; issues are publicly linkable.
- Lane agents shell `gh` directly; conventions live in gh.md + 
  `docs/agents/issue-tracker.md` (manadj divergences).
- Pre-migration issue-path references in PRDs/ADRs resolve via the tombstone
  mapping.
