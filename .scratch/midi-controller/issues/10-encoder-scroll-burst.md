# 10 — Encoder scrolling stutters: smooth-scroll restarts per tick

Status: ready-for-human (implemented, change lzqoquru; checks green — feel-verify with the encoder pending)

## Parent

`.scratch/midi-controller/PRD.md` (follow-up to 05-browser-encoder-load)

## What to fix

Spinning the browser encoder fast makes the library list stutter: every
tick moves the selection and calls `scrollTrackIntoView`, which restarts a
`behavior: 'smooth'` animation that never gets to finish.

Fix: burst-aware scrolling in `scrollTrackIntoView` — calls arriving within
200ms of the previous one scroll instantly (`behavior: 'auto'`, row still
centered every tick), a lone navigation keeps the smooth glide. Selection
stays per-tick responsive (debouncing the selection would make the encoder
feel laggy). Held arrow keys get the same treatment for free.

## Acceptance criteria

- [ ] Fast encoder spins track the selection with no scroll stutter
- [ ] Single encoder detents / single arrow presses still glide smoothly
- [ ] make typecheck, eslint on touched files, vitest green
