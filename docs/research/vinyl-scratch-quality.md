# Vinyl Scratch Quality

Initial research and deterministic probe verification: 2026-09-09.
Mixxx code is pinned to **`d0de795077d887214506d4fe094bba41f81ec422`** (2.5 branch,
2026-09-08). Web docs accessed 2026-09-09; local references describe the probed lane.

## Implemented Revision

- Replaced packet-duration motion with two cascaded 8 ms velocity filters, evaluated
  analytically by the worklet, engine clock, and capture reconstruction. No copied
  Mixxx implementation. Gain follows speed, not packet expiry.
- Ordinary hand-up ends scratch synchronously; a fresh reverse throw below -2x
  retains its gesture until 12 ms without rotation. Slip stays latched through
  coasting; retouch does not restart it. Physical thresholds need listening review.
- Current probe (`--check-release --check-gain`): 0 ms handover delay; uniform
  5 ms packet motion gain min/max/mean all 1. The 880 Hz sideband is -25.6 dBc,
  down from -13.6 dBc. Residual rate modulation and fast-resampling aliasing remain.
- Regression coverage includes 44.1/48 kHz PCM, jitter, reversals, stopped/edge
  silence, shared audio timestamps, loop/EOF capture and replay, and allocation-free
  replay buffer splitting. Hardware feel is not established by these tests.

## Original Defects

[Persistent probe](vinyl-scratch-quality.probe.ts) imports actual `JogController`,
`moveScratch`, and `DeckSourceKernel`. No device/database/audio output. Run from `frontend/`:

```sh
npx tsx ../docs/research/vinyl-scratch-quality.probe.ts
```

The measurements below describe the original packet-duration implementation;
the companion probe now exercises the replacement model and checks should pass.

**Packet-boundary gain modulation:** one second of constant `1.08x` motion at 48 kHz,
with perfectly on-time 5 ms updates. Rendering uses segments of at most 128 frames,
split at event boundaries: ideal delivery, not a MIDI capture. Measurements cover
only 0.1-0.9 seconds, excluding the gesture's true start/end fades.

| Input / measurement | 5 ms packet motion | One continuous motion |
|---|---:|---:|
| DC diagnostic gain minimum | 0.02083333 | 1 |
| DC diagnostic gain maximum | 1 | 1 |
| DC diagnostic gain mean | 0.8082465 | 1 |
| 1 kHz source, rendered carrier | 1080 Hz | 1080 Hz |
| 880 Hz sideband relative to carrier | -13.6056 dBc | Numerical floor, below -240 dBc |

`deckSourceKernel.ts:398-405` fades according to the finite motion's remaining time
(up to a 1 ms fade), so smooth motion repeatedly loses gain at packet boundaries.
The 200 Hz packet cadence produces the measured 880 Hz sideband. `--minimal-fade`
changes only the probe's kernel constructor from 240 to 1 declick frame: packet
gain min/max/mean become 1 and the sideband falls below -240 dBc. Linear PCM
interpolation is unchanged. **This isolates the envelope, not a production fix:**
removing meaningful de-click fades would compromise real stops and edges.

**Delayed release:** contact at 0 ms, 20 GRV6 ticks at 10 ms, hand-up at 11 ms.
Commanded motion finishes at 20 ms; the scratch `end()` callback occurs at 76 ms:
65 ms handover delay, including **56 ms stationary/silent hold**. These are model
times, excluding device/audio latency; `end()` marks transport handover, not a
measured hardware playback onset. `jog.ts:169-175,209-225` waits on both its 65 ms
timer and remaining motion. `--zero-settle` changes only the probe's 65 ms timeout
to zero: handover is at 21 ms, still 10 ms after release, with 1 ms silent hold
(ceil timer rounding). Removing the timeout alone leaves residual-motion debt.

| Original probe flags | Original result |
|---|---|
| `--check-release` | Intentionally fails: handover exceeds proposed 5 ms target |
| `--check-gain` | Intentionally fails: uniform motion fades at packet boundaries |
| `--minimal-fade --check-gain` | Passes; diagnostic isolation only |

The 5 ms release target is a recommendation, **not a universal Mixxx specification**.
Existing tests cover transport/endpoints but missed constant-velocity gain continuity.
These defects are confirmed without input jitter; their contribution to subjective
live-hardware sound, additional batching artifacts, and preferred tuning remain unmeasured.

## Mixxx Motion And Audio

FLX4/DDJ-400 mappings consume center-64 relative deltas, enabling scratch on contact
and disabling on release. Turns feed `scratchTick` while `isScratching()`, otherwise
`jog`. Settings: 720 counts/rev, `33 1/3` RPM, `alpha = 1/8`, `beta = 1/256`;
not GRV6 measurements. [FLX4][m-flx4], [DDJ-400][m-400].

