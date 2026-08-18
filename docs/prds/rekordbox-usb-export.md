# PRD: rekordbox-compatible USB export/sync

Status: ready-for-agent
Research: `docs/research/rekordbox-performance-write.md`,
`docs/research/rekordbox-usb-library-formats.md`

## Problem Statement

manadj is the source of truth (ADR 0001) for my library: tracks, playlists,
hot cues, beatgrids, keys, energy. To play on club-standard Pioneer gear
(CDJ-2000NXS2, CDJ-3000, XDJ line) I currently have to route everything
through desktop rekordbox and its own USB export. I want to plug a USB stick
into manadj, sync selected playlists to it, and have it play on CDJs directly
— cues, grids, waveforms, and playlists intact — with no rekordbox in the
loop.

## Solution

A device export/sync subsystem that writes the classic rekordbox Device
Library format to a USB stick: `PIONEER/rekordbox/export.pdb` (DeviceSQL),
per-track `PIONEER/USBANLZ/**/ANLZnnnn.{DAT,EXT,2EX}` analysis files, and
audio under `/Contents/`. It also reads that format back — both to verify its
own output and to parse sticks written by rekordbox itself. Sync is
incremental for audio (the big bytes) and rebuild-from-scratch for the
database and analysis files (small). Runs as a background task with progress,
driven from a playlist-selection UI.

Fidelity standard ("byte-equivalent"):

1. **Round-trip**: our reader parses any rekordbox-written export; our writer
   re-serializes what it parsed byte-identically.
2. **Structural equivalence**: from-scratch exports parse clean under an
   independent read oracle (Kaitai-generated parser from crate-digger's
   `.ksy` specs), load in desktop rekordbox's Devices pane, and play on
   hardware.

Exact byte-identity with rekordbox's own from-scratch output is a non-goal:
edit-sequence counters and the un-reverse-engineered index/tree pages make it
impossible, and players don't require it (empty index pages are the proven
approach — players fall back to linear scan).

### Validation ladder (hardware reality)

No regular standalone-player access; desktop rekordbox (with DDJ-GRV6
controller) is available daily; CDJ-3000s are available in short periodic
windows. So the gates are, in order of availability:

1. Byte round-trip tests (every commit).
2. Independent Kaitai read-oracle parse of our output (every commit).
3. Desktop rekordbox reads the exported stick in its Devices pane and shows
   tracks/playlists/cues/grids/waveforms (at-home oracle, every milestone).
4. CDJ-3000 session: batched checklist of pending hardware questions
   (playback, grid/cue positions per codec, waveform rendering, browse
   performance). Findings recorded in a research doc after each session.

## User Stories

1. As a DJ, I want to sync selected manadj playlists to a USB stick, so that
   I can play them on club CDJs without owning rekordbox.
2. As a DJ, I want my 8 hot cues (with colors and labels) present on the CDJ,
   so that my performance material works as it does in manadj.
3. As a DJ, I want hot cues mirrored as memory cues, so that older players
   and memory-cue workflows still see my cue points.
4. As a DJ, I want my beatgrids (including variable grids) exact on the CDJ,
   so that quantize, loops, and sync behave correctly.
5. As a DJ, I want cue/grid positions corrected per audio container, so that
   points land on the same audio sample the CDJ decodes (decode-frame
   offsets).
6. As a DJ, I want the main cue point set on the CDJ, so that loading a track
   cues where I expect.
7. As a DJ, I want track title, artist, key, BPM, duration, and color visible
   in the CDJ browser, so that I can pick tracks on the player.
8. As a DJ, I want musical key shown in rekordbox's notation, so that key
   mixing works on the player display.
9. As a DJ, I want energy represented as track color, so that my energy
   ladder survives on the device.
10. As a DJ, I want waveform previews and scrolling waveforms (monochrome and
    NXS2 color) on the player, so that I can read track structure.
11. As a DJ, I want playlists to preserve manadj play order, so that prepared
    sets are usable.
12. As a DJ, I want the stick to work across player generations (nexus, NXS2,
    CDJ-3000), so that I don't need to know the booth hardware in advance.
13. As a DJ, I want re-syncing to only copy new/changed audio, so that
    updating a stick takes seconds, not an hour.
14. As a DJ, I want tracks removed from selected playlists pruned from the
    stick (with confirmation), so that the stick doesn't fill with orphans.
