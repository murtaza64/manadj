# Energy export to Engine — star ratings ride the Engine tag export

Status: ready-for-agent

## What to build

Export direction: the Library's Energy reaches Engine DJ as a star rating, riding the whole-library "Export tags → Engine" operation exactly as it rides Rekordbox's (where the tag export writes energy colors + an Energy MyTag). For every matched Engine track, the export sets Engine's rating to the Library energy via the encoding from issue 01. An empty Library energy never overwrites an Engine rating — the field is skipped, per the Export rule.

Writing the rating column on existing matched tracks is a simple-column update, consistent with ADR 0006 (only Engine track *insertion* is forbidden; tag/playlist export already writes Engine's DB directly).

UI: the "tags diverged" group's "Export tags → Engine" button must also appear when the group holds only energy divergences against Engine (Rekordbox got the same fix), and its side-effects text mentions star ratings.

## Acceptance criteria

- [ ] Engine tag export sets Track.rating = energy × 20 for matched tracks with Library energy set
- [ ] Empty Library energy never overwrites: Engine rating untouched for those tracks
- [ ] Include-energy behavior is optional in the export call, mirroring the Rekordbox writer's shape
- [ ] After an export, a previously energy-diverged Engine row compares in sync
- [ ] "Export tags → Engine" group button appears for energy-only divergences; side-effect text mentions ratings
- [ ] Tests cover rating writes, the never-overwrite-with-empty rule, and idempotent re-export
- [ ] Typecheck and full test suite pass

## Blocked by

- 01-engine-energy-read
