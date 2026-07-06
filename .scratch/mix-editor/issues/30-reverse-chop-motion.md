# 30 — Reverse-chop motion: beat-length bass-in pulses (dnb chops)

Status: needs-triage

## Parent

.scratch/mix-editor/ (Transition editor tracker; filed 2026-07-05 from human feedback)

## The ask

A one-gesture way to author a **reverse chop**: momentarily hand the bass to the incoming track for a beat or two, then snap back — the dnb teaser move. Today this is drawn by hand as 4+ breakpoints across the paired low-EQ lanes (A low down + B low up, then both reverted), twice per chop, and keeping it beat-exact against two beatgrids is fiddly.

## Questions for the grill

- **Shape**: a lane-editing gesture ("insert chop at position, N beats, on the low-EQ pair") vs. a small library of **motions** — named, beat-quantized, multi-lane micro-moves (chop, bass swap, cut-echo…) insertable anywhere in a window? One chop is the concrete ask; motions are the possible seam.
- **Beat domain vs. lane domain**: lanes are normalized-x over a seconds window; a chop is beat-native. Snap to whose beatgrid (the chop plays over both tracks — presumably mix-time beats via the tempo-matched grid, like the snap system already does)? Does it stay beat-attached when the window is resized/rescaled (template-style scalability), or bake to x on insert?
- **Editing after insert**: is a chop a grouped object (drag to move, handle to widen, delete as one) or does it dissolve into ordinary breakpoints on insert (cheapest; loses grouped editing)?
- **Direction variants**: reverse chop (B gets bass, back to A) vs. forward chop (A bass dips out); both are the same primitive mirrored — one gesture with a direction toggle?
- **Templates**: can templates contain motions (so "double drop w/ two chops" is a recipe)? Template lanes are already normalized — motions may just be authoring sugar that emits breakpoints, in which case templates get them for free.
- **Capture/vectorization**: do performed chops survive Take vectorization today, or are fast paired-EQ alternations smoothed away? (If smeared, recognizing chops could be a later vectorizer refinement — probably out of scope for the editor gesture.)
- Relation to issue 29 in the sets tracker (B-interlude doubles): a chop is *within* a Transition's window and needs no model change — keep the two clearly separated at triage (chop = lane authoring sugar; interlude = artifact/model gap).

## Blocked by

- The grill itself (needs the human)
