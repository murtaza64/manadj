# Clip editor / video export

Portrait (1080×1920) or landscape (1920×1080), 30/60 fps MP4 of a mix with its rendered audio (#377).

## Use

- CLIP mode (top bar overflow → CLIP, `?view=clip&clip=<kind>:<uuid>[:<start>-<end>]`). Entry points: the
  Mix editor's picker on the right of CLIP (same component), Mix editor `⇥ clip`, and the Session timeline:
  drag-select a span → `⇥ clip` (`openClipEditor` in `export/clipEvents.ts`).
- Sources: `routine`, `transition`, `candidate` (miner span), `routine-take`, `session:<uuid>:<start>-<end>`
  (an arbitrary Session span promoted on the fly; scratch gestures ride along as #352 scratch clips).
- Editor: source bar · portrait preview + inspector · transport + timeline.
  - Timeline: per-deck presence envelopes, drops (red), dominant 16-bar phrases, cue flags (drag to move),
    in/out handles (drag to trim), click/drag to scrub. The source renders once; trims slice it.
  - A **scene** is a cue: from its time on it sets the visualizer preset (+ params), changes look fields, and
    arrives with a transition. Tabs:
    - STORYBOARD: auto storyboard — ARC (default; modelled on a hand-authored clip: mixer-forward intro with titles
      at drop, a short blackout + preset blast at the first phrase change, a bar of blackout into the first drop
      which cuts to MONO DROP, then a new preset every 8-bar phrase with the visualizer brightening (darken /
      vignette → 0) and the UI stripping back — knobs + titles at ~65 %, playhead / cue flags / pills at ~82 %)
      or ROTATION (presets cycle on drops / phrases; optional `vary transitions` / `look changes`); preset list,
      impacts, min gap, phrase pulses → GENERATE STORYBOARD. Scene cards: rendered thumbnail, time, length,
      preset, transition, what the look changes (diff against the scene before); `+ SCENE AT PLAYHEAD` snaps to
      the nearest phrase/drop.
    - SCENE n: everything about one scene on one page — ◀ ▶ between scenes, time, impact, PREVIEW (seeks past the
      transition); Visualizer (◀ ▶ steps presets, BROWSE = the preset browser, PARAMS = per-scene param sliders);
      Arrives with: CROSSFADE (own fade length; also blends numeric look changes) / CUT / held kinds that run for a
      length (bar buttons) before (`⇥ INTO CUE`) or after the cue and hand back — BLACKOUT (visualizer black;
      optionally the waves too), SOLO (one deck full-frame; AUTO = dominant), BLAST (another preset, then back),
      VFX (beat-synced RGB split / glitch / kaleido / mirror / invert / tunnel / strobe / fader CHOP (16th gate, 32nds in the last bar) / FREEZE (stutter on 8ths/16ths) / RISE (white swell into the cue) / SHAKE over the frame); Look: the
      full look editor showing the look in force, fields this scene changes in magenta (`×` = inherit), styles
      (MIXER, BRIGHT, WAVES ONLY, MONO DROP, …), CLEAR CHANGES, COPY PREVIOUS SCENE. Changes persist until a later
      scene changes them.
    - BASE LOOK: the clip's starting look (same editor) + file name.
    Timeline: click a flag to open its scene; crossfade ramps and held segments (colored per kind) under the
    flags; `◆` = scene changes the look.
  - Look fields: styles; composite SOLID / WINDOW (wave masks the visualizer) / LIGHT (additive) / NEGATIVE
    (the wave inverts the visualizer) / CUTOUT (black hole, color rim) / TINT (deck hue, preset light) / STAGE;
    palette; lanes FULL-BLEED (default) / CARDS; decks AUDIBLE / ALL; glow, visualizer, darken, vignette, zoom
    pulse, impacts, wave zoom; response (BEAT×ENERGY / BEAT / ENERGY / BASS / OFF; controls amount, waveform
    pulse, drop boost); overlays (top bar, mixer row, beat grid, hot cue flags, track titles, playhead, action pills, title cards, titles at drop,
    drop countdown, Beat FX strip, footer, manaDJ mark); deck layout STACK / SIDE (info column) / GRID (columns) /
    SPOTLIGHT (dominant deck big, rest in a strip) / VERTICAL (waves scroll down into a horizontal playhead) / MIRROR
    (history mirrored out from a centre playhead); deck view WAVE / BARS (EQ analyser: the deck's share of the master
    spectrum) / RING (33⅓ platter, spectrum spokes, progress ring with hot cues) / NONE (visualizer only + lower
    third; the record label is the track's cover art); font MONO (terminal look, glowing text) / SF / AVENIR / NEW YORK
    (italic; breakdown lower thirds) — premium faces get a soft shadow instead of glow; controls KNOBS / SLIDERS /
    MINIMAL (thin white arcs, hairline meters, no colour); levels BAR / SEGMENTS (LED); DJ readout (top right):
    PHRASE (16-tick ring, bar/phrase, drop distance) / MIX (balance line between the two loudest decks, "MIXING A→C ·
    n BARS") / DATA (mono BPM · key · phrase:bar.beat · energy · remaining) / SET (track n of the set strip); lower
    third CLASSIC / TECHY (mono, ticked rule, boxed fields) / METAL (brushed rule, metallic title) / BRIGHT (colour
    slabs and chips) — title cards and the visualizer-only view, with BPM / key / genre tags and the set number;
    `setTrackIds` (the whole set's track order) numbers tracks; `clockOffsetSec` / `clockTotalSec` run the footer
    clock across a multi-part render;
    control colours; build-up (the 16 bars before each drop: zoom creep, closing vignette, beat subdividing to a
    snare roll, white haze, last-bar shake, growing countdown; the offline visualizer's `regime.buildup` is forced up
    over the same window so build-aware presets evolve too); text and controls swell with the beat only near drops (8
    bars after, 2 before; calm elsewhere); drop countdown = ghost digits behind the decks over the last 8 bars; action
    pills = a right-aligned row above the footer (deck bar, line icon, verb-first label; paired actions replace each
    other; the action that lands a drop is a larger hero pill; scratch / backspin get their own icons); bare lanes
    run the wave behind the info (local scrims only when `infoShade` > 0); deck headers step back while a title card
    is up;
    controls shade (dark strip behind the title/controls row);
    accent; handle/caption (defaults to the last handle typed, `@dj.reroll` initially). Titles at drop: a track reads
    "ID" until its hot cue 4 drop; one already past its drop when the clip starts is named from the start.
  - OUTPUT: numeric range + fades, fps, PORTRAIT / LANDSCAPE, export.
  Timeline: wheel / pinch zooms around the pointer, shift+wheel pans, double-click shows all; the view follows the
  playhead. Specs persist per source in localStorage (`manadj-clip:<source>`).
- Headless: `node scripts/export/render_routine_video.mjs --app <vite> --source <kind:uuid> [--max s] [--viz id] [--auto 1|'<AutoVizOptions json>'] [--spec '<partial ClipSpec json>']`
  (drives `?view=clip&autostart=1`; `window.manadjClipEditor.{run,state,seek}`)
  (needs `playwright`: sibling `node_modules`, `~/manadj/node_modules`, or `PLAYWRIGHT_MODULE`; runs Chromium with ANGLE/Metal — SwiftShader is ~15× slower).
- Output: `<data root>/exports/<title>-<id>.mp4` (+ `<title>-<id>.clip.json`, the spec that made it — LOAD CLIP reopens it), served at `/api/video-export/files/<name>`.

## Pipeline (`frontend/src/export/`)

| Step | Module | Notes |
|---|---|---|
| Spec | `clipSpec.ts` | `ClipSpec` = source + range + fades + viz cues (keyframes: preset + impact + params + `look` overrides + `transition`; `viz.auto` = place from the hypermeter at load) + base look. Per frame `programmeFrame(spec, s)` → `lookAt` (overrides layered in cue order, numeric blend over crossfades), `fadeGainAt`, `impactAt`, `overlayAt` (held segment); `vizAt` (same-preset cue = impact-only; cut / held kinds switch instantly) |
| Hypermeter | `clipMetric.ts` | Per track: bars anchored at hot cue 4 (else first ladder reset mark, else first downbeat), counted in beats so off-phase downbeats still phrase; drops = hot cue 4 + strong `/api/drops` hypotheses on its 16-bar lattice; with neither, drops are inferred from the waveform's low band (`inferDrops`: 8-bar boundaries where energy jumps ≥ 1.6×) and anchor the lattice. Titles at drop fall back to the track passing its first known drop, else its takeover, else 32 bars after entry. On the mix clock: bar crossings of playing slots (tier ≥ 4-bar, audible) → events; dominant slot (smoothed post level, hysteresis); per-slot presence ramps (lookahead, hold); takeovers; `autoVizCues` |
| Load | `routineVideoExport.ts` `resolveClipSource` / `loadClip` | Routine detail, Transition via `transitionToProjection`, previews for candidate / take / session span (`GET /api/video-export/session-span/{session}`); `buildEditorRoutine` (target BPM = slot 0 native); waveform blobs, grids, hot cues, user's `full` style slot; cover art (`GET /api/video-export/artwork/{track}`: embedded picture, else Deezer → iTunes search; cached in `<data root>/artwork/`, misses retried after a week or with `?refresh=1`) |
| Audio | `routineAudioRender.ts` (`renderRoutineAudioChunked`: ~30 s pieces, 3 at a time in order, 6 s pre-roll, stitched at control steps; the editor previews the rendered head; last 2 renders cached in memory). Per-step work skips idle strips and unchanged controls; strips the routine never targets with Beat FX drop their insert | `OfflineAudioContext` 48 kHz. One `ChannelStrip` per cast slot (real isolator EQ, sweep filter, fader, Beat FX insert) → program → master Beat FX → ceiling. `traceSegments` turns each slot's trace into constant-rate `AudioBufferSourceNode` runs, minus scratch-clip spans; `scratchRuns` samples each clip's recorded trajectory per 128-sample quantum into monotone runs (speed stepped per quantum, backward runs on a reversed slice, worklet declick gain; cue snaps break runs). Lanes + FX applied every 2048 samples via `suspend`/`resume`; per-slot (post-fader, low/mid/high) + master FFT meters captured per step (`RenderMeters`). Fades are gain ramps on the result |
| Visualizer | `offlineVisualizer.ts` | `VisualizerFrameData` from the meters with the live bridge's ballistics; beat/bar from the dominant track's hypermeter; known drops land as `regime.dropTransition`; any registered preset + the `materia` candidates; `BackgroundProgramme` crossfades cues |
| Frames | `routineVideoScene.ts` `drawRoutineFrame(ctx, scene, t, w, h, {background, fade, impact, overlay})` (callers set `scene.look` per frame; overlay: blackout drops the background (± lanes), solo lays one lane over the frame, vfx post-processes the finished frame in device pixels; blast is swapped in by `BackgroundProgramme`) | Pure Canvas 2D at exact instants. Deck positions from `routineSlotStateAt` (inside a scratch clip: the recorded gesture; live players pass `netScratch`). Deck cards stack centered, unfold with presence (AUDIBLE) and slide to make room; one playhead through all cards. Card: styled waveform (palette, composite) on a fixed column grid — left of the playhead the strip as heard (`performance/stripHistory`, replayed on seek), right the current controls; cue pins (beat grid optional); info row split at the playhead (title/artist/fader/level left, knobs right). Beat FX drawn on the target wave (echo ghosts, reverb halo, flanger comb, trans gate, roll stutter) + label. HUD: beat pips + 16-bar phrase bar + bar / drop countdown + master meter, pulsing with beat × bass/energy (harder after drops). Impacts (flash/zoom/shockwave/strobe), beat zoom pulse, track title cards, action pills, footer |
| Actions | `routineActions.ts` | Hot cues, beat jumps, loops, play/pause; kills/restores, fader in/out, filter engage/release by hysteresis; FX on/off; one SCRATCH / BACKSPIN per scratch clip (`scratchActionKind`: backward travel ≥ 1.5 s and > 3× forward). Seeds at a slot's entry are ignored |
| Filter on waveforms | `waveform/filterModulation.ts` | The sweep's real response (`sweepResponseDb`) at one centre per style group → gains multiplied into the EQ modulation. Shared by the clip scene and the live Perform waveform (`DeckPanel` strip) |
| Encode | `jpegEncodeWorker.ts` | `ImageBitmap` → `OffscreenCanvas.convertToBlob`, 4 workers, 12-frame pipeline; workers recycled every 1200 frames and batches posted as one buffer (Blobs only free on GC — long renders hit `ERR_BLOB_OUT_OF_MEMORY`) |
| Mux | `backend/video_export.py`, `routers/video_export.py` | `POST /api/video-export/jobs` (WAV body) → `/frames` → `/finish`. ffmpeg image2pipe → libx264 crf 18 yuv420p + aac 256k, faststart |

Throughput (M2 Max, GPU on): audio ≈ 1.2× realtime, frames ≈ 20 fps.

## Not covered

- No Routine or Transition in the library uses Beat FX yet; the FX look is exercised by Session spans
  (e.g. 2026-10-14 `5fa4e59d…:11080-11226`).

- Key Lock (sources resample without stretch), stems, crossfader/master lanes.
- Session timeline waveforms don't carry filter steps (`DeckControlSteps` has no filter), so the
  filter-sweep idiom is live Perform + clip only.
- The filter sweep look (band attenuation through the real response) deliberately has no extra tint,
  so Perform and clip agree.
