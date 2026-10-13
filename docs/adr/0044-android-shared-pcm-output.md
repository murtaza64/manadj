# Android uses one native PCM mixer and output clock

The first real Android slice uses platform decoding off-thread and one Oboe PCM output/mixer, with stable A–D identities. All three native layouts, and future Session/Conductor clients, submit commands and observe the same engine snapshots; Compose does not advance playback time. Independent Media3 players would make shared-clock mixing and sample-domain transport a later replacement rather than an incremental extension.

The native module owns bounded PCM storage, source generations, callback state and accepted/applied command IDs. The app owns persisted document grants, metadata, selection and Android audio-focus/service lifetime. A source is READY only after priming; output-open errors remain separate from source readiness. Source replacement must never associate old PCM or clock state with a new track identity.

This is the initial parity candidate from [#367](https://github.com/murtaza64/manadj/issues/367), implemented through [#369](https://github.com/murtaza64/manadj/issues/369) and [#370](https://github.com/murtaza64/manadj/issues/370). Unsupported DSP, grid/sync and scratch controls remain explicitly unavailable; waveform analysis can be pending, never fabricated for selected media. Physical-device latency and later stretch/FX/headphone-output choices remain unproven. The throwaway #365 change stays separate.
