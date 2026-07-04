This projet is a pre-pre-pre-alpha in active development. It has no users other than the developer. As such, BACKWARD COMPATIBILITY IS NOT A CONCERN.

this project is managed by uv.
to add requirements, use `uv add`.
to run scripts or modules, use `uv run path/to/script.py` or `uv run -m path.to.module`

this project does NOT prefer pastel colors as per my global theme, instead preferring bright, fully saturated colors

## Agent skills

### Issue tracker

Issues and PRDs are local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Version control

This repo uses jj. One jj change per issue; change description = `<feature-slug>: <issue-file-stem>`, e.g. `soundcloud-acquisition: 01-investigate-likes-scanning`.

### Parallel work (multiple agents)

Trunk-based: `main` is trunk and advances after a green gate; landed history is immutable. One lane = one workspace = one agent. Never rewrite a change another workspace's `@` sits on or descends from; never touch another lane's workspace. Real DB lives only in the default workspace — lanes APFS-clone it (`cp -c`), never symlink; migrations touch the real DB only after landing. Full rules, lane registry (`.lanes/`), hotspot protocol, probes: `docs/agents/parallel-work.md` (ADR 0012).

### Database migrations

Alembic (see `docs/adr/0005-alembic-migrations.md`). Generate revisions with `uv run alembic revision [--autogenerate] --rev-id <NNNN>_<jj-short-id> -m "<slug>"` — sequential number, suffixed with the jj change short ID of the change the migration belongs to. Parallel duplicates of a number are fine: alembic flags multiple heads; re-parent one. Startup auto-migrates (`upgrade head`). Never use `Base.metadata.create_all` for the app DB.

### Triage labels

Default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as `Status:` lines in issue files. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
