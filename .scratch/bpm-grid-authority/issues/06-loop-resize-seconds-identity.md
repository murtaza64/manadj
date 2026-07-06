# 06 — Loop resize operates on seconds; `lengthBeats` becomes a display projection

Status: ready-for-agent
Type: task

ADR 0027 §6. Loops are seconds-identity (a re-tempo never audibly moves
an active loop — correct), but `loop-resize` re-derives the region from
the CURRENT grid (`transport.ts:257-259`), so the first halve/double
after a re-tempo discontinuously re-sizes the audible region and can
yank the playhead via the shrink pull-in. And `lengthBeats` (stored at
engage time) lies in the UI after any grid change.

## Change

- `loop-resize` while looping: new end = `start + (end - start) × factor`
  — pure seconds; the existing grid-vanished fallback
  (`transport.ts:256-261`) becomes the only path. Pending-size halving
  (idle) unchanged. Shrink pull-in keeps its phase-mod semantics against
  the new seconds length.
- `lengthBeats` stops being stored truth: derive the displayed beat
  count from the live grid at render time (LoopRow — `LoopRow.tsx:54,75`),
  shown `~N` when non-integral. Keep a stored beats field only if the
  worklet/pending-size plumbing needs it; it no longer drives resize.
- Fresh engages still snap/derive from the live grid (unchanged).

## Testing decisions

- transport.test.ts: engage 4 beats at grid G, swap ctx to re-tempo'd
  G', resize halve → audible length exactly halves (no re-derivation);
  playhead untouched unless stranded, and stranding folds by the new
  seconds length.
- Display: region spanning 2.0s against a 174 grid renders `~5.8`-style
  projection (component or pure-fn test).
