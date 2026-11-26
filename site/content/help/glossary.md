---
slug: glossary
title: Shared vocabulary
summary: App terms from the repository, with musical timing and workshop language kept distinct.
order: 14
related: [analysis, perform, capture, editor, sets]
---

## Two kinds of language

App terms describe what manaDJ stores and does. Musical language describes what you hear and intend. They overlap, but they are not interchangeable.

The app definitions below come directly from the repository's shared glossary. The timing notes distinguish the app model from the workshop shorthand used in [the November workshop report](../../media/workshops/2026-11-26/index.html). They do not add controls or change playback behavior.

## Timing and musical intent

### Beat 0 {#term-beat-zero}

A position at the start of a Track, not an instruction about when to start it in a mix. Starting an incoming Track earlier can expose more of its opening while keeping a later drop aligned. Changing only the starting position can shift that drop instead.

### Beat groups and hyperbar {#term-hyperbar}

Name the size when timing matters: **16-beat group**, **32-beat group**, **64-beat group**. In this workshop vocabulary, a **hyperbar** is a power-of-two grouping larger than 4 beats: 8, 16, 32, 64, and so on. It is not one fixed duration.

In 4/4, 16 beats are 4 bars, 32 beats are 8 bars, and 64 beats are 16 bars. Say both the number and the unit instead of assuming that "phrase" means the same length to everyone.

### Section: app model versus workshop shorthand {#term-section}

In the app, a **Section** is an Analysis-produced labeled span of a Track, such as intro, buildup, drop, breakdown or outro. It is not defined as a fixed number of beats. **Structure** is the Track's full partition into those Sections.

In the workshop, "section" was shorthand for a **64-beat group**, and "half-section" for **32 beats**. Use those explicit beat counts when discussing alignment; do not read them as the app's Section definition.

### Metric ladder {#term-metric-ladder}

The grouping of bars into higher tiers, typically 2-, 4-, 8- and 16-bar groups. The Beatgrid remains the authority on beats and bars. A Reset mark recounts the higher tiers from a downbeat; the earliest mark is the Ladder anchor. These groupings are distinct from analysis-labeled Sections.

### Pickup: two different meanings {#term-musical-pickup}

In music, a pickup or anacrusis leads into a main beat or phrase. In manaDJ, **Pickup** is the Conductor action that resumes a Set from the current Deck state when that state maps cleanly onto its plan. The app term does not mean "start the incoming Track earlier."

### Double drop {#term-double-drop}

Two Tracks sounding together at a drop. This need not mean replaying the first Track's drop onset: a later incoming drop can land while the outgoing Track continues. Intentional Jumps can be part of the blend.

### Clean, tease and decisive {#term-clean}

**Clean** is a listening judgment, not a synonym for seek-free, longest or least edited. A clear incoming downbeat and intentional alignment can help, but a deliberate Jump can be the point.

A **tease** briefly introduces an incoming element, then retreats before its fuller entry. **Decisive** describes the timing of a control move, such as a quick EQ handoff rather than a long drift. Neither is a rule for every transition. Listen in context.

## App terms

These definitions are generated from `site/content/glossary.yml`, rather than maintained as a second copy. The repository's `CONTEXT.md` holds the canonical model meanings.

<!-- APP_TERMS -->
