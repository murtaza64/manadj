# 06 — Tempo policies: Riding and Fixed

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md

## What to build

Per-Set Tempo policy. **Riding**: after each window closes, the incoming Track eases from its matched rate back to native — the Tempo return, a tunable-heuristic ramp that must complete before the next window; the planner emits insufficient-runway flags (clamp faster rather than stay incomplete) and the ladder/toolbar surface them. **Fixed**: an explicit, editable Set tempo (BPM, defaulted from the first Track's native BPM); every Track pitched to it; pinned Transitions play rate-scaled as a whole (tempo-matched Transitions scale cleanly under a global rate; the tempo-match flag is moot). Toolbar chip shows the policy (and Set tempo when Fixed). Key Lock: the Conductor inherits each Deck's sticky setting; no Set-level override.

## Acceptance criteria

- [ ] Planner covers both policies: ramp segments + runway flags (Riding), global rate scaling (Fixed)
- [ ] Riding: audible ramp back to native between handovers; next Transition plays as authored
- [ ] Fixed: whole Set holds the Set tempo; changing it re-plans; default comes from the first Track
- [ ] Runway warnings visible on the affected adjacency in the Set view
- [ ] Policy and Set tempo persist per Set

## Blocked by

- 04-conductor-v1
