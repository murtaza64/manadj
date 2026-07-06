# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

## Maturity ladder (added 2026-07-06)

File like Takes, promote like Transitions: filing is cheap capture, `ready-for-agent` is deliberate promotion.

- File early, label honestly — an issue after loose discussion is correct *if* labeled `needs-triage` (or a `grilling`-typed ticket). Filing ≠ authorization; the Status line authorizes.
- File the question, not the decomposition: one "grill X" issue, never speculative sub-issues — slicing is a grilling output.
- `ready-for-agent` bar: an agent can start without asking anything. Litmus: if you can't write acceptance criteria yet, it isn't ready; if writing them takes a design decision, grill first.
- Issue size: one landable-or-parkable unit = one Walkthrough. No single walkthrough describes it → too big; sneak-fix-sized diff → too small to file.
- PRD threshold: decomposition exceeds ~2 issues or decisions cut across slices. A PRD is the grill's residue, not ceremony.
- An issue gated on human timing is labeled `ready-for-agent` with a `Blocked by: <condition> (human calls it)` line — the blocked line, not the label, carries the gate.

## PRD user stories: default actor

The actor defaults to the DJ and is omitted ("Loop N beats from where I am, so I can hold a section"); name the actor only when it differs ("As the developer tuning detection…"). Benefit clauses stay — they carry spec weight.
