# 06 — Waveform zoom follows effective BPM, not base

Status: ready-for-human (implemented, change zwqttooy; checks green — eye-verify while beatmatching pending)

## Parent

`.scratch/performance-mode/` (follow-up to 05-linked-time-zoom)

## What to fix

Issue 05's invariant — "equal effective BPM means equal beat spacing on
screen" — only held at 0% pitch. The renderer shows the shared zoom as
seconds of *track time*, so a pitched deck kept its base-BPM beat spacing:
two beatmatched decks showed different beat widths, defeating visual
beatmatching.

Fix: per deck, scale the renderer's track-time window by the playback rate
(`composeRate(pitch, bend)`, the same rate as the effective-BPM readout).
A viewport then always shows the same wall-clock duration on both decks.
The wheel callback divides the stepped value back by the rate, so the
view's shared zoom state stays rate-free.

## Acceptance criteria

- [ ] Two decks beatmatched via pitch show equal beat spacing at any zoom
- [ ] Zoom wheel on a pitched deck still steps the shared zoom smoothly
- [ ] `trackWindowSeconds` under vitest (equal-effective-BPM invariant)
- [ ] make typecheck, eslint on touched files, vitest green

## Comments

- Follow-up (change klmmztnn): the original rate included bend, so nudging
  breathed the zoom scale mid-beatmatch — exactly when the ruler must hold
  still. The window rate is now pitch-only; the effective-BPM readout keeps
  bend (ears vs eyes).
- Second follow-up (change nvlxzxny): the effective-BPM READOUT also
  included bend — it wobbled during nudges. Both the ruler and the number
  now answer "where is the tempo fader", not "what is this instant's rate".
