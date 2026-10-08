# Changelog

All notable changes to manaDJ. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/). Install: [docs/install.md](docs/install.md).

## [Unreleased]
- Acquisition redesigned (Dig view, #342): one table with the lifecycle in the status cell, inline Soulseek candidates on failure, batch verbs, queue drawer, sort/filter; Spotify likes/playlists as browse-only feeds with want (#347); favorite feeds pour into "all sources"; app-wide restyled checkboxes.

- Capture: Beat FX echo/reverb tails count as audible — an echo-out Take now ends where the tail dies out, not at the fader slam; Session timeline bands follow (#355).
- Session timeline shows Beat FX: an effect-coloured band (echo yellow, reverb green, flanger red) on the targeted deck lane — Master FX bands every lane — with opacity following LEVEL/DEPTH; the scrub readout shows the FX state (#354).
- Mix editor: Beat FX lanes — Takes recorded with Beat FX audition with their echo/reverb/flanger; edit FX steps (effect, target, length, on/off) and depth under the slots; FX replays in Set playback and carries through templates and Routine promotion (#353).
- Replaced the README with prerelease installation notes and current-app screenshots (#340).
- Added website help pages and the offline in-app Help manual, linked from Settings, Tours and Setup guides (#295).
- Mix editor: author mixes from scratch with + New blank mix — drag tracks from the library onto the canvas/timeline. 2 tracks save as a Transition, 3 or more as a Routine; adding or removing a track across that line converts it on save (Set pins follow). Drop a track onto an open Transition to grow it into a Routine (#325, #330).
- Reordered the site into eight workflow sections, expanded Library curation, folded controllers into Perform, and removed the glossary (#346).
- Added direct classic Rekordbox USB export with Playlists, Hot Cues, beatgrids, waveforms and read-back verification (#91–#94, #265).
- Experimental direct Engine USB export: `scripts/engine_usb.py export/verify` builds a standalone Engine device library (tracks, playlists, cues, grids, optional donor analysis) in a target directory and verifies it against your library — behind the export toggle, and not yet wired to real USB drives (#267, #268).
- Sessions are grouped by day with longest-first previews and mined-candidate counts; timelines gain live zoom redraws, progressive gridlines, and stable playback-start positioning (#263).
- In-app FEEDBACK button (top bar): files a bug/feature report on GitHub with a screenshot and app-state capture; QUEUE holds filed reports until you explicitly send them to the agent batch (#243, #244, #245).
- Background tasks now run in parallel lanes — SoundCloud downloads, Soulseek transfers, and local compute (waveforms, analysis, stems) no longer block each other (#224).
- Shortened feature and installation copy on the public site (#341).
- Added prerelease downloads and an install/Setup guide at https://manadj.murt.dev.

## [0.1.0-rc.3] - 2026-10-07

### Added
- New users start in PERFORM with 2 decks; EXPORT (the full library view) moved into the ⋯ menu next to HISTORY. Backtick and ?view=library still reach it.
- Fresh installs start from sensible preference defaults (waveform styles, column layout, keylock, quantize, visualizer, GRV6 jog calibration); your own settings always win.
- Cue mode: Trigger makes a Hot Cue on a paused Deck jump and start playing (Gated hold-to-preview stays the default). Toggle with GATED in the Performance view mixer strip; also a Setup guide.
- Added an action-gated Keyboard DJing Tutorial, replayable from ? and Settings → Help → Tutorials (#322).
- Controller check (Settings → Controllers; also a Setup guide): pick Master/Cue outputs with a test tone on each, see whether your MIDI controller has a Mapping, press any control to see it light up, and open jog calibration for the DDJ-GRV6.
- Added the explainer site with keyboard DJing, real-app video clips, and a GitHub Pages build workflow (#294).
- Soulseek: manaDJ bundles and runs slskd itself — enter a Soulseek username/password in Settings → Accounts → Soulseek (also a Setup guide). An existing slskd configured via `slskd_url` + `SLSKD_API_KEY` still takes precedence.
- SoundCloud connect (Settings → Accounts → SoundCloud; also a Setup guide): paste your soundcloud.com `oauth_token` cookie, manaDJ confirms the account and likes count. Sync → Acquisition only appears once SoundCloud is connected.

- Added a hands-on Transition Tutorial covering Track selection, Slide, automation, audition and confirmed autosave (#323).
- Revised Tour orientation copy, explicit dismissal and popover positioning; Tours and hands-on Tutorials are labeled separately (#332).
- Windows x64 installer (per-user, no admin; data in `%APPDATA%\manaDJ`). Untested on Windows hardware so far — see Known limitations (#317).
- Quitting manaDJ always shuts its backend down cleanly, on macOS and Windows, and the backend no longer lingers if the app crashes (#314).
- Keyboard map: ? or F1 opens a full-keyboard shortcut overlay for every area (also Settings → Keyboard + mouse). Perform number row drives Beat FX: 1–5 target A/B/C/D/MST, 6/7 length ÷2/×2, 8/9 effect type, hold 0 + mouse for LEVEL/DEPTH, - on/off (#285).
- Flanger length reads in bars by default (1 = 1 bar = 4 beats); toggle Bars/Beats in Settings → Performance → Beat FX → Flanger (#331).

- First-launch welcome and resumable Setup sequence: Rekordbox import, music folder, Cue mode, SoundCloud, Soulseek and Controller check; replay individual guides from Settings → Help → Setup (#275, #288).
- Rekordbox import previews Tracks, Playlists and MyTags, imports cues/grids/keys without changing Rekordbox, and reports progress and skipped items. Imported Tags and Tag Categories receive saturated colors (#274, #326).
- Music-folder Setup saves the tracks directory and offers a recursive Scan, with progress and connection-error recovery (#276).

## [0.1.0] - 2026-10-07

First public release: a DJ library manager and performance app for Apple Silicon Macs, with a Windows x64 build marked untested on Windows hardware.

### Library
- Library of Tracks from your tracks folder, with Tags, Tag Categories, Genre and Energy for curation.
- Playlists with editable play order; archive Tracks without deleting them.
- Analysis: beatgrids, BPM and Key for every Track; a needs-attention worklist for Tracks that analysed poorly.
- Stems: each Track is split into drums, bass, vocals and other, used by stem controls in the Performance view.

### Rekordbox and Engine DJ
- First run: import your Rekordbox library — Tracks, Playlists, Hot Cues, beatgrids and Keys.
- Sync view: import from Rekordbox and Engine DJ at any time.
- Export to Rekordbox and Engine DJ (Tracks, Tags, Playlists, performance data) — off by default; turn it on in Settings → Library.

### Discovery
- Follow mode: suggests what to play next from the playing Track — Match score, harmonic compatibility, Transition history, Tags.
- Dig view for exploring your Library from a Track outward.

### Performance
- Performance view with up to four Decks, Mixer, Sweep filter and Beat FX (Echo, Reverb, Flanger).
- Hot Cues, loops, Quantize, Key Lock, Sync, Slip mode, Vinyl mode and Cue mode for headphone pre-listening.
- Controllers: Pioneer DDJ-GRV6 and DDJ-SB3 work out of the box.
- Sessions: every set you play is recorded; Transitions you perform become Takes you can revisit.

### Sets and mixing
- Sets: plan a sequence of Tracks and Transitions and play it back hands-free or alongside you.
- Mix editor: design Transitions with automation lanes, save them as templates, and practise them.
- Routines and Cameos: capture and replay multi-track passages and guest appearances.

### Getting started
- Guided Tour of each area and Setup guides (Rekordbox, tracks folder, Cue mode, SoundCloud, Soulseek, Controller check).
- Settings for audio routing, filters, Beat FX, waveforms and jog wheels; your library, settings and logs live in `~/Library/Application Support/manaDJ`.

### Known limitations
- macOS: Apple Silicon (M1 or later) only; no Intel build.
- Windows x64: untested on Windows hardware; unsigned (SmartScreen "Run anyway"); stem splitting and audio/controller routing not yet validated there. No Windows on ARM.
- macOS build not notarized: the first launch needs right-click → Open (see [docs/install.md](docs/install.md)).
- Export to Rekordbox/Engine DJ is off until enabled in Settings.
- No auto-update: download new versions from GitHub Releases.
- The first launch takes longer than later ones while manaDJ prepares its database and analysis engine.

[Unreleased]: https://github.com/murtaza64/manadj/compare/v0.1.0-rc.3...HEAD
[0.1.0-rc.3]: https://github.com/murtaza64/manadj/releases/tag/v0.1.0-rc.3
[0.1.0]: https://github.com/murtaza64/manadj/releases/tag/v0.1.0
