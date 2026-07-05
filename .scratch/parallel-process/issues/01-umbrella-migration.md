# Umbrella directory migration

Status: ready-for-agent
Blocked by: all lanes landed/forgotten and all agent sessions idle — the human calls the moment.

## What to do

Restructure so every workspace lives under one umbrella root (decision grilled 2026-07-05; target layout in `docs/agents/parallel-work.md`):

```
/Users/murtaza/manadj/            ← umbrella (same path as today's repo — deliberate)
├── default/                      ← the repo (default workspace, real DB, real app)
├── <lane>/                       ← lane workspaces, e.g. looping/, sets/
└── .lanes/                       ← registry, moved out of the repo
```

## Preconditions (verify, don't assume)

- [ ] `jj workspace list` shows only `default`
- [ ] No agent session busy (`/session/status` on the opencode server)
- [ ] Real app stopped (ports 8000/5173 free)

## Steps

1. Move the repo one level down (order matters — umbrella keeps the old repo's path):
   `mv ~/manadj ~/manadj-migrating && mkdir ~/manadj && mv ~/manadj-migrating ~/manadj/default`
2. Move the registry out of the repo: `mv ~/manadj/default/.lanes ~/manadj/.lanes` (drop the `.lanes/` gitignore entry; add a note in the registry README about its new home).
3. Update hardcoded paths (the full inventory as of writing):
   - `scripts/agent/lane_app.py`: `MAIN_ROOT = Path("/Users/murtaza/manadj/default")`; registry lookup → umbrella `.lanes/`
   - `scripts/agent/spawn_session.py`: sessions created with `directory=/Users/murtaza/manadj` (umbrella — project path is unchanged, so session history survives); fresh-lane prompt instructions → `../<lane>` convention
   - `docs/agents/parallel-work.md`: flip the "until the migration runs" wording; update absolute paths (`.lanes`, DB clone source `~/manadj/default/data/library.db`, post-landing hot-reload `jj -R ~/manadj/default new main`)
   - `AGENTS.md` process lines if they carry paths
4. Verify nothing else hardcodes the old layout: `rg -l '/Users/murtaza/manadj' --hidden` in the repo and act on hits (config.toml `tracks_directory` points at `~/Music/Tracks` — untouched by design).
5. Smoke: start the real app from `~/manadj/default` (ports 8000/5173); create a scratch lane `jj workspace add --name smoketest -r main ../smoketest`, run `lane_app.py start` there with explicit ports, hit both servers, `stop`, forget the lane.
6. Confirm opencode still resolves the project: `GET /project/current?directory=/Users/murtaza/manadj` (vcs detection will change — the umbrella has no `.git`; acceptable, agents use the jj CLI. If opencode tooling degrades in practice, fall back to per-workspace project dirs plus an `external_directory` allow for `/Users/murtaza/manadj/**`).
7. Land the path/docs updates via the merge protocol; toast the human.

## Acceptance criteria

- [ ] Real app runs from `~/manadj/default`
- [ ] A lane under `~/manadj/<lane>` runs the lane app with no permission prompts in a non-yolo session
- [ ] `rg '/Users/murtaza/manadj-' -l` in the repo returns nothing (no stale sibling-layout paths)
- [ ] Registry at umbrella root; `parallel-work.md` describes only the new layout
