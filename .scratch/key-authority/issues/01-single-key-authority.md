# One Key authority — stop duplicating the key table in the frontend

Status: needs-triage

## Problem

`backend/key.py` is the canonical Key module, but its knowledge is copied twice in the frontend:

- `frontend/src/utils/keyUtils.ts:12–65` — the full 24-key mapping table, hand-maintained
- `frontend/src/components/Library.tsx:45–72` — hand-rolled harmonic-compatibility logic

Three copies means notation or compatibility changes must land three times, and the copies can drift silently (no tests cover the TS copies; per testing-grill decision, we won't test duplicates — we'll remove them).

## Idea

Make `key.py` the single Key authority for the frontend too. Candidate mechanisms (pick during implementation):

- serve the key table + compatibility relation from a backend endpoint, or
- generate `keyUtils.ts` from `key.py` at build time.

Also aligns display with the glossary: OpenKey is the preferred notation (CONTEXT.md).

## Notes

- Related: architecture-review candidate 4 (Track-metadata module) makes `key.py` the backend's only Key authority; this ticket extends that to the frontend.
