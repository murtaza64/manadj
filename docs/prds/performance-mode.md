# PRD: Performance view — two Decks and a Mixer

Status: done (all 5 issues landed 2026-07-03; mix-editor prototype built on the mixer stack)

## Problem Statement

As a DJ, I can work a single track well (the Deck engine gives instant transport, EQ, and filter), but I cannot practice or perform an actual mix: there is no second deck, no way to hear two tracks together, no faders to blend them, and no view built around performing rather than curating. The Practice view proved the platform; now it needs to become the real thing.

## Solution

Replace the Practice view with a **Performance view** mirroring a hardware DJ setup: two stacked full-width waveforms with linked zoom, symmetric Deck A / Deck B panels (transport, hot cues, beatjump with adjustable size, pitch + momentary nudge, beatgrid/BPM editing, quick metadata edits), a central **Mixer** panel (per-channel trim, 3-band EQ, sweep filter, channel fader; crossfader, master volume, always-on limiter) — the top half of the viewport; the bottom half embeds the full Library browse surface (sidebar, filters, table) with load-to-A/B affordances. Audio-wise, everything runs in one graph: a Mixer module owns the single `AudioContext` and both decks feed its channel strips (ADR 0009). Both Decks live app-wide — a mix keeps playing while you flip to the library to browse.

## User Stories

1. As a DJ, I want two Decks playing simultaneously through one output, so that I can hear and practice real transitions.
2. As a DJ, I want a Performance view with symmetric left/right deck panels and a central mixer, so that the screen mirrors the hardware I'm building muscle memory for.
3. As a DJ, I want two stacked full-width waveforms, so that I can see both tracks' structure while mixing.
4. As a DJ, I want the stacked waveforms to share one zoom level measured in time (seconds per pixel), so that comparing beat spacing across decks is meaningful for visual beatmatching.
5. As a DJ, I want per-channel trim, 3-band EQ with full kill, and a sweep filter, so that I can shape each track like on a real mixer.
6. As a DJ, I want channel volume faders and a crossfader, so that I can blend decks the way hardware allows.
7. As a DJ, I want a master volume with an always-on safety limiter, so that two summed tracks never clip the output.
8. As a DJ, I want a per-deck BPM match button that sets pitch to match the other deck's effective tempo (clamped to the ±8% fader range, with a hint when out of reach), so that tempo-matching is one press while phase-drop stays my skill.
9. As a DJ, I want effective-BPM readouts (base BPM × pitch) per deck, so that I can verify a match at a glance.
10. As a DJ, I want each deck panel to carry the full single-deck toolkit — play/pause, hold-cue, beatjump, 8 hot cue pads (set/jump/preview/delete), pitch fader with reset, time/bar readout, and a small click-to-seek minimap — so that nothing I could do with one deck is lost with two.
11. As a DJ, I want beatgrid controls (set downbeat at playhead, nudge) on each deck panel, so that I can fix a grid mid-practice against that deck's own playhead.
12. As a DJ, I want to edit title, artist, and energy inline on a deck panel (and run BPM/key analysis), with changes saved immediately to the library, so that quick fixes don't require leaving the mix.
13. As a DJ, I want tag editing and deeper curation to stay out of the Performance view, so that the performing surface stays uncluttered.
14. As a DJ, I want the full Library browse surface (sidebar, filters, table) embedded below the decks, with explicit load-to-A / load-to-B affordances (arrow keys + per-row hover buttons), so that browsing mid-mix has the library's full power.
15. As a DJ, I want Loading onto a *playing* deck blocked in the Performance view (with a visible hint), so that a stray load can't kill a live mix — while the library view keeps its replace-freely browsing behavior.
16. As a DJ, I want both decks to keep playing when I flip to the Library view to browse, so that the mix never depends on which screen is visible.
17. As a DJ, I want a two-handed keyboard layout (left hand = Deck A, right hand = Deck B), so that I can ride both decks without the mouse.
18. As a DJ, I want the embedded table driven by arrow keys (`↑`/`↓` navigate, `←`/`→` load to A/B, Enter = load to A), so that loading is spatial and collision-free with the deck keys.
21. As a DJ, I want hold-to-nudge (momentary tempo bend) per deck on both buttons and keys, so that I can ride phase alignment by hand — the skill BPM match deliberately leaves to me.
22. As a DJ, I want a per-deck beatjump size control (halve/double, 1-128), so that jumps match the phrase length I'm working at.
23. As a DJ, I want to edit BPM (including half/double corrections) and fix the beatgrid (set downbeat, nudge grid) from the deck panel, so that imported grids can be corrected mid-practice.
19. As the developer, I want one AudioContext owned by a Mixer module with decks as channel inputs, so that crossfading, master limiting, and future features (recording, headphone cue) are graph operations rather than hacks.
20. As the developer, I want the mixer's pure math (fader/trim mappings, crossfader curve, BPM-match calculation) unit-tested, so that the audible controls have exact, regression-guarded semantics.