DDJ-SX uses 2048 counts/rev and the same gains/RPM, but its ring always pitch-bends
while its platter checks scratch state: no universal Pioneer release-stream policy.
MSB/LSB fader handlers are not interpolation of these relative jog deltas. [DDJ-SX][m-sx].

| Quantity | Units and behavior |
|---|---|
| Counts/rev; RPM | Physical encoder resolution; imaginary record revolutions/minute |
| `m_dx` | Track seconds/count: `60 / (rpm * intervalsPerRev)` |
| `scratchTick(interval)` | Accumulates signed counts and records last movement time |
| Estimator clock | Requested 1 ms timer, nominal 1000 Hz; fixed `dt = 0.001` seconds |
| Observation | `m_dx * accumulated counts`: track seconds moved per estimator interval; zero if no ticks |
| `scratch2` / estimated velocity | Signed track seconds/real second, a speed ratio |
| Alpha/beta | Dimensionless discrete-time gains; response depends on estimator cadence |

The OS's 1 ms timer delivery is assumed, not measured; public script timers have a
separate 20 ms minimum. [Scratch API][m-api]. The filter predicts displacement from
velocity, corrects position/velocity from error, then rebases position. Velocity
correction is `beta * residual / dt`, not raw `delta / MIDI callback gap`; position
state is relative, not a seek target. Timecode defaults (`1/512`, `1/524288`) differ
from jog alpha/beta. [Filter][m-filter].

Keep GRV6's measured approximately 6600 counts/rev and approved **0.00027 track
seconds/count** (`1.8 / 6648` from the slow capture). That implies approximately
3704 counts/s at `1x`, not messages/s. Counts/rev, MIDI report rate, estimator rate,
and audio sample rate are distinct. The side stream's unreported slow motion cannot
be recovered in software. [Local calibration](ddj-grv6-jog-calibration.md).

- `RateControl::calculateSpeed` uses scratch as an absolute speed override while
  playing; paused decks can scrub without changing the play button. Separate `jog`
  bending uses a 25-entry average and `0.1` sensitivity, once per audio callback:
  its duration is 25 callbacks, not fixed milliseconds. [Rate control][m-rate].
- `EngineBuffer::processTrackLocked` bypasses keylock during scratching for natural
  speed/pitch coupling; it also bypasses ordinary keylock below `abs(speed)=0.1`
  and above `1.9`. [Engine buffer][m-buffer].
- `EngineBufferScaleLinear` uses **two-point linear PCM interpolation**, not its
  unused `hermite4` helper. It ramps sample-consumption rate by `(new-old)/frames`
  per output frame, including the source/output sample-rate ratio. Reversals use
  old-rate-to-zero and zero-to-new-rate buffer halves. Ramp time: `frames/outputSampleRate`
  (128 frames/48 kHz = 2.667 ms). Mixxx stereo samples/2 = frames. [Scaler][m-scaler].
- `EnginePregain` applies `log10(1 + 4*abs(speed)) / log10(5)`, with a headroom cap:
  zero gain at rest, unity at `1x`. Gain ramps over a buffer, through zero at scratch
  reversals, rather than restarting per packet. `MIN_SEEK_SPEED=0.010` is not a
  universal mute threshold enforced by the linear scaler. [Pregain][m-gain],
  [scaler interface][m-scale-header]. No band-limited anti-alias stage is visible in
  this scaler; fast-resampling quality remains a separate later A/B question.

## Release And Slip

| Situation | Mixxx MIDI scratch behavior |
|---|---|
| Contact, ramp enabled | Initialize from existing scratch speed, otherwise playing speed or zero if paused |
| Contact, ramp disabled | Initialize velocity at zero |
| Release, playing, ramp enabled | Return toward `rate_ratio`, negated for reverse play |
| Release, paused, ramp enabled | Return toward zero; do not start playback |
| Release, ramp disabled | Clear scratch enable immediately; internal cleanup continues inaudibly |

Both ramp flags default true. During release, no movement for at least 1 ms makes
the filter observe `targetRate * 0.001 seconds`; fresher movement uses accumulated
wheel displacement instead. Release ends within `0.00001` speed-ratio error of the
target. The 1 ms check is freshness, not release duration; state/gains, scheduling,
and continued ticks determine return. No fixed 65 ms wait. [API][m-api], [defaults][m-header].
Default ramping permits spinbacks; immediate control release still retains renderer
rate/gain handling, not an abrupt PCM splice. [Official guide][m-doc].

**Physical coasting is not emulated motor inertia.** GRV6 ticks can report continued
rotation. Mixxx's separate waveform/mouse `PositionScratchController` has synthetic
throws; it is not MIDI alpha-beta processing or GRV6 friction. [Source][m-position].

