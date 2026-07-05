# Trim lanes in the Transition editor

Status: needs-triage

Follow-up from the editor-shared-decks grill (2026-07-05, Q7): when editor
auditions moved onto the shared Mixer, the user's live **trim** was
deliberately passed through (gain staging follows the tracks), while the
crossfader is pinned neutral by the automation overlay and fader/EQ/filter
are lane-owned.

That leaves trim as session state a Transition cannot express: a pair that
only balances with A trimmed down loses that balance on another day (or for
a future Mix renderer).

Proposal: support trim state in the Transition editor — likely as a per-deck
trim automation lane (or a static per-Transition trim value, if a full lane
is overkill), persisted with the Transition and driven through the same
automation overlay as the other lanes.

Out of scope for the editor-shared-decks rearchitecture; file under its own
grill/triage when picked up.
