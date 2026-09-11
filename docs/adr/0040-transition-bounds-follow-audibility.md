# Transition Bounds Follow Audibility

Transition ENTER/EXIT follow mixer and transport state, not waveform amplitude or the saved automation frame. An outgoing Track left open plays to its jump-aware natural EOF; the former saved EXIT no longer implies a stop. Murtaza confirmed this behavior on 2026-09-09 (#230), instead of manual window resizing.

- Preserve nonzero fade tails and fold outgoing cross-cut returns into one handover. Incoming must survive at the exit, not return after an unrelated long silence.
- Keep authoring extent separate from handover bounds. Retain automation and setup jumps outside the handover without stretching their timing.
- Use the same bounds in the editor and Set planner. Tempo return follows the handover, not retained hidden material.
- Opening or auditioning persists nothing. Autosave and Promote retain a stable source and preserve absolute lane/jump timing while normalizing the coordinate frame.
- Scope: Transitions only. Routine and Cameo boundaries are unchanged. Permanent authored transport stops are not yet expressible in a Transition; never infer one from its old duration.
