# Selection-scoped presence Export/Import + per-row default actions

Status: needs-triage

## Problem

The unified view's presence operations (Export to Rekordbox, RBXML generation, Import from Rekordbox) act on ALL missing tracks — the underlying executor operations have no track-id filter. The view therefore hides checkboxes on those sections and labels buttons "all…" (PRD Stories 8, 13, 14 partially deferred).

## Idea

Add track-id scoping to the tracks executor operations (filter the find_missing results by selected ids before acting). Unlocks: checkboxes + "Export N selected" on all sections, and per-row one-click default actions (Story 8).
