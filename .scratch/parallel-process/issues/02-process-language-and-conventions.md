# Process language and conventions (docs)

Status: ready-for-agent

## Parent

ADR 0026; grilled 2026-07-06 (workflow session).

## What to build

Docs-only slice reifying the process vocabulary and hygiene rules.

**AGENTS.md — new "Process language" section**: one line per term — Park, Walkthrough, Handover, Track, Quiescent, Orchestrator, Sneak fix — plus a bare-use list (Lane, Land, fast-path, additive-append, Probe, Sandbox DB, Claim, review-gated, auto-land, idle placeholder). Include: the anti-restatement rule (artifacts use terms bare; re-explaining AGENTS.md/parallel-work.md content in a handoff or issue is a bug), the diff-hygiene line (never dump full `--git` diffs; `--stat` then targeted reads), and the resume rule (re-check lane ownership before first write after resume/fork).

**parallel-work.md**: placeholder hygiene (never describe an empty placeholder — described empties defeat jj auto-abandon AND break idle-placeholder detection); five-step lane close protocol (`lane_app.py stop` → `workspace forget` → `abandon` leftover empty `@` → `rm -rf` dir → delete registry file); conflicted landing merges are abandoned immediately, never parked on; Orchestrator duties + the never-owns-feature-lanes constraint; `owner:` is always a session ID, never a role name; Sneak fix workflow (eligibility = auto-land category verbatim; self-contained description `<area>: <symptom> → <fix> (sneak)`; ephemeral `sneak-<slug>` lane; growth valve: second change → file an issue); the blocking-plugin escalation trigger (if read-only-default violations recur after guard/land tooling exists, build the write-interceptor plugin); document the umbrella pointer AGENTS.md.

**issue-tracker.md**: PRD user-story default-actor convention (actor omitted = the DJ; explicit only when it differs).

Terms must match this issue's wording where quoted; keep definitions one-two lines each.

## Acceptance criteria

- [ ] All seven terms + bare-use list + three rules in AGENTS.md, one line each
- [ ] parallel-work.md carries the six convention additions above
- [ ] issue-tracker.md default-actor convention
- [ ] No mechanics restated in AGENTS.md that parallel-work.md owns (pointer instead)
- [ ] Docs fast-path land

## Blocked by

None - can start immediately
