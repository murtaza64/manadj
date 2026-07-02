# LLM-assisted Cleanup

Status: needs-triage

## Idea

Rule-based Cleanup covers the common patterns (`Artist - Title`, junk tokens). An optional LLM pass could handle the residue: ambiguous artist/title splits, uploader-vs-artist disambiguation, foreign scripts, collab notation (`w/`, `feat.`, `b2b`).

## Notes

- Blocked by: rule-based Cleanup existing (soundcloud-acquisition effort).
- Should be suggest-and-confirm, not silent.
- Needs an LLM provider decision (local vs API) — out of scope until this is picked up.
