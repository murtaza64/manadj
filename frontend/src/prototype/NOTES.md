# Waveform style prototype — running verdicts

PROTOTYPE — wipe me. Answer log for the questions this prototype exists to
answer (PRD: `.scratch/waveform-overhaul/PRD.md`, data model: ADR 0014).

## Questions and current answers

**Q: How fast is the new generation pipeline?**
Answered: 600–1100× realtime (~0.3–0.7 s/track), blobs ~1 KB/s of audio.
Verified on flac + aac including a 10.5-min track.

**Q: Does texture-based rendering (zoom/pan as uniforms, tiled LOD textures,
styles as shader variants) work?**
Answered: yes. Style/palette/grouping changes are live uniform edits; new
styles (8-band stack, 3-group stack, flux-based transient) were added with
zero renderer changes. No geometry, no regen on zoom.

**Q: Which render style wins?**
Front-runner (2026-07-04, reconfirmed after playback + transient work):
**B — additive RGB**, with tuning:
gamma 1.0, master 1.0, gains low 0.70 / mid 1.05 / high 1.50,
group boundaries b1=3 (low = bands 0–2, up to 400 Hz), b2=5 (mid = bands
3–4, 400 Hz–2.5 kHz; high = 2.5 kHz+).
These are the prototype defaults. H (peak-edged additive) rejected —
broadband silhouette too spiky. I (B + attack ticks) and G still open.

**Q: How do we get sharp transient edges without lying?**
- Scroll flicker: fixed by pixel-snapping the view origin + hard-max columns.
  Weighted "antialiased" max is wrong (heights pulse); snap instead.
- Causal (end-stamped) band frames: tried, REJECTED — only shifts the
  window ramp right, doesn't narrow it.
- **Multi-resolution windows (format v2, adopted)**: per-band STFT windows
  2048 (bands 0-1) / 1024 (2-4) / 256 (5-7), all on the shared hop-512 grid
  with shared frame centers (blob layout unchanged, version byte 2). Upper
  bands get ~6 ms edges — the honest fix; bass stays soft because bass is
  soft. Uncertainty principle rules out any single-window fix.

**Q: Does 8-band data support all candidate looks?**
So far yes — every style above, including regrouping the 3-band split live,
renders from the same blobs. Open sub-question: is shader-side spectral flux
(12 ms band frames) crisp enough for a transient-focused style, or does
production want a dedicated onset channel computed at Analysis time
(format v2)?

## Not yet judged

- LOD behavior on very long files (longest test track is 10.5 min; PRD
  anticipates 2-hour mixes)
- fps under sustained zoom gestures on battery/integrated GPUs
