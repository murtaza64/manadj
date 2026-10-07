# Audio fingerprinting for live-set track ID

Research 2026-10-07 (desk research only; nothing benchmarked). Question:
given a long recording of a DJ/live set, which library Tracks played and when,
matching only against the local library (closed set). Sources are primary
(paper, patents, vendor docs, project READMEs); each claim links its source.
**Inference** marks reasoning that no source states directly.

Context: a manadj Session stores events, not audio ([CONTEXT.md](../../CONTEXT.md)
§Session), so manadj-played sets already know their tracklist. Fingerprinting
is for audio from elsewhere: CDJ/rekordbox/club recordings and SoundCloud mixes.

## Recommendation

1. **Run a 1–2 day bake-off before building anything.** Use Panako (and Olaf
   inside it) against 3–5 real sets with hand-written tracklists. Panako is the
   only engine whose docs target DJ-set speed changes, and it reports time and
   frequency factors per match.
2. **MVP: an in-repo Python constellation matcher with a tempo search.** Keep it
   behind a narrow `identify(recording) -> [Hit(track_id, rec_start, rec_end,
   track_offset, rate, score)]` seam, so Panako or ShazamKit can sit behind
   the same interface if they win the bake-off. Effort: ~6–10 agent-days to a
   reviewable tracklist UI (breakdown below).
3. **Don't use** Chromaprint/AcoustID (wrong problem), audfprint (unmaintained
   and fragile to speed changes), or commercial APIs as the core. The APIs
   either match only the exact version or keep the custom-catalog and
   derivative-matching features behind a sales contact. Panako/Olaf are AGPL,
   so shipping them inside the packaged app is a licensing decision for
   Murtaza, not an engineering default.

## How constellation matching works (Wang / Shazam)

- **Peaks.** Pick spectrogram peaks: a point is a candidate if it "has a higher
  energy content than all its neighbors in a region centered around the point".
  The sparse result is a "constellation map" ([Wang 2003][wang]).
- **Hashes.** Pair each anchor peak with peaks in a target zone ahead of it.
  Each pair gives "two frequency components plus the time difference", packed
  into a 32-bit hash. The index stores hash → (track ID, time offset)
  ([wang]).
  - The target zone spans `[t0+L, t0+L+W]`, optionally limited to `[f0−F, f0+F]`
    in frequency ([US6990453][p453]).
  - Fan-out F≈10 gives about 10 hashes per peak and roughly a 10,000× speedup
    over single-peak lookup ([wang]).
- **Match.** For each candidate track, histogram δt = t_ref − t_query and look
  for a peak (a diagonal of slope 1.0 in the scatterplot). The score is the
  count in the histogram peak ([wang]).
  - The δt peak gives the **time offset into the reference** for free.
  - It also gives **segmentation**: run fixed windows over the recording and
    stitch consecutive windows that share a track and offset.
- **Robustness.** Built for "foreground voices and other dominant noise" and
  codec compression ([wang]).
  - Pub noise: recognition falls to 50% at about −9/−6/−3 dB SNR for
    15/10/5 s clips (10k tracks, Fig. 4).
  - Only about 1–2% of hashes need to survive.
  - Dropouts are irrelevant.
- **Overlaps/transitions.** "We can correctly identify each of several tracks
  mixed together", which Wang calls "transparency" ([wang]). So a blend should
  surface both tracks as separate histogram peaks rather than nothing.
- **Limits.**
  - The basic algorithm assumes slope 1.0 ([wang]).
  - The paper says it "is not expected to generalize to live recordings"
    ([wang]). That means performed/live-played versions; a DJ set is the
    recorded master and fits the model.
- **Patents.** US6990453 and US7627477 (the speed-invariant follow-up) show as
  "Expired" on Google Patents (2024-01-07, 2025-03-31; [p453], [p477]).
  Panako's and Olaf's READMEs still carry patent warnings ([panako-readme],
  [olaf-readme]). Not a legal opinion.

