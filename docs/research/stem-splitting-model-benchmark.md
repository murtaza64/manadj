# Stem-splitting model benchmark on real library tracks

Measured 2026-08-25 on this machine (Apple M2 Max, 12 cores, 64 GB, macOS 26.5)
for stems research ticket #148 (map #118). Candidates: demucs v4 family
(`htdemucs`, `htdemucs_ft`), demucs v3 MDX family (`mdx`, `mdx_extra`,
`mdx_extra_q`), and Spleeter 4stems as baseline — run against 8 dnb-heavy
library tracks picked from the sandbox DB by genre tag (neurofunk ×2,
jump up ×2, dancefloor ×3, liquid ×1; aac/mp3/flac mix; 34.8 min of audio).

## Recommendation

**`htdemucs` (demucs v4 default), on MPS, as the task-system job model.**

- Quality: near-interchangeable with `htdemucs_ft` (the best-known open model,
  9.0 dB MUSDB-HQ SDR) — per-stem SI-SDR agreement 11–14 dB, and the lowest
  cross-model bleed of every non-ft candidate. ft is a 4-model bag costing 3.5×
  the runtime for what its own README calls "might be a bit better".
- Speed: **~15 s per track (17× realtime)** on MPS; a 1072-track library is a
  ~4.5 h one-time backfill vs ~15.5 h for ft on manadj's one-at-a-time task
  worker.
- Memory: 3.0 GB peak RSS — comfortable next to the running app (mdx family:
  7–8 GB; Spleeter: 19 GB).
- License: MIT (code and weights); maintained fork publishes to PyPI.

Job settings: `demucs -d mps -n htdemucs --float32 --clip-mode none` with
`PYTORCH_ENABLE_MPS_FALLBACK=1`, feeding **wav decoded by our own pipeline**
(see decode-offset gotcha below), then encode stems for storage (storage
format is a separate map decision). CPU fallback works at ~3.8× realtime.

Spleeter is rejected outright; mdx variants are dominated by htdemucs on every
axis measured. Details below.

## Reproduce

Harness (venv setup, driver, analysis) lived in the lane's
`.scratch/stembench/` — `bench.py` (demucs runs), `bench_spleeter.py`,
`analyze.py` (quality metrics), `results*.json`, `analysis.json`,
`bands.json`. Core command per run:

```sh
uv venv --python 3.12 venv && uv pip install -p venv/bin/python demucs soundfile diffq
PYTORCH_ENABLE_MPS_FALLBACK=1 /usr/bin/time -l \
  venv/bin/demucs -d mps -n htdemucs -o out --filename "{track}/{stem}.wav" TRACK
```

## Runtime and memory (per track, MPS, model pre-downloaded)

| model       | mean wall/track | × realtime | peak RSS | notes |
|-------------|----------------:|-----------:|---------:|-------|
| htdemucs    | **14.9 s** | **17.5×** | **3.0 GB** | single model, v4 hybrid transformer |
| htdemucs_ft | 51.8 s | 5.0× | 4.5 GB | bag of 4 fine-tuned v4 models |
| mdx         | 37.5 s | 7.0× | 7.1 GB | bag of 4 v3 models, MUSDB-only |
| mdx_extra   | 32.0 s | 8.1× | 7.5 GB | bag of 4 v3, extra training data |
| mdx_extra_q | 34.0 s | 7.7× | 7.8 GB | quantized mdx_extra (needs `diffq`) |
| spleeter    | 16.5 s | 15.8× | **18.9 GB** | TF, CPU only |

CPU datapoint: htdemucs `-d cpu` on the 191 s track = 50.5 s (≈3.8× realtime),
2.6 GB RSS. Wall times include python + model load (~5 s fixed overhead) and
wav encode. MPS required no fallback ops in practice but keep the env var set.

## Separation quality

No ground-truth stems exist for commercial tracks, so quality was assessed by
structured signal analysis (an ear pass on the kept stems is the follow-up
verification; see "Listen for yourself"). Metrics, per (model, track):

1. **Agreement with `htdemucs_ft`** (best-known model) — per-stem SI-SDR.
   Measures proximity to the reference, not absolute quality.
