# 06 — Editor's private mixer ignores the routed master device (bug)

Status: done — pending user ear-verify

## Parent

.scratch/headphone-cue/PRD.md (regression surfaced by issue 04's routing)

## What to build

Bug: the Transition editor plays "through the headphones" when the routed master device differs from the system default. Diagnosis (H1, code-confirmed): `MixPlayer` builds a private Mixer/AudioContext, and routing (issue 04) applies the saved master sink to the shared mixer only — the private mixer plays to the system default device, which is typically the cue/headphone interface once a DJ has configured cue. Not the cue *bus* — an un-routed second master. Third tax on the private-mixer decision (after ADR 0013's arbiter and ADR 0019's addressability note).

Fix at the routing seam:

- `routingStore` gains a registry of secondary mixers: `registerRoutedMixer(mixer)` → applies the currently-resolved **master** sink immediately and on every recompute; returns an unregister. Cue sink stays exclusive to the primary (shared) mixer — the editor must never open a second cue bridge.
- `MixPlayer` registers its mixer for its lifetime (dispose unregisters).
- Regression test first, at the routingStore seam with fake Mixer-shaped objects (sanctioned fake style — routing.ts/DeckAudioPort precedent): red today (secondary mixer never receives a sink).

## Acceptance criteria

- [ ] With a saved master device, editor playback comes out of the same device as deck playback (eye/ear-verify)
- [ ] Changing the master device while the editor is open re-applies to both mixers
- [ ] Cue sink is never applied to a secondary mixer
- [ ] Regression tests at the routingStore seam (fake mixers): secondary receives master on register and on device change; never cue
- [ ] Gate green

## Blocked by

None.

## Comments

- Done (lane followmode): `registerRoutedMixer` registry in routingStore (master sink only, applied on register + every recompute, error-degrades to default like the primary); MixPlayer registers its private mixer, dispose unregisters. Regression tests (3) at the routingStore seam — red before the fix — with fakes at the true browser seams (localStorage, mediaDevices, AudioContext probe). Root cause per H1: the private mixer was never routed; landed as ADR 0021 with the deep fix (fold editor onto the shared context) noted as a future re-grill. Ear-verify: route master to speakers, open the editor, play — audio should follow the speakers; flip master device mid-session and the editor follows.
- Follow-up (probe round 2, instance-tagged): fix was right but its lifecycle was StrictMode-wrong. The log showed the PLAYING editor mixer (`e2ar`) revived after a spurious StrictMode dispose with `masterSinkId: null` (the dispose raced the registration's setSinkId — "AudioContext is going away" — and the error fallback wrote null), while a zombie second MixPlayer (`v1se`) stayed registered receiving every update. Fixes: (1) `Mixer.setMasterSinkId` stores first and applies only to a live context; revival reapplies — the sink now survives the Mixer's documented dispose-then-revive contract, and registration no longer force-creates contexts; (2) registration moved from MixPlayer's constructor/dispose to TransitionEditor's mount effect (StrictMode pairs effects correctly). ADR 0021 consequences updated. Probes to be abandoned after ear-verify.
