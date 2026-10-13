# SUPERSEDED: browser phone performance lab (throwaway)

This browser demo is frozen. The native Android/Compose prototype is in `prototypes/android-performance/`; #365 and the owning lane's `review.html` point to its APK and emulator evidence. Do not use this browser route to evaluate phone DJ touch behavior.

Run `npm run dev -- --host 0.0.0.0` from `frontend/`, then visit `/prototype/phone-performance?variant=stack` on that server. Alternatives: `variant=focus`, `variant=mixer`; floating arrows switch without restarting audio. Development-only route; not a shipping Android app. Tap PLAY to initialize audio. LOAD accepts a local audio file per deck. The position ruler is schematic, **not an audio waveform or analyzed beat grid**; its BPM defaults to 120/126 and is not analyzed. Orange main-cue, palette hotcue flags, and pink transport playhead mark actual prototype positions. The fixed bus keeps both transports and crossfader reachable while scrolling.

- Stack: two expanded decks above channel mixer.
- Focus: one expanded deck, persistent transport for the other.
- Mixer: both compact transports, mixer first, deck-selectable pads.
- Session/Set area: simulated future desktop ⇄ phone intent. Captured events and replay are volatile prototype-only actions, not compatible with desktop Sessions or Sets.

Limits: Web Audio varispeed changes pitch; no keylock, beat grid or auto-sync, headphone preview/independent outputs, native Android latency/background guarantees, offline installation, library sync, or desktop connection. Demo loops are generated locally. Local files decode into memory; large files may exhaust phone memory. Headphone cue button is a momentary transport cue on the **master** bus, not a separate headphone channel. Test on real Android hardware before claiming performance viability.

Context: [old companion cut #65](https://github.com/murtaza64/manadj/issues/65) excluded live DJing; superseded for this study. [Runtime research #151](https://github.com/murtaza64/manadj/issues/151) focused on iOS, not Android validation. [Sync groundwork #152](https://github.com/murtaza64/manadj/issues/152) assumed desktop-authoritative pull-only v1; bidirectional Session/Set ambitions remain open. [Old v1 scope #153](https://github.com/murtaza64/manadj/issues/153) was single-track.
