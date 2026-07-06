# guard.py preflight + lanes_doctor.py

Status: ready-for-agent

## Parent

ADR 0026; 2026-07-06 sweep (22 registered lanes, 14 dead, junk owners, two blind spots found).

## What to build

Two read-only reporting tools sharing registry/session plumbing.

**`scripts/agent/guard.py`** — "am I stale?" preflight, run on session resume and before landing (AGENTS.md resume rule cites it): does the registry still list my session as this lane's `owner:`; has my `@` been moved by an op I didn't issue (op-log delta); has `main` moved since my last merge base; do `jj workspace list` and `.lanes/` disagree about this lane. Exit non-zero with a one-line reason per finding.

**`scripts/agent/lanes_doctor.py`** — the fleet view: joins `jj workspace list` × `.lanes/*.md` × opencode sessions, prints one line per lane (owner, owner-session liveness, `@` age, unlanded work, hygiene flags) and a sweep proposal for dead lanes. Bake in the sweep's lessons: session liveness via `GET /session` `time.updated` (the `/session/status` endpoint only lists busy sessions — idle-but-live is invisible there); hyphen-safe workspace-name parsing; junk-owner detection (`owner:` not matching `^ses_` is a flag, not a crash); never proposes sweeping lanes with unlanded work.

Neither tool mutates anything; sweeping remains a deliberate act (close protocol, issue 02).

## Acceptance criteria

- [ ] guard.py: four checks, each demonstrable (fabricate drift in a scratch lane)
- [ ] doctor: verdict table correct for a fabricated mix (live/dead/junk-owner/unlanded/hyphenated lane)
- [ ] Doctor liveness uses session `time.updated`; no use of `/session/status` for liveness
- [ ] AGENTS.md resume rule and parallel-work.md sweep section reference the tools

## Blocked by

None - can start immediately (consumes issue 07's env var when present)
