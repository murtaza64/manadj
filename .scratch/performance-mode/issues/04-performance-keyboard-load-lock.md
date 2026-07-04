# 04 — Performance keyboard + load lock

Status: done (implemented, change krkmyxuk)

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

## Comments

Implemented in jj change `krkmyxuk` (performance-mode: 04-performance-keyboard-load-lock).
- `performance/performanceKeys.ts`: `DECK_KEYS` (A: f/d/a/s, w/e, zxcv; B: j/k/l/;, i/o, m,./) — one table shared by bindings and the on-control kbd hints so they can't drift. Guards: `isGuardedKeyEvent` (keydown: typing + ctrl/meta/alt) and `isTypingTarget` (keyup: typing only — a modifier held at release must not eat a cue keyup; library-hub parity).
- `performance/DeckKeys.tsx`: null-rendering per-deck hub mounted inside each `<DeckScope>` — deck-blind, data-driven from the map. Repeat suppression on holds (cue/nudge/pads), play latches during load (same selector as library space), jumps use scope beatjump size, window-blur releases bend.
- Table keys in `PerformanceView`: ↑/↓ navigate (scroll-into-view), ← load A, → load B, Enter = A (skips focused buttons). **Space claimed and unbound** (preventDefault so it neither scrolls nor re-activates a focused control). No curation keys.
- Load lock (view policy): every load path (row A/B buttons, double-click, ←/→/Enter) goes through `tryLoad`; refused when `isAudioRunning() || pendingPlay` with a 1.5s "PLAYING — LOAD BLOCKED" hint on the deck panel; row affordances dim via `lock-A/B` container classes (pure CSS, no row re-renders). Library view keeps replace-freely.
- Library: `browseOnly` mounts NO hub (`LibraryHub` extracted as a conditionally-rendered null component — faithful prop extraction); new `LibraryBrowseHandle` (`navigate`, `getSelectedTrack`) via `browseRef`; embedded double-click routes through the lock (memoized wrapper, rows stay memo-clean).
- Kbd hints rendered on CUE/PLAY/jump/nudge buttons and pads 1–4.
- Review fixes: keyup modifier-guard parity (stuck-cue hazard), memoized embedded double-click path.
- Ear/hand verification pending user: both decks by keys while both play; space dead; arrows drive the table; load refusal hint.
