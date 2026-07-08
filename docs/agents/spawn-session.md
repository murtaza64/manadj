# Spawning implementation sessions

Retired 2026-07-08 (ADR 0028): `scripts/agent/spawn_session.py` is replaced by
`es agent spawn` (fresh lane + session, owner stamped, `--handoff`, `--lane`
handover, `--sneak`, `--agent lane`, `--model`; opus by default). Revive idle
sessions with `es agent resume`; block on transitions with `es wait`.

Handoff docs go to the sidecar: `.editspace/handoffs/` (the spawn writes them
there when given `--handoff`). Content rules: the `/handoff` skill — task +
constraints, reference PRDs/issues by path, no mechanics restatement.

Workspace rules: fresh lane per spawn (default); `--lane` only to hand over a
quiescent lane you own. Never point two live sessions at one workspace.
