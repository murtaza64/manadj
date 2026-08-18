# rekordbox USB library formats: which players read what

Research question: which rekordbox USB library format(s) do specific
AlphaTheta/Pioneer DJ players read (classic Device Library vs Device Library
Plus / OneLibrary), plus filesystems and codecs.

Date: 2026 (sources reflect rekordbox 7.2.x era).

## TL;DR / corrections to the premise

- **There is no "XDJ-GRV6."** The 2024 GRV6 product is the **DDJ-GRV6**, a
  4-channel *controller* (no standalone USB playback). It does not appear
  anywhere in rekordbox's USB-export compatibility matrix. Question 1 is moot;
  the closest standalone-player answers are the all-in-one systems in Q4.
- **"Device Library Plus" was renamed "OneLibrary"** (Oct 21 2025). Same
  on-disk format; the rekordbox 6 FAQ still says "Device Library Plus", the
  rekordbox 7 FAQ and product pages say "OneLibrary (formerly Device Library
  Plus)". Treat the two names as the same format.
- **Classic "Device Library"** = `export.pdb` + `PIONEER/USBANLZ` ANLZ files
  (`.DAT`/`.EXT`). **Device Library Plus / OneLibrary** = an encrypted SQLite
  DB (SQLCipher4), file `exportLibrary.db`. Confirmed by pyrekordbox.
- **CDJ-3000 does *not* currently read Device Library Plus / OneLibrary.** A
  firmware (v3.30, 2025-10-21) added it but was **withdrawn**; CDJ-3000 reverted
  to Device Library (latest listed firmware 3.22). OneLibrary support lives in
  the *separate* new model **CDJ-3000X**. Question 2's premise (that CDJ-3000
  firmware permanently added DLP) is currently false.
- **rekordbox 7.2.11+ writes BOTH formats to USB simultaneously by default**
  (official). So one USB works on both classic and OneLibrary players.

## Master table: player -> formats read

Legend: DL = classic Device Library (`export.pdb` + ANLZ). OL = OneLibrary /
Device Library Plus (`exportLibrary.db`). "off" = official-source; "com" =
community-reported.

| Player | Type | DL (classic export.pdb) | OL (Device Library Plus) | Confidence |
| --- | --- | --- | --- | --- |
| CDJ-3000X | player | no | **yes** | off (high) |
| CDJ-1500X | player | no | **yes** | off (high) |
| CDJ-3000 | player | **yes** | no (fw 3.30 added it then withdrawn) | off (high) |
| CDJ-TOUR1 | player | yes | no | off (high) |
| CDJ-2000NXS2 / NXS / 900NXS / 850 / 350 | player | yes | no | off (high) |
| XDJ-1000MK2 / XDJ-1000 / XDJ-700 | player | yes | no | off (high) |
| OPUS-QUAD | all-in-one | no | **yes** | off (high) |
| OMNIS-DUO | all-in-one | no | **yes** | off (high) |
| XDJ-AZ | all-in-one | no | **yes** | off (high) |
| XDJ-AN | all-in-one | no | **yes** | off (high) |
| XDJ-XZ / XDJ-RX3 / RX2 / RX / RR | all-in-one | yes | no | off (high) |
| DDJ-GRV6 | controller | n/a (no standalone USB) | n/a | off (high) |
| "XDJ-GRV6" | — | does not exist | does not exist | off (high) |

Primary source for the whole matrix:
- rekordbox USB Export compatibility table:
  https://rekordbox.com/en/support/usb-export/
  (icons decoded from raw HTML: `rb-icon-check` vs `rb-icon-none`; col1=Device
  Library, col2=OneLibrary.)
- Cross-check, AlphaTheta official device-compatibility overview (identical):
  https://alphatheta.com/en/information/important-notice-for-customers-using-usb-devices-with-our-dj-equipment/

## Q1 — XDJ-GRV6

No such product. Every search resolves to **DDJ-GRV6** (controller, announced
2024-10-08). It is absent from the USB-export matrix because controllers play
from a computer, not standalone USB. So: no classic export.pdb reading, no
OneLibrary reading — it isn't a standalone player.
- Announcement: https://alphatheta.com/en/information/introducing-ddj-grv6-4-channel-performance-dj-controller/
- Confidence: high (official).

If the real intent was a standalone player, see the all-in-one answers in Q4.

## Q2 — CDJ-3000 and Device Library Plus / OneLibrary

Timeline (all official):
- **2025-10-21**: CDJ-3000 firmware **v3.30** released, adding OneLibrary
  support (OneLibrary prioritised during load).
- **~2025-11-04**: Withdrawn after tracks/playlists failed to display when USBs
  were exported by older rekordbox versions. No data was deleted.
- Current state: **CDJ-3000 reverted to Device Library.** Latest listed firmware
  is **3.22 (reads Device Library)**; "no OneLibrary preparation is needed."
  AlphaTheta says CDJ-3000X firmware (not CDJ-3000) will get more flexible
  library loading.

So, as of these sources: CDJ-3000 reads **classic export.pdb only**; it does
**not** currently read OneLibrary/DLP. The DLP-capable flagship is the separate
**CDJ-3000X**, which reads **OneLibrary only** (not classic Device Library —
per the matrix it needs OneLibrary exported to browse a USB).

Sources:
- CDJ-3000 fw 3.30 important notice (official):
  https://www.pioneerdj.com/en/news/2026/cdj-3000-firmware-ver330-important-notice/
- USB device notice w/ compatibility table (official):
  https://alphatheta.com/en/information/important-notice-for-customers-using-usb-devices-with-our-dj-equipment/
- CDJ-3000X needs OneLibrary to browse USB (official FAQ):
  https://rekordbox.com/en/support/faq/onelibrary-7/#faq-q700038
