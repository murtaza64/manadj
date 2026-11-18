# Telemetry design (unfiled draft)

Research note from the 2026-11-18 steer. Murtaza asked to "track some secure and private telemetry work too that would help us improve the project." No such ticket exists in the tracker today (searched 2026-11-18; nearest is #439 crash diagnostics, owned by another lane), so this records the proposed work as a backlog draft. This is design preparation, not approval to collect or transmit anything.

## Proposed ticket draft (house style, for review before filing)

- **Title**: telemetry: privacy-first usage insight for product decisions
- **Problem**: roadmap calls are made on vibes. Which features earn their place (Follow picks actually taken, exports actually run, deck time, tutorial completion) is unknown, and adding analytics the usual way would betray the project's personal, local-first character.
- **Design constraints**: local-first aggregate counters, not event streams; opt-in with a visible toggle; no audio, library contents, track titles or friend data ever collected; nothing transmitted without an explicit per-purpose consent; everything inspectable in-app before it leaves; deletion wipes local history. Any future sharing is aggregate-only and minimal (think "7 sessions this week, Follow acceptance rate 0.4"), and self-hosted or no backend at all in v0.
- **Acceptance**: a written threat model and data inventory (what is collected, where it lives, what is never collected); a local stats surface showing the user their own aggregates; the toggle defaults off; no network code in v0.
- **Direct Murtaza 2026-11-18.** Port: now, desktop first; Android counterpart states its own decision.

## Status

Unfiled, design-only. No collection, transmission, backend, or account work is started or authorized by this note. Filing the ticket is the owner's call.

## Sources

- Murtaza, iMessage 2026-11-18 (steer: track secure/private telemetry work as design prep).
- Tracker search 2026-11-18: no matching usage-telemetry issue; #439 (crash diagnostics) is separately owned.