## DJ-set distortions vs. the method

| Distortion | Effect on constellation hashes | Mitigation (source) |
|---|---|---|
| Crowd noise, MC, room mic | Kills most hashes; ~1–2% surviving is enough | Native strength ([wang]) |
| EQ / filter sweeps | Removes peaks in cut bands; the rest survive (**inference** from peak-local hashing) | Longer windows; lower score threshold |
| Overlap/blend (2–3 tracks) | Several histogram peaks, one per track | "Transparency" ([wang]); report top-k per window (audfprint `--max-matches`, [audfprint]) |
| Tempo change, no keylock (varispeed) | Frequencies **and** Δt scale by rate r; exact hashes miss | Ratio-invariant hashes plus a two-stage histogram (speed ratio, then `t′−R·t`) ([p477]); Panako triplets ([panako14]) |
| Tempo change with keylock | Frequencies hold, Δt scales; hashes miss on Δt only (**inference**) | US7627477 names "pitch-corrected tempo variation, used by DJ's" as the failure case ([p477]); time-ratio hashes (Panako) or a tempo search (below) |
| Pitch/key shift alone | Frequencies scale, Δt holds | Frequency-ratio hashes ([p477]); Panako handles ±10% ([panako14]) |
| Long recording, many tracks | Need per-segment IDs plus offsets | Windowed queries plus stitching (Olaf `--fragmented`, Panako 25 s/5 s overlap, ShazamKit `slices`) |
| Loops, edits, re-entries | Offset jumps inside one track (**inference**) | Stitch on track ID; allow offset discontinuities |

The Panako README says "During a DJ-set speed changes are almost always
present" ([panako-readme]). Panako's JOSS paper says audfprint and NeuralFP
"lack robustness to significant speed changes of more than 5%" ([panako-joss]).
**Tempo is the deciding axis; noise is not.**

## Options compared

| Option | Local-only | Tempo / pitch | Long-recording output | Platform / license | Verdict |
|---|---|---|---|---|---|
| **Custom constellation (Python, in repo)** | Yes | Whatever we build: tempo search, see MVP | We design it | numpy/scipy already deps; patents expired | **MVP** |
| **Panako 2** ([panako-readme]) | Yes (LMDB) | Built for it: ±10% claimed ([panako14]); 20 s queries sped up 10% went from 18%→83% top-1 TP after the 2.0 regression matcher ([panako21]) | Query start/stop, match start/stop, time factor %, frequency factor %, score | Java 17 + ffmpeg; "does not support Windows"; **AGPL-3.0** | **Bake-off baseline** |
| **Olaf** ([olaf-readme]) | Yes (LMDB) | Classic Shazam algorithm; no tempo claim in its docs | `--fragmented` (30 s) → `query_offset`, `reference_start/stop` | C/Zig, WASM; **AGPL-3.0**; 100k tracks at ~80× realtime | Bake-off, noise-robust baseline |
| **audfprint** ([audfprint]) | Yes | Panako 2014 eval: no recovery after pitch shifts over 3%, "unable to cope with time-scale modification" ([panako14]) | `--find-time-range`, `--max-matches` | Python, MIT; last push 2019; offsets alias past ~6 min by default (`--maxtimebits 16` → ~25 min) | Reference code only |
| **Chromaprint / AcoustID** ([chromaprint], [acoustid-faq]) | Fingerprinting local; web service is the global MusicBrainz DB, non-commercial, 3 req/s ([acoustid-ws]) | Not a design goal: "designed to identify near-identical audio" | `fpcalc -chunk/-overlap/-ts` gives fixed-chunk fingerprints | LGPL-2.1 overall; self-hostable `acoustid-index` (RAM-resident) | **Wrong problem.** The FAQ says it can't identify short snippets or noisy audio |
| **ShazamKit custom catalog** ([sk-session], [wwdc22]) | Yes: "exact matching … all on-device" | Reports `frequencySkew` (e.g. 0.05 = 100→105 Hz) and "No match returns if the frequency skew is too large"; no documented keylock-tempo tolerance | `matchOffset` (can be negative), `predictedCurrentMatchOffset`; `SHSignature.slices(from:duration:stride:)` for long signatures | Apple platforms (iOS 15/macOS 12; file signatures macOS 13; slices macOS 15); `/usr/bin/shazam` CLI (macOS 13+); Android AAR; no Linux/Windows | Bake-off candidate; macOS-only conflicts with cross-platform work |
| **ACRCloud** ([acr-custom], [acr-scan]) | No: upload fingerprints to a bucket bound to a project | Fingerprinting: "Only detect the exact same version"; derivative (speed/pitch) detection is test-10-files, then contact sales ([acr-music]) | File Scanning "Traverse" gives multiple results with `offset`, `played_duration`, `db_begin_time_offset_ms`, custom-file hits listed separately | Cloud; 14-day trial; prices behind login; offline SDK mobile-only | Not core |
| **AudD** ([audd-ent], [audd-home]) | No; custom catalog "requires special access" ([audd-py]) | Marketing says "stable through … tempo changes"; no numbers in API docs | Enterprise: 12 s chunks, `skip`/`every`/`limit`, `offset` in file plus `timecode` in song | Cloud; $2–5 per 1000 requests (1 h set ≈ 300 requests); on-prem by quote | Not core; possible fallback for non-library tracks |