15. As a DJ, I want stable track IDs across re-syncs, so that CDJ history and
    tag lists don't dangle between gigs.
16. As a DJ, I want a preflight check (filesystem, free space, mount state),
    so that I find out about a bad stick at home, not in the booth.
17. As a user, I want export to run as a background task with progress and
    failure states, so that big syncs are observable and resumable.
18. As a user, I want to verify a stick after export (read-back + report), so
    that I trust it before a gig.
19. As a user, I want manadj to parse any rekordbox-written USB, so that I
    can inspect what rekordbox exports (and diff against manadj's output).
20. As a developer, I want a from-scratch minimal export that plays one track
    on hardware (tracer bullet), so that format risk is retired early.
21. As a developer, I want golden-file round-trip tests, so that encoding
    subtleties (DeviceSQL strings, row bitmasks, padding, alignment) are
    locked down before hardware time.
22. As a developer, I want the CDJ-crash pitfalls encoded as tests (≥221-byte
    track rows, UTF-16LE alignment, rating as raw byte), so that regressions
    can't reach a booth.

## Implementation Decisions

- **Target format**: classic Device Library (`export.pdb` + ANLZ). It is the
  only format CDJ-3000 and NXS2-era players read (OneLibrary/Device Library
  Plus support on CDJ-3000 was added in fw 3.30 and withdrawn; see research
  doc). OneLibrary (SQLite) is out of scope but noted as a cheap future
  addition for OPUS/OMNIS/XDJ-AZ venues.
- **Compatibility superset**: emit `.DAT` (PPTH, PVBR, PQTZ, PWAV, PWV2,
  PCOB) + `.EXT` (PCOB, PCO2, PWV3, PWV4, PWV5) per track. ANLZ tags are
  additive; older players ignore unknown tags. `.2EX`/PSSI (CDJ-3000 3-band
  waveforms, phrases) and `exportExt.pdb` (My Tags) are later polish —
  playback does not depend on them.
- **Language**: pure Python, new `rekordbox/device/` package. Rationale: ANLZ
  authoring is already Python here (pyrekordbox tag builders + the existing
  PQTZ writer); rekordcrate (Rust) has no ANLZ writer; format and pitfalls
  are documented (crate-digger `.ksy`, rekordcrate writer source, pino as
  working exemplar). Escape hatch if the pdb writer stalls: shell out to a
  rekordcrate-based CLI.
- **Independent read oracle**: Kaitai-generated Python parser from
  crate-digger's `rekordbox_pdb.ksy` / `rekordbox_anlz.ksy`, sharing no code
  with the writer. Used in tests and in the post-export verify step.
- **pdb writer**: little-endian paged heap per the Deep Symmetry analysis.
  Tables: tracks, artists, albums, genres, keys, labels, colors,
  playlist_tree, playlist_entries, artwork, columns, history (empty where
  unused but present). Each table's first page is an empty index page.
  Known hardware constraints honored: track rows padded to ≥221 bytes (via
  comment string), UTF-16LE strings aligned, row padding write-through-safe,
  rating as raw byte 0–5.
- **Entity synthesis** (manadj has no artist/album/genre/artwork/rating
  entities): artist rows deduped from Track.artist; album/genre/artwork
  empty; color from energy via the existing energy→color mapping; key via
  the existing 24-key authority; BPM from the grid projection (centi-BPM).
- **ANLZ authoring**: reuse the existing PQTZ writer and pyrekordbox tag
  builders (PPTH, PVBR, PCOB, PCO2); hot cue kinds/colors via the existing
  cue mapping; positions corrected via the existing per-container
  decode-offset classifier (its validity on CDJ decode frames is an explicit
  hardware-session question).
- **Waveforms**: generated in rekordbox's formats (PWAV/PWV2/PWV3 monochrome,
  PWV4/PWV5 color) from the existing ffmpeg PCM streaming pipeline. manadj's
  internal waveform blob is not RB-shaped; a spike decides whether its 8-band
  RMS data can be transformed or waveforms are regenerated from audio.
- **Sync model**: manadj is source of truth; sync direction is one-way to
  device. Every sync rebuilds `export.pdb` and all ANLZ files from scratch
  (small, avoids in-place-edit complexity — rekordcrate's writer made the
  same call); audio under `/Contents/` is diffed by file hash for
  incremental copy and optional prune. A per-device, per-track ID mapping is
  persisted in the manadj DB so track IDs are stable across syncs.
