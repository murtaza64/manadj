# DDJ-GRV6 Jog Calibration

Hardware session: 2026-07-15. Controller: DDJ-GRV6. The official MIDI list
documents center-64 relative deltas but no counts/revolution or report rate:
[`DDJ-GRV6_MIDI_Message_List_E1.pdf`](https://downloads.support.alphatheta.com/software_info/dj-controllers/DDJ-GRV6/DDJ-GRV6_MIDI_Message_List_E1.pdf).

## Measurements

One physical revolution per capture:

| Stream | Motion | Absolute ticks | Signed ticks | Messages | Ticks/s | Max delta |
|---|---|---:|---:|---:|---:|---:|
| side | fast | 6482 | -6482 | 1343 | 4808.6 | 7 |
| shift-side | fast | 6324 | -6324 | 1834 | 3344.3 | 5 |
| platter-vinyl | slow | 6648 | -6648 | 5425 | 1138.4 | 3 |

- Effective resolution is approximately 6600 counts/revolution.
- The platter reports continuously at slow speed.
- The side stream is threshold-gated: slow motion emits nothing. Its
  counts/revolution figure is meaningful only once the threshold is crossed.
- Shift does not materially change side resolution.
- At 33 1/3 RPM, one revolution represents 1.8 seconds of audio. The measured
  platter scale is therefore `1.8 / 6648 = 0.000271` seconds/tick.

## Approved Values

Controller-in-hand result:

```text
bendPercentPerTick          0.1
bendMaxPercent             25
bendFilterWindow            4 x 25 ms
rimSeekSecondsPerTick       0.0001
touchSeekSecondsPerTick     0.00027
fastSeekSecondsPerTick      0.05
fastSeekAccelTicksPerSecond 50
fastSeekAccelMax           100
```

Small playback nudges were controllable at the lower gain. Raising the clamp
from 8% to 25% retained that fine response while allowing fast spins to make
coarser corrections. Paused platter travel used the measured vinyl scale.

## Prior Art

### Mixxx

Mixxx has separate pitch-bend and scratch paths:

- `jog`: drains accumulated deltas into a 25-sample moving average, then
  multiplies by a fixed `0.1` rate factor. See
  [`RateControl::getJogFactor`](https://github.com/mixxxdj/mixxx/blob/f4c4424c74aea329034641ff6573e6c952762c33/src/engine/controls/ratecontrol.cpp).
- `scratchEnable` converts `(intervalsPerRev, RPM)` to distance/tick and feeds
  `scratchTick` observations through an alpha-beta velocity filter. See
  [`controllerscriptinterfacelegacy.cpp`](https://github.com/mixxxdj/mixxx/blob/f4c4424c74aea329034641ff6573e6c952762c33/src/controllers/scripting/legacy/controllerscriptinterfacelegacy.cpp#L683-L760).
- Pioneer FLX4 and DDJ-400 mappings use center-64 deltas, `720` intervals/rev,
  33 1/3 RPM, alpha `1/8`, beta `1/256`, bend scale `0.8`, and fast-seek scale
  `150`. The `720` value is an uncited tuning convention, not a measurement.
  See the
  [`FLX4 mapping`](https://github.com/mixxxdj/mixxx/blob/f4c4424c74aea329034641ff6573e6c952762c33/res/controllers/Pioneer-DDJ-FLX4-script.js#L178-L185).

### Other Implementations

- [TimoRams multiplatform DJ software](https://github.com/TimoRams/multiplatform-dj-software/blob/main/src/midi/MidiControllerManagerInternal.h#L22)
  calibrates a Pioneer FLX10 with explicit counts/revolution and the same
  `ticks * (60 / RPM) / CPR` conversion. Its scratch controller uses
  delta/time velocity, adaptive smoothing for slow motion and direction
  changes, and less smoothing for fast throws.
- [xwax](https://github.com/xwax/xwax/blob/master/pitch.h) uses an alpha-beta
  position/velocity estimator plus a PLL correction layer.
- [Superpowered](https://github.com/superpoweredSDK/Low-Latency-Android-iOS-Linux-Windows-tvOS-macOS-Interactive-Audio-Platform/blob/master/Superpowered/SuperpoweredAdvancedAudioPlayer.h)
  exposes `ticksPerTurn`, scratch/pitch-bend modes, smoothing, and release
  deceleration; its implementation is proprietary.
- rekordbox, Serato, VirtualDJ, Traktor, and djay jog physics are closed. Their
  mapping artifacts expose gesture/address separation but not response math.

## Revisit Triggers

- Scratch support: replace linear paused seek with a fixed-rate velocity
  estimator; use measured CPR instead of Pioneer community conventions.
- Better fast-throw playback response: add a velocity curve only if the
  approved linear gain plus 25% clamp proves insufficient.
- Side-stream fine control cannot be recovered in software below the hardware
  emission threshold; use the platter stream for sub-threshold movement.