## Implementation Decisions

- **View**: Performance view replaces the Practice view. The Practice view is deleted in the first slice (the engine/mixer refactor breaks its EQ section; the Library view is the audible smoke-test surface in the interim). The layout prototype is deleted when the Performance view lands; its verdict is recorded below.
- **Audio architecture** (ADR 0009): one `AudioContext`, owned by a Mixer module. `DeckEngine` no longer creates/revives a context; it is constructed against the shared context and an output node. StrictMode-safe context revival moves to the Mixer/provider layer. Signal chain per channel: deck (source → declick envelope, varispeed) → trim → isolator EQ → sweep filter → channel fader → crossfader gain pair → master gain → limiter (`DynamicsCompressorNode`, always on) → destination. The EQ and sweep filter move from the deck's graph into the Mixer's channel strip, matching hardware ownership; the deck keeps transport, envelopes, pitch.
- **Deck model**: the provider owns the Mixer and both Decks, created eagerly at app start (graph nodes only; no memory until Load). Decks are view-independent and keep playing across view switches. The library view binds to Deck A exclusively (player, waveforms, keyboard, Enter-to-Load). The Performance view shows both.
- **Deck addressing**: a thin deck-scope context (`<DeckScope deck="A">`) selects which deck `useDeck()`/`useDeckSnapshot()`/`useDeckReady()`/`useHotCueActions()` read — signatures unchanged, so Player/HotCue/hooks work for either deck unmodified. The library view wraps its tree in scope A; the Performance view renders one symmetric DeckPanel per scope. `useMixer()` is a separate hook (channel strips, crossfader, master); only the Performance view consumes it in v1. `loadedTrack`/`loadTrack` are per-deck.
- **Nudge (momentary tempo bend)**: first-class engine API — `setBend(percent)`/`setBend(0)`, a rate multiplier stacked on pitch (`rate = (1 + pitch/100) x (1 + bend/100)`), clock re-anchored like setPitch, exposed in the snapshot, auto-cleared on Load. +/-2% constant (tune by ear later). Buttons under the pitch fader; hold-to-bend on keys.
- **Beatjump size**: per-deck UI state in the deck scope; halve/double control (1-128) in the Performance view; the library view keeps the fixed 32-beat constant.
- **Load lock**: in the Performance view, Load onto a deck that is audibly running *or* has a latched pending play is blocked with a hint; in the library view, Load replaces freely (auditioning behavior). The lock is view policy — the provider/engine stay policy-free. Double-click in the embedded table loads to A (the lock makes mis-clicks safe). No override in v1.
- **Mixer panel**: per channel — trim (top), 3-band EQ, sweep filter knob, channel fader; center — crossfader, master volume. No headphone cue (deferred; ADR 0009 fixes its future shape as a second output path from the same graph). No trim auto-gain (future feature; manual trim covers it).
- **BPM match**: per-deck button setting pitch so effective BPM matches the nearest reachable of {other, other x2, other /2} within the +/-8% range (preferring the direct match when several reach); hint only when none reach. Tempo only — no phase sync; phase is ridden by hand via nudge. Varispeed detune is accepted and expected (keylock deferred). Effective BPM (base x pitch) is displayed live per deck.
- **Waveforms**: stacked, full-width, playheads at 25%, per-deck markers, drag-scrub each; single shared zoom applied to both. Zoom equivalence is time-based — the renderer gains a set-zoom-by-visible-seconds operation (the current zoom factor is track-length-relative, which breaks cross-deck beat-spacing comparison).
- **Deck panels**: symmetric; track header with inline-editable title/artist/energy (immediate library mutations, no save step), BPM/key display with effective BPM, analysis buttons, transport, 8 hot cue pads with full set/jump/preview/delete, pitch fader + reset, beatgrid set-downbeat/nudge, time/bar readout, small minimap.
- **Keyboard**: each view owns its hub outright; the embedded Library does not mount the library hub (`browseOnly` implies it; selection is exposed to the parent so the Performance hub drives navigation). Performance map, mirrored hands — cue hold `f`/`j`, play `d`/`k`, beatjump `a`,`s`/`l`,`;`, nudge hold `w`,`e`/`i`,`o` (replaces the scrub binding — waveform drag covers scrubbing), hot cues 1-4 `z`,`x`,`c`,`v`/`m`,`,`,`.`,`/` (slots 5-8 mouse-only). Table: `↑`/`↓` navigate, `←`/`→` load to A/B, Enter = load to A; per-row hover buttons for the mouse. `j`/`k` belong to Deck B, never table navigation. Space deliberately unbound (single-deck muscle-memory hazard — confirmed). No curation keys (t/e/g); beatgrid/mixer controls mouse-only in v1.
- **Browse surface**: the real Library component in `browseOnly` mode (bottom 50vh) — sidebar, filter bar, full table with the library's filtering power. Load-to-B is new; Enter/double-click keep meaning Deck A everywhere for muscle-memory continuity.
- **No backend changes expected.**

