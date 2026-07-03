# Import Tag assignments from an external library

Status: needs-triage

## Problem

The divergence matrix shows tag diffs but offers no "← import" for tags (deferred in grill 2026-07-02: unlikely workflow).

## Open design questions

- Unknown tag names (exists downstream, not in manadj): auto-create? in which Tag Category? skip-and-warn?
- Merge semantics: replace the whole assignment or merge per-tag?

## Notes

- Wireable via PATCH tag_ids once names map to ids.
