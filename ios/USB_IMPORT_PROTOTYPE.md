# Rekordbox USB import prototype

Branch preparation only. No physical USB, signed iPhone install or release acceptance.

## Implemented slice

Settings opens a separate USB import sheet. The user chooses the connected drive's top folder using Apple's folder picker. The app reads classic `PIONEER/rekordbox/export.pdb` through a scoped directory grant. It shows track availability and playlist metadata before copying anything. The user explicitly chooses tracks and confirms an app-owned copy. Imported audio appears in this separate sheet with Load A/B actions and survives app restart. It is not merged into or uploaded to the paired desktop library. Source files are never opened for writing.

The pure Swift reader handles present track, artist, playlist-tree and ordered playlist-entry rows, including short ASCII, long ASCII and UTF-16 strings. Deleted rows are skipped. It bounds file size, header/table counts, page chains, row offsets and strings. A synthetic 40-track, multi-page independent-desktop-writer fixture exercises the parser. No user collection was used.

Preview excludes missing/unreadable files, symlinks, path traversal, non-regular files, case-colliding paths, size mismatches and unsupported extension types. Extension acceptance is not a decode-quality claim. Copy rechecks exact database bytes and preview-time file identity, size and modification/change timestamps. It uses component-by-component `openat` with no symlink following, bounded chunks and before/after handle state checks. New files stage in the app's import directory and become visible by one directory rename; failed copies remove the staging directory. Source USB roots cannot be copy destinations.

## Unfinished and unverified

- OneLibrary / `exportLibrary.db`, `exportExt.pdb`, ANLZ cue/grid/waveform import are not implemented.
- This is a strict classic subset, not compatibility with every real Rekordbox export. Unusual/malformed strings can refuse the scan.
- No USB writes, rebuilding, formatting, automatic mount discovery or raw block-device access.
- No in-place USB playback. Import copies audio first and keeps a separate manifest; no deduplication into an existing user library.
- Imported files have no saved grid/cue/waveform. Stored BPM/title/artist are preview metadata, not a claim that beatgrid or cue state transfers into playback.
- Playlist metadata/order is retained in the manifest, but imported-playlist navigation is not yet exposed in this sheet.
- No progress/resume/background import, cache management or deletion UI.
- File-provider behavior, drive disconnects, adapter power, Files folder selection, storage exhaustion and audible output require real iPhone testing. Scoped directory access is not evidence of physical USB support.
- No iOS merge, signing, release or real-library write is authorized by this prototype.

## Platform evidence

Apple documents external drives in Files, supported formats and power/adapter constraints:
https://support.apple.com/guide/iphone/external-storage-devices-iph95baac91f/ios

Apple documents folder-picker security-scoped URLs and recursive directory access:
https://developer.apple.com/documentation/uikit/providing-access-to-directories

Format references are the repository's DeviceSQL schema and independent writer. The schema identifies Deep-Symmetry/crate-digger and EPL-1.0. This handwritten bounded subset reads format fields; it does not embed the generated Kaitai parser. Existing licensing notices remain applicable. No distribution/legal-completeness claim is made.
