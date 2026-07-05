# 05 — Key Lock for the Transition editor's player

Status: done (resolved by ADR 0022 — editor-shared-decks lane)

## Parent

`.scratch/key-lock/PRD.md`

## The problem

Tempo-matched editor playback applies SUSTAINED rate offsets while the user
judges whether a blend works harmonically — Key Lock matters more here than
anywhere, and the editor doesn't have it.

The hard part is architectural (grill-notes "Noted tensions"): Key Lock
lives in the Deck's dual-mode worklet source (ADR 0018), but the editor owns
a private playback surface (ADR 0013 family) with its own player. Either the
private player duplicates the worklet machinery, or the editor plays through
the shared Decks and the private-surface decision gets revisited.

## What to do

Grill this before building: duplicate vs converge, and what converging means
for the audible-surface arbiter. Outcome is likely an ADR amendment plus a
build issue.

## Blocked by

- 03-stretch-mode-keylock (need the machinery to exist first)

## Comments

**Resolved by construction (2026-07-05, editor-shared-decks lane, ADR
0022).** The private editor player is gone: the Transition editor plays
through the shared Decks, so its auditions run through each Deck's sticky
Key Lock (default ON) — including tempo-matched playback, where it
matters most. No editor-specific Key Lock work remains.