2. **Bleed proxy** — mean stem energy (dBFS) in frames where ft says that stem
   is silent (< −60 dBFS, 93 ms frames). Higher = audible bleed.
3. **Vocal sparsity** — fraction of frames with vocal stem above −50 dBFS.
   dnb vocals are sparse; a never-silent vocal stem = broadband leakage.
4. **Band assignment** — share of the mixture's 20–150 Hz energy landing in
   the bass stem; share of 6–16 kHz landing in drums.
5. **Reconstruction SNR** — sum of stems vs original mixture (sanity check).

### Agreement with htdemucs_ft (SI-SDR dB, mean of 8 tracks)

| model       | drums | bass | vocals | other |
|-------------|------:|-----:|-------:|------:|
| htdemucs    | 13.7 | 13.3 | 11.3 | 12.4 |
| mdx_extra   | 10.9 |  9.2 |  7.5 |  7.4 |
| mdx_extra_q | 10.6 |  8.7 |  7.3 |  7.3 |
| mdx         |  7.7 |  7.6 |  3.8 |  4.7 |
| spleeter    |  0.6 |  2.5 | −4.1 | −5.8 |

(Spleeter's row includes one corrupted comparison on the mp3 track from a
decoder offset — excluding it, spleeter is still ≈ 4 / 5 / 1 / 1 dB: far off.)

### Bleed in ft-silence (dBFS; lower = cleaner)

| model       | drums | bass | vocals | other |
|-------------|------:|-----:|-------:|------:|
| htdemucs    | −61 | −47 | −58 | −65 |
| mdx_extra_q | −47 | −36 | −54 | −63 |
| mdx_extra   | −52 | −33 | −49 | −59 |
| mdx         | −45 | −31 | −50 | −57 |
| spleeter    | −37 | −25 | −34 | −53 |

htdemucs is the cleanest on every stem. Spleeter's −34 dBFS vocal bleed and
−25 dBFS bass bleed are clearly audible levels. Mean vocal-active fraction:
htdemucs 0.62, ft 0.68, spleeter 0.82 — on the *instrumental* neuro track
(Prism) spleeter's vocal stem is active 92% of the time (htdemucs: 26%).

### Structured listening notes (from per-track metrics)

- **Neuro reese lives in "other", not "bass"** — on Prism, even ft assigns
  only 33% of 20–150 Hz energy to the bass stem and 49% to other; htdemucs and
  ft *disagree with each other* about the split (bass SI-SDR −0.5 dB between
  them). The drums/vocals boundary stays clean (drums agreement 12–14 dB).
  Performance-stems implication: a "bass kill" on neurofunk won't reliably
  kill the reese — the mid-heavy bass is genre-ambiguous between bass/other.
  A drums/vocals/everything-else grouping is robust; bass-vs-other is not,
  on neuro specifically.
- **Jump up and liquid separate cleanly** — Ready For It puts 91% of sub in
  bass with 91% of HF in drums; The Journey 97%/66%. Classic sub+drums dnb is
  demucs's easy case.
- **Vocal tracks are the showcase** — Shiver (Hayla vocal): htdemucs↔ft vocal
  agreement 15.9 dB, vocal bleed −72 dBFS; effectively a clean acapella.