## Testing Decisions

- Continue the established seam (ADR 0002, deck-consolidation precedent): vitest on pure modules only, no Web Audio mocking.
  - Mixer math: trim/fader value→gain mappings, crossfader curve (both-center behavior, end kills), BPM-match pitch calculation including half/double-time candidates, clamp preference, and out-of-reach cases.
  - Bend/pitch rate composition (`rate = pitch x bend`), bend auto-clear on load.
  - Any new pure zoom math (visible-seconds ↔ zoom factor).
  - Existing transport reducer tests continue to cover per-deck transport semantics unchanged.
- The Mixer graph, decks, and views stay ear/eye-verified: two-deck summing without clipping (limiter engages), EQ kill quality per channel, crossfader sweep, load lock behavior, cross-view playback continuity.

## Out of Scope

- Keylock/time-stretch (named risk: BPM match makes varispeed detune audible for the first time)
- Beat-phase sync / auto-alignment to a shared beat clock
- Headphone cue / pre-listen routing (deferred; future second output path per ADR 0009)
- Mix recording (future master-bus tap)
- Trim auto-gain / loudness normalization
- MIDI controller support (the layout maps naturally to hardware someday; not now)
- Full library table, tag editing, or provenance in the Performance view
- Keyboard control of mixer controls (faders/EQ/crossfader)

## Further Notes

- ADR 0009 (`docs/adr/0009-one-audio-graph-mixer-owns-the-context.md`) records the one-graph decision. Glossary updated during design: **Deck** (two, app-owned, sound shaping moved to Mixer), **Mixer**, **Performance view**, **Load** (view-dependent load lock).
- Blocked by deck-consolidation issues 03 and 04; start after they land. The `DeckEngine` context-injection refactor should be the first slice — it touches the same code 03 just stabilized.
- **Prototype verdict** (4 iterations on the practice route, `?variant=`): "hardware mirror" layout won — top 50vh performance surface (stacked full-width waveforms; deck | mixer | deck), bottom 50vh embedded Library. Deck panel: minimap top (deck tag beside it), then a deck column (2x4 hot pads stacked over the beatjump row `jump / halve / [size] / double / jump` over full-width CUE and PLAY rows), the beatgrid/BPM block (BPM input, half/x2, effective-BPM readout; grid nudge + set-downbeat), and a tempo cluster on the flank (MATCH above a vertical pitch fader — polarity: down = faster, hardware-style — with nudge hold-buttons below). Metadata (energy, title/artist inline edits, key) is the panel footer, mirrored on Deck B. Mixer: columnar per channel — TRIM/HI/MID/LOW/FLT rotary knobs with the VOL fader on the channel's outer flank — crossfader and master below. Design language: library player (square 1px-border buttons, hot-cue squares, muted catppuccin palette). The prototype code (components/prototype/, the practice-route `?variant=` switch, and Library's `browseOnly` prop trial) is throwaway except `browseOnly`, which is the intended real integration seam. *(Done — the verdict is implemented as the real Performance view and the prototype is deleted, issue 03.)*
