# 01: Ultra-flat deck layout

Status: done (landed olumspok; pending user eye-verify — tweaks in-prod)

Implement the PRD layout in the real performance components (replacing the
current flank/mixer layout outright — no flag, no back-compat):

- `PerformanceView.tsx`: auto-height surface, MixerStrip between waves and
  decks, two-column deck grid, library flex:1.
- `MixerPanel.tsx` → `MixerStrip` (crossfader + master only). `Knob` stays
  exported for the deck MIX zone.
- `DeckPanel.tsx`: three-zone band (TRACK / PLAY / MIX) per the PRD; MIX zone
  wires TRIM/EQ/FLT knobs + VOL to `useMixer()` (state survives view
  switches), PITCH/nudge/MATCH to the deck engine; KEY + effective-BPM
  readouts in the MIX foot.
- Tag pills read-only (sorted by category display_order, then tag
  display_order); "+" affordance stubbed → issue 02.
- Keyboard hints (perf-kbd) keep rendering on pads/transport/nudge.
- Zone labels (TRACK yellow / PLAY / MIX) kept from the prototype.

## Comments

- Prototype (variant C iteration 2) approved by Murtaza 2026-07-04; residual
  tweaks happen in-prod.
