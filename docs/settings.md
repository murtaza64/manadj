# Settings

- Open **Settings** from the mode menu.
- Direct links: `?view=settings&section=filters`, `section=waveforms`, `section=jog`.
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
- Live preview uses a shared Deck and its current routing/levels. Load explicitly replaces that Deck's Track. Preview transport is locked during automation; tuning remains live.

## Waveforms And Jog

- Full waveform and minimap settings remain independent; existing colors and calibration values are retained.
- Waveform preview uses the production renderers and shared Deck playback.
- Jog calibration retains DDJ-GRV6 response controls. Capture and stream telemetry live under Hardware measurement and diagnostics.

## Limits

- These filter models are not measured Pioneer hardware emulations.
- Global changes alter existing Transition and Session replay sound; historical configurations are not captured.
- Capture's existing near-full-sweep kill heuristic is unchanged, even when custom endpoints leave audible content.
- Hardware listening on the controller's master/headphone outputs remains part of review.
