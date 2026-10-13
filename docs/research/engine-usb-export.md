# Engine USB / device library export (research)

Issue #267 (2026-09-16, lane
`engine-usb-267-reverse-engineer-native-device-libraries`). Research
only — no exporter implemented. Revised same day after parent physical
validation (#267 comment 5704820446): all 526 USB audio references are
dead on disk; universal no-pairing and hardware-origin claims rescoped
to the evidence inspected. Sibling of
`docs/research/enginedj-write.md` (desktop m.db write recipes), which
this doc extends to inserted-drive libraries.

Inputs: read-only snapshots taken by the show-export lane
(`data/show-export/snapshots/manifest.json`, 2026-09-16):

- `engine/` — desktop library, `~/Music/Engine Library` (schema 3.0.1,
  uuid `15541569-e89c…`, 1033 tracks, 124 playlists)
- `engine-usb/` — `/Volumes/SANDISK USB/Engine Library` (schema 3.0.1,
  uuid `b9d51693-86da…`, 526 tracks, 13 playlists)

Probe copies + scripts: lane-local `data/engine-usb-research/`
(gitignored; `probe_lists.py`, `probe_blobs2.py`, `probe_final.py`,
normalized schema dumps). Codecs reused from
`scripts/spike_enginedj/blob_encode.py`.

## Verdict

**Direct Engine USB export from manadj is feasible and is the same
write problem as the desktop library, plus a directory layout.** A
device library is just `Engine Library/Database2/m.db` at the drive
root with the identical schema (3.0.1, byte-identical DDL modulo
whitespace), identical blob formats (all four codec round-trips pass on
device blobs), self-referential origin IDs, and drive-relative track
paths. No registry, manifest, or pairing artifact was found **between
these two snapshotted libraries**; whether Engine desktop's Sync
Manager exports create pairing state elsewhere is untested (no
desktop-export fixture — see unknowns/ladder).
Bonus: the `overviewWaveFormData` format — the one gap in
enginedj-write.md — is now closed via libdjinterop and verified against
all 52 analyzed device blobs.

**Caveat:** the available USB library was **not** produced by Engine
desktop's device sync (its uuid and history don't match the desktop
library). The inferred origin — from `pdbImportKey` stamping, the
rekordbox `/Contents` path layout, and the hm.db session timing — is
Engine OS hardware importing a rekordbox-exported drive in place; this
attribution is an inference from DB internals, not independently
confirmed. If correct it is a ground truth for *what hardware accepts
and creates*, but not for *what Engine desktop writes on export*. No
desktop-export fixture exists yet; that's rung 3 of the ladder.

## Facts (observed in snapshots)

### Layout and registry

- USB `Engine Library/` contains only `Database2/{m.db, hm.db, sm.db,
  stm.db}` (+ empty journals). No marker files, manifests, or device
  IDs. Desktop `Database2/` additionally has `itm.db, rbm.db, trm.db`,
  `images/`, streaming dirs.
- `sm.db`/`stm.db` on USB: empty schema clones of m.db (0 tracks).
  `hm.db`: m.db schema + `Historylist`/`HistorylistEntity` (play
  history; one session, 2026-08-02 16:43 EDT, 49 plays with per-track
  `startTime`).
- No cross-references **between the two compared uuids**: the desktop
  library uuid (`15541569…`) appears nowhere in any USB db (strings
  scan), and the USB tracks/playlists carry only the USB's own uuid
  (`b9d51693…`). This does not generalize: desktop itself holds 159
  foreign-db playlist references to a third uuid (`9ed382ac…`, below),
  so Engine libraries can and do couple across databases.
