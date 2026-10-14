# 0045 — Device sync: phone edits flow back, newest edit wins, every change is logged

Status: accepted (human decision 2026-10-14, #375). Builds on #372 (read-only pull), #373 (LAN listener), #374 (device tokens).

## Decision

- **Device sync** (a distinct term — CONTEXT.md "Sync" means external libraries) is two-way for track-level edits made on a Paired device: hot cues, main cue, Tag assignment, title, artist, energy, key; later the saved Beatgrid (whole grid, clock = Beatgrid `updated_at`) and Metric-ladder Reset marks (clock = ladder `updated_at`) for the phone's track edit view. The rest stays pull-only: audio, analysis, grids, BPM, Transitions, Sets and Playlists (#152 posture).
- **The phone journals edits.** Each edit records the field, its old value (what the phone saw) and its new value, the edit wall-clock time and a uuid. The phone applies edits locally at once, as an overlay on the cached snapshot. A sync pushes the journal first and pulls second.
- **Conflict rule: newest edit wins, per (track, field).** If the desktop's current value still equals the edit's old value, the edit applies. Otherwise the desktop changed the field too, and the edit time is compared with the desktop's change time: the HotCue row's `updated_at` for a slot, the Track's `updated_at` for scalar fields and tags. The newer edit wins and the loser is logged as `superseded`. Track-level `updated_at` is coarser than a per-field clock. That is acceptable for one user with two devices, and a per-field clock can come later without changing the protocol.
- **Durable change log** (`device_sync_changes`): one row per synced change, in both directions. It records batch, device, direction, track, field, old → new, edit time, sync time and outcome. The phone→desktop rows are written when the desktop applies pushed edits. The desktop→phone rows are reported by the phone after a pull: it diffs its previous snapshot against the new one for the synced fields. Only the phone knows what it had.
- **Synced performance settings** (Waveform style slots, filter tuning; the snapshot's `settings`) travel the same path as field `setting:<key>` with no track. The value is the whole persisted JSON object; its clock is the settings row's `updated_at` (a shipped default has none, so a phone edit always applies over it).
- **Revert:** the desktop lists the log and can revert one entry or a whole batch. Reverting writes the entry's old value back on the desktop and logs that as a new desktop-side change, so the next pull carries it to the phone. Nothing is deleted from the log.

## Consequences

- No CRDT and no field-version table yet. The rejection reasoning is in docs/research/mobile-sync-protocol.md.
- Desktop edit paths need no hooks. Conflict detection reads existing `updated_at` columns.
- Phone clocks can be wrong. The desktop clamps edit times to its own receive time, so an edit can't win from the future.
- Edits to a Track the desktop archived or deleted are logged as `rejected`.
