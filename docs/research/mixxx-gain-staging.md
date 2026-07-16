# Mixxx gain staging vs manadj master-headroom

Researched 2026-07-16 for `master-headroom` follow-up. Primary sources only:
current Mixxx source (`main` branch) and the official Mixxx 2.5 manual. Serato /
rekordbox autogain could not be confirmed from accessible primary docs and is
therefore left unstated below (see "Serato / rekordbox").

## Mixxx audio graph (current `main`)

Per-deck chain, in `EngineDeck::process` (order is literal in the source):

1. `EngineBuffer::process` — decode + resample/scratch.
2. `EnginePregain::process` — ReplayGain × pregain × speed gain.
3. `processPreFaderInPlace` — deck EQ, Quick Effect (filter), and any
   pre-fader effects.
4. Deck VU meter tap (`m_vuMeter.process`) — reads the post-pregain,
   post-EQ/effect, **pre-fader** signal.

Cite: [EngineDeck::process](https://github.com/mixxxdj/mixxx/blob/main/src/engine/channels/enginedeck.cpp).

Channel volume fader + crossfader are applied in the mixer, not the deck. In
`EngineMixer::process` the channel `volume` gain and the crossfader gains are
folded into one `m_mainGain.setGains(left, 1, right)` and applied while summing
the per-orientation buses (`ChannelMixer::applyEffectsInPlaceAndMixChannels`).
Then, in order: sum the three orientation buses → main effects
(`applyMainEffects`) → talkover ducking gain → mix in talkover → **main gain**
(`m_pMainGain`) → `[MasterOutput]`-only post-fader effects → balance → VU meter
→ optional mono mixdown → `m_pMainDelay`. Booth and headphone/PFL are separate
taps of the same summed main.

Cite: [EngineMixer::process / applyMainEffects](https://github.com/mixxxdj/mixxx/blob/main/src/engine/enginemixer.cpp).

So the requested end-to-end chain, confirmed:

> decoded → ReplayGain/pregain (+speed gain) → EQ/filter/effects (pre-fader) →
> channel volume fader → crossfader → sum → main effects → ducking → main gain
> → balance → main delay → output.

### Compressor / limiter / soft clip

**None on channel or master.** Nowhere in `EngineDeck`, `EngineChannel`, or
`EngineMixer` is there a compressor, limiter, or soft-clip/waveshaper on the
program path. The only dynamics processor in the engine is talkover **ducking**
(`EngineTalkoverDucking`), which attenuates the main mix while a mic is active —
it is not a peak safety net and does nothing when no mic is configured. Samples
are `CSAMPLE` (float) and are never clamped to ±1 in the mix path.

Cite: [EngineMixer::process](https://github.com/mixxxdj/mixxx/blob/main/src/engine/enginemixer.cpp).

### Headroom / summing / clipping policy

Mixxx has **no headroom-reservation trim offset and no output ceiling.** Unity
is unity: channel `volume` defaults to 1.0 (`ControlAudioTaperPot` -20..0 dB),
main `gain` defaults to 0 dB (`ControlAudioTaperPot` -14..+14 dB). Two unity
decks summing above 0 dBFS simply clip, and the manual's entire gain-staging
policy is *the human turns gains down*:

- "These should stay at the top of the green region … They should never be in
  the red region."
- "Do NOT turn the Gain Knob up so much that the level meter is in the red
  region. At this point the track is clipping…"
- "In no case should any part of the signal chain be clipping."
- The Main knob "should be a last resort for adjusting volume" — Mixxx does not
  protect the sum; the DJ and downstream amp gain do.

Cite: [Mixer / Gain Knob / Main knob](https://manual.mixxx.org/2.5/en/chapters/user_interface),
[Setting Your Levels Properly (Gain Staging)](https://manual.mixxx.org/2.5/en/chapters/djing_with_mixxx).

### Autogain / ReplayGain: exact behavior and defaults

Autogain in Mixxx **is** ReplayGain, applied in `EnginePregain::process`:

- Enabled by default: "By default, Mixxx automatically applies an additional
  ReplayGain so tracks have approximately equal loudness at unity gain."
  (`[ReplayGain] ReplayGainEnabled`.)
- `totalGain = pregain × clamp(replayGainCorrection, 0, 10)`, then a speed-gain
  factor (vinyl emulation) that is itself capped so `totalGain` cannot exceed
  0.9 by speed alone (`kMaxTotalGainBySpeed`, "-1 dB to not risk any clipping").
- If the track has a stored ReplayGain value, its correction is
  `replaygain × [ReplayGain] ReplayGainBoost` (boost is `ControlAudioTaperPot`
  -12..+12 dB, default 0 dB). On a value change it **smooth-fades over 1 s**
  (`kFadeSeconds`) rather than jumping.
- If ReplayGain is not yet analyzed (value 0), it uses
  `[ReplayGain] DefaultBoost` (-12..+12 dB, default 0 dB) as a provisional
  correction and prepares to smooth-fade once analysis lands. The manual: Mixxx
  "will not apply a newly calculated ReplayGain value to a track after it has
  already started playing (to avoid a sudden change in the gain of a playing
  track)."
- Passthrough or ReplayGain-disabled → correction forced to 1.0 (expects an
  already-levelled input).
- Correction is clamped [0, 10] to guard corrupt tags.

Pregain (per-deck "gain" trim knob) is `ControlAudioTaperPot` -12..+12 dB,
default 0 dB, and is manual level-matching per the manual's Gain Knob text.

Cite: [EnginePregain::process](https://github.com/mixxxdj/mixxx/blob/main/src/engine/enginepregain.cpp),
[Gain Knob / ReplayGain note](https://manual.mixxx.org/2.5/en/chapters/user_interface).

### Meter taps and clip indicators

`EngineVuMeter` (used per-deck and on the main):

- Level statistic is **mean absolute sample per channel** (`sumAbsPerChannel`),
  smoothed, updated at ~30 Hz — not sample peak. Attack smoothing 1.0, decay
  0.1.
- A **separate** `peak_indicator` (with L/R variants) is the clip flag, driven
  by `SampleUtil`'s clip status, held for `kPeakDuration` = 500 ms.
- Deck VU meter reads **post-EQ/effect, pre-fader**; the main VU meter reads the
  final summed main (post main gain, post balance).
- Manual: deck meters "should stay at the top of the green region," transients
  "briefly going into the yellow," "never … in the red."

Cite: [EngineVuMeter](https://github.com/mixxxdj/mixxx/blob/main/src/engine/enginevumeter.cpp),
[Channel Faders and Level Meters](https://manual.mixxx.org/2.5/en/chapters/user_interface).

### Crossfader

`EngineXfader::getXfadeGains` — constant-power or additive curve selectable
(`xFaderMode`/`xFaderCurve`), with a calibration so the constant-power curve
normalizes as if signals were uncorrelated (`gain1² + gain2² == 1`). Default
curve is constant power; there is no dip-avoidance trim beyond the curve itself.

Cite: [EngineXfader::getXfadeGains](https://github.com/mixxxdj/mixxx/blob/main/src/engine/enginexfader.cpp).

### Serato / rekordbox

Not confirmed. Accessible primary Serato/AlphaTheta documentation on autogain /
output-limiter behavior could not be retrieved (support-article and manual URLs
returned 404/403 at research time). Per the primary-source requirement this is
left unstated rather than guessed. It is widely reported that both apply track
loudness normalization (Serato "Auto Gain", rekordbox "Auto Gain / track gain")
and that hardware players/mixers carry hardware limiters, but that is not a
primary source and is not asserted here.

## Comparison to manadj (current lane files)

| Dimension | Mixxx (`main`) | manadj |
|---|---|---|
| Per-channel level matching | ReplayGain (autogain) **on by default** + manual pregain trim | **No autogain.** Only a manual trim knob |
| Trim center | 0 dB (unity), range -12..+12 (`pregain`) | -6 dB, range -18..+6 (`trimToGain`, `TRIM_CENTER_DB`) |
| Channel fader taper | audio taper pot | quadratic `v*v` (`channelFaderToGain`) |
| Crossfader | selectable const-power/additive with calibration | dipless linear, unity through own half incl. center (`crossfaderGains`) |
| Master dynamics | **none** | **none** (compressor removed, ADR 0034) |
| Output ceiling | **none** (policy: don't clip) | **-2 dBFS hard sample ceiling always on** (`samplePeakCeilingCurve`, `LIVE_OUTPUT_CEILING`) |
| Meter statistic | mean-abs `sumAbsPerChannel`, ~30 Hz | mean-abs over analyser window, 30 Hz (`ChannelStrip.levelSample`) — deliberately Mixxx-matched |
| Clip indicator | separate `peak_indicator`, `|sample|>=1`, 500 ms hold | separate `clipped`, `|sample|>=1`, 500 ms hold (`readChannelLevel`) — deliberately Mixxx-matched |
| Meter tap | post-EQ/effect, pre-fader | post-trim/EQ/filter, pre-fader/PFL — deliberately Mixxx-matched |

manadj's meter model (`mixer.ts`, `master-gain-staging.md` "Channel meters")
already tracks Mixxx faithfully. The two structural divergences are:

1. manadj **reserves headroom by trim offset** (-6 dB center) and keeps an
   **always-on -2 dBFS ceiling**; Mixxx reserves nothing and relies on the DJ.
2. manadj has **no autogain/ReplayGain**; Mixxx enables it by default.

## Why removing manadj's compressor feels harder to mix — and the likelier cause

Removing the `DynamicsCompressorNode` (ADR 0034) had two measured effects on the
program (per `master-gain-staging.md`): it was applying **makeup gain**
(a -10.78 dBFS input came out at -9.07 dBFS, +1.71 dB) and it was **reducing
dynamics** across ordinary two-track mixes (two "typical" tracks summed to
+0.13 dBFS post-compressor vs the pre-master +4.48 dBFS). So the old node was
acting as a loose leveller/glue: it quietly pulled disparate track loudnesses
toward each other and tamed the summed peaks. That is exactly the job a DJ
otherwise does by ear with per-channel gain — so its removal makes level
management feel more manual, i.e. "harder to mix."

But the compressor was a poor and accidental leveller: threshold -3 dB, ratio
20:1, 3 ms attack, 250 ms release, auto makeup, no output clamp — it changed
program loudness, dulled transients, and still overshot 0 dBFS. Restoring it
would reintroduce those defects.

The more likely root cause of "harder to mix" is **the missing autogain**. Mixxx
matches per-track loudness *before* the fader by default (ReplayGain in
`EnginePregain`), which is the specific thing that lets a DJ set faders/EQ and
trust that two tracks arrive at comparable loudness. manadj currently has only a
manual trim, so every track pairing requires manual gain-riding — the friction a
compressor was incidentally masking (by squashing the loud one down toward the
quiet one). The compressor compensated for the symptom (mismatched summed
loudness) globally and destructively; autogain addresses the cause (mismatched
per-track loudness) per-channel and transparently, which is why it is the better
fix and the more probable explanation for the regression in feel.

Recommendation implied by the sources (not a decision): add per-track loudness
normalization at the trim/pregain stage (Mixxx's model), keep the -2 dBFS
ceiling as the mistake/transient guard, and do **not** reinstate a program
compressor.

## URLs (verified accessible 2026-07-16, HTTP 200)

- https://github.com/mixxxdj/mixxx/blob/main/src/engine/enginemixer.cpp
- https://github.com/mixxxdj/mixxx/blob/main/src/engine/enginepregain.cpp
- https://github.com/mixxxdj/mixxx/blob/main/src/engine/enginevumeter.cpp
- https://github.com/mixxxdj/mixxx/blob/main/src/engine/enginexfader.cpp
- https://github.com/mixxxdj/mixxx/blob/main/src/engine/channels/enginedeck.cpp
- https://github.com/mixxxdj/mixxx/blob/main/src/engine/channels/enginechannel.cpp
- https://manual.mixxx.org/2.5/en/chapters/user_interface
- https://manual.mixxx.org/2.5/en/chapters/djing_with_mixxx
- https://manual.mixxx.org/2.5/en/chapters/preferences/library
