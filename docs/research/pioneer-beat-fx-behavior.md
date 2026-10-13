# Pioneer/AlphaTheta Beat FX behavior

Researched 2026-10-06 for [gh#272](https://github.com/murtaza64/manadj/issues/272).
Claims below use AlphaTheta/Pioneer DJ primary sources. DSP inferences are
explicitly marked.

## Findings

### Signal chain and tails

- Echo and Reverb are **post-fader effects**, not pre-fader channel inserts.
  Pioneer describes these effects as post effects designed to leave natural
  reverberation after sound is cut with the channel fader. Its external-effect
  FAQ likewise says an insert on an individual channel cannot leave an Echo
  tail, while a post-fader effect can.[^post-effects][^external-tail]
- The behavior implies a post-fader excitation path whose effect return is not
  attenuated by later channel-fader movement: lowering the fader stops new
  input while the delay/reverb state already excited continues to output. A
  pre-fader effect followed by the channel fader would incorrectly kill the
  tail.
- The same Pioneer FAQ says these generated Echo/Reverb sounds cannot be
  monitored through the Beat Effects CUE path because their generating
  circuitry is downstream.[^post-effects] For manadj, PFL should therefore
  remain pre-Beat-FX.
- Official sources establish tail preservation after **fader closure**. They do
  not establish that pressing Beat FX ON/OFF must preserve the tail. Ring-out
  on disable is a manadj design choice, not verified Pioneer behavior.

### LEVEL/DEPTH

- The DJM-A9 and DJM-900NXS2 Beat FX tables define Echo LEVEL/DEPTH as the
  balance between original and echo sound, and Reverb LEVEL/DEPTH as the
  balance between original and effect sound.[^a9-manual][^nxs2-manual]
- The wire/control law is an unsigned balance/depth throw. Neither manual
  assigns negative and positive effect meanings around center, and the GRV6
  reports one unsigned 14-bit absolute value.[^grv6-midi] manadj's requested
  -1…1 UI/Mixer domain is therefore a coordinate transform: -1 = original-only,
  0 = balance midpoint, +1 = effect-only. Center is not bypass or polarity
  reversal.
- The official documents do not specify a gain equation, constant-power versus
  linear crossfade, center gain, or a physical/electrical center detent. A
  midpoint equal-balance interpretation is reasonable UI behavior, but is an
  implementation inference rather than a documented amplitude law.
- Reverb LEVEL/DEPTH controls dry/effect balance, not decay time. A fixed IR or
  decay with this knob mapped only to mix matches the documented interface.

### Echo algorithm

- Pioneer defines Echo as delayed sound emitted several times and gradually
  attenuated, with delay time selected as a BPM-linked beat fraction.[^a9-manual][^nxs2-manual]
  This establishes a feedback delay and a decaying tail, but not the feedback
  coefficient.
- No official source found specifies feedback gain, damping filters,
  saturation, interpolation, stereo topology, or smoothing during BPM changes.
  In particular, **50% feedback is not an official Pioneer value**.
- No official source says Echo contains Reverb or an ambience stage. The GRV6
  exposes ECHO, LOW CUT ECHO, SPIRAL, and REVERB as separate selections.[^grv6-midi]
  The manuals describe Echo only as repeated delayed sound. “Reverberation” in
  the tail FAQ is a generic description of a lingering effect, not evidence of
  a reverb algorithm.
- Applying a high-pass filter to normal Echo would blur the documented
  distinction from LOW CUT ECHO. Any high/low-pass damping or soft clipping in
  manadj should be labeled a creative tuning choice, not Pioneer parity.
- **Open-source inference, not Pioneer evidence:** Mixxx's maintained Echo uses
  a delay ring buffer, separate send and feedback gains, sample clamping, and
  no reverb stage. Its default feedback is -3 dB, demonstrating that a fixed
  coefficient is implementation-specific rather than a Pioneer fact.[^mixxx-echo]

### DDJ-GRV6 controls and MIDI

AlphaTheta says the GRV6 has Beat FX from the DJM-A9 and a Beat FX section with
a similar feel.[^grv6-product] The official E1 list assigns the section to MIDI
channel 5 (wire channel nibble `4`):[^grv6-midi]

| Control | MIDI input | Relevant value |
|---|---|---|
| SELECT: ECHO | Note `33` (`0x21`) | New detent emits note-on |
| SELECT: REVERB | Note `37` (`0x25`) | New detent emits note-on |
| SELECT: LOW CUT ECHO | Note `34` (`0x22`) | Separate algorithm |
| LEVEL/DEPTH | CC `2` MSB + CC `34` LSB | Unsigned 14-bit absolute control |
| ON/OFF | Note `71` (`0x47`) | Same note is MIDI output for its lamp |
| BEAT left / right | Notes `74` / `75` | Shift: notes `102` / `107` |
| Shift + ON/OFF | Note `67` | Release FX, distinct from ON/OFF |

The E1 output table also defines beat-indicator values for `1/4`, `1/2`, `3/4`,
`1`, `2`, `4`, `8`, `16`, and `32`. This proves display encodings, not that
every effect accepts every value.[^grv6-midi]

## Recommendations for gh#272

1. Place the effect input after the channel fader and mix its persistent return
   downstream of that fader; keep PFL before Beat FX. A post-fader serial
   dry/wet node is sufficient if lowering the fader zeros only new input and
   does not scale the node's existing tail.
2. Map LEVEL/DEPTH across the full unsigned range as dry/effect balance. For
   manadj's bipolar coordinate, map hardware minimum/center/maximum to -1/0/+1;
   center remains the balance midpoint, not bypass. Do not claim an exact
   Pioneer crossfade curve without measurement.
3. Keep Reverb decay/IR fixed and map LEVEL/DEPTH only to dry/effect balance.
4. Implement Echo as a full-band beat-linked feedback delay with decaying
   repeats and no reverb stage. Treat 50% feedback, safety saturation, and
   BPM-retarget smoothing as manadj choices.
5. Remove the proposed high-pass from normal Echo, or rename that voicing Low
   Cut Echo. Pioneer exposes Low Cut Echo separately.
6. Test tail behavior specifically: after the fader reaches zero, no new audio
   enters Echo/Reverb, but the existing wet tail remains audible. Keep ON/OFF
   tail behavior as a separate product decision.

## Sources

[^post-effects]: AlphaTheta Help Center, DJM-900SRT, [“Effect sounds cannot be monitored even when the BEAT EFFECTS - CUE button is pressed”](https://support.alphatheta.com/en-US/articles/19919958100121). States that Echo and Reverb are post effects designed to preserve natural reverberation when the channel fader cuts sound. Verified 2026-10-06.
[^external-tail]: AlphaTheta Help Center, DJM-750MK2, [external-effect Echo-tail FAQ](https://support.alphatheta.com/en-US/articles/4408734212505). Contrasts per-channel insert behavior with post-fader Echo tails. Verified 2026-10-06. The [DJM-A9 external-effect FAQ](https://support.alphatheta.com/en-US/articles/16001570967065) independently documents the same tail-routing constraint.
[^a9-manual]: AlphaTheta, [DJM-A9 Instruction Manual download page](https://support.alphatheta.com/en-US/articles/15916598774553), “Beat FX types and settings” table. Verified 2026-10-06.
[^nxs2-manual]: AlphaTheta, [DJM-900NXS2 Instruction Manual download page](https://support.alphatheta.com/en-US/articles/4404624192665), “Types of effects” table. Verified 2026-10-06.
[^grv6-midi]: AlphaTheta, [DDJ-GRV6 MIDI Message List E1](https://downloads.support.alphatheta.com/software_info/dj-controllers/DDJ-GRV6/DDJ-GRV6_MIDI_Message_List_E1.pdf), pp. 3, 7. Verified 2026-10-06.
[^grv6-product]: AlphaTheta, [DDJ-GRV6 product page](https://alphatheta.com/en/product/dj-controller/ddj-grv6/black/), “Club-inspired layout and features” and control callouts. Verified 2026-10-06.
[^mixxx-echo]: Mixxx project, [`echoeffect.cpp`](https://github.com/mixxxdj/mixxx/blob/main/src/effects/backends/builtin/echoeffect.cpp). Authoritative for Mixxx only; used solely as an explicitly labeled implementation reference. Verified 2026-10-06.
