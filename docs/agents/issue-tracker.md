# Issue tracker: GitHub Issues

The tracker is **GitHub Issues on `murtaza64/manadj`** (public) as of
2026-08-19. Mechanics — three-axis state model, label set, claims
(`agent:<lane>` labels), frontier query, native blocked-by dependencies,
closure: `~/dotfiles/docs/tracker-ops/gh.md`. Raw `gh`/`gh api` by
convention; `es issue` has no gh backend — do not use it here.

The old sidecar tracker (`.editspace/issues/`) is **tombstoned** — never file
there. Terminal issues remain as history; the migration mapping (sidecar file
→ issue number) is in `.editspace/issues/README.md`.

## manadj divergences and conventions

- Title: `<feature-slug>: <title>`; every issue carries its `feature:<slug>`
  label (create with color `c2e0c6` at first use).
- jj change description stays `<feature-slug>: <focus>`, e.g.
  `soundcloud-acquisition: 01-investigate-likes-scanning` for migrated issues
  or `sets: #47 session-to-set gaps` for gh-era ones.
- Parked work: `parked` label + Walkthrough comment; claim label stays
  (per gh.md). Blocked-by is native dependencies only — a parked blocker
  still blocks its dependents until it lands and closes (deliberate: no
  building on unreviewed work).
- `Needs review of:` has no native equivalent; where a migrated issue carries
  it, honor it manually (satisfied only by human approval).
- PRDs stay in the repo at `docs/prds/<feature-slug>.md` (docs fast-path).

## When a skill says "publish to the issue tracker"

`gh issue create -R murtaza64/manadj --title "<feature-slug>: <title>"
--label "feature:<slug>" [--label <marker>]` — body is the full issue text
(problem, design, acceptance criteria). Untriaged = no marker label.

## When a skill says "fetch the relevant ticket"

`gh issue view <n> -R murtaza64/manadj --comments`. References like
`issues/<feature>/<NN>-<slug>.md` are pre-migration paths: terminal ones are
still on disk; open ones resolve via the tombstone mapping.