- **Scope of sync**: playlist-selection export (rekordbox-style), not
  full-library mirror. A device holds the union of its selected playlists.
- **Device identity**: a manadj marker file on the stick carries a device
  UUID; the DB keeps per-device state (selected playlists, ID map, last
  sync).
- **Seams** (fewest, highest): (1) the device exporter behind dependency
  injection at the router, mirroring the existing sync-export router pattern
  — fakeable in API tests; (2) the writer itself takes a destination
  directory, so tests target `tmp_path`, never a real mount. Export runs as
  a task-worker job (existing in-process task system) with progress; the
  planner (what to copy/write/prune) is a pure function over DB state +
  device manifest, tested without any filesystem.
- **Preflight**: destination must be FAT32 (broadest player support; exFAT
  acceptable only for CDJ-3000-only sticks — future toggle), mounted,
  writable, with sufficient free space; refuse otherwise.
- **Settings files**: emit rekordbox-default `MYSETTING.DAT`, `MYSETTING2.DAT`,
  `DJMMYSETTING.DAT`, `DEVSETTING.DAT` (formats documented in rekordcrate) —
  cheap, matches rekordbox's layout verbatim.
- **UI**: device page — stick detection, playlist selection, sync button,
  task progress, verify report. Modeled after the existing sync views.

## Testing Decisions

- Test external behavior at the two seams: planner outputs (pure), and
  written-tree contents parsed back via the independent Kaitai oracle — not
  writer internals.
- **Round-trip property**: parse a rekordbox-written export → re-serialize →
  byte-identical. Golden rekordbox exports are personal data and stay out of
  the repo (ADR 0004); round-trip tests against them are env-gated
  (`MANADJ_RB_EXPORT_CORPUS`), skipped otherwise.
- Committed fixtures are synthesized: minimal hand-built pdb pages/ANLZ
  sections built by our own writer, plus the existing silent audio fixtures
  for end-to-end export tests into `tmp_path`.
- Hardware-pitfall regression tests: min track-row size, UTF-16LE alignment,
  string encodings (short-ASCII vs long vs UTF-16LE), row presence bitmasks,
  page free/used bookkeeping.
- Decode-offset correctness carries over from the existing offset tests;
  device-side validity is a hardware-session checklist item, not a unit test.
- Prior art: the existing rekordbox export test files (grid/hotcue/offset/
  auto-export) and the router DI fakes in the sync-export tests.
- API/task tests fake the exporter at the router seam; task lifecycle via the
  existing task-system test patterns.

## Out of Scope

- OneLibrary / Device Library Plus (`exportLibrary.db`) writing.
- Importing foreign rekordbox USBs into manadj (cues/grids/playlists →
  manadj entities). The read layer lands; the import mapping is a separate
  future PRD. Read-back is verification-only here.
- Loops and memory cues as first-class manadj entities (no such entities;
  memory cues exist only as hot-cue mirrors).
- Artwork export (no artwork entity; would need tag extraction — future).
- `exportExt.pdb` My Tags from manadj Tags (noted as follow-up).
- PSSI phrase analysis (manadj has structure analysis, but PSSI is
  lighting-oriented and XOR-masked; not needed for playback).
- Two-way sync / conflict resolution (manadj is source of truth).
- rekordbox XML export.
- Link Export (pro DJ link over network).

## Further Notes

- Primary format references: Deep Symmetry export structure analysis
  (djl-analysis.deepsymmetry.org), crate-digger `.ksy` specs, rekordcrate
  `pdb` writer + PR #259 (`DeviceExportWriter`), pino (working open-source
  USB export app, hardware-verified), pyrekordbox ANLZ docs.
- Known open risks: DeviceSQL index/tree pages are un-reverse-engineered
  (mitigated: empty index pages, proven on hardware); no per-model
  conformance spec exists (mitigated: rekordbox-as-oracle + CDJ-3000
  sessions); decode offsets unverified on CDJ decoders (hardware checklist).
- rekordbox 7.2.11+ writes both classic and OneLibrary when exporting; we
  only need to *read* the classic half of such sticks.
- The CDJ-3000 checklist should be maintained as a living section in the
  hardware-session research doc so short access windows are spent on
  queued questions, not improvisation.
