# The earliest Reset mark anchors the ladder; the pre-anchor region derives backward

The primary marking workflow is "find the drop, mark it" — one move should realign the whole metric structure, but under ADR 0029 the region before the first mark still counted forward from the Grid origin, so a misaligned track needed a second mark at the structure's "beginning" (and flagged parentheticals against an origin the user had just implicitly disowned). We decided: the **earliest Reset mark is the Ladder anchor — derived, never stored** — and the region before it is a bounded segment **counted backward, right-aligned to the anchor, with the ADR 0029 derivation rules mirrored**: complete groups peel from the anchor toward the track start, bottom-up, and a *leading* incomplete remainder is the parenthetical. Marks' storage, API, and forward derivation are untouched; only the resolver's first-region base changes, plus a distinct render for the anchor mark (solid vs. outlined pennant) so the governing mark is visible.

Backward peeling makes "largest group that fits" fall out for free: an 8-bar intro into an anchored drop reads "1 of 8 … 8 of 8" (not "9 of 16 …"), a 9-bar intro flags its pickup bar "+1" with no extra marks, and a bare anchor on the drop absorbs any misalignment silently — the model never guesses irregularity it wasn't told about; a second mark is how you *say* "bonus bar".

## Considered options

- **Explicit anchor kind** (a stored per-track flag on one mark): buys the ability to have resets before a non-anchor… which is incoherent, at the cost of a schema change, a second gesture, and anchor-selection UI. Rejected — derived-earliest makes the incoherent state unrepresentable.
- **Backward extension in whole TOP-tier groups** (always 16 bars): consistent with Grid origin's whole-beat extrapolation, but forces short intros to read as the tail of a phantom 16 ("9 of 16…") — nobody counts a fresh 8-bar intro that way. Rejected for backward bottom-up peeling.
- **Suppressing pre-anchor parentheticals entirely**: simpler, but throws away honest pickup detection (the 9-bar intro's "+1") that the mirrored rule provides at no cost. Rejected.

## Consequences

- Adding a mark earlier than the current anchor re-anchors there and demotes the old anchor to an ordinary reset — one tap can reflow the whole count. Deliberately un-guarded: marks, bands, and the readout update live, and delete-nearest is a complete undo.
- The readout denominator varies honestly in the pre-anchor region ("of 8" where an 8 peeled, "of 16" elsewhere).
- `barIndexes` semantics gain a backward-counted region; consumers keep reading the projection only.
- Supersedes ADR 0029's "the ladder origin is simply the first mark, defaulting to the Grid origin" with an exact meaning; everything else in 0029 stands.