Mixxx advances a shadow position at the rate captured on slip enable and seeks there
on disable; the scratch API does not toggle slip. [Engine buffer][m-buffer]. Serato
returns to the unmanipulated playback position; **Enable Slip Release** optionally
respects the release period first. **Braking** describes play/pause, not necessarily
scratch release. These are semantics, not DSP constants. [Slip][s-slip], [preferences][s-prefs].

## Recommended Model

1. Estimate velocity at fixed audio-thread cadence, independently of callback gaps,
   using timestamped calibrated displacement. Bound prediction/tracking lag; stationary
   contact converges to zero without releasing. Tune in milliseconds/position error:
   1 kHz Mixxx gains are not drop-in gains for 375 Hz worklet quanta at 48 kHz.
2. Integrate renderer rate ramps into the authoritative playhead; use speed-dependent
   zero/reversal gain handling, not packet-expiry fades. Retain real stop/edge de-clicks
   and scratch keylock bypass. Fix these confirmed defects before changing interpolation.
3. Hand-up starts return to regular pitch-adjusted transport rate (including relevant
   sync/reverse state), or zero if paused, without a forced silent wait. Preserve
   genuine motion with bounded tracking lag, not an unbounded debt-drain gate.
4. Honor physical continued spinbacks separately or through Mixxx-style ongoing ticks
   during release. Do not invent motor inertia or accidentally reinterpret a throw's
   residual ticks as a fresh large bend. Select coast thresholds from hardware captures.
5. Define Slip handover: audible endpoint without Slip; shadow position with Slip.
   Decide whether coasting delays return. Paused scratching must not start transport.

## Limits And Licensing

Hardware listening, batching, reversals, and playing/paused Slip/keylock combinations
need validation. Proprietary DSP/coast routing remain unknown; no claim relies on the
unextracted GRV6 PDF. Mixxx is **GPL-2.0-or-later**: translating code retains obligations;
distributed derivatives need GPL compliance, notices, and corresponding source, not
just attribution. Independent generic algorithms differ from ports; Mixxx's filter
credits xwax/Mark Hills. [License][m-license].

[m-api]: https://github.com/mixxxdj/mixxx/blob/d0de795077d887214506d4fe094bba41f81ec422/src/controllers/scripting/legacy/controllerscriptinterfacelegacy.cpp
[m-header]: https://github.com/mixxxdj/mixxx/blob/d0de795077d887214506d4fe094bba41f81ec422/src/controllers/scripting/legacy/controllerscriptinterfacelegacy.h
[m-filter]: https://github.com/mixxxdj/mixxx/blob/d0de795077d887214506d4fe094bba41f81ec422/src/util/alphabetafilter.h
[m-rate]: https://github.com/mixxxdj/mixxx/blob/d0de795077d887214506d4fe094bba41f81ec422/src/engine/controls/ratecontrol.cpp
[m-buffer]: https://github.com/mixxxdj/mixxx/blob/d0de795077d887214506d4fe094bba41f81ec422/src/engine/enginebuffer.cpp
[m-scaler]: https://github.com/mixxxdj/mixxx/blob/d0de795077d887214506d4fe094bba41f81ec422/src/engine/bufferscalers/enginebufferscalelinear.cpp
[m-scale-header]: https://github.com/mixxxdj/mixxx/blob/d0de795077d887214506d4fe094bba41f81ec422/src/engine/bufferscalers/enginebufferscale.h
[m-gain]: https://github.com/mixxxdj/mixxx/blob/d0de795077d887214506d4fe094bba41f81ec422/src/engine/enginepregain.cpp
[m-position]: https://github.com/mixxxdj/mixxx/blob/d0de795077d887214506d4fe094bba41f81ec422/src/engine/positionscratchcontroller.cpp
[m-flx4]: https://github.com/mixxxdj/mixxx/blob/d0de795077d887214506d4fe094bba41f81ec422/res/controllers/Pioneer-DDJ-FLX4-script.js
[m-400]: https://github.com/mixxxdj/mixxx/blob/d0de795077d887214506d4fe094bba41f81ec422/res/controllers/Pioneer-DDJ-400-script.js
[m-sx]: https://github.com/mixxxdj/mixxx/blob/d0de795077d887214506d4fe094bba41f81ec422/res/controllers/Pioneer-DDJ-SX-scripts.js
[m-doc]: https://github.com/mixxxdj/mixxx/wiki/MIDI-Scripting#scratching-and-jog-wheels
[m-license]: https://github.com/mixxxdj/mixxx/blob/d0de795077d887214506d4fe094bba41f81ec422/LICENSE
[s-slip]: https://support.serato.com/hc/en-us/articles/235191207-Slip-Mode
[s-prefs]: https://support.serato.com/hc/en-us/articles/223363407-DJ-Preferences
