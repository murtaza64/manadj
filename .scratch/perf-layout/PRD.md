# perf-layout: tighter performance surface

Verdict of the perf-layout grilling session + `PerfLayoutPrototype` (variant C
"Ultra flat", iteration 2). Prototype lives off-main on change `mosvrqol`;
delete after issue 01 lands.

## Decisions (grilled 2026-07-04)

- Goals: more vertical room for the embedded library + richer track metadata
  (tags) on the decks. 4-deck prep explicitly out of scope.
- Top surface is **content-sized** (auto height); library takes all remaining
  height (`flex: 1`). No fixed 50% split, no splitter.
- **No central mixer column.** Per-channel controls live on their deck;
  X-FADER + MASTER form a slim horizontal strip between the waveforms and the
  decks.
- Deck = thin minimap header + one dense horizontal band in three zones,
  ordered outer → inner (deck B mirrored, so MIX zones meet in the middle):
  - **TRACK** (persistent — edits write to the library; yellow accent):
    title / artist (inline-editable, separate rows), tag pills (+ edit
    affordance), energy picker, consolidated tempo/grid cluster (BpmControl
    with embedded grid buttons; dropdown is the sole halve/double affordance).
  - **PLAY**: CUE over PLAY (compact), 2×4 hot-cue pads, beatjump row.
    Transport order never mirrors.
  - **MIX**: knob row TRIM | [LOW MID HI boxed] | FLT, horizontal PITCH and
    VOL sliders, foot row with prominent KEY + effective-BPM readouts beside
    MATCH + nudge.
- Pitch fader: horizontal, right = faster (+8%), not flipped on deck B,
  double-click resets. Hardware down-is-faster polarity abandoned with the
  vertical fader.
- Size by information value, not clickability (keyboard/MIDI-first): transport
  stays prominent as *state*, not as click target.
- Tags: pills read-only in issue 01; click-to-edit popover is issue 02.

## Issues

- 01-ultra-flat-deck-layout — the layout restructure (this PRD, minus tag editing)
- 02-tag-editor-popover — tag pills open the existing TagEditor in a popover