## MVP architecture (custom matcher)

All in backend Python. No new heavy deps: numpy, scipy and soundfile are
already in `pyproject.toml`.

1. **Index (task-system job, once per Track, incremental).**
   - Decode to mono at 8–11 kHz.
   - Peaks via `scipy.ndimage.maximum_filter`, density-capped.
   - Hash `(f1, f2, Δt)` with fan-out ~10.
   - Store `hash → (track_id, t)` in a SQLite side table or a numpy-sorted
     array file under the data root.
   - Rough size: ~1k tracks × ~6 min × a few hundred hashes/s → low tens of
     millions of rows. **Inference**: fine for SQLite or memory-mapped arrays;
     measure it.
2. **Query.**
   - Slide 10–15 s windows with a 5 s hop over the recording (Panako uses
     25 s/5 s, Olaf 30 s fragments).
   - Per window, histogram δt per candidate track and keep the top-k peaks
     above a threshold (k≥2 for blends).
3. **Tempo search, the manadj-specific lever (inference; validate in the
   bake-off).**
   - The library already has per-Track BPM/beat grids, and beat-this is a
     dependency.
   - Estimate local tempo for each recording window. The candidate rate for
     track i is `r = window_bpm / track_bpm`, so the set of rates to try is
     small and known, not a blind ±10% sweep.
   - Keylock: rescale query Δt by 1/r before hashing.
   - Varispeed: also rescale query frequency bins by 1/r.
   - Try both per candidate and keep the better score.
   - Fallback without BPM: sweep r in ~0.5% steps over ±8%.
   - Escape hatch if this proves fragile: ratio-invariant hashes per
     [p477]/[panako14].
4. **Stitch.**
   - Merge consecutive windows with the same track and δt drifting at rate r
     into a Hit `(rec_start, rec_end, track_offset, rate, score)`.
   - Overlapping Hits mark transitions.
   - Gaps mean unknown audio (not in the library).
5. **Review UI.**
   - Tracklist with confidence plus a timeline over the recording waveform.
   - Unmatched gaps can be shipped to AudD on demand (optional, off by
     default).

Effort (focused agent-days, including tests on decoy/synthetic mixes):

