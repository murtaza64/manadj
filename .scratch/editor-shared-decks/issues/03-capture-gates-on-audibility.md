# Capture gates on audibility

Status: ready-for-agent

## Parent

`.scratch/editor-shared-decks/PRD.md` (ADR 0022)

## What to build

The always-on capture recorder (ADR 0020) runs only while the shared
Decks+Mixer surface holds audibility. On losing the audible surface (the
Transition editor claims), capture suspends and **discards any in-flight
engagement** — a half-detected Handover interrupted by entering the editor
is not a performance. On regaining it, capture resumes fresh.

Rationale (glossary "Take", updated 2026-07-05): after ADR 0022 the editor
auditions play through the same shared Decks and Mixer, with drift-sync
seeks and lane crossfades that look exactly like performed Handovers.
Takes are performance evidence; editor auditions must be invisible to
capture. Today (pre-swap) the gate is vacuous — the editor doesn't touch
the shared machinery yet — but it must land before the swap does.

The gate lives in the recorder (subscribe to the audible-surface arbiter),
not in the persistence sink: drop early, not late.

## Acceptance criteria

- [ ] Recorder produces no Takes and records no events while a non-shared
      surface holds audibility
- [ ] An engagement in progress when audibility is lost is discarded, not
      persisted
- [ ] Capture resumes cleanly when 'shared' regains audibility
- [ ] Tests at the recorder seam (fake surfaces via the arbiter's test
      reset) cover gate-off, mid-engagement loss, and resume
- [ ] Full gate green

## Blocked by

None — can start immediately.
