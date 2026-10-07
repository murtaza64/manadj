# ADR 0041: Performance sync shares tempo, not a master

Status: accepted (#19; August 24 grill, completed September 12, 2026).

## Context

One-shot MATCH cannot keep Decks together during tempo rides. Reference-deck
chasing requires ownership and fallback rules and cannot handle every Deck
remaining synced without an additional leader concept.

## Decision

- Synced Decks share one Group Tempo. Any member's pitch input retargets it.
- Capture tempo at first engagement; do not continuously chase unsynced Decks.
- Keep per-member half/double relationships and per-Deck Nudge.
- Quantize governs a one-shot phase snap on MATCH and SYNC engagement, not ongoing phase lock.
- BEAT SYNC toggles membership; Shift+BEAT SYNC preserves one-shot MATCH.

## Consequences

There is no Tempo Master or master-handoff lifecycle. A lone synced Deck does
not follow subsequent rides on an unsynced Deck; sync both to ride together.
Phase remains under performer control after engagement. Explicit Tempo Master
remains a fallback if this workflow proves awkward, not a parallel mode.

Behavior and verification: [Performance sync](../prds/performance-sync.md).