| Piece | Days |
|---|---:|
| Bake-off harness: Panako + Olaf install, index library copy, 3–5 sets, ground-truth scoring | 1–2 |
| Indexer + store + task job | 1.5–2 |
| Windowed query + histogram + top-k | 1 |
| Tempo search (BPM-guided + sweep), keylock/varispeed variants | 1.5–3 |
| Stitching + segmentation + scoring vs ground truth | 1–1.5 |
| API + tracklist/timeline review UI | 1.5–2 |
| **Total custom MVP** | **~6–10** |
| Alternative: Panako as subprocess behind same seam (if it wins) | 2–3 (+ AGPL/Java/Windows decision) |
| Alternative: ShazamKit Swift helper behind same seam (macOS only) | 3–4 (+ tempo tolerance unknown) |

The biggest uncertainty is keylock tempo shifts of several percent. Until the
bake-off measures it, treat the tempo-search estimate as the upper bound.

## Open questions for the bake-off

- What top-1 accuracy and boundary error (seconds) do Panako and Olaf reach on
  real sets with keylock on vs. off?
- Does ShazamKit match keylocked audio at all? Its docs only speak to
  frequency skew; the WWDC "less than 5 percent" advice is about
  *deliberately* skewed catalog audio ([wwdc22]).
- Are 2-track blends recovered as two hits, or does the dominant track mask
  the other?
- How large is the index for the full library?

## Sources

- [A. Wang, "An Industrial-Strength Audio Search Algorithm", ISMIR 2003][wang]
- [US6990453B2 (Shazam, combinatorial hashing)][p453]
- [US7627477B2 "Robust and invariant audio pattern matching"][p477]
- [Six & Leman, "Panako", ISMIR 2014][panako14]
- [Panako 2.0, ISMIR 2021 LBD][panako21]
- [panako-readme][panako-readme]
- [panako-joss][panako-joss]
- [olaf-readme][olaf-readme]
- [audfprint][audfprint]
- [chromaprint][chromaprint] ; fpcalc flags: https://github.com/acoustid/chromaprint/blob/master/src/cmd/fpcalc.cpp
- [acoustid-faq][acoustid-faq]
- [acoustid-ws][acoustid-ws] ; index: https://github.com/acoustid/acoustid-index
- [ShazamKit docs][sk-session] (SHSession, SHCustomCatalog, SHSignatureGenerator, SHSignature `slices(from:duration:stride:)`, SHMatchedMediaItem `matchOffset`/`frequencySkew`); Android: https://developer.apple.com/shazamkit/android/
- ["Create custom catalogs at scale with ShazamKit"][wwdc22]
- [acr-custom][acr-custom]
- [acr-scan][acr-scan]
- [acr-music][acr-music]
- [audd-ent][audd-ent]
- [audd-py][audd-py]
- [audd-home][audd-home]

[wang]: https://www.ee.columbia.edu/~dpwe/papers/Wang03-shazam.pdf
[p453]: https://patents.google.com/patent/US6990453B2/en
[p477]: https://patents.google.com/patent/US7627477B2/en
[panako14]: https://archives.ismir.net/ismir2014/paper/000122.pdf
[panako21]: https://archives.ismir.net/ismir2021/latebreaking/000039.pdf
[panako-readme]: https://github.com/JorenSix/Panako
[panako-joss]: https://raw.githubusercontent.com/JorenSix/Panako/master/paper.md
[olaf-readme]: https://github.com/JorenSix/Olaf
[audfprint]: https://github.com/dpwe/audfprint
[chromaprint]: https://github.com/acoustid/chromaprint
[acoustid-faq]: https://acoustid.org/faq
[acoustid-ws]: https://acoustid.org/webservice
[sk-session]: https://developer.apple.com/documentation/shazamkit
[wwdc22]: https://developer.apple.com/videos/play/wwdc2022/10028/
[acr-custom]: https://docs.acrcloud.com/get-started/tutorials/recognize-custom-content
[acr-scan]: https://docs.acrcloud.com/reference/console-api/file-scanning/file-scanning
[acr-music]: https://docs.acrcloud.com/get-started/tutorials/recognize-music
[audd-ent]: https://docs.audd.io/enterprise
[audd-py]: https://docs.audd.io/sdks/python
[audd-home]: https://audd.io/
