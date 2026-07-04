# Sync as a fourth mode

Status: ready-for-agent

## Parent

User-reported (2026-07-04): "I want sync to appear as a tab just like the 3 DJ modes, with a similarly styled header, rather than the current overlay with styling that doesn't match the rest of the site and feels sloppy."

## What to build

Sync becomes a fourth mode alongside library/performance/transition (grilled 2026-07-04):

- `MODES` gains `sync` (icon ⇄, label SYNC); the special right-aligned topbar Sync button is deleted; the topbar's right side stays empty for now
- SyncView renders inside the app shell under the persistent TopBar like every other mode; `View = AppMode | 'sync'` special-casing, `onOpenSync`, and `onClose` plumbing die
- SyncView's own header dies: no title (topbar-title shows SYNC), no Close button (mode buttons are the way out)
- The Tracks / Playlists / Acquisition sub-tabs stay, restyled as a slim secondary row in the topbar design language: square 1px-border bold buttons, `--blue` active fill, compact height — `--lavender` accent and monospace tab styling go
- Startup deep-link generalizes from the hardcoded `?view=transition` to any mode name (`?view=sync` included)
- Sub-tab selection stays local component state (re-entering Sync lands on Tracks)

## Acceptance criteria

- [ ] Sync is entered via a fourth topbar mode button; mode buttons stay visible inside Sync
- [ ] Decks keep playing across the switch (already provider-owned — no regression)
- [ ] No Close button / internal title; sub-tabs match the topbar button language, blue accent
- [ ] `?view=sync` (and any other mode) deep-links at startup
- [ ] Frontend build + vitest pass; visual check by the user

## Comments

**2026-07-04 — Done** (jj change `mnvvpvmw`, workspace perffix, on the main-line tip). Sync is the fourth topbar mode (⇄): `AppMode` gains `'sync'`, SyncView renders inside the app shell under the persistent TopBar, `View`/`onOpenSync`/`onClose` special-casing deleted (including the Close button chain down through PlaylistSync → PlaylistDetailView, and the orphaned `.topbar-sync`/`.detail-close-button` CSS). Sub-tabs restyled to the topbar language (square 1px `--overlay0` border, bold, `--blue` active fill; `--lavender` and monospace gone); container is `height: 100%` inside `.app-main` instead of its own `100vh`. Deep link generalized: `?view=<any mode>`, `?view=sync` included. Build + 166 vitest green; visual check by the user pending.
