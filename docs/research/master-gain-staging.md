# Master gain staging

Measured 2026-07-16 for `master-headroom/01`. Digital measurements use
Electron's real `OfflineAudioContext`; device facts use read-only CoreAudio
properties. Physical DAC/loopback checks remain in the parked Walkthrough.

## Reproduce

```sh
cd desktop
/Users/murtaza/manadj/desktop/node_modules/.bin/electron ../scripts/probes/master_gain_staging.js
# Optional: measure each track's loudest one-second region and their sum
/Users/murtaza/manadj/desktop/node_modules/.bin/electron ../scripts/probes/master_gain_staging.js \
  --track /path/to/a.flac --track /path/to/b.flac
cd ..
swift scripts/probes/coreaudio_output_probe.swift
```

The gain harness renders deterministic full-scale, correlated, decorrelated
"typical mastered", trim, EQ, filter, and crossfader scenarios through the
production filter and former compressor settings. It reports sample peak,
4x-rendered true-peak estimate, and RMS at decoded, channel, summed
pre-Master, post-Master, post-compressor, and final-ceiling stages. It also
runs a proposed-neutral recording through the production WAV/MP3 export.

## Baseline measurements

| Scenario | Channel | Pre-Master | Post-compressor |
|---|---:|---:|---:|
| one full-scale, unity trim | +1.22 dBFS | +1.22 dBFS | -0.20 dBFS |
| two correlated, unity trim | +1.22 dBFS | +7.24 dBFS | +0.64 dBFS |
| two typical, unity trim | +0.36 dBFS | +4.48 dBFS | +0.13 dBFS |
| one full-scale, -12 dB trim | -10.78 dBFS | -10.78 dBFS | -9.07 dBFS |
| one full-scale, +12 dB trim | +13.22 dBFS | +13.22 dBFS | +1.08 dBFS |
| one full-scale, all EQ +6 dB | +7.22 dBFS | +7.22 dBFS | +0.64 dBFS |
| one full-scale at filter resonance | +2.93 dBFS | +2.93 dBFS | -0.83 dBFS |

The reported user recording measured -7.6 LUFS integrated, +2.4 dBTP, and
decoded samples to ±1.31 before `audio-recording/03`. Its replacement export
ceiling held decoded WAV/MP3 samples at -2 dBFS, but the waveform remained
solid because the live compressor had already reduced dynamics and the
export limiter then held most peaks at its ceiling.

### DynamicsCompressorNode

The old node was threshold -3 dB, knee 0, ratio 20:1, attack 3 ms, release
250 ms. It was neither transparent nor a ceiling:

- A -10.78 dBFS input emerged at -9.07 dBFS: +1.71 dB makeup gain below the
  nominal threshold.
- Two typical tracks emerged at +0.13 dBFS; two correlated tracks at
  +0.64 dBFS; max trim at +1.08 dBFS.
- Its 3 ms envelope allowed attack overshoot and its transfer had no output
  clamp.

This matches the Web Audio algorithm: it computes automatic makeup gain and
does not clamp output. WebKit's implementation writes delayed input times
the computed gain directly. Sources:

- [Web Audio DynamicsCompressor processing](https://www.w3.org/TR/webaudio-1.1/#DynamicsCompressorOptions-processing)
- [WebKit DynamicsCompressorKernel](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/DynamicsCompressorKernel.cpp)

### EQ and filter

Flat three-band reconstruction sample-peak change by sine frequency:

| Hz | 60 | 250 | 500 | 997 | 2500 | 5000 | 12000 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| dB | +0.01 | -0.06 | +1.48 | +1.22 | +0.90 | +0.95 | +0.76 |

The current three-way LR4 topology is not peak-flat through the midrange,
though RMS stays near unity for the sine scenarios. The sweep's intentional
+3 dB resonance measured +2.93 dB at cutoff. These are channel-metered
post-EQ/filter and must fit inside trim headroom; they are not hidden at the
Master.

## Chosen digital contract

- Trim center is -6 dB, with the existing 24 dB throw shifted to -18..+6
  dB. Two unity-fader channels therefore receive 6 dB expected summing
  headroom; the crossfader remains dipless and does not hide a loudness
  change.
- At proposed neutral trim, one full-scale sine measured -4.78 dBFS after
  flat EQ; two typical tracks summed to -1.52 dBFS. Two exactly correlated
  full-scale tracks still reached +1.24 dBFS and are an overload case.
- The Web Audio compressor is removed. It changed ordinary program
  loudness, reduced dynamics, and still failed to establish a ceiling.
- Master and Cue end in a -2 dBFS sample-peak ceiling, linear below the
  threshold. It catches correlated/extreme overloads and reserves
  intersample/DAC headroom. It is a final guard, not a loudness processor.
- Master uses an audio taper to explicit 0 dB unity at 50%, then provides
  0..+6 dB over its upper half. This user-controlled make-up gain
  precedes the ceiling.
- Recording branches from the program sum before monitor Master gain and
  passes through an independent -2 dBFS sample ceiling. The desktop export
  limiter remains a defensive codec/file boundary and should normally be
  inactive. Monitor volume/boost cannot alter the file.
- The ceiling is sample-peak, not a true-peak lookahead limiter. The 2 dB
  reserve is deliberate; physical loopback validates the remaining DAC
  reconstruction risk.

## Channel meters

The GRV6 channel tap stays post-trim/EQ/filter and pre-fader/PFL, matching
the hardware mixer contract. It reports Mixxx-style mean absolute level at
30 Hz with separate sample clipping (`|sample| >= 1`) held for 500 ms.
Ordinary VU is capped at E1 `0x75`; only clipping sends red `0x77`. With
trim center now -6 dB, orange is the target at a track's loudest passage,
matching the DDJ-GRV6 manual's trim instruction. Red means the channel
itself exceeded full-scale before summing, not that the downstream Master
ceiling engaged.

## CoreAudio and hardware

Apple canonical audio and WebKit use non-interleaved 32-bit float; samples
are not clamped to ±1 before CoreAudio. The Web Audio specification calls
destination rendering outside nominal [-1,1] undefined.

`coreaudio_output_probe.swift` measured:

| Device | Format | Outputs | CoreAudio volume/mute |
|---|---|---:|---|
| DDJ-GRV6 | 32-bit float PCM | 4 | absent |
| MacBook Pro Speakers | 32-bit float PCM | 2 | master volume + mute settable |
| rekordbox Aggregate Device | 32-bit float PCM | 6 | absent |

The GRV6 therefore has no CoreAudio/system attenuation control. Its physical
Master knob is MIDI input to manadj's software Master gain; the USB audio
device receives the resulting float stream at fixed device gain. MacBook
Speakers expose system attenuation, but primary sources do not establish
whether it precedes their final clamp. DAC clip shape and actual analog
ceiling on both devices require physical/acoustic loopback.

Sources:

- [Apple Core Audio canonical formats](https://developer.apple.com/library/archive/documentation/MusicAudio/Conceptual/CoreAudioOverview/CoreAudioEssentials/CoreAudioEssentials.html)
- [Web Audio signal value rendering](https://www.w3.org/TR/webaudio-1.1/#audio-values-rendering)
- [WebKit AudioDestinationCocoa](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/AudioDestinationCocoa.cpp)
- [Mixxx EngineVuMeter](https://github.com/mixxxdj/mixxx/blob/main/src/engine/enginevumeter.cpp)
