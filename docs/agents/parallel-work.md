# Parallel work: lanes, trunk, and the rules that prevent collisions

Conventions for running 3-4 agents on this repo concurrently. Grilled 2026-07-04,
calibrated against a day of real multi-agent incidents (clobbered stacks, divergent
changes, deleted workspaces, 4.8 GB DB copies).

## Vocabulary

**Lane**: one workstream = one jj workspace = one agent = one `.scratch/<feature>`
at a time. Named after the feature (workspace `perfdata` ↔ lane perfdata).

**Trunk**: the `main` bookmark. The integrated, verified line of development.
jj's `trunk()` resolves to it, and jj treats `trunk()::` as immutable — landed
history mechanically cannot be rewritten (ADR 0012). Note: the repo config pins
`trunk()` to *local* `main` (`jj config set --repo 'revset-aliases."trunk()"'
'present(main)'`), so immutability applies the moment `main` moves — no push
required. Pushing `main` to origin is periodic backup hygiene, not part of the
gate. After advancing `main` from your own head, immediately `jj new` — your
old `@` just became immutable.

**Landing**: getting a lane's changes behind trunk — by rebase (short lanes) or
by a named merge commit (long-lived lanes).

**The gate**: the verification suite that must be green before trunk advances.

**Probe**: a temporary merge for cross-lane testing. Never built upon, always
abandoned.

**Sandbox DB**: a lane-local APFS clone of the real library database.

## The prime rules

1. **Never rewrite a change another workspace's `@` sits on or descends from.**
   No amend, describe, rebase, squash, or split of foreign mutable changes.
   An agent's working-copy change is private until landed or handed off.
2. **Never touch another lane's workspace** — no `workspace forget`, no edits in
   its directory. A workspace is created and forgotten by its own agent only.
3. **Rebase within your own lane; merge across lanes.**

## Trunk-based flow

- Lanes branch off trunk (`jj workspace add --name <lane> -r main ../manadj-<lane>`).
- **Short lane (1-3 changes)**: finish → rebase onto trunk tip → run the gate →
  advance `main` to your head (`jj bookmark move main --to <head>`). If trunk moved
  while you verified: rebase again, re-gate, retry.
- **Long-lived lane**: never repeatedly rebase the whole stack (rewrites every
  commit; races every other workspace). Catch up by merging trunk *into* the lane
  (`jj new <lane-head> main`), keep building on top. Land with a named merge
  commit (`merge: <what>`), then move `main` to it.
- Rebases onto trunk happen at issue boundaries, never mid-issue.

## The gate (before `main` moves)

On the rebased/merged tree:
- `uv run -m pytest`
- `npm --prefix frontend run build` and `npx vitest run` in `frontend/`
- `uv run alembic heads` → exactly one head
- `uv run --extra dev ruff check` on touched files (known baseline excepted)

## Lane registry: `.lanes/`

Advisory claims, not locks — the prime rules prevent damage; the registry makes
routing visible. Untracked directory at the **main repo root**
(`/Users/murtaza/manadj/.lanes/`), readable by every agent via absolute path.
One file per lane (so registry writes never collide): `<lane>.md` with workspace
path, agent, `.scratch` feature, claimed areas/hotspots, port offset, and a
status line. Create it when the lane opens; delete it when you forget your
workspace. `jj workspace list` remains the source of truth for what exists.

## Hotspot protocol

The files multiple lanes touch, and how to touch them:

- **Tracker (`.scratch/`)**: append-only across lanes — comments under
  `## Comments`; status-line edits only on issues your lane owns.
- **Docs (`CONTEXT.md`, `docs/`)**: ride a dedicated change at the base of the
  lane (`<feature>: grill (docs)`), so integrators can move them independently.
  Glossary additions union cleanly.
- **Structural code** (`App.tsx`, `api/client.ts`, `backend/main.py` router list,
  `models.py`): additive-append style — new entries at the end of lists/sections.
  Reshaping a hotspot (renames, moves, splits) must be claimed in `.lanes/` and
  should land alone, straight onto trunk, while other lanes are at issue
  boundaries.
- **Alembic**: duplicate numbers in parallel lanes are fine; the lane that lands
  second re-parents; the gate's single-head check keeps multi-head off trunk.

## Database

- **The real DB exists only in the default workspace** (`data/library.db` is
  workspace-relative). Lanes never reference the default workspace's `data/`.
- Lanes needing data **clone, never symlink, never plain-copy**:
  `cp -c /Users/murtaza/manadj/data/library.db data/library.db`
  (APFS clone: instant, block-shared, fully isolated). Staleness is a feature;
  re-clone for fresher data. Track audio is referenced by absolute path and is
  read-only — nothing to copy.
- **Migrations run against the real DB only after landing**, via the default
  workspace. Pre-trunk, migrations execute only on sandbox clones. (Symlinking
  the real DB would let a lane's startup auto-migrate run un-landed migrations
  on the real library — that is the accident this rule exists to prevent.)

## Probes (temporary merges)

To test lanes together before they land:

- `jj new main <headA> <headB> -m "tmp: integration probe — abandon, do not build on"`
- Materialize in the **default workspace** (the verification venue; has the real
  DB for realistic read-only testing — no un-landed migrations).
- Description starts `tmp:`. Nothing is ever built on top. Findings go to tracker
  comments; fixes go to the owning lanes; the probe is abandoned the same session.
- Topology queries (`heads(mutable())`) must ignore `tmp:` changes.

## Docs fast-path and the tracked/ephemeral split

Rule of thumb: **if it needs history, it's tracked and lands via trunk; if it
needs real-time visibility and no history, it lives in `.lanes/`.**

- **Docs fast-path**: a change touching only docs/tracker files (`.scratch/`,
  `docs/`, `CONTEXT.md`, `AGENTS.md`) may land on `main` immediately with a
  reduced gate (nothing to build or test — sanity-read the diff). Any lane may
  do this for cross-lane-relevant updates: triage, status flips, PRDs, filed
  issues, convention changes. Change-specific Done comments keep riding their
  lane's change as before.
- **Claims are ephemeral**: "this issue is being worked" is a real-time signal,
  not history — record it in your `.lanes/<lane>.md` file (issue path + started
  timestamp), not as a tracker `Status:` edit. Tracker `Status:` lines keep the
  durable states only (`needs-triage`, `ready-for-agent`, `wontfix`, done/
  verified notes). This removes the two-agents-grab-one-issue race without
  un-tracking the tracker.
- Rationale (grilled 2026-07-04): fully un-tracking the tracker would give
  instant visibility but lose ticket history, Done comments pinned to jj change
  IDs, docs-with-code atomicity, and merge machinery for concurrent writes.
  Trunk is the central place now — the fast-path uses it.

## The default workspace

Reserved for the human and for integration/verification: probes, gates, the real
DB, the real app (ports 8000/5173). It is not a lane; agents do not do feature
work in it. Each lane records a port offset in its `.lanes/` file (e.g. +10:
backend 8010, vite 5183) and always passes explicit ports.
