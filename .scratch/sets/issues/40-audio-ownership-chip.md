# 40 — TopBar audio-ownership chip

Status: done (human-approved 2026-07-06; landed via merge `xpsonons`, lane topbar)

## Parent

.scratch/sets/PRD.md (grilled 2026-07-06 — decisions below are settled, do not re-litigate)

## What to build

One persistent chip in the TopBar (global chrome, above the view
switch) answering "who owns the decks/audio right now — and what will
my next transport gesture drive". Primary job: make the next gesture's
consequence legible (34's stateful spacebar + 37's mounted-editor-over-
live-set make this pure hidden state today); secondary: ambient
"conductor is active" visibility from any view.

## Decisions (grilled 2026-07-06)

- **Three faces**, driven by `audibleHolder()` + conductor state:

  | State | Chip |
  |---|---|
  | Conductor playing | `▶ SET <set name>` |
  | Conductor paused | `⏸ SET <set name>` — a paused Conductor still holds the claim (ADR 0024); the chip must not hide it |
  | Editor audition sounding | `AUDITION` (pair label if cheap) |
  | Shared (manual decks) | muted `DECKS` |

- **Always present** (muted when shared): a fixed location you learn to
  glance at; no layout shift; the muted→colored flip is itself the
  takeover/stand-down signal.
- **No extra state** for "editor mounted but silent over a live set" —
  the chip reading `▶ SET …` while you stand in the editor IS the
  warning. Three faces, learnable.
- **Navigate-only interaction**: click `SET` → select/scroll to the
  conducting set in the Sets view; click `AUDITION` → editor. Never a
  transport control — 34/36(now 39) just gathered transport; a global
  pause button in chrome re-scatters it and invites destructive
  fat-fingers.
- **Tooltip carries the next-gesture consequence** ("Space pauses this
  set" / "Play in the editor will silence this set").
- **Out of scope (follow-up candidate)**: a one-shot toast on
  system-initiated stand-down (24's anchor-gone reorder) — the one
  ownership change with no audible edge and no user transport gesture.

## Acceptance criteria

- [ ] Chip visible in every view, same TopBar slot, no layout shift across faces
- [ ] Conducting (playing or paused) shows the set's name; manual decks show muted DECKS; sounding audition shows AUDITION
- [ ] Takeover / stand-down / displacement flip the chip live (subscribeAudible + useConductorState)
- [ ] Click navigates to the owner (set view selection / editor); nothing on the chip changes audio
- [ ] Tooltip states what space/play will do in the current context

## Notes

- Everything needed is landed: `audibleHolder`/`subscribeAudible`
  (playback/audibleSurface.ts), `useConductorState` (setId + status),
  set name via the `['sets']` query. TopBar is App-chrome — additive
  mount, coordinate via `.lanes/` (App.tsx hotspot rule).
- Bright, fully saturated colors per repo convention.

## Comments

**2026-07-06 — implemented (change `pzvknwol`, lane topbar). Parked ready-for-human.**

What was built:

- **Pure face seam** — `frontend/src/components/ownershipChip.ts`:
  `resolveChipFace(audibleHolder, {setId, status})` → SET(playing|paused) /
  AUDITION / DECKS. Holder is the truth for ownership: `'editor'` wins even
  while a displaced Conductor still reports a set (ADR 0024 stand-down
  without release); an inconsistent `'conductor'` holder with an idle store
  falls back to DECKS (never a nameless SET face). `chipTooltip(face, ctx)`
  writes the next-gesture consequence per 34's DECIDED semantics (editor
  mounted → space auditions; set selected → space drives the Conductor;
  otherwise deck gesture = takeover). Co-located `ownershipChip.test.ts`
  (15 tests, TDD).
- **`AudioOwnershipChip.tsx`** — always-mounted TopBar button:
  `useSyncExternalStore(subscribeAudible, audibleHolder)` +
  `useConductorState()` + the shared `['sets']` query (name + a 3px
  left-border swatch in the set's color). Navigate-only: SET →
  `requestSetNavigate(setId)` + mode 'library'; AUDITION → mode
  'transition'; DECKS disabled. Never touches audio.
- **`sets/navigateToSet.ts`** — openPair-pattern cross-view request:
  `selectSet(id)` (store, restores on Library mount) + window event for the
  ALREADY-mounted Library, which grew an additive listener (view →'set',
  local selection sync). Co-located jsdom test.
- **TopBar mount** — chip leads the right cluster and carries the
  `margin-left: auto` formerly on the MIDI badge (only non-additive touch,
  one CSS line moved; chip is always mounted so the cluster anchor holds).
  Colors: green = conducting, yellow = paused-but-still-holding (the state
  people misread as free), mauve = audition, muted outline = shared decks.
  Fixed 24px height, same typography across faces; width growth eats the
  flex free space — neighbors don't shift.
- **AUDITION pair label**: omitted — pair identity is not globally exposed
  (editor store is component state); "if cheap" was the settled bar, and it
  isn't cheap. Face reads AUDITION only.

Gate: `npx vitest run` 1176 ✓ (new ownershipChip.test.ts + navigateToSet.test.ts),
`npm run build` ✓, eslint clean on touched files, `uv run -m pytest` 671 ✓
(no backend changes), `alembic heads` → single `0022` (frontend-only, no
migration). Tooltip copy follows issue 34's spec; 34 itself is parked
ready-for-human on lane conductor (unlanded) — review the copy knowingly.
