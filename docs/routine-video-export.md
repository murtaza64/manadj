# Clip editor / video export

Portrait (1080×1920, 30/60 fps) MP4 of a mix with its rendered audio (#377).

## Use

- CLIP mode (top bar overflow → CLIP, `?view=clip&clip=<kind>:<uuid>[:<start>-<end>]`). Entry points: the
  Mix editor's picker on the right of CLIP (same component), Mix editor `⇥ clip`, and the Session timeline:
  drag-select a span → `⇥ clip` (`openClipEditor` in `export/clipEvents.ts`).
- Sources: `routine`, `transition`, `candidate` (miner span), `routine-take`, `session:<uuid>:<start>-<end>`
  (an arbitrary Session span promoted on the fly; spans with scratch motion are refused like promotion).
- Editor: source bar · portrait preview + inspector · transport + timeline.
  - Timeline: per-deck presence envelopes, drops (red), dominant 16-bar phrases, cue flags (drag to move),
    in/out handles (drag to trim), click/drag to scrub. The source renders once; trims slice it.
  - PROGRAMME: auto programme (rotation from the preset browser, drop/phrase impacts, min gap, phrase pulses →
    GENERATE CUES; collapses once cues exist), compact cue list, `+ CUE AT PLAYHEAD` snaps to the nearest
    phrase/drop. Selected cue: preset browser (every curated + genepool preset; search; sort by score, likes,
    rating, newest, name; dead toggle) and the preset's params as sliders — per cue (keyframe), not per preset.
    Each cue is a keyframe:
    - Transition: CROSSFADE (own fade length; also blends numeric look changes) / CUT / held kinds that run for a
      length (bar buttons) before (`⇥ INTO CUE`) or after the cue and hand back — BLACKOUT (visualizer black;
      optionally the waves too), SOLO (one deck full-frame; AUTO = dominant), BLAST (another preset, then back),
      VFX (beat-synced RGB split / glitch / kaleido / mirror / invert / tunnel / strobe over the frame).
    - Look: `EDIT LOOK FROM THIS CUE` opens the LOOK tab scoped to the cue (`FROM CUE m:ss`); every field set there
      is a keyframe change (magenta, `×` clears = inherit) that persists until a later cue changes it.
    - Auto programme options `vary transitions` / `look changes` sprinkle both over generated cues.
    Timeline: crossfade ramps and held segments (colored per kind) under the flags; `◆` = cue changes the look.
  - LOOK: look presets; composite SOLID / WINDOW (wave masks the visualizer) / LIGHT (additive) / NEGATIVE
    (the wave inverts the visualizer) / CUTOUT (black hole, color rim) / TINT (deck hue, preset light) / STAGE;
    palette; lanes FULL-BLEED (default) / CARDS; decks AUDIBLE / ALL; glow, visualizer, darken, vignette, zoom
    pulse, impacts, wave zoom; response (BEAT×ENERGY / BEAT / ENERGY / BASS / OFF; controls amount, waveform
    pulse, drop boost); overlays (top bar, mixer row, beat grid, action pills, title cards, titles at drop,
    drop countdown, Beat FX strip, footer, manaDJ mark); controls shade (dark strip behind the title/controls row);
    accent; handle/caption (defaults to the last handle typed, `@dj.reroll` initially). Titles at drop: a track reads
    "ID" until its hot cue 4 drop; one already past its drop when the clip starts is named from the start.
  - OUTPUT: numeric range + fades, fps, export.
  Specs persist per source in localStorage (`manadj-clip:<source>`).
- Headless: `node scripts/export/render_routine_video.mjs --app <vite> --source <kind:uuid> [--max s] [--viz id] [--auto 1|'<AutoVizOptions json>'] [--spec '<partial ClipSpec json>']`
  (drives `?view=clip&autostart=1`; `window.manadjClipEditor.{run,state,seek}`)
  (needs `playwright`: sibling `node_modules`, `~/manadj/node_modules`, or `PLAYWRIGHT_MODULE`; runs Chromium with ANGLE/Metal — SwiftShader is ~15× slower).
- Output: `<data root>/exports/<title>-<id>.mp4`, served at `/api/video-export/files/<name>`.

## Pipeline (`frontend/src/export/`)

| Step | Module | Notes |
|---|---|---|
| Spec | `clipSpec.ts` | `ClipSpec` = source + range + fades + viz cues (keyframes: preset + impact + params + `look` overrides + `transition`; `viz.auto` = place from the hypermeter at load) + base look. Per frame `programmeFrame(spec, s)` → `lookAt` (overrides layered in cue order, numeric blend over crossfades), `fadeGainAt`, `impactAt`, `overlayAt` (held segment); `vizAt` (same-preset cue = impact-only; cut / held kinds switch instantly) |
| Hypermeter | `clipMetric.ts` | Per track: bars anchored at hot cue 4 (else first ladder reset mark, else first downbeat), counted in beats so off-phase downbeats still phrase; drops = hot cue 4 + strong `/api/drops` hypotheses on its 16-bar lattice. On the mix clock: bar crossings of playing slots (tier ≥ 4-bar, audible) → events; dominant slot (smoothed post level, hysteresis); per-slot presence ramps (lookahead, hold); takeovers; `autoVizCues` |
| Load | `routineVideoExport.ts` `resolveClipSource` / `loadClip` | Routine detail, Transition via `transitionToProjection`, previews for candidate / take / session span (`GET /api/video-export/session-span/{session}`); `buildEditorRoutine` (target BPM = slot 0 native); waveform blobs, grids, hot cues, user's `full` style slot |
| Audio | `routineAudioRender.ts` (`renderRoutineAudioChunked`: ~30 s pieces, 3 at a time in order, 6 s pre-roll, stitched at control steps; the editor previews the rendered head; last 2 renders cached in memory). Per-step work skips idle strips and unchanged controls; strips the routine never targets with Beat FX drop their insert | `OfflineAudioContext` 48 kHz. One `ChannelStrip` per cast slot (real isolator EQ, sweep filter, fader, Beat FX insert) → program → master Beat FX → ceiling. `traceSegments` turns each slot's trace into constant-rate `AudioBufferSourceNode` runs. Lanes + FX applied every 2048 samples via `suspend`/`resume`; per-slot (post-fader, low/mid/high) + master FFT meters captured per step (`RenderMeters`). Fades are gain ramps on the result |
| Visualizer | `offlineVisualizer.ts` | `VisualizerFrameData` from the meters with the live bridge's ballistics; beat/bar from the dominant track's hypermeter; known drops land as `regime.dropTransition`; any registered preset + the `materia` candidates; `BackgroundProgramme` crossfades cues |
| Frames | `routineVideoScene.ts` `drawRoutineFrame(ctx, scene, t, w, h, {background, fade, impact, overlay})` (callers set `scene.look` per frame; overlay: blackout drops the background (± lanes), solo lays one lane over the frame, vfx post-processes the finished frame in device pixels; blast is swapped in by `BackgroundProgramme`) | Pure Canvas 2D at exact instants. Deck cards stack centered, unfold with presence (AUDIBLE) and slide to make room; one playhead through all cards. Card: styled waveform (palette, composite) on a fixed column grid — left of the playhead the strip as heard (`performance/stripHistory`, replayed on seek), right the current controls; cue pins (beat grid optional); info row split at the playhead (title/artist/fader/level left, knobs right). Beat FX drawn on the target wave (echo ghosts, reverb halo, flanger comb, trans gate, roll stutter) + label. HUD: beat pips + 16-bar phrase bar + bar / drop countdown + master meter, pulsing with beat × bass/energy (harder after drops). Impacts (flash/zoom/shockwave/strobe), beat zoom pulse, track title cards, action pills, footer |
| Actions | `routineActions.ts` | Hot cues, beat jumps, loops, play/pause; kills/restores, fader in/out, filter engage/release by hysteresis; FX on/off. Seeds at a slot's entry are ignored |
| Filter on waveforms | `waveform/filterModulation.ts` | The sweep's real response (`sweepResponseDb`) at one centre per style group → gains multiplied into the EQ modulation. Shared by the clip scene and the live Perform waveform (`DeckPanel` strip) |
| Encode | `jpegEncodeWorker.ts` | `ImageBitmap` → `OffscreenCanvas.convertToBlob`, 4 workers, 12-frame pipeline |
| Mux | `backend/video_export.py`, `routers/video_export.py` | `POST /api/video-export/jobs` (WAV body) → `/frames` → `/finish`. ffmpeg image2pipe → libx264 crf 18 yuv420p + aac 256k, faststart |

Throughput (M2 Max, GPU on): audio ≈ 1.2× realtime, frames ≈ 20 fps.

## Not covered

- No Routine or Transition in the library uses Beat FX yet; the FX look is exercised by Session spans
  (e.g. 2026-10-14 `5fa4e59d…:11080-11226`).

- Key Lock (sources resample without stretch), stems, scratch clips (promotion refuses them —
  today's Raindrops session cannot be a source until #352 lands), crossfader/master lanes.
- Session timeline waveforms don't carry filter steps (`DeckControlSteps` has no filter), so the
  filter-sweep idiom is live Perform + clip only.
- The filter sweep look (band attenuation through the real response) deliberately has no extra tint,
  so Perform and clip agree.