- Community corroboration (secondary): DJ Mag / Digital DJ Tips coverage of the
  fw 3.30 pull; DLP has existed since rekordbox 6.8.2.
- Confidence: high (official) for current state; the exact 3.30→withdrawal dates
  are official-sourced.

"Which is preferred" for CDJ-3000: classic Device Library (the only one it
currently reads).

## Q3 — What does current rekordbox (7.x) write to USB by default

**Both, simultaneously.** Official: "In the latest version of rekordbox (ver.
7.2.11), both OneLibrary and Device Library are automatically generated when
exporting to a USB drive, allowing playback on either type of hardware."

- On an existing classic-only USB, rekordbox offers **Convert from Device
  Library** to also generate OneLibrary; thereafter every export writes to both.
- The two libraries are maintained separately for edits/deletes/histories —
  deleting from one does not delete from the other; a sync tool exists. Editing
  in Collection then re-exporting updates both.
- There is no single "choose format" toggle; the "setting"/action is the
  per-USB **Convert from Device Library** (right-click OneLibrary in the device
  tree), after which dual-write is automatic.

Sources (official):
- USB device notice (dual-generation statement, 7.2.11):
  https://alphatheta.com/en/information/important-notice-for-customers-using-usb-devices-with-our-dj-equipment/
- OneLibrary FAQ (convert + dual-write + separate edit/delete semantics):
  https://rekordbox.com/en/support/faq/onelibrary-7/
- USB Export Guide PDF:
  https://cdn.rekordbox.com/files/20251021171528/USB_export_guide_en_251007.pdf
- Confidence: high (official).

## Q4 — OPUS-QUAD, OMNIS-DUO, XDJ-AZ (and XDJ-AN)

All four are **OneLibrary / Device Library Plus only** — they do **not** read
classic Device Library. (Practically invisible to the DJ because rekordbox 7
dual-writes; but if only a classic export exists, these units won't browse it.)

- Matrix: DL=no, OL=yes for OPUS-QUAD, OMNIS-DUO, XDJ-AZ, XDJ-AN.
  https://rekordbox.com/en/support/usb-export/
- pyrekordbox (independent): "As of 2025, this [Device Library Plus] format is
  only supported by the OPUS-QUAD, OMNIS-DUO, and XDJ-AZ devices."
  https://pyrekordbox.readthedocs.io/en/latest/formats/devicelib_plus.html
  (XDJ-AN post-dates that sentence; rekordbox's own matrix adds it.)
- Confidence: high (official + independent tooling).

## Filesystems

- rekordbox supports FAT32 and exFAT (HFS+/APFS/NTFS not for export media).
- **exFAT is supported by**: CDJ-3000X, CDJ-1500X, CDJ-3000, OPUS-QUAD,
  OMNIS-DUO, XDJ-AZ, XDJ-AN, XDJ-XZ, XDJ-RX3 (as of Jul 2026). Older/other
  units are FAT32-only.
  - https://rekordbox.com/en/support/faq/v7/#faq-q700010 (exFAT list)
  - https://rekordbox.com/en/support/faq/v7/#faq-q600157 (filesystem overview)
- Confidence: high (official).

## Audio codecs (from rekordbox 7 FAQ "Which music file formats are supported")

Tier A — hi-res (88.2/96 kHz FLAC, ALAC, WAV, AIFF) + 44.1/48 kHz FLAC/ALAC/
WAV/AIFF/AAC (**no hi-res AAC**) + mp3:
- CDJ-3000X, CDJ-3000, CDJ-TOUR1, CDJ-2000NXS2, **OPUS-QUAD**, **XDJ-AZ**.

Tier B — 44.1/48 kHz only, FLAC/ALAC/WAV/AIFF/AAC/mp3 (no hi-res):
- CDJ-1500X, XDJ-1000MK2, **OMNIS-DUO**, **XDJ-AN**.

Tier C — XDJ-XZ, XDJ-RX3: 44.1/48 kHz, FLAC/WAV/AIFF/AAC/mp3 (no ALAC).

Tier D — "other" older units: WAV/AIFF/AAC/mp3 only (no FLAC/ALAC).

- Source: https://rekordbox.com/en/support/faq/v7/#faq-q700035
- Confidence: high (official).

## Format internals (for tooling)

- Classic Device Library: `export.pdb` (DeviceSQL) + `PIONEER/USBANLZ/**` ANLZ
  (`ANLZ0000.DAT`/`.EXT`). Legacy, well reverse-engineered.
- Device Library Plus / OneLibrary: `exportLibrary.db` — SQLite encrypted with
  SQLCipher4, single shared (non-machine-specific) key; schema is a subset of
  the rekordbox 6 `master.db` (`content`, `playlist`, `cue`, `history`, etc.).
  - https://pyrekordbox.readthedocs.io/en/latest/formats/devicelib_plus.html
  - rekordbox 6 master DB (SQLCipher context):
    https://pyrekordbox.readthedocs.io/en/latest/formats/db6.html
  - Confidence: high (independent tooling docs; not first-party but
    authoritative for byte layout).

## Source confidence summary

Verified from official AlphaTheta / rekordbox sources:
- USB-export matrix, OneLibrary rename, CDJ-3000 fw 3.30 withdrawal + revert,
  CDJ-3000X = OneLibrary, all-in-one OneLibrary-only, dual-write default (7.2.11),
  exFAT list, codec table, no XDJ-GRV6 (DDJ-GRV6 is a controller).

Independent/tooling (authoritative for internals, not first-party):
- pyrekordbox for `exportLibrary.db` = SQLCipher SQLite and DLP device list.

Community-only (secondary corroboration, lower confidence):
- DJ Mag / Digital DJ Tips on the fw 3.30 pull and DLP-since-6.8.2 history.