- In the evidence inspected (these two Database2 dirs + desktop hm.db),
  the desktop's only record of devices is harvested history: desktop
  `hm.db` Historylist rows carry `originDriveName` ("REROLL", "REROLL
  SD") + the device db uuid. Five distinct device uuids seen
  (2025-11 → 2026-06).
- Desktop playlists can reference device-resident tracks:
  `PlaylistEntity.databaseUuid` = foreign device uuid (159 entities,
  uuid `9ed382ac…`, trackIds that don't resolve locally). Multi-db
  playlists are a first-class schema feature.

### Schema and IDs

- `PRAGMA user_version` 4194305, `Information` schema 3.0.1 on both.
  Normalized DDL (tables/indexes/triggers/views) is identical; only
  whitespace differs. Same 16 triggers incl. `fix_origin` (stamps
  `originTrackId=id`, `originDatabaseUuid=(SELECT uuid FROM
  Information)` when NULL/0), `insert_performance_data`, `check_id`.
- All 526 USB tracks: `originTrackId = id`, `originDatabaseUuid` = the
  USB db's own uuid. Self-referential origin is proven acceptable to
  Engine OS (this library played a gig).
- Denon's third-party-tools guidance: never alter the schema of any db
  under `Database2`; bind external data via `{originTrackId,
  originDatabaseUuid}` and the `PlaylistPath` view; extension data goes
  in a separate ATTACHed db inside `Database2`. [3]

### Tracks (device rows, inferred hardware-created)

- Paths are POSIX, relative to the `Engine Library` dir:
  `../Contents/<Artist>/<Album>/<file>` — i.e. audio referenced at the
  **drive root** `/Contents/…` (rekordbox's export layout).
  `Track.path` has a UNIQUE constraint. **These references are now all
  dead on the physical drive** — see "Does the available USB have
  native tracks?".
- Every USB track: `pdbImportKey = 2246` =
  `Information.lastRekordBoxLibraryImportReadCounter` (2246). Desktop
  tracks all have `pdbImportKey = 0`. This is the basis (with the
  `/Contents` layout and hm.db timing) for inferring a rekordbox-PDB
  import created this library, and suggests `pdbImportKey` is a
  rekordbox-import generation stamp. Inference, not independently
  confirmed.
- NULL/field profile of device-accepted rows: `dateAdded`,
  `dateCreated` NULL on all 526; `isMetadataImported = 0` on all;
  `length` NULL on the 474 unanalyzed tracks; `bpm`, `key`, `year`,
  `fileBytes` populated on all; `albumArtId` non-NULL on all — 438
  point at the shared empty-art row (`id=1`, `hash=''`,
  `albumArt=NULL`). The desktop rendering gate's empty-art-row
  convention (enginedj-write.md exp D) holds on device libraries too.
- `isAnalyzed`: 474 false / 52 true. Hardware analyzes lazily (on
  load), like desktop.

### Playlists and ordering

- USB: 13 root playlists, all `isPersisted=1`,
  `isExplicitlyExported=1`, identical `lastEditTime` (2026-08-02
  20:41:07 UTC — import moment; first history play 20:43 UTC).
- Sibling order: `nextListId` singly-linked list per parent, `0`
  terminator; USB chain reconstructs cleanly 1→…→13. Track order:
  `PlaylistEntity.nextEntityId` linked list per `listId`, `0`
  terminator, head = the entity no other entity points to. All 13
  chains verified complete (single head, single tail, no cycles) —
  `probe_lists.py`. Matches manadj's existing writer
  (`enginedj/playlist.py`) and libdjinterop's model. [1]
- `PlaylistEntity.databaseUuid` = owning db's uuid for local tracks.
  `membershipReference` = 0 throughout USB (one stray 1 on desktop).

### Performance blobs

- **Formats are identical to desktop.** Spike codecs
  (`blob_encode.py`) round-trip byte-exact on every device blob:
  beatData 53/53, quickCues 526/526, trackData 53/53, loops 526/526
  (`probe_blobs2.py`). Device beatData tails are all `00`*9 (the
  "fresh grid" tail from enginedj-write.md).
- Partial blob sets are device-legit: the 474 unanalyzed
  rekordbox-imported tracks carry **quickCues + loops only** (no
  beatData/trackData/overview), and hm.db records 49 real plays from
  this library — cues without grids were playable in practice. The 52
  analyzed tracks have all five blobs.
- **`overviewWaveFormData` format (gap closed):** qCompress framing,
  then payload: `i64 BE count` ×2 (must match), `f64 BE
  samples_per_point`, `count × 3 bytes` (low/mid/high u8 per point),
  `3 bytes` max-point (low/mid/high maxima). Source: libdjinterop
  `overview_waveform_data_blob.{hpp,cpp}`. [1] Verified decode on all
  52 device blobs: count = 1024 always, `samples_per_point =
  track_length_samples / 1024` (matches beatData's length field),
  payload 3099 B = 24 + 3·1025 (`probe_final.py`).

### Upstream sources

1. **libdjinterop** (LGPL-3.0, tag 0.27.1) — the canonical open-source
   implementation. Supports schemas 1.6.0…3.0.2
   (`include/djinterop/engine/engine_schema.hpp` maps schema↔app: 3.0.1
   = Engine 4.3.x; latest 3.0.2 = 4.5/5.0). Can create a database from
   scratch (`engine::create_database`, default dir name `Engine
   Library`); Database2 era writes **m.db only** — no hm/sm/stm
   handling anywhere in the repo. Reference DDL captured from real
   installs up to desktop 5.0.0 in `testdata/ref/engine/` — a ready
   schema oracle for our fixtures.
   https://github.com/xsco/libdjinterop
2. **Mixxx** ships "Export Library to Engine DJ" built on libdjinterop
   0.27.1 (`src/library/export/engineprimeexportjob.cpp`): writes
   `<base>/Engine Library` + audio in `<base>/mixxx-export/`, defaults
   to latest schema, exports beatgrid/main cue/8 hot cues/8
   loops/overview waveform; deliberately skips loudness (mis-scaled
   waveforms can render blank on players). Working proof that
   third-party m.db-only libraries with audio in an arbitrary
   drive-root dir are accepted by Engine OS hardware.
3. **Denon official**: third-party db tools guidance
   (support.denondj.com article 69000834165); drives must be FAT32 or
   exFAT (article 69000844056); desktop→drive export is drag-and-drop /
   Sync Manager. Official docs do **not** specify on-drive layout or
   hardware recognition rules in text.
4. Mixxx wiki "Engine Library Format" covers the 1.x era only; the
   blob corrections in enginedj-write.md supersede it for 3.x.

## Experiments run (this lane, sandbox copies only)

| Probe | Result |
|---|---|
| Normalized DDL diff desktop vs USB | identical (whitespace only) |
| Blob codec round-trip on all USB PerformanceData | 4/4 formats byte-exact (53/526/53/526 blobs) |
| Overview waveform decode (libdjinterop layout) | 52/52; count=1024; spp=length/1024 |
| Playlist + entity linked-list integrity, both dbs | all chains single-head/tail, no cycles |
| Origin/uuid audit | USB fully self-referential; zero cross-db references **between the two compared uuids** (`15541569…` ↔ `b9d51693…`) — desktop separately holds 159 foreign refs to `9ed382ac…` |
| NULL-field audit of device-accepted Track rows | see Facts |
| uuid strings scan across all USB dbs | desktop uuid absent (that uuid only; not a general no-coupling proof) |
| Physical row-path validation (parent lane, read-only) | **all 526 USB audio references missing** — `data/show-export/device-audit.json` |

No writes to any snapshot, real library, or /Volumes. All probes on
lane-local copies.

## Hypotheses (unverified)

- **H1 — m.db alone suffices on a fresh drive**: hardware creates
  hm/sm/stm itself when missing. Evidence: libdjinterop/Mixxx never
  write them and Mixxx exports work on hardware; the SANDISK set was
  plausibly created all-at-once by the hardware import. Verify at
  ladder R4.
- **H2 — audio may live anywhere on the drive** reachable by a
  relative path from `Engine Library/` (`../Contents/…` and
  `../mixxx-export/…` both work). manadj should use its own dir, e.g.
  `/manadj/…` at drive root, or reuse `/Contents` when sharing a
  rekordbox drive (penbridge does exactly this dual-format trick).
- **H3 — a genuine Engine-desktop drive export stamps
  `originDatabaseUuid` = the desktop library uuid** (so Sync Manager
  can dedup/round-trip). Untestable from this USB (not a desktop
  export). Matters only for interop if the user later syncs a manadj-written
  drive with Engine desktop; self-referential origins are proven safe
  for hardware playback.
- **H4 — `isExplicitlyExported=1` + `isPersisted=1`** is the correct
  flag state for playlists written to a device (all 13 device
  playlists have it; desktop uses it to mark lists flagged for device
  sync — 14/124 there).
- **H5 — Engine desktop treats any mounted FAT32/exFAT volume
  (including a DMG) as a device**, enabling agent-side R2 verification
  without hardware.
- **H6 — desktop insert recipe transfers unchanged**: the
  enginedj-write.md track recipe + full 5-blob set + `isAnalyzed=1`
  renders with minimap on hardware. Overview format known, so full
  sets are now writable.

## Unknowns

- Anything about genuine Engine-desktop→drive export internals (origin
  stamping H3, whether it copies `AlbumArt` blobs, chosen audio dir,
  whether it prunes `isExplicitlyExported=0` lists). Needs a
  desktop-export fixture on a decoy drive.
- Whether hardware tolerates missing hm/sm/stm (H1). (Missing audio is
  no longer hypothetical: all 526 USB row references are dead — how
  Engine OS renders them next boot is untested.)
- Whether Engine desktop Sync Manager exports create any pairing/
  registry state elsewhere (outside the two Database2 dirs inspected
  here).
- Murtaza's player model + Engine OS version (history drive names
  REROLL/REROLL SD only; schema 3.0.1 ⇒ OS 4.3.x era at import time).
  Firmware upgrades may bump target schema to 3.0.2.
- `membershipReference` semantics (0 everywhere that matters;
  libdjinterop also marks it unknown).

## Does the available USB have native tracks?

**In the database: yes — 526 file-based (non-streaming) track rows**
(`streamingSource`/`uri` NULL on all; audio referenced at
`/Contents/<Artist>/<Album>/…`), 13 playlists, real play history. It is
a standalone, rekordbox-derived Engine library (inferred
hardware-created) — not an Engine-desktop export.

**On disk: no — all 526 referenced audio paths are missing.**
Parent-lane read-only physical validation
(`data/show-export/device-audit.json` in the show-export lane:
`usb_engine_tracks: 526, usb_engine_missing_audio: 526`). Cause: an
earlier authorized rekordbox USB rewrite replaced the old
`/Contents/<Artist>/<Album>/…` files with `/Contents/<manadj-id>/<file>`
paths; the Engine DB was left stale intentionally for this research.
Note a directory listing could never have verified this — row-path
validation was required. Consequence for export: the USB's Engine
library is entirely stale; any manadj export to this drive must rebuild
m.db track paths against the drive's actual audio layout (or ship its
own audio), and the R4 ladder rung doubles as the test of how Engine OS
treats a library whose references are dead.

## Fixture-based tracer plan

Goal: one tiny end-to-end tracer proving manadj can author a
device library Engine accepts, before any production exporter. All
destructive steps target decoy assets only.

1. **Fixture**: `data/engine-usb-research/fixture-usb/` containing
   `Engine Library/Database2/m.db` (authored by us) + `manadj/` with
   2–3 generated tone files (ffmpeg sine sweeps, ~5 s). No real music.
2. **Author m.db**: create db with DDL taken verbatim from the USB
   snapshot dump (`schema-usb.sql`, = libdjinterop ref 3.0.1); insert
   Information row (fresh uuid4, 3.0.1, user_version 4194305); insert
   tracks per enginedj-write.md recipe with `path='../manadj/…'`; one
   playlist, entity linked list; one track with full 5-blob set
   (`isAnalyzed=1`, overview encoded per the now-known format), one
   metadata-only (`isAnalyzed=0`), one cues-only (quickCues+loops, no
   grid — mimics the 474 device-accepted rows).
3. **Static validation (agent)**: sqlite `PRAGMA integrity_check`;
   normalized DDL diff vs snapshot; blob round-trips; linked-list
   invariants; fix_origin stamped; albumArtId resolves; UNIQUE(path)
   holds. Reuse this lane's probe scripts.
4. **Desktop-as-oracle (agent-adjacent, decoy)**: `hdiutil create -fs
   exFAT` a small DMG, copy the fixture in, mount, open Engine desktop
   → does the volume appear as a device with our playlist/tracks
   browsable and playable, waveform/minimap correct on the analyzed
   track? (Tests H5 + H6. Engine may write to the fixture db — fine,
   decoy.) Also the reverse fixture: let Engine desktop export a real
   playlist to a second empty DMG → diff what desktop writes vs what
   we write (settles H3 + desktop layout unknowns without any real
   USB).
5. **Compare + iterate** until our fixture is
   indistinguishable-or-accepted; record deltas in this doc.

## Device verification ladder

Rungs in order; stop at the first failure and record it here.

- **R0 (agent, done)**: snapshot forensics — this doc.
- **R1 (agent)**: fixture static validation (tracer steps 1–3).
- **R2 (agent + Engine desktop, decoy DMGs)**: mounted-DMG device
  recognition + desktop-export diff (tracer step 4). No real library
  writes; Engine desktop open with its real library is read-only from
  our side.
- **R3 (human, decoy USB)**: write the fixture to a spare/decoy
  FAT32-or-exFAT USB stick (never the show USB), verify Engine desktop
  sees it as a device.
- **R4 (human, hardware, decoy USB)**: insert into the player. Verify:
  library recognized; playlist present and in linked-list order;
  metadata-only track analyzes and plays; full-blob track shows our
  grid/cues/minimap without re-analysis; cues-only track behaves like
  the 474 rekordbox-imported rows; edit a cue on-device, eject, re-read
  db (H1: were hm/sm/stm created? did our track survive?).
- **R5 (human approval + parent lane)**: real show export — production
  exporter writing the actual show USB. Out of scope for #267; owned
  by show prep, gated on R4.

## Sources

- [1] libdjinterop: engine_schema.hpp, engine.hpp,
  engine_library_dir_utils.cpp, v2/playlist_entity_table.hpp,
  v2/track_table.hpp, v2/overview_waveform_data_blob.{hpp,cpp},
  testdata/ref/engine/ — https://github.com/xsco/libdjinterop
  (LGPL-3.0, tag 0.27.1)
- [2] Mixxx: src/library/export/engineprimeexportjob.cpp,
  dlglibraryexport.cpp — https://github.com/mixxxdj/mixxx
- [3] Denon, "Engine DJ v3.0 | Support for Third-Party Database Tools"
  — https://support.denondj.com/en/support/solutions/articles/69000834165
- [4] Denon, "Engine DJ Adding Music and Exporting to a Drive"
  (FAT32/exFAT) — https://support.denondj.com/en/support/solutions/articles/69000844056
- [5] Denon, rekordbox import / use rekordbox drives on Engine hardware
  — https://support.enginedj.com/en/support/solutions/articles/69000798942
- [6] Mixxx wiki, "Engine Library Format" (1.x era) —
  https://github.com/mixxxdj/mixxx/wiki/Engine-Library-Format
- [7] penbridge (Engine Library onto a rekordbox drive) —
  https://github.com/athousanddetails/penbridge
- [8] This repo: docs/research/enginedj-write.md;
  scripts/spike_enginedj/blob_encode.py; lane probes in
  data/engine-usb-research/ (gitignored).
