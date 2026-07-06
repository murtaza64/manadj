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

**Landing**: getting a lane's changes behind trunk — by a named merge commit
targeting a specific `main` commit (revised 2026-07-05; formerly rebase for
short lanes). Fast-forward degenerate case: if `main` has not moved and your
stack sits directly on it, moving the bookmark *is* the land.

**The gate**: the verification suite that must be green before trunk advances.

**Probe**: a temporary merge for cross-lane testing. Never built upon, always
abandoned.

**Sandbox DB**: a lane-local APFS clone of the real library database.

## The prime rules

1. **Never rewrite a change another workspace's `@` sits on or descends from.**
   No amend, describe, rebase, squash, or split of foreign mutable changes.
   An agent's working-copy change is private until landed or handed off.
2. **Never touch a workspace you don't own** — no `workspace forget`, no edits
   in its directory. Ownership is explicit: the `owner:` line (a session ID, or
   `human`) in the lane's `.lanes/<lane>.md`. It changes only by explicit
   handover (the spawn script updates it when handing a workspace to a new
   session). After resuming a session — or as a forked session — re-read your
   lane's `owner:` before your first write; if it isn't you, the lane moved
   on: open your own.
3. **The default workspace is read-only for agents** (see below).
4. **Rebase within your own lane; merge across lanes.**

## Trunk-based flow

- Lanes branch off trunk (`jj workspace add --name <lane> -r main ../<lane>`).
- **Landing is merge-based** (revised 2026-07-05 after rebase-landing retry
  storms; head-to-head in the change history of this file):
  1. Pick the `main` commit you are integrating with (usually the tip; pin it).
  2. `jj new <lane-head> <main-commit> -m "land: <what>"` — the landing merge.
  3. Verify that tree (per Verification below).
  4. `jj bookmark move main --to <merge>`.
  5. If `main` moved while you verified: do **not** rewrite anything — stack a
     fresh merge of new-`main` + your verified merge, spot-verify the
     integration delta, retry the move. Retries are cheap and non-destructive.
- **Retry invariant**: `main` only ever moves to a commit that has the current
  `main` as an ancestor — the mechanical definition of "never lose someone's
  landed work." If your candidate doesn't, re-merge; never `--allow-backwards`.
- **Fast-forward degenerate case**: `main` unmoved and your stack sits on it →
  move the bookmark to your head; no merge-commit litter.
- **Rebase is an intra-lane tool only** (cleanup of your own unlanded stack,
  pre-review); it is never the landing mechanism. Catch up with trunk by
  merging it into your lane (`jj new <lane-head> main`), at issue boundaries,
  never mid-issue.
- Accepted cost: trunk history is merge-shaped; read it linearly with
  `jj log -r 'main:: & ~merges()'`. Review-gated prefix landing composes:
  approval of change X = landing merge of X + main.

## Landing policy (revised 2026-07-05: human review gates features)

Who may advance `main`, by category of work:

- **Auto-land (agent's own judgment)**: bugfixes (restoring intended
  behavior), incidental refactors and maintenance done in passing (renames,
  tooling, dev-process changes), and the docs fast-path below.
- **Review-gated (never advance `main` without human approval)**: feature
  work — anything driven by a PRD or `.scratch/<feature>/issues/` — and
  refactors that are their own tracked effort (arch-review outputs, module
  reshapes).
- **Tiebreaker**: unsure → request review.

A bugfix discovered inside a feature lane may be split to its own change and
auto-landed while the feature stack stays parked for review.

## Verification (the landing agent owns it)

The issue's Testing Decisions are the verification spec — the agent decides
what checks prove the change, and runs those. The standard suite is a
**suggestion** for when in doubt, not a mandate:

- `uv run -m pytest`
- `npm --prefix frontend run build` and `npx vitest run` in `frontend/`
- `uv run --extra dev ruff check` on touched files (known baseline excepted)

One hard invariant remains, always, on the rebased/merged tree:
`uv run alembic heads` → exactly one head. (Repo integrity, not testing — a
multi-head trunk breaks every lane's startup auto-migrate at once, and no
issue's Testing Decisions will ever catch it.)

## Requesting review (review-gated work)

1. Verify per the issue's Testing Decisions; rebase/prepare the stack.
2. Start the lane app: `uv run scripts/agent/lane_app.py start` (reads the
   lane's port offset from `.lanes/`, clones the sandbox DB if absent, runs
   backend+vite in the background; refuses to run in the default workspace).
3. Flip the issue to `Status: ready-for-human` with a **verification
   walkthrough** comment: the URL to open (or desktop-shell command:
   `npm --prefix desktop start -- --port <vite port>` — attach-only, works
   from anywhere), and a brief guide of what to look at — the 3-5 clicks
   that exercise the slice and what correct looks like. Land the flip via
   the docs fast-path.
4. Toast the human (same URL + one-line summary) and report it in-session.
   **Print the full verification walkthrough in the agent's output
   message itself** — the URL and the click-by-click steps, not just a
   pointer to the issue file. The human reviews from the session
   transcript; docs and toasts are the durable/ambient copies, not the
   primary delivery.
5. **Keep working**: continue to the next issue on top of the parked stack.
   Approval lands a *prefix* (`jj bookmark move main --to <reviewed change>`
   — landing a non-head is fine). Review fixes are amended into the still
   unlanded changes (your lane, your right).
6. The human's verbal approval ("approved, land it" — in your session or
   relayed) is the gate; the agent then moves `main` and stops the lane app
   (or keeps it running for the next review round).

## Directory layout (migrated 2026-07-06)

