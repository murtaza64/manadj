# Re-run Cleanup on demand for existing Tracks

Status: needs-triage

## Idea

Cleanup (rule-based title/artist normalization) runs at Track creation during acquisition. Allow re-running it on demand for existing Tracks — single track or bulk — e.g. after improving the junk-pattern rules. Show a before/after diff and require confirmation rather than overwriting silently, since existing titles may be hand-curated.

## Notes

- Related: protect manual edits (`.scratch/analysis-curation/issues/01-protect-manual-overrides.md`) — same "don't clobber curation" concern, applied to title/artist.
