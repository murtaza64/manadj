# 03 — Performance view: decks + mixer surface (mouse-only)

Status: ready-for-agent

## Parent

`.scratch/performance-mode/PRD.md` (layout: prototype verdict in Further Notes)

## What to build

The real Performance view, replacing the prototype placeholder on the route. Layout per the prototype verdict:

- Top 50vh performance surface: two stacked full-width waveforms (each deck's own clock, playheads at 25%, drag-scrub, per-deck markers, dimming while loading); below them Deck A panel | Mixer | Deck B panel (mirrored).
- Deck panel: minimap with deck tag on top; deck column of 2x4 hot pads over the beatjump row (`jump / halve / [size] / double / jump`) over full-width CUE and PLAY rows; beatgrid/BPM block (editable BPM with half/x2, live effective-BPM readout, grid nudge ◄ D ► against that deck's playhead); tempo cluster on the flank (MATCH above a vertical pitch fader — down = faster — with nudge hold-buttons below); metadata footer (energy, inline title/artist edits saving immediately, key), mirrored on B.
- Mixer panel wired to `useMixer()`: columnar channels (TRIM/HI/MID/LOW/FLT rotary knobs, VOL fader on the channel's outer flank), crossfader + master below. Audible: kills kill, crossfader blends, limiter holds under two full-scale tracks.
- MATCH wired via the issue-02 pure function (sets pitch; out-of-reach hint).
- Bottom 50vh: `Library browseOnly` with per-row hover load-to-A / load-to-B buttons (mouse path; keyboard is issue 04). Enter/double-click still load to A via the library's existing paths.
- One deck panel component rendered twice under `<DeckScope>` — no A/B forks in the panel code.
- Delete the prototype (`components/prototype/`, the `?variant=` switch); record its verdict as done in the PRD. Sidebar entry renamed Performance.

## Acceptance criteria

- [ ] A real two-deck mix works by mouse: load A and B from the embedded library, both audible, EQ kills and crossfader blend correctly, master limiter prevents clipping
- [ ] Both waveforms track their own decks; hot cues/cue markers per deck; drag-scrub works on both
- [ ] Nudge buttons bend ±2% while held and restore exactly; MATCH sets pitch (half/double-aware) with an out-of-reach hint
- [ ] BPM edit + half/x2 mutate the track and refresh grid/waveform; grid nudge/set-downbeat act per deck
- [ ] Effective BPM readouts live-update with pitch and bend
- [ ] Metadata inline edits persist to the library (visible in the table below)
- [ ] Prototype code deleted; `browseOnly` remains as the real seam
- [ ] `make typecheck`, eslint on touched files, vitest, pytest all green

## Blocked by

- 02-deck-scopes-engine-groundwork

## Comments

Implemented in jj change `qspqpmkw` (performance-mode: 03-performance-view-surface).
- `components/performance/`: `PerformanceView` (top 50vh surface + bottom 50vh `Library browseOnly`), `DeckPanel` (+`DeckWaveform`), `MixerPanel`, CSS per the prototype verdict. One deck-blind `DeckPanel` rendered twice under `<DeckScope>`; `mirrored` is CSS-only.
- Deck panel: minimap + deck tag; 2×4 hot pads; beatjump row wired to scope size (halve/double 1–128); CUE/PLAY; BPM edit + ½/×2 (delete + re-get beatgrid to force regeneration — TagEditor parity — then invalidate `['beatgrid']`/`['track']`/`['tracks']`/`['playlist']`); grid nudge ◄ D ► at the deck's own playhead; MATCH via `bpmMatch` (fresh other-deck BPM from the query cache, out-of-reach hint for 2s); vertical pitch fader (down = faster) + hold-to-nudge (`setBend(±2)`, lit from snapshot.bendPercent); effective BPM = bpm × composeRate(pitch, bend); metadata footer (energy 1–5 picker, inline title/artist, key) saving immediately.
- Panels read the track through `['track', id]` (placeholder = loadedTrack) so edits refresh in place.
- `MixerPanel`: rotary knobs (drag, double-click reset) + VOL faders + crossfader + master, straight against `useMixer()`; positions seeded from Mixer getters (survive view switches).
- Library: `onLoadToDeck` → TrackList → TrackRow hover A/B buttons (title cell overlay); `onOpenPractice`→`onOpenPerformance` (optional; sidebar buttons hidden when absent); sidebar tooltip "Performance view".
- Per-deck `loadTrack` made identity-stable in the provider so memoized rows don't churn.
- Prototype deleted (`components/prototype/`); PRD verdict marked done; route/view renamed `performance`.
- Known (issue 04 scope): the embedded library still mounts the library keyboard hub bound to Deck A — space/f/etc. drive Deck A inside the Performance view until issue 04 replaces the hubs.
- Ear/eye verification pending user: full two-deck mix by mouse (criterion 1), kills/crossfader/limiter, scrub on both waveforms, MATCH/nudge feel.
