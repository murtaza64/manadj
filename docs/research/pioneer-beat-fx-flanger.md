# Pioneer Beat FX: Flanger

Researched 2026-10-06 for [gh#272](https://github.com/murtaza64/manadj/issues/272).

## Official behavior

- The DDJ-GRV6 exposes FLANGER as SELECT detent note 38 (`0x26`) on MIDI
  channel 5. BEAT left/right and LEVEL/DEPTH are the same shared Beat FX
  controls used by Echo and Reverb.[^grv6-midi]
- Pioneer DJM Beat FX manuals describe Flanger as a one-cycle flanger produced
  over the beat span selected by the BEAT controls. LEVEL/DEPTH increases the
  effect's intensity. The manuals do not publish delay range, feedback gain,
  LFO waveform, stereo phase, or interpolation law.[^a9-manual][^nxs2-manual]
- Flanger uses the normal Beat FX routing: A–D after the channel fader and MST
  on the summed program path. Unlike Echo/Reverb, a short flanger delay has no
  musically significant tail once excitation stops.

## Implementation choices

- Use a sine-LFO-modulated short delay. One LFO cycle lasts the selected Beat FX
  span (`beats × secondsPerBeat`). Smooth frequency changes when BPM/BEAT moves.
- Expose center delay, sweep width, and feedback in Settings. These are useful
  synthesis controls but are not documented Pioneer parameters.
- Keep LEVEL/DEPTH as the shared dry/effect balance; do not add a second Flanger
  mix control.
- Defaults: 3 ms center, 2 ms peak-to-peak sweep width, 35% feedback. Clamp the
  modulation amplitude below the center delay so delay time never crosses zero.

## Other effect tuning

- Echo: expose feedback and safety saturation. Pioneer publishes neither
  coefficient; normal ECHO remains full-band (LOW CUT ECHO is separate).
- Reverb: expose decay, damping cutoff, and stereo width. LEVEL/DEPTH remains
  balance, not decay.

## Sources

[^grv6-midi]: AlphaTheta, [DDJ-GRV6 MIDI Message List E1](https://downloads.support.alphatheta.com/software_info/dj-controllers/DDJ-GRV6/DDJ-GRV6_MIDI_Message_List_E1.pdf), p. 3.
[^a9-manual]: AlphaTheta, [DJM-A9 Instruction Manual download page](https://support.alphatheta.com/en-US/articles/15916598774553), “Beat FX types and settings”.
[^nxs2-manual]: AlphaTheta, [DJM-900NXS2 Instruction Manual download page](https://support.alphatheta.com/en-US/articles/4404624192665), “Types of effects”.
