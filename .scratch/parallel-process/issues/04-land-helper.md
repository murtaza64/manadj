# land.py: the mechanical land

Status: ready-for-agent

## Parent

ADR 0026 (merge-based landing); 39 hand-rolled landing chains found in session analysis, no two complete.

## What to build

`scripts/agent/land.py <change>` — executes the mechanical tail of the landing protocol (parallel-work.md "Trunk-based flow"), refusing rather than warning:

- **Retry invariant**: target must have current `main` as ancestor; otherwise exit with "re-merge onto new main" guidance. Never `--allow-backwards`.
- **Conflict check**: target (or any ancestor being landed) conflicted → refuse, cite the abandon-and-remerge rule.
- **Ownership check**: caller's session ID (env from issue 07, or `--session`, or skip-with-warning when unavailable) must match the lane's registry `owner:`.
- Then: `jj bookmark move main --to <target>`, fresh undescribed `jj new` placeholder in the invoking workspace, `--hot-reload` optionally moves default `@` to new trunk — only after verifying it is an idle placeholder (empty + undescribed); otherwise report and leave it.
- Prints a one-line result (landed change, new main position).

Verification judgment stays with the agent — this script is everything after "I decided to land".

## Acceptance criteria

- [ ] Refuses: non-descendant main, conflicted target, ownership mismatch (each with a one-line reason)
- [ ] Lands a clean fast-forward and a merge-land; leaves fresh placeholder
- [ ] `--hot-reload` respects the idle-placeholder gate (both branches tested)
- [ ] Referenced from parallel-work.md landing section (replaces the raw command sequence there)

## Blocked by

None - can start immediately (consumes issue 07's env var when present; degrades gracefully without)
