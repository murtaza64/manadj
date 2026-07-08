# Issue tracker: sidecar Markdown

Issues live in the editspace sidecar at
`~/manadj/.editspace/issues/<feature-slug>/` — out-of-tree relative to every
lane working copy, shared live, its own jj repo (with the rest of the sidecar).
PRDs moved back into repo history at `docs/prds/<feature-slug>.md` (ADR 0028:
split by contention — issues are high-contention, PRDs are authored
deliberately).

## Conventions

- One feature per directory: `issues/<feature-slug>/`
- Implementation issues are `issues/<feature-slug>/<NN>-<slug>.md`, numbered from `01`
- Triage state is a `Status:` line near the top (vocabulary: `triage-labels.md`);
  `es issue` buckets on the first word, so annotations after it are fine
- Dependencies: `Blocked by:` (satisfied when the blocker is parked) and
  `Needs review of:` (satisfied only by human approval) — lines or `## Blocked by` sections
- Comments append under `## Comments`

## Writing

- Claim: `es issue claim <path> --lane <lane>` (atomic: Status + Lane + record)
- Comment: `es issue comment <path> "<text>"` (append-only)
- Status flip: direct edit of your own issue's `Status:` line, then
  `jj -R ~/manadj/.editspace commit -m "<feature>: <what>"`
- New issues/PRDs: create the file, commit the sidecar (issues) or land via
  docs fast-path (PRDs)

## Reading

- `es issue list [--frontier]` — status table / grabbable frontier
- Files are plain markdown: Read/Grep them directly

## When a skill says "publish to the issue tracker"

Issues → new file under `.editspace/issues/<feature-slug>/`, then commit the
sidecar repo. PRDs → `docs/prds/<feature-slug>.md` in the repo, landed via the
docs fast-path.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path.
