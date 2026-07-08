# Editspace migration: umbrella collapse, es adoption, permission-enforced lanes

Amends ADRs 0012 and 0026. manadj's parallel process was the prototype; dotfiles
generalized it into the editspace/lane machinery (`es` CLI, embedded single-repo
sidecars — dotfiles ADR 0005, `~/dotfiles/docs/editspace-lanes.md`). Running two
divergent implementations of the same process is pure duplication tax, so manadj
migrates onto the shared machinery. All work idle 2026-07-08; grilled same day.

1. **Umbrella collapse.** `~/manadj` stops being a plain root holding `default/` +
   lane dirs and becomes the manadj repo's default workspace itself. The sidecar is
   embedded at `~/manadj/.editspace/` (its own colocated jj repo, gitignored);
   `~/editspaces/manadj` is a compatibility symlink. Lanes live at
   `.editspace/lanes/<lane>/repos/murtaza/manadj/` (jj workspaces named
   `manadj--<lane>`). This reverses ADR 0026 point 4's rejection of workspaces
   inside a working copy: the calculus flipped when a dotfiles spike showed the
   embedded sidecar is what makes lane sessions discoverable from the project-root
   TUI, and the layout became ecosystem-canonical. The umbrella existed solely to
   give lanes/registries a shared root outside the working copy; with those in the
   sidecar, its purpose evaporated. The opencode project path (`~/manadj`) and its
   session history survive — the thing 0026 point 4 actually protected.

2. **Coordination layer → es; tracker split by contention.** Issues move from
   `.scratch/<feature>/issues/` to sidecar `issues/<feature>/` (flat import
   conforming to `es issue`'s parser; the old `.scratch` repo is archived, no
   history graft). PRDs return to repo history at `docs/prds/` — a partial,
   deliberate reversal of the 0026 tracker exodus: the exodus evidence (staleness
   across lane copies, flip-churn landing cost) indicts high-contention issue
   files, not deliberately-authored PRDs. Handoffs move to the sidecar. `.lanes/`
   registry retires in favor of sidecar `LANE.md` records. Script retirements:
   `tracker.py` → `es issue`; `spawn_session.py` → `es agent spawn` (a superset:
   `--lane` handover, `--handoff`, `--sneak`, `--agent`); local
   `session-identity.js` → the global editspace-lock plugin's `EDITSPACE_AGENT_ID`
   injection. Kept, adapted to sidecar paths: `land.py`, `guard.py`,
   `lane_app.py` (ports self-assigned on first start: scan sibling `LANE.md`s,
   claim next free offset, write it back — no more hand bookkeeping),
   `lanes_doctor.py` (manadj-specific litter checks), `sit.py`, `configure_jj.py`.

3. **Permission-enforced lane isolation** — the 0026 escalation trigger fires, but
   as static permission sets, not the write-interceptor plugin. `es agent spawn`
   sets the session cwd to the lane workspace, and opencode's
   `external_directory` gate anchors to that cwd — so one static ruleset on a
   `lane` agent enforces "own lane only" with no per-lane config:
   deny-by-default outside the cwd, whitelisting the tracker
   (`.editspace/issues/**`), all lane records (`.editspace/lanes/*/LANE.md` —
   registry stays all-readable/writable; own-record-only remains a rule), the
   real-DB path (readable for `cp -c` cloning, `edit`-denied), and
   `~/dotfiles/docs/**`. Everything not whitelisted is `deny`, never `ask` — an
   unattended session stalling on a prompt defeats dispatch. Sanctioned
   trunk/default-workspace operations flow only through `land.py` (its command
   line carries no external path, so it passes the gate; ad-hoc
   `jj -R ~/manadj …` from a lane trips it) — enforcement for the common
   accident, choke-point validation for the deliberate op. Consequence: probes
   materialize in the requesting lane against its DB clone (the dotfiles-canonical
   rule); realistic-data probes against the real DB become human/orchestrator
   acts. Rejected: the plugin (permission sets are less machinery, pending spike
   verification), and umbrella-wide read allowances (deny-by-default is simpler to
   reason about; legitimate external reads are enumerable).

4. **Kept divergences from dotfiles canon**, recorded here so nobody "fixes" them:
   trunk stays *local* `main` (`trunk() = present(main)`; pushing to origin is
   backup hygiene, not part of the gate — canon makes push part of landing);
   landing stays lane-owned via `land.py` (auto-land after verification, or on
   verbal approval — canon uses a separate lander from the default workspace);
   the auto-land policy survives (bugfixes/incidental maintenance/docs fast-path
   auto-land; features and tracked refactors park — canon parks everything).
   Everything else defers to `~/dotfiles/docs/editspace-lanes.md`; manadj process
   docs shrink to divergences + manadj-specifics (DB sandbox, lane app, alembic
   single-head invariant).

Consequences: a verification spike must precede trust — confirm
`external_directory` anchors to the spawned session's cwd, lane-session TUI
discovery from `~/manadj`, and editspace-lock behavior with embedded sidecars
(dotfiles fixes are in scope where `es` machinery falls short). The unlanded
`midi-controller: 14-hide-cursor` change survives the migration in the store and
is re-adopted into a lane afterward. Docs rewrite (AGENTS.md,
`parallel-work.md` slimmed to divergences, `spawn-session.md` retired to a
pointer) lands as the migration's final phase, via the new process itself.
