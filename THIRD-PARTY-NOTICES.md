# Third-party license inventory

The root MIT license applies to manaDJ code that its licensor has the right to
license, not to third-party code, models, fonts or media. Existing copyright
and license notices remain in place. Ownership and contributor rights have not
been exhaustively checked. No authorship years have been inferred from the
repository creation date.

This is a partial source inventory reviewed on 2026-11-19, not release clearance
or a legal opinion. `sbom.cdx.json` is CycloneDX 1.6. Its 96 entries include
alternative platform versions, not 96 components installed in every build.

## What is recorded

- Every name/version in the universal frozen Python release export, with its
  environment markers: base plus stems, excluding dev and harness groups.
- The frontend runtime dependency tree from `frontend/package-lock.json`, and
  the exact Electron version in `desktop/package-lock.json`.
- Selected vendored Signalsmith DSP, Ubuntu Mono font and Android Oboe evidence.
  This is not the full Android or iOS dependency graph.
- Evidence level, source URL or repository path, retained license-file paths
  and SHA-256 hashes for each component, in
  `licenses/inventory-evidence.json` and the SBOM properties.

A package's declared license is metadata evidence, not an audit of every file
in its wheel. Some classifications are based on a retained pinned source
license. One older platform-specific Demucs version remains unclassified in
the SBOM rather than borrowing a different version's license text. Vendored
Signalsmith Linear and Ubuntu Mono have no established version here.

## Texts, not only summaries

`licenses/third-party/` retains available upstream license, copyright and notice
files. Existing Signalsmith and Ubuntu Mono texts remain in their original
repository locations. Each retained path and hash is listed in the evidence
index. Source-archive notices can differ from the exact installed wheel and
are not proof that binary-distribution obligations have been met.

The desktop packaging scripts copy this inventory and retained text directory
into a `licenses` directory in the app's resources. This is a packaging-code
change only. No DMG or Windows bundle has been built or inspected for this
review. Mobile packaging of notices is still outstanding.

## Distribution questions that remain open

### Mutagen

The pinned Mutagen 1.47.0 metadata declares GPL-2.0-or-later; its GPL text is
retained. `backend/artwork.py` imports it for embedded artwork. Distribution of
the combined desktop application needs a GPL compatibility and corresponding
source review for the actual package and distribution method. Selecting MIT
for owned code neither removes Mutagen's terms nor settles the combined-work
question. The current recommendation keeps the useful component and makes this
an explicit release gate, not a claim that a notice file alone meets the GPL.

### Madmom code and models

The pinned Madmom commit's root source notice has two BSD conditions, recorded
here as BSD-2-Clause. It separately places model/data files under
CC-BY-NC-SA-4.0. The complete pinned notice is retained, including its exceptions
for differently licensed files and its link to the Creative Commons legal
terms. This root notice is not an exhaustive file-by-file model audit.

The noncommercial restriction affects downstream community reuse as well as
commercial distribution. A free app is not automatic clearance. Confirm the
models actually shipped and used, attribution, modifications and distribution
terms before any release. This work does not replace or relicense the models.

### Essentia

Essentia belongs to the offline harness group. The release export now explicitly
excludes that group. The frozen dependency-list check confirms Essentia is
absent after the change; it does not prove a built bundle is free of stale or
indirect copies. The Windows build uses the same export helper. Development and
harness environments are not relicensed by this change.

### LGPL, MPL and native payloads

Zeroconf, soxr and lameenc have LGPL declarations. Soundfile wheels may include
libsndfile; other wheels contain additional native code. Review the exact
binaries, license versions, notices, source availability and replaceability or
relinking requirements for the chosen distribution method. A PyPI link alone
is not proof of an adequate source offer.

Bidict, certifi and portions of tqdm carry MPL terms. Preserve their notices
and review source availability for covered files and modifications. Package
metadata is not a complete file-level licensing decision.

## Known inventory gaps

- Python runtime, ffmpeg/ffprobe, Chromium/Electron bundled third parties, native
  wheel payloads, downloaded model weights and all assets are not fully covered.
  In particular the macOS ffmpeg download is not a pinned audited build here.
- AndroidX, the full Android dependency graph and the separate unmerged iOS
  branch are not exhaustively inventoried. Existing source notices are not
  deleted or replaced.
- No installed-artifact hashes, full dependency relationships, source offers,
  App Store legal clearance, source replaceability test or contributor-rights
  audit is claimed.
- `httpx` is imported directly by artwork code but declared in development
  dependencies and currently reaches some release environments transitively.
  That pre-existing packaging issue is not silently fixed by this inventory.

## Reproduce and update

With Python 3.13+ and uv available:

```sh
python scripts/release/generate_sbom.py --check
python scripts/release/generate_sbom.py
```

The generator uses a frozen export, exact npm locks and retained evidence. It
fails on dependency or marker drift and changed license-text hashes. Review and
update evidence deliberately when dependencies change; it does not guess a
license for new packages. The review date is not an artifact build timestamp.
Port: desktop notice-copy logic now; mobile notice integration remains a
recorded release gap, not implicit mobile compliance.
