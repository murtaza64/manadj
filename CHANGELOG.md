# Changelog

All notable changes to manaDJ. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/). Install: [docs/install.md](docs/install.md).

## [Unreleased]

### Added
- Fresh installs start from sensible preference defaults (waveform styles, column layout, keylock, quantize, visualizer, GRV6 jog calibration); your own settings always win.
- Cue mode: Trigger makes a Hot Cue on a paused Deck jump and start playing (Gated hold-to-preview stays the default). Toggle with GATED in the Performance view mixer strip; also a Setup guide.
- Controller check (Settings → Controllers; also a Setup guide): pick Master/Cue outputs with a test tone on each, see whether your MIDI controller has a Mapping, press any control to see it light up, and open jog calibration for the DDJ-GRV6.
- Added the explainer site with keyboard DJing, real-app video clips, and a GitHub Pages build workflow (#294).

## [0.1.0] - 2026-10-07

First public release: a DJ library manager and performance app for Apple Silicon Macs.

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
- Apple Silicon (M1 or later) Macs only; no Intel or Windows build.
- Not notarized: the first launch needs right-click → Open (see [docs/install.md](docs/install.md)).
- Export to Rekordbox/Engine DJ is off until enabled in Settings.
- No auto-update: download new versions from GitHub Releases.
- The first launch takes longer than later ones while manaDJ prepares its database and analysis engine.

[Unreleased]: https://github.com/murtaza64/manadj/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/murtaza64/manadj/releases/tag/v0.1.0