Umbrella root `/Users/murtaza/manadj/` contains **every** workspace:
`default/` (the repo's default workspace — real DB, real app, the human's
working copy) plus one directory per lane (`/Users/murtaza/manadj/<lane>`).
One root means no external-directory permission prompts and a tidy tree; the
opencode project path is `/Users/murtaza/manadj` (the umbrella — one project
for all workspaces). The `.lanes/` registry lives at the umbrella root,
outside any working copy. Lane creation, from `default/`:
`jj workspace add --name <lane> -r main ../<lane>`.

## Placeholder and closure hygiene (added 2026-07-06)

- **Never describe an empty placeholder.** A described empty defeats jj's
  auto-abandon *and* breaks idle-placeholder detection (the hot-reload gate's
  definition of idle is "empty + undescribed"). Lane identity is already
  visible via the workspace marker in `jj log`; status lives in `.lanes/`.
- **Closing a lane, in order**: `lane_app.py stop` (orphaned dev servers hold
  the directory) → `jj workspace forget <lane>` → `jj abandon` the leftover
  empty `@` if it didn't auto-vanish → `rm -rf` the directory → delete
  `.lanes/<lane>.md`.
- **A conflicted landing merge is abandoned immediately** — never left as
  `@`. Merge retries are cheap: abandon, resolve in-lane, re-merge.
- `lanes_doctor.py` reports litter (described empties, conflicted heads,
  dead-owner lanes); sweeping is a deliberate act using the close protocol.

## Orchestrator

A session that coordinates work and implements nothing: spawns and hands
over track lanes, watches for parked work and relays Walkthroughs to the
human, runs `lanes_doctor.py` and sweeps, broadcasts policy nudges, rescues
orphaned lanes. One per multi-track effort or one global — optional, at the
human's discretion. **Never owns a feature lane, never lands feature code**;
its writes are docs/registry only (via a docs lane). `owner:` fields are
always session IDs, never role names — roles don't own workspaces, sessions
do.

## Sneak fixes

A bugfix or incidental-maintenance change with no tracker artifact — skips
ceremony, not visibility. Eligibility is the auto-land category, verbatim;
unsure → file an issue instead. The change description is the entire record:
`<area>: <symptom> → <fix> (sneak)`. Mechanics: ephemeral `sneak-<slug>`
lane, verify per your own judgment, auto-land via merge protocol, close the
lane. Growth valve: the moment it needs a second change or raises a design
question, file the issue and continue tracked.

## Enforcement posture

Coordination stays advisory (registry + conventions) with mechanized
consultation at choke points (`guard.py`, `land.py`, `tracker.py` refuse on
rule violations). **Escalation trigger, recorded 2026-07-06**: if
read-only-default violations recur after the guard/land tooling exists,
build the opencode write-interceptor plugin (blocks tracked-file writes in
the default workspace). A landing mutex stays rejected (ADR 0026).

## Lane registry: `.lanes/`

Advisory claims, not locks — the prime rules prevent damage; the registry makes
routing visible. Untracked directory at the **main repo root**
(`/Users/murtaza/manadj/.lanes/`), readable by every agent via absolute path.
One file per lane (so registry writes never collide): `<lane>.md` with workspace
path, **`owner:` (session ID or `human` — the write-access key, see prime rule
2)**, `.scratch` feature, claimed areas/hotspots, port offset, and a status
line. Create it when the lane opens; delete it when you forget your workspace.
`jj workspace list` remains the source of truth for what exists. The registry
is untracked: writing it is exempt from the default workspace's read-only rule.

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
  `cp -c /Users/murtaza/manadj/default/data/library.db data/library.db`
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

## Prototypes and exploratory work

Prototype/exploratory changes (throwaway UI variants, spike code, anything
built under the prototype skill's constraints) **never land on `main`**:

- They live on their own change/lane off `main`, clearly described as
  throwaway (e.g. `perf-layout: ultra-flat prototype (throwaway)`).
- To test against current `main`, use a `tmp:` probe merge in the default
  workspace — never advance `main` to include the prototype.
- When a prototype has answered its question, capture the verdict, then
  absorb it as a **fresh implementation change** (prototype code is written
  without tests/error handling — rewrite, don't promote) and abandon the
  prototype change.

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

Reserved for the human: the real DB, the real app (ports 8000/5173), and the
human's own edits. **Read-only for agents** (rule added 2026-07-05 after two
same-day stranding incidents caused by agent docs edits there): agents never
write tracked files in it — docs, tracker, handoffs, scripts included; all
work happens in a lane (docs-only lanes are cheap: `jj workspace add`, no DB
clone needed, docs fast-path lands from there). Writing the untracked
`.lanes/` registry is exempt. Agent-initiated `@` moves are limited to the
two sanctioned maneuvers — post-landing hot-reload (below) and probe
materialization — both gated on `@` being an idle placeholder; since agents
never edit here, a non-idle `@` is the human's by construction: back off and
report instead. Each lane records a port offset in its `.lanes/` file (e.g.
+10: backend 8010, vite 5183) and always passes explicit ports.

- **Post-landing hot-reload** (practice added 2026-07-05): the real app runs
  off the default workspace's working copy, so a landed change is invisible
  there until that working copy moves. After advancing `main`, check the
  default workspace's `@`: if it is an idle placeholder (empty change, no
  description — or its own stale "post-landing" empty), move it to a fresh
  change on the new trunk: `jj -R /Users/murtaza/manadj/default new main`. Vite and
  the auto-reload backend pick the landed change up immediately. If `@` has
  file changes or a real description, it's the human's — leave it alone and
  say the app needs a manual update instead. (Note: moving default@ onto a
  trunk containing new migrations auto-migrates the real DB on next backend
  start — that is the sanctioned post-landing migration path.)
