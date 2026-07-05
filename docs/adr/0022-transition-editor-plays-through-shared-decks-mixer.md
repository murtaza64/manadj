# The Transition editor plays through the shared Decks and Mixer

Status: accepted (grill 2026-07-05)

The Transition editor's private Mixer (tolerated against ADR 0009, policed
by ADR 0013's arbiter) accumulated a tax ledger: two-clock stutter (the
arbiter's reason to exist), hardware-addressability carve-outs (ADR 0019),
and a device-routing miss (ADR 0021, explicitly interim). Decision: full
unification. Editor auditions play through the shared two Decks and the
one Mixer/AudioContext. `MixPlayer` becomes a pure conductor — mix
timeline on the audio clock, arrangement drift sync, jump events, lane
application, tempo-match pitch — constructed over injected shared
machinery, owning no audio. The "feature lands on one mixer, misses the
shadow one" bug class is deleted by construction.

The design that makes sharing safe:

- **Automation overlay (replacement semantics)**: the Mixer grows a
  distinct automation write-path to the 10 lane-driven node params
  (fader/EQ/filter × 2 channels). User-facing state (`channels`,
  `getChannelState`, notify) is never touched; on release the Mixer
  reapplies base state to the nodes. A knob turned mid-audition updates
  base state and takes effect on release (DAW automation-read behavior).
  The overlay also **pins the crossfader to neutral** while the editor is
  audible (the editor mixes via fader lanes; a stale hard-left crossfader
  would silence deck B). Trim, master, cue level/mix, and PFL pass
  through live — trim follows the tracks, the rest are bus-level; PFL in
  the editor becomes a feature (impossible under ADR 0021).
- **Borrowed-deck checkpoint**: per-deck pitch is snapshotted on claim
  and restored on release (a leaked ±25% tempo-match pitch is off-scale
  for the ±8% Performance fader). Transport mutations deliberately
  persist — transition editing is not a mid-set activity. Main cue and
  hot cues are safe by construction (the conductor only seeks/plays/
  pauses/sets pitch).
- **Pitch-range policy moves to callers**: the engine stores up to the
  widest range; the Performance UI/MIDI layer clamps its writes to ±8%,
  the editor conductor to ±25%. The constructor-constant range fork dies.
- **Key Lock carve-out retired**: the editor plays through each Deck's
  sticky Key Lock (default ON) — tempo-matched auditions are where Key
  Lock matters most (ADR 0018's deferral resolved).
- **Capture gates on audibility**: the always-on recorder (ADR 0020) runs
  only while 'shared' holds the audible surface and discards any
  in-flight engagement on losing it — editor auditions on the same decks
  must not become phantom Takes.
- **Load mirroring dies**: editor loads ARE Deck loads through the one
  DeckContext load path (Main-cue defaults included).
- **The arbiter survives, shrunk**: still the single-holder owner of
  playback policy and gesture-class routing (ADR 0019 intact), and now
  the transaction boundary where the overlay engages/disengages, the
  pitch checkpoint saves/restores, and capture gates. The clock machinery
  is deleted: `silence()` means "pause your playback" only, `wake()`-as-
  resume and the `mayStart` tripwire go — with one context there is no
  second clock to resurrect, and the tripwire's predicate
  (`isAudible('shared')`) would block the editor's own conducting of the
  shared engines.

## Considered options

- **Shared context, private strips** (editor keeps its own channel strips
  as a second bus in the one context) — rejected: only pays off the clock
  item; cue routing, Key Lock, capture, and every strip-level feature
  still land twice. The tempting half-measure that keeps the shadow
  surface alive.
- **Save/restore mixer state** instead of the overlay — rejected: mutates
  user state as an implementation detail, and this codebase has already
  demonstrated (StrictMode, headphone-cue 06) that designs with a restore
  step eventually miss it. Base-state-never-mutated is fail-safe.
- **Multiplicative compose** (node value = user state × automation) —
  rejected: composition semantics per control are a swamp nobody asked
  for.
- **Feature flag / parallel path** for migration — rejected: dual wiring
  is exactly the duplication this work exists to kill, kept alive during
  the riskiest window. The risky piece (the overlay) lands first,
  consumer-free, under tests instead.

## Consequences

- ADR 0009 is restored in full; ADR 0021 (secondary-mixer routing
  registry) is retired and its registry deleted; ADR 0013 is superseded
  in part (the clock invariant is vacuous; the single-holder policy and
  routing seam remain); ADR 0019 survives whole, though "the editor's
  private mixer is not hardware-addressable" no longer motivates the
  mixer-class exclusion — mixer controls now audibly affect editor
  playback, which is the intended pass-through.
- Trim is session state a Transition cannot express; follow-up filed
  (editor-shared-decks issue 01: trim state in the Transition editor).
- The shared context now runs continuously once created (nothing ever
  suspends it) — small idle CPU cost, accepted for a desktop tool.
- The swap slice's real gate includes an ear check (release reapply pops,
  overlay-vs-rampGain interaction, stretch artifacts at ±25%) — vitest
  cannot hear.
