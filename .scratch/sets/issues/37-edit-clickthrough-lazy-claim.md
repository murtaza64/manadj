# 37 — Edit click-through must not silence a conducting set (extend 21's lazy claim)

Status: ready-for-human (implemented 2026-07-06, lane editclaim, change `yknqookw` — parked for review; lane app on http://localhost:5413, backend 8240)

## Parent

.scratch/sets/PRD.md (human feedback 2026-07-06, during sets 24 review)

## Problem

Set row → edit (the sets 09 adjacency click-through) silences a playing
Conductor. `TransitionEditor.openPair` (and `openTake`) call
`ensureEditorAudible()` BEFORE loading — the arbiter's `silence()` pauses
the Conductor's decks. This is deliberate, documented residue of sets 21
(its Done comment: "openPair/openTake claim eagerly before loading:
opening an artifact loads the shared Decks (ADR 0022), so whatever
sounds stands down first — sets 09 behavior kept"). 21 made only *plain
mode entry* lazy.

Sets 24 (live re-plan) makes that boundary wrong: the headline loop is
"set playing → click edit on an adjacency → drag lanes → hear the
ongoing set change". Today the click kills the music; the loop only
works by entering the editor plain (mode switch) and having it adopt
whatever the decks hold.

## Direction (grill at triage)

- While another surface holds audibility, `openPair` should load the
  SESSION only (pairKey, transition selection, editor model — a mounted
  editor is already a pure model under 21's MixPlayer gate) and claim
  NOTHING; defer the shared-deck loads to the first audition gesture
  (`ensureEditorAudible` → holder stands down → THEN load both decks →
  play when ready; `auditionTogglePlay`'s `ready()` gate needs the
  deferred-load plumbing).
- Editor waveform strips read the shared decks, which mid-set hold the
  Conductor's tracks, not the opened pair — decide what the deferred
  state shows (wrong-track waveforms are confusing; empty strips or
  track-facts rendering may be better).
- Free case: editing the SOUNDING adjacency — the decks already hold the
  right pair (adopt-on-entry no-op rule), nothing to defer.
- Sequencing: same territory as 28 (foreign load = takeover, triaged,
  held until 24 lands) — the deferred loads must compose with 28's rule,
  and both touch the same editor/conductor seams. Dispatch together to
  the Conductor-owning lane after 24 lands.

## Decisions (grilled 2026-07-06)

- **Deferred state loads the session only** (pairKey, selection, model);
  no claim, no shared-deck loads while another surface holds audibility.
- **Waveform strips render the OPENED pair from track data, decoupled
  from the decks** — the strips must show what you're editing, not what
  the decks hold (the ladder's buffer-free waveform machinery, issue 30,
  is the likely source). Fallback if the strips prove deeply
  deck-coupled: show the conducted decks as-is (the sets-40 ownership
  chip explains why) and file the decoupling separately.
- **Audition is a one-press arm**: play = claim → load the pair onto
  both decks → start the moment both are ready. Pending-play cancels on
  any other transport gesture or displacement. Precedent: the practice
  flow's cue-on-ready plumbing (`pendingCues`, SetDetailPane).
- **Claim before load, always** — the set stands down before its decks
  are reloaded under it (the invariant today's eager path protects).
  This also composes with 28 (landed): by the time the editor's loads
  fire, the holder is the editor — they are never foreign loads during
  conduction.
- Warm the pair via the decode cache (`prefetchTrackBuffer`) at open so
  the arm gap is usually near-zero.

## Blocked by

- 24-live-replan (LANDED 2026-07-06) — unblocked
- 28-foreign-loads-during-conduction (LANDED 2026-07-06) — composes, see Decisions
- Coordinate with lane conductor (claims on Conductor.ts + editor playhead overlay, 34/38 parked)

**2026-07-06 datapoint (lane conductor, during 38's review):** human confirmed the behavior live — entering the editor via an adjacency click stops Set playback (the openPair deck commandeer), while the new 38 conductor playhead works as expected once playback is re-established. The friction is real in the live-editing loop; raises the value of fixing this.

## Comments

**Implemented (2026-07-06, jj change `yknqookw`, lane editclaim — parked for review):**

- `openPair`/`openTake` are SESSION-ONLY: no claim, no shared-deck loads — track state, store pair/selection, and the player's track targets only. Whatever sounds keeps sounding. Both warm the pair via `prefetchTrackBuffer` at open (tracks a deck already holds are skipped).
- One-press audition arm — new pure module `frontend/src/editor/auditionArm.ts`: play claims first (`ensureEditorAudible`, claim-before-load always — by load time the holder is the editor, so the loads are never foreign during conduction; composes with 28), issues only the missing deck loads (a matching in-flight load is not re-requested), and starts the moment both decks hold the pair ready. Free case (sounding adjacency): fulfils synchronously — claim, no loads, immediate play.
- Pending-play cancellation, per the Decisions: re-press (⏯/Space/hardware PLAY), any other transport gesture (every editor seek path — timeline scrub, minimap, jog, cue/beat jumps — taps `MixPlayer.subscribeSeek`), displacement (`subscribeAudible` holder change), pair supersession (`assignSession`), and unmount. Cancelling never revokes loads already issued. Precedent followed: SetDetailPane `pendingCues`.
- `MixPlayer` grew session track targets (`setTrack`): `ready()` is now TRACK-AWARE (a foreign-ready deck is not ready; `play()` refuses it) and model durations fall back to track-data durations while a deck holds a foreign track — scrubs/parks/strip clocks describe the OPENED pair under a deferred open.
- Waveform strips: verified already decoupled by construction — `DawTimeline`/`GlobalMinimap` render from waveform blobs keyed by the session track ids, with engine reads guarded by trackId match (mix-editor 28 guard). No strip fallback needed; no decoupling issue to file. `DeckCard` load-state text is now track-aware (shows `deferred` while the engine holds a foreign track).
- Adopt-on-entry and swap-decks are session-only too (the last-pair fallback no longer loads empty decks on mount — pre-37 that was a latent sets-28 takeover trigger); the embedded library's explicit deck-load affordances (buttons, arrow keys) keep loading immediately (a load onto a conducted deck is a takeover, sets 28).
- ⏯ enables whenever a pair is open (it arms), pulses `player-button-arming` while loads are in flight.

**Editor files touched (laneux fence note):** `TransitionEditor.tsx` (open/claim/audition plumbing + DeckCard/center-panel props only — no lane-timeline UI), `MixPlayer.ts`, `auditionArm.ts` (new) + tests, `transitionEditor.css` (additive append at EOF: `.player-button-arming` + `editor-arm-pulse` keyframes). No changes to `DawTimeline.tsx`, `LaneCanvas.tsx`, `GlobalMinimap.tsx`, `DeckCard.tsx`, `laneColors.ts`, `editorStore.ts`.

**Verification (agent, 2026-07-06):** gate green — `npx vitest run` 1210 passed (incl. 8 new auditionArm tests, 7 new MixPlayer track-aware/seek-tap tests); `uv run -m pytest` 671 passed; frontend build clean; eslint clean on touched files; `alembic heads` → one (`0022`, no migration).
