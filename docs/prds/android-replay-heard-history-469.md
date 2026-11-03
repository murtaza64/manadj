# Replay waveform heard history — #469

- Port: now — Android rendering follows the existing desktop history-behind/live-ahead contract (`WaveformRendererV2.ts`). Desktop parity inspection does not certify every desktop Session call site or establish a separate desktop defect.
- Actual `ReplayDeckStrip` calls `ReplayWaveform`, which supplies recorded heard-strip evidence to the detail `WaveView`. Ahead of the playhead retains current modulation; overview and normal performance/live `StripHistory` paths remain unchanged.
- `ReplayHeardHistory` indexes immutable replay events once per log/deck. Queries select the most recent Master-audible source-coordinate visit strictly before the display's latency-adjusted Session time, within that instant's Load occurrence. Repeated loads of the same Track do not share history.
- Pitch/bend, loops, seek, pause, preview and tenure use the existing replay reducer. Unheard coordinates and unknown scratch motion return no evidence, not extrapolated history. The existing current-strip fallback applies only where no recorded heard visit exists.
- Index queries do not reduce events or call the strip mapper. Loops retain compact spans rather than expanding one entry per repetition. Recorded events, Track metadata, playback scheduling and Session capture files are unchanged.

## Verification

- `ReplayWaveformIntegrationTest` invokes the same composition function as the actual replay deck, using the real Session reducer and native-graphics waveform painter with generated bands. Before the hook, the recorded EQ boundary changed 6,800 past pixels; after it, zero past pixels change while 13,600 future pixels change.
- Render controls cover unchanged redraw, EQ, crossfader, mixer changes while paused, and deterministic backward/forward Session seeks. Adapter controls cover repeated/simultaneous loads, deck isolation, unheard gaps, loop visits, rate/bend/reverse/held transport, preview/tenure/scratch and 10,000 queries without remapping.
- Targeted app tests: 19 passed, zero skipped; app main and instrumentation Kotlin compilation passed. This is source/host-render evidence, not native decoded-audio, installed-device, rotation-crash or complete Session capture proof.
- #436 remains unresolved. #425 recording delivery, #467 surplus loads and #468 missing starts remain separate.
