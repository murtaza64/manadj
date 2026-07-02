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

### Triage labels

Default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as `Status:` lines in issue files. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
