# Settings

- Open the dedicated **Settings** toggle before the **...** overflow button in the top bar.
- Settings replaces the lower tracklist panel; the current mode and decks above stay visible. Explicit mode changes close Settings.
- Export retains its Player. History and Sync show Settings in their content area.
- Direct links: `?view=performance&settings=1&section=filters`, `section=waveforms`, `section=jog`, `section=mouse-jog`. Legacy Settings links open Performance with Settings visible.
- Sliders apply live. Numeric entry commits on Enter or blur; Escape cancels.
- Preferences use the existing settings API/table and local cache. Writes serialize per key; unacknowledged writes are journaled locally and retried on startup. No live cross-window synchronization.

## Filters

| Parameter | Default |
|---|---|
| Model | Resonant 24 dB/octave |
| Added resonance | 17 dB |
| Resonance trim | 15% (-2.55 dB while fully wet) |
| Sweep curve | 1 |
| Center deadzone | 3% |
| LP / HP endpoints | 40 Hz / 16 kHz |
| Twin peak spread | 0.8 octaves |
| Drive / output trim | 0 dB / 0 dB |
| Frequency/Q smoothing | 20 ms time constant |

- Models: Original 12 dB, Resonant 12/24 dB, Steep 48 dB, Twin peak 24 dB.
- Original mode retains the old fixed mapping. Other models have dry center and a 7% dry/wet transition beyond the deadzone.
- Filter output trim applies at center too. Drive is gain-compensated saturation, not reverb or echo.
- Preferences affect every Deck, PFL and automated mix. Existing -2 dBFS output/recording ceilings remain unchanged.
- The response graph shows the linear target at 48 kHz, before drive and output limiting.
- Select a Deck in the response diagnostic to inspect or adjust its filter sweep. The graph follows automation's ghost position; sweep controls lock during automation, while tuning remains live.
- Settings has no duplicate track picker, loading, transport, loop, waveform or minimap previews. Test with the existing decks above.

## Waveforms And Jog

- Full waveform and minimap settings remain independent; existing colors and calibration values are retained.
- Waveform Settings contains style controls only; the waveforms above are the live preview.
- Jog calibration retains DDJ-GRV6 response controls. Capture and stream telemetry live under Hardware measurement and diagnostics.

## Mouse Jog

| Parameter | Default |
|---|---|
| Sensitivity | 2x |
| Acceleration | 1.8 |
| Smoothing | 50 ms |
| Maximum bend | 25% (8-50%) |

- Open `?view=performance&settings=1&section=mouse-jog`. Mouse tuning is in the Settings lower panel.
- Maximum bend caps the response without changing fine-motion gain. Defaults reach 8% at 3000 px/s and 25% near 5650 px/s. Target readouts describe steady motion before smoothing. Larger fast swipes use stroke speed rather than being diluted over the 100 ms fine-motion window; reversing starts a new motion history.
- Paused seek keeps 1.25 ms/pixel at low speed and ramps to 50 ms/pixel for fast movement. This curve is separate from pitch-bend tuning and does not affect scratching.
- In Performance, hold T for the left control-focus Deck (A/C) or Y for the right (B/D). Bindings remain owned by the decks above, not Settings.
- With Vinyl on, Shift plus the Deck's hand key arms scratch; playback continues until mouse motion.
- Read-only telemetry shows live mouse speed and actual bend for both focused Decks. Outside Performance, Settings shows a hint instead and installs no T/Y bindings.
- Reset mouse defaults also discards numeric drafts. Mounting, leaving, resetting or navigating Settings never loads, pauses or disposes Decks.
- DDJ-GRV6 hardware jog calibration is unchanged and remains a separate section.

## Limits

- These filter models are not measured Pioneer hardware emulations.
- Global changes alter existing Transition and Session replay sound; historical configurations are not captured.
- Capture's existing near-full-sweep kill heuristic is unchanged, even when custom endpoints leave audible content.
- Hardware listening on the controller's master/headphone outputs remains part of review.