- **Drums are the most reliable stem everywhere** (bleed −55 to −69 dBFS on
  every demucs model, every track) — good news for the drum-loop ambitions
  (#120).
- **Spleeter collapses on hot masters** and mid-heavy bass: bass-stem bleed
  −13 to −17 dBFS on the neuro tracks (i.e. only ~15 dB down in sections
  where the bass should be silent).

### Reconstruction and the clip-mode gotcha

With defaults (`--clip-mode rescale`, int16), stems from loud masters do
**not** sum back to the mixture: demucs rescales stems to avoid clipping,
changing per-stem gain by up to −30% (drums on Destiny scaled ×0.70;
aligned reconstruction SNR 9–15 dB). With `--float32 --clip-mode none`,
reconstruction is ~28–30 dB SNR — effectively exact. Performance stems play
simultaneously and must sum to the original when all stem faders are up, so
the job should split with `--float32 --clip-mode none` and handle headroom in
our own gain stage.

### Decode-offset gotcha (mp3)

demucs 4.1.0 decodes input via [sphn](https://github.com/kyutai-labs/sphn);
its mp3 decode is offset **1105 samples (~25 ms) vs ffmpeg's** (measured by
cross-correlation; flac/aac tracks aligned exactly). Stems must line up with
our beatgrids/waveforms, which come from our own decode path — so decode to
wav ourselves and feed demucs the wav, rather than handing it the mp3.

## License and maintenance

- **demucs**: MIT (code and released weights) —
  [facebookresearch/demucs](https://github.com/facebookresearch/demucs) is
  archived (read-only since 2025); the author's fork
  [adefossez/demucs](https://github.com/adefossez/demucs) is "the officially
  maintained Demucs", publishes `demucs` 4.1.0 to PyPI, active (last push
  2026-07), though in maintenance mode ("no new feature for now"). Python
  ≥3.10; works on 3.12 + torch 2.13 (MPS) unmodified. Weights fetched from
  HF Hub on first run (~80 MB htdemucs, ~320 MB ft/mdx bags), cacheable.
  Note: `mdx_extra` was trained *including the MUSDB test set*.
- **spleeter**: MIT ([deezer/spleeter](https://github.com/deezer/spleeter)),
  but effectively unmaintained as a package: pins `tensorflow==2.9.3` which
  has **no Apple Silicon wheels**. Getting it to run took `--no-deps` +
  manual `tensorflow-macos` 2.9.2 + numpy/protobuf/typer/click/h2 pins, and
  it then **silently produced degenerate output** (4 identical stems) when
  its model download failed — weights had to be fetched manually from the
  GitHub release. Not a viable dependency.
- MUSDB-HQ published figures for context (demucs README): htdemucs_ft 9.0 dB
  SDR, hybrid v3 7.7, spleeter 5.9.

## Rejected alternatives

- **htdemucs_ft** — quality ceiling, but 3.5× runtime and 1.5× memory for a
  marginal gain that our bleed metrics can barely distinguish. Worth a listen
  test later on the worst neuro offenders before backfilling the whole
  library; the job's model name should be a config knob anyway.
- **mdx / mdx_extra / mdx_extra_q** — previous generation (v3): slower than
  htdemucs on MPS (4-model bags), 2.5× the memory, more bleed on every stem.
  `mdx` (MUSDB-only training) is notably weak on vocals (3.8 dB agreement).
- **spleeter** — worst quality on every metric, 19 GB RSS, dead packaging.
  Its only virtue (CPU speed) is irrelevant given MPS.
- **htdemucs_6s** (6-stem: +guitar/piano) — not benchmarked; upstream README
  flags piano as broken, and guitar/piano stems have no dnb use.

## Track set

| slug | track | tags |
|------|-------|------|
| neuro-prism | Vici & Neonlight — Prism | DnB, Neurofunk (instrumental) |
| neuro-propaganda | QO & Prdk — Propaganda (Neonlight rmx) | DnB, Neurofunk, Screechy |
| jumpup-readyforit | Basstripper — Ready For It | DnB, Jump Up |
| jumpup-insidemymind | Herbz & Jaybee — Inside My Mind (Master Error rmx) | DnB, Jump Up, Vocal |
| dancefloor-shiver | John Summit, Hayla — Shiver (Wilkinson rmx) | DnB, Dancefloor, Vocal |
| dancefloor-destiny | Netsky & Sub Focus — Destiny | DnB, Dancefloor (mp3) |
| liquid-journey | Feint ft. Veela — The Journey | DnB, Liquid, Vocal (flac) |
| dancefloor-igotu | Duke Dumont — I Got U (High Contrast rmx) | DnB, Dancefloor (flac) |

## Listen for yourself

Until the lane is torn down, all stems (6 models × 8 tracks) sit in the lane
at `.scratch/stembench/out/<model>-mps/<model>/<slug>/{drums,bass,vocals,other}.wav`
(spleeter: `out/spleeter/<slug>/`). Suggested A/B spots: `neuro-prism`
bass-vs-other (the reese ambiguity), `dancefloor-shiver` vocals (acapella
quality), any spleeter drums stem vs htdemucs (bleed).
