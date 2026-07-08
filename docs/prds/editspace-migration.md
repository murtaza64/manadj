# PRD: Editspace migration — manadj onto the shared es machinery

Decision record: `docs/adr/0028-editspace-migration-umbrella-collapse-es-adoption.md`
(in the manadj repo). Canonical mechanics: `~/dotfiles/docs/editspace-lanes.md`,
dotfiles ADR 0005. Grilled 2026-07-08; all manadj work idle.

Status: ready-for-agent

## Problem Statement

manadj runs a homegrown parallel-agent process (umbrella layout, `.lanes/`
registry, `.scratch/` tracker, `tracker.py`/`spawn_session.py`/local
session-identity plugin) that was the prototype for the dotfiles editspace
machinery. Two divergent implementations of the same process now exist; fixes
and improvements land in one and not the other. manadj's lane-isolation rules
are advisory only — the two same-day stranding incidents that produced the
read-only-default rule show advisory isn't enough. And manadj's layout
(external umbrella, external tracker) no longer matches the ecosystem-canonical
embedded-sidecar layout that makes lane sessions discoverable in the TUI.

## Solution

Migrate manadj onto the shared `es` machinery as a single-repo editspace with
an embedded sidecar, collapsing the umbrella so `~/manadj` is the repo's
default workspace and `~/manadj/.editspace/` houses lanes, issues, and lane
records. Enforce the lane write boundary mechanically with a static permission
set on a dedicated `lane` agent (deny-by-default `external_directory` anchored
to the spawned session's cwd, with a small whitelist). Retire the homegrown
coordination scripts in favor of `es` primitives; keep manadj's domain layer
(lane app, DB sandbox, alembic invariant, `land.py` landing protocol) and its
three recorded divergences from canon (local `main` trunk, lane-owned landing,
auto-land policy). Modifications to dotfiles are in scope wherever `es`
machinery doesn't cleanly support manadj's needs.

## User Stories

1. As the human operator, I want manadj lanes/issues/spawning to use the same `es` commands as every other project, so that one set of process improvements serves all projects.
2. As the human operator, I want lane sessions discoverable from the `~/manadj` TUI picker, so that I can find and resume any agent session from one place.
3. As a lane agent, I want my writes outside my own lane mechanically denied, so that a bad path can't strand the human's working copy again.
4. As a lane agent, I want read/write access to the issue tracker and all lane records from inside my lane, so that claims, flips, comments, and routing stay frictionless.
5. As a lane agent, I want to read the real DB file (and nothing else deny-worthy) to APFS-clone my sandbox, so that lane setup stays one `cp -c`.
6. As a lane agent, I want to be mechanically prevented from *writing* the real DB, so that un-landed migrations can never touch the real library.
7. As an unattended spawned session, I want every non-whitelisted action denied rather than prompted, so that I never stall on a permission prompt.
8. As an orchestrating agent, I want `es issue list --frontier`, `es agent spawn/resume`, and `es wait` to work in manadj, so that I can dispatch tracks without manadj-specific tooling.
9. As a spawning agent, I want `es agent spawn --agent lane` to stamp the child session as lane owner at spawn time, so that ownership is never ambiguous.
10. As a lane agent, I want `lane_app.py start` to self-assign a free port offset and record it in my `LANE.md`, so that port bookkeeping disappears.
11. As a landing agent, I want `land.py` to keep working from my lane (refusals, retry invariant, `--hot-reload`), so that landing semantics survive the migration unchanged.
12. As the human operator, I want the migration to preserve all landed history, the opencode project + session history at `~/manadj`, and the unlanded `midi-controller: 14-hide-cursor` change, so that nothing is lost.
13. As the human operator, I want the old `.scratch` tracker archived (not grafted), with issues imported into the sidecar and PRDs returned to repo history, so that the tracker split matches the contention boundary.
14. As a future agent, I want manadj process docs slimmed to divergences-over-canon pointing at `editspace-lanes.md`, so that mechanics are stated in exactly one place.
15. As the human operator, I want a verification spike before any real work runs under the new permission model, so that the isolation guarantees are observed, not assumed.

## Implementation Decisions

- **Layout**: umbrella collapse per ADR 0028 §1. Repo store and working copy move from `~/manadj/default/` up to `~/manadj/`; vestigial empty umbrella `.git` deleted; the two duplicate `.opencode/` dirs merge into one repo-level `.opencode/`; `tmp/` kept (empty, gitignored); `.editspace/` gitignored. Compatibility symlink `~/editspaces/manadj → ~/manadj/.editspace`.
- **Sidecar**: created by the *updated* dotfiles `es create manadj --single-repo ~/manadj` (embedded-sidecar `es` — dotfiles must be advanced to master and reinstalled first, daemon restarted between sessions).
- **Tracker**: issues flat-imported to sidecar `issues/<feature>/`, conforming to `es issue`'s parser (validate with `es issue list --frontier`); PRDs → `docs/prds/` in repo; handoffs → sidecar; `.scratch` archived to `~/manadj-scratch-archive/`.
- **Permission set** (on a `lane` agent defined in repo `.opencode/`): `external_directory` `{"*": "deny", "~/manadj/.editspace/issues/**": "allow", "~/manadj/.editspace/lanes/*/LANE.md": "allow", "~/manadj/data/library.db": "allow", "~/dotfiles/docs/**": "allow"}`; `edit` `{"*": "allow", "~/manadj/data/library.db": "deny"}`. Deny, never ask. Sanctioned trunk/default-workspace ops flow only through `land.py`.
- **Script fates**: retire `tracker.py`, `spawn_session.py`, `.opencode/plugins/session-identity.js` (superseded by `es issue`, `es agent spawn`, global editspace-lock `EDITSPACE_AGENT_ID`). Keep + adapt paths: `land.py`, `guard.py` (reads `LANE.md`, compares `EDITSPACE_AGENT_ID`), `lane_app.py` (ports from `LANE.md`, self-assignment on first start), `lanes_doctor.py`, `sit.py`, `configure_jj.py`.
- **Probes** move into the requesting lane against its DB clone (canon rule); real-DB probes become human/orchestrator acts.
- **Divergences kept** (ADR 0028 §4): local `main` trunk, lane-owned landing via `land.py`, auto-land policy. Not negotiable during implementation.
- **Dotfiles changes in scope**: editspace-lock plugin must recognize embedded sidecars reached via physical paths (current code anchors detection to `~/editspaces`); any `es lane create` metadata passthrough needed for ports is optional (self-assignment in `lane_app.py` is the chosen mechanism and needs no es change).
- **Unlanded work**: change `tzwrmkmtxnus` (`midi-controller: 14-hide-cursor-during-midi-operation`, parent already landed) stays in the store; re-adopt into a lane post-migration.

## Testing Decisions

- The spike is the test: observed behavior over assumed semantics. Spawn a throwaway lane session under the `lane` agent and attempt each write class — own lane (allow), sibling lane workspace (deny), default workspace tracked file (deny), tracker issue (allow), lane records (allow), real DB write (deny), real DB read/clone (allow). Verify `external_directory` anchors to the spawned session's cwd, not a resolved project root.
- TUI discovery: a session started in an embedded-sidecar lane appears in the picker from `~/manadj`.
- editspace-lock: acquires/releases correctly for embedded-sidecar lane writes.
- Post-collapse integrity: app boots from `~/manadj`; `uv run alembic heads` → exactly one head; `uv run -m pytest` green; frontend build green; opencode session history intact at `~/manadj`.
- Tracker import: `es issue list --frontier` parses every imported issue; spot-check claims/flips/comments via `es issue` against imported files.
- Dress rehearsal before declaring done: one small real issue end-to-end — `es agent spawn` → implement → park with Walkthrough → approve → `land.py` → hot-reload.

## Out of Scope

- Rewriting product/domain ADRs or any product code beyond path constants.
- Upstreaming manadj's divergences into dotfiles canon (auto-land, local trunk, lane-owned landing stay manadj-local).
- The write-interceptor plugin — build only if the spike falsifies the permission-set approach.
- Migrating `.scratch` history into the sidecar repo (archived instead).
- Bash-level write interception beyond what `external_directory` already catches (prime rules + `es` refusals remain the backstop).

## Further Notes

- Execution is phased (ADR 0028 / grill of 2026-07-08): 0 prerequisites (dotfiles update + daemon restart, between sessions) → 1 quiesce (forget workspaces, abandon nothing with content) → 2 collapse → 3 sidecar + import → 4 spike/verify → 5 docs rewrite. Human review gates each phase boundary; the docs phase lands via the new process itself.
- These issues will themselves be imported into the sidecar mid-flight (phase 3); the import issue should account for the in-flight feature.
- If the spike falsifies cwd-anchoring, fall back to the plugin design (recorded in the grill transcript and ADR 0028 §3 rejection note) without re-litigating the rest.
