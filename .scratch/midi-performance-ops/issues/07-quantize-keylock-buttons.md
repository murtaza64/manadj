# Q and SHIFT+Q: Quantize toggle and per-Deck Key Lock

Status: ready-for-agent

## Parent

`.scratch/midi-performance-ops/PRD.md`

## What to build

The hardware Q buttons drive the two "keep it musical" guards, registry-direct:

- Either deck's Q button toggles the single app-wide Quantize (no per-deck quantize — the hardware's placement is two handles on one switch). Both Q lamps mirror the one state, together with the on-screen TopBar toggle.
- SHIFT+Q toggles that Deck's Key Lock (shifted controls emit on channel+3; learn the exact messages via the inspector, TODO(hardware-verify) discipline).
- Key Lock lamp: probe whether the shifted-Q address (channel+3, same note) drives the Q lamp while SHIFT is held — Mixxx drives no such output but does drive other shifted-layer lamps, so it's plausible. If real, it shows Key Lock while SHIFT is held; if not, Key Lock stays screen-only and the Q lamp remains quantize-only (one lamp never tells two truths).

## Acceptance criteria

- [ ] Pressing either Q button flips the app-wide Quantize; both Q lamps and the TopBar toggle agree at all times, including after reconnect (full sync on connect)
- [ ] SHIFT+Q toggles Key Lock on the correct Deck only; on-screen key-lock toggle reflects it
- [ ] Quantize consumers (cue set, hot-cue placement, loop engage) respect the hardware-toggled state
- [ ] Shifted-Q lamp probe outcome recorded in the mapping file (used if real, comment explaining if not)
- [ ] Translator/mapping tests cover both bindings; LED derivation tests cover the mirrored Q lamp rule

## Blocked by

None - can start immediately
