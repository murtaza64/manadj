# 02 — Follow rides playback

Status: done — pending user eye-verify

## Parent

.scratch/follow-mode/PRD.md

## What to build

The flag reducer — the follow model's state-machine face — wired to the Decks' snapshot subscriptions, so Follow anticipates the DJ without manual intervention:

- **Spread on play**: a Deck starting playback while any Deck follows begins following.
- **Drop on pause**: a pausing Deck stops following — unless it was the only Deck playing (the list survives mid-set silence).
- **Sticky expiry**: a paused Deck may only follow while nothing plays; any Deck starting playback revokes follow from paused followers.
- **Never self-enable**: when no Deck follows, playback never turns Follow on.

Reducer shape: `(flags, event) → flags`, events = manual toggle / deck-play / deck-pause with per-Deck playing+loaded context, mirroring the transport reducer pattern.

Also: persist the per-Deck flags as session state (localStorage, alongside the loaded-decks key) and restore on boot — invariant-consistent since nothing plays after boot. Opportunistic rider, not required: a tiny typed localStorage preference helper extracted from the hand-rolled load/validate/save code this touches.

## Acceptance criteria

- [ ] With Follow on A (playing), starting B spreads Follow to B; pausing A then drops A (B still playing)
- [ ] Pausing the sole playing followed Deck keeps it following; the list does not explode
- [ ] Starting any Deck revokes Follow from a paused following Deck
- [ ] With Follow off on both Decks, play/pause never enables it
- [ ] Flags survive a reload: Decks restore paused with Follow intact
- [ ] Framework-free reducer tests cover the full state machine, including the scenarios above and toggle-on-empty-deck rejection
- [ ] Gate green

## Blocked by

- 01-follow-core-manual-toggles

## Comments

- Done (nmsouxlr, lane followmode): `reduceFollow` state machine in the follow model (toggle/play/pause events carrying the post-event deck-running map) — spread-on-play, drop-on-pause-unless-sole, sticky expiry, never-self-enable, enable-requires-loaded; 10 reducer tests incl. a pinned interpretation: a manual enable is never blocked by playback state (rules re-assert on the next transport event). `followPlaybackBridge` subscribes to both engines and edge-detects the snapshot `playing` flag (previews never touch it), mounted from DeckProvider. Store reworked: all writes dispatch through the reducer; flags persist to `manadj-follow-flags` and restore on boot; persistence face tested against a faked localStorage (4 tests). Spec deviation, deliberate: play/pause events omit the loaded map (a running Deck is necessarily loaded); rider (shared localStorage helper) skipped again — third hand-rolled instance now exists, worth an issue if a fourth appears. Gate: 530 pytest / 515 vitest / build / one head.
