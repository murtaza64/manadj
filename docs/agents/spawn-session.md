# Spawning implementation sessions

Hand work to a fresh opencode session via the server API instead of a copy-paste handoff. Trigger phrases: "spawn a session", "hand this off to a new session".

## Flow

0. **Describe your working change first** (`jj describe -m "<feature-slug>: <focus>"`). Undescribed snapshots in the default workspace can be silently shuffled by another session's landing flow; a named change can't be absorbed unnoticed.
1. **Write the handoff doc** to `.scratch/<feature>/handoffs/<UTC-timestamp>-<slug>.md` using the `/handoff` skill's content rules (suggested-skills section, no duplication of PRD/issue content — reference by path, redact secrets). This location **overrides** the global skill's temp-dir rule: repo handoffs are versionable, survive reboots, and are re-usable if the spawned session dies.
2. **Run the spawn script**:

   ```
   uv run scripts/agent/spawn_session.py \
       --title "<feature-slug>: <focus>" \
       --handoff .scratch/<feature>/handoffs/<file>.md \
       --task "Implement .scratch/<feature>/issues/NN-<slug>.md"
   ```

3. Report the printed session ID to the user. **Do not monitor the child** — handoff means handoff. The user supervises via the TUI (a toast announces the spawn).

## Workspace rules (ADR 0012)

- Default: the child is instructed to set up a **fresh lane** per `docs/agents/parallel-work.md`.
- Pass `--workspace <path>` only when handing over an existing lane that is quiescent and fully transferred — e.g. your own lane at the end of your session. Never point two live sessions at one workspace.

## Script behavior

- **Port discovery**: `--port` flag → `OPENCODE_PORT` env → probe (`lsof` for opencode LISTEN ports, health-check, confirm the server's `worktree` is this repo). No convention needed.
- **Agent/mode**: defaults to the user's `yolo` mode — an unattended session that stalls on a permission prompt defeats the point. `--agent` overrides (e.g. `--agent normal`); `--model provider/model` overrides the model.
- **Kickoff**: plain async prompt ("read handoff → workspace rule → task"); the child picks its own skills from the handoff's suggested-skills section.
- `--dry-run` prints the calls and composed prompt without touching the server.

## v2 (2026-07-06)

- Kickoff prompt tells the child its session ID (registry owner ID); landing policy no longer restated (AGENTS.md carries it).
- `--workspace` Handover stamps the lane's registry `owner:` at spawn time.
- `--handoff` optional; `--sneak` = sneak-fix delegation (self-contained `--task`, ephemeral lane, auto-land, close).
