# 04 — Performance keyboard + load lock

Status: ready-for-agent

## Parent

`.scratch/performance-mode/PRD.md`

## What to build

The Performance view's own keyboard hub and the view's load policy. Each view owns its hub outright; the embedded Library does not mount the library hub (`browseOnly` implies it), and exposes its selection so the Performance hub can drive it.

- Two-handed map (kbd hints on the controls should match): Deck A — cue hold `f`, play `d`, beatjump `a`/`s`, nudge hold `w`/`e`, pads 1-4 `z x c v`; Deck B mirrored — `j`, `k`, `l`/`;`, `i`/`o`, `m , . /`. Pads 5-8 mouse-only.
- Table: `↑`/`↓` navigate the embedded table (scroll-into-view), `←` loads selection to Deck A, `→` to Deck B, Enter = load to A. `j`/`k` never touch the table here.
- **Space is unbound** in the Performance view (single-deck muscle-memory hazard; confirmed decision).
- No curation keys (t/e/g, Shift+H/L); beatgrid and mixer controls stay mouse-only.
- Load lock (view policy, not provider): in the Performance view any Load onto a deck where `isAudioRunning() || pendingPlay` is blocked with a visible hint on the deck panel and the row affordance; the library view keeps replace-freely behavior. Double-click in the embedded table loads to A subject to the same lock.

## Acceptance criteria

- [ ] All mapped keys act on the correct deck while both decks play; guards match the library hub (inputs focused, modifiers, key-repeat for holds)
- [ ] Space does nothing in the Performance view; the library view's hub is unchanged when visiting it
- [ ] `↑`/`↓`/`←`/`→`/Enter drive the embedded table; loading a stopped deck works, loading a running deck is refused with a hint
- [ ] Nudge keys bend while held and restore on release (parity with the buttons)
- [ ] Library view in its own route still has its full hub (including space and curation keys)
- [ ] `make typecheck`, eslint on touched files, vitest, pytest all green

## Blocked by

- 03-performance-view-surface
