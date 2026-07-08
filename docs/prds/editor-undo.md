# PRD: Transition editor undo/redo

Status: ready-for-agent

## Problem Statement

Editing a Transition is sketch work: drawing automation lanes, sliding the incoming Track, dragging the window, stamping templates. Every one of these edits autosaves within 300ms — there is no draft state and no way back. A stray drag over a carefully drawn fader lane, a template stamp over a finished sketch, or an accidental delete destroys work permanently. Two places in the code already warn about exactly this ("would be data loss with no undo"). The editor punishes experimentation, which is the opposite of what a sketching surface should do.

## Solution

Standard undo/redo in the Transition editor, invoked by Cmd+Z / Shift+Cmd+Z and by toolbar buttons. Undo covers everything the editor autosaves — sketch edits and session operations — in one chronological history per Track pair. Each **Undo step** (see CONTEXT.md) is one gesture, one discrete action, or one coalesced run of Alignment nudges. Undoing an edit made on a different Transition re-selects that Transition so the change is visible. History is in-memory and ends when the pair is switched.

## User Stories

1. As a DJ sketching a Transition, I want to undo a lane-drawing stroke, so that a stray drag doesn't destroy a finished automation curve
2. As a DJ, I want one drag (press to release) to be exactly one Undo step, so that undo doesn't crawl through per-frame intermediate states
3. As a DJ, I want to undo a block drag or window resize on the timeline, so that I can experiment with the Transition window without fear
4. As a DJ, I want to undo a Slide of the incoming Track, so that I can try an alignment and back out
5. As a DJ, I want a run of Alignment nudges to coalesce into one Undo step, so that walking the pair into phase doesn't cost sixteen undos to reverse
6. As a DJ, I want the nudge run broken by any other action or a pause, so that separate alignment intents stay separately undoable
7. As a DJ, I want each beat-jump Slide to be its own Undo step, so that discrete deliberate moves undo one at a time
8. As a DJ, I want to undo adding, moving, or removing a Jump event, so that mid-mix structure edits are safe
9. As a DJ, I want to undo a template stamp, so that applying a Transition template over an existing sketch is recoverable rather than destructive
10. As a DJ, I want to undo toggling tempo-match, so that the alignment consequences of that toggle are reversible
11. As a DJ, I want to undo deleting a Transition, so that the sketch and its Favorite state come back intact
12. As a DJ, I want to undo renaming a Transition or toggling its Favorite, so that session operations are as safe as sketch edits
13. As a DJ, I want to undo promoting a Take, so that a mistaken promotion returns to the reviewable draft
14. As a DJ, I want undo to re-select the Transition the undone edit touched, so that I can see what changed instead of it happening off-screen
15. As a DJ, I want redo (Shift+Cmd+Z) to walk forward through undone steps, so that undoing too far is itself recoverable
16. As a DJ, I want a new edit after undoing to discard the redo tail, so that history stays a simple line I can reason about
17. As a DJ, I want undo history to span all Transitions in the pair's session chronologically, so that undo always reverses my most recent edit, wherever it was
18. As a DJ, I want undo/redo toolbar buttons whose enabled state shows whether history exists, so that I can see at a glance if there's anything to undo
19. As a DJ, I want Cmd+Z to work only while the Transition editor is the active mode, so that it never fires against an editor I'm not looking at
20. As a DJ, I want undo/redo to be inert while a drag is mid-flight, so that the sketch is never yanked out from under my pointer
21. As a DJ, I want my snap and Locked window settings untouched by undo, so that view preferences never flip as a side effect
22. As a DJ auditioning while editing, I want the audition to reflect the restored state immediately, so that what I hear always matches what I see
23. As a DJ, I want the undone state to autosave like any other edit, so that what I see after undo is what persists
24. As a DJ, I want switching pairs to end the history cleanly, so that undo never resurrects state from a session I've left

## Implementation Decisions

- Undo/redo lives entirely in the editor session store — the single funnel all persisted mutations already pass through. No other module gains undo awareness.
- **Snapshot history**: the store's state is already immutable-snapshot-shaped; each Undo step captures the pre-edit snapshot. Depth cap: 200 steps per pair.
- **Scope rule**: an edit is undoable iff it autosaves. Sketch edits (lanes, jumps, slides, window, tempo-match, stamps) and session operations (rename, Favorite, delete, create, Take promotion) are in; view toggles (snap, Locked window, lane visibility) and selection are out.
- **Restore semantics**: undo restores the mix, the session items, and the selection (re-selecting the Transition the step touched); it never restores view toggles, which keep their current values.
- **Gesture boundaries**: the store's interface grows a begin/end-gesture marker; drag-driven widgets bracket their pointer interactions with it, so the many per-pointermove mutations inside a drag collapse into one step. Undo/redo requests arriving mid-gesture are ignored.
- **Coalescing**: consecutive Alignment nudges merge into the open step until any other action or ~1s idle; direction changes do not break the run. Beat-jump Slides never coalesce.
- **History lifetime**: one stack per pair, in-memory only; cleared on pair switch (and therefore on unmount). Never persisted.
- **Linear history**: a new edit truncates the redo tail. No branching.
- **Persistence unchanged** (ADR 0011 — client-authoritative): undo is just another mutation through the store; the debounced autosave persists the restored state, and the server's uuid-based pair reconciliation handles resurrection of a deleted Transition with no backend changes.
- **Evaporation is not an Undo step**: pristine items and unpromoted Take drafts dropped on navigation carry no user work (drafts remain re-openable from the Transition history), so their disappearance creates no history entry and navigation stays outside undo.
- **Invocation**: Cmd+Z / Shift+Cmd+Z bound while the Transition editor is the mounted top-panel mode, plus toolbar undo/redo buttons whose disabled state reflects stack emptiness.
- Audio needs no work: the mix player is a synchronous store subscriber, so restored snapshots propagate to the audition automatically.

## Testing Decisions

- Test at the editor session store's public interface: perform named mutations (and gesture-bracketed drag sequences), call undo/redo, assert on the emitted snapshots. Never assert on internal stack structure.
- Coverage: gesture = one step; nudge coalescing and its break conditions (other action, idle); beat jumps discrete; redo truncation; cross-Transition re-selection; delete/restore round-trip; view toggles surviving undo; mid-gesture inertness; pair-switch clearing; depth cap; undone state reaching the persistence callback.
- Prior art: the existing vitest suites for the editor stores (session store, pair store, template store) already test exactly this way — construct store with a fake persistence hook, mutate, assert snapshots. Extend the session store's suite.
- Keybinding/button wiring is thin UI glue; it is not unit-tested beyond what existing component conventions do.

## Out of Scope

- Persisting undo history across pair switches or app restarts (upgrade path exists if in-memory-per-pair feels lossy)
- Per-Transition history stacks
- Undo in any other view (library, Performance view)
- Undo for Transition template CRUD (templates are a separate explicit-save store; stamping *into* a sketch is covered, editing the template library is not)
- Undoing view toggles or bare selection changes
- Branching/tree history

## Further Notes

- The glossary term **Undo step** was added to CONTEXT.md during the design session; use it in code and issues.
- No ADR was written: the design is cheap to reverse and unsurprising given the store architecture.
