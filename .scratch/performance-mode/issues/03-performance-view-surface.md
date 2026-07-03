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
