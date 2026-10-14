package dev.manadj.app

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.manadj.audio.DeckId

/** Device orientation picks the layout: portrait one-screen, landscape dense. No manual view switch. */
@Composable fun PerformanceApp(model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit) {
    for (id in model.visibleDecks) {
        val ui = model.decks.getValue(id)
        LaunchedEffect(ui.source?.id) { ux.ensureWave(ui.source, model.visibleDecks.mapNotNull { model.decks.getValue(it).source?.id }.toSet()); ux.extras.getValue(id).history.clear(); if (ui.source != null) ux.loadedAt[id] = System.nanoTime() else ux.loadedAt.remove(id) }
    }
    // Desktop filter tuning synced through the library (edits journal back from FilterSettingsPanel).
    LaunchedEffect(ux.synced) { ux.synced?.lib?.settingJson(dev.manadj.library.PerformanceSettings.FILTER)?.let { model.updateFilterSettings(dev.manadj.audio.FilterSettings.fromJson(it)) } }
    // Key lock defaults on per deck (desktop manadj-keylock default); the pitch panel toggles it after that.
    val canKeyLock = model.supports("key-lock")
    LaunchedEffect(canKeyLock) { if (canKeyLock) for (d in model.visibleDecks) if (model.decks.getValue(d).snapshot?.keyLock != true) model.setKeyLock(d, true) }
    // Engine starts with quantize off; push the persisted preference once it can take it.
    val canQuantize = model.supports("quantize")
    LaunchedEffect(canQuantize) { if (canQuantize) model.setQuantize(ux.quantize) }
    // Played-this-session: a library deck that starts playing.
    for (id in model.visibleDecks) {
        val playingTrack = if (model.decks.getValue(id).snapshot?.playing == true) dev.manadj.app.library.LibraryHolder.trackOn(model, id)?.toLong() else null
        LaunchedEffect(playingTrack) { if (playingTrack != null && playingTrack !in ux.played) ux.played.add(playingTrack) }
    }
    // Record what was heard (strip per source position) so the waveform behind the playhead keeps it.
    val anyPlaying = model.visibleDecks.any { model.decks.getValue(it).snapshot?.playing == true }
    LaunchedEffect(anyPlaying) {
        while (anyPlaying) {
            withFrameNanos { }
            for (id in model.visibleDecks) { val ui = model.decks.getValue(id); if (ui.snapshot?.playing == true) ux.extras.getValue(id).history.record(position(ui), ux.strip(ui)) }
        }
    }
    // Edge-to-edge: no cutout padding. Controls dodge corner arcs and the camera hole via screenSafe().
    val view = LocalView.current
    var screen by remember { mutableStateOf(ScreenShape()) }
    CompositionLocalProvider(LocalScreenShape provides screen) {
    BoxWithConstraints(Modifier.fillMaxSize().background(Ink.background).onGloballyPositioned { val s = ScreenShape.of(view); if (s != screen) { android.util.Log.d("ScreenSafe", "shape $screen -> $s"); screen = s } }) {
        val band = with(LocalDensity.current) { screen.topBand.toDp() }
        val landscape = maxWidth > maxHeight
        val screenHeight = maxHeight
        val modal = model.replace != null || ux.settings || model.outputPanel
        val blur by animateDpAsState(if (modal) 8.dp else 0.dp, tween(220), label = "backdrop")
        Box(Modifier.fillMaxSize().blur(blur)) {
            if (landscape) Landscape(model, ux, pick, Modifier.fillMaxSize()) else Portrait(model, ux, pick, Modifier.fillMaxSize(), screenHeight, band)
        }
        AnimatedVisibility(ux.settings, Modifier.align(Alignment.TopCenter).padding(top = band), enter = fadeIn(tween(150)) + slideInVertically { -it / 4 }, exit = fadeOut(tween(120))) {
            SettingsSheet(model, ux, Modifier.widthIn(max = 460.dp).fillMaxWidth().heightIn(max = screenHeight - band - 16.dp))
        }
        if (model.outputPanel) OutputPanel(model, Modifier.fillMaxSize())
        ReplaceDialog(model, ux)
        KnobPopupOverlay(ux)
        WheelOverlay(ux)
        Banners(model, ux, Modifier.align(Alignment.TopCenter).padding(top = maxOf(band, 44.dp)).widthIn(max = 520.dp).fillMaxWidth().padding(horizontal = 8.dp))
    }
    }
}

@Composable private fun DetailWave(ui: DeckUi, model: PlayerModel, ux: UiModel, modifier: Modifier, vertical: Boolean = false) {
    val wave = ux.waves[ui.source?.id ?: ""]
    val e = ux.extras.getValue(ui.id)
    val moving = ui.snapshot.let { it?.playing == true || it?.previewing == true }
    val frame = frameNanos(moving)
    val clock = remember(ui.id) { SmoothClock() }
    // Engine output-timestamp clock (what is heard now), eased by SmoothClock; raw snapshot when no timestamp.
    // Only read model.output while moving: it changes every engine tick and would redraw idle waves at 30 fps.
    fun heard(now: Long): Double { ux.seekPreview[ui.id]?.let { return it }; if (now == 0L) return position(ui); val out = model.output; return if (out != null && ui.source?.id == ui.snapshot?.sourceId) out.audibleSeconds(ui.id, now) else position(ui) }
    WaveView(wave, { clock.at(frame.value, heard(frame.value), moving && frame.value != 0L, playbackRate(ui)) }, ui.durationSeconds, marksOf(ui), modifier.semantics { contentDescription = "${ui.id} detail wave" }.pinchZoom(ux),
        vertical = vertical, windowSeconds = ux.waveSeconds * tempoRate(ui), live = { ux.strip(ui) }, history = e.history, accent = deckColor(ui.id),
        status = when { ui.source == null -> "${ui.id} · no track"; wave == null -> if (ux.waveSource[ui.source?.id] == "failed") "no waveform" else "analysing…"; !wave.complete -> "analysing ${(100 * wave.frames * wave.bandHop / wave.sampleRate / (ui.durationSeconds ?: 1.0)).toInt().coerceIn(0, 99)}%"; else -> null })
}

/** Deck info in the camera band (A left of the hole, B right); each half dodges the hole and corner arcs. */
@Composable private fun TopBar(model: PlayerModel, modifier: Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(DeckGap)) {
        for (id in listOf(DeckId.A, DeckId.B)) Box(Modifier.weight(1f).fillMaxHeight()) {
            DeckInfo(model.decks.getValue(id), model, Modifier.align(Alignment.BottomStart).fillMaxWidth().height(44.dp).screenSafe())
        }
    }
}

@Composable private fun SettingsKey(ux: UiModel, modifier: Modifier = Modifier.size(40.dp)) = Key("", modifier, Ink.muted, description = "Settings", icon = Glyph.Gear, style = KeyStyle.BARE) { ux.settings = true }

/** Portrait centre: app-level toggles in one floating group (#58) — QUANTIZE, crossfader enable, SETTINGS. */
@Composable private fun GlobalControls(model: PlayerModel, ux: UiModel, modifier: Modifier) {
    val q by remember { derivedStateOf { model.output?.quantize ?: ux.quantize } }
    // One row of compact keys; the group centres in whatever height the mixer leaves.
    Box(modifier, contentAlignment = Alignment.Center) {
        Row(Modifier.fillMaxWidth().height(40.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(10.dp)).border(1.dp, Ink.surface, androidx.compose.foundation.shape.RoundedCornerShape(10.dp)).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Key("QUANT", Modifier.weight(1.2f).fillMaxHeight(), Ink.accent, model.supports("quantize"), q, if (q) "Quantize on" else "Quantize off", style = KeyStyle.PILL, textSize = 10) { ux.quantize = !q; model.setQuantize(!q) }
            Key("XF", Modifier.weight(.8f).fillMaxHeight(), Ink.accent, engaged = ux.crossfaderEnabled, description = "Crossfader enable", style = KeyStyle.PILL, textSize = 10) {
                ux.crossfaderEnabled = !ux.crossfaderEnabled
                if (!ux.crossfaderEnabled) model.updateCrossfade(.5)
            }
            Key("", Modifier.weight(.7f).fillMaxHeight(), Ink.muted, description = "Settings", icon = Glyph.Gear, style = KeyStyle.PILL, textSize = 12) { ux.settings = true }
        }
    }
}

/** Quantize quick toggle + indicator (Settings has the same switch). */
@Composable private fun QuantizeKey(model: PlayerModel, ux: UiModel, modifier: Modifier) {
    val on by remember { derivedStateOf { model.output?.quantize ?: ux.quantize } }
    Key("Q", modifier, Ink.accent, model.supports("quantize"), on, if (on) "Quantize on" else "Quantize off", style = KeyStyle.PILL, textSize = 12) { ux.quantize = !on; model.setQuantize(!on) }
}

/**
 * The one BROWSE button: swaps controls for the browser and back. `model.browser` = the deck whose controls
 * the browser covers — in landscape the outgoing deck (coveredDeck, decided once on open); portrait covers all.
 */
@Composable fun BrowseKey(model: PlayerModel, ux: UiModel, modifier: Modifier) =
    Key("BROWSE", modifier, Ink.warning, engaged = model.browser != null, textSize = 12, style = KeyStyle.PILL) {
        model.browser = if (model.browser != null) null else coveredDeck(mixOf(model, ux, DeckId.A), mixOf(model, ux, DeckId.B))
    }

fun mixOf(model: PlayerModel, ux: UiModel, id: DeckId): DeckMix {
    val ui = model.decks.getValue(id)
    val xf = if (!ux.crossfaderEnabled) 1.0 else if (id == DeckId.A) ((1 - model.crossfade) * 2).coerceAtMost(1.0) else (model.crossfade * 2).coerceAtMost(1.0)
    return DeckMix(id, ui.source != null, ui.snapshot?.playing == true, ui.fader, xf, ui.eq[0], ui.filter, ux.loadedAt[id])
}

@Composable private fun OutputLine(model: PlayerModel) {
    val audio = model.output
    Text(when { audio == null -> "OPENING AUDIO"; !audio.outputOpen -> "OUTPUT CLOSED"; else -> model.outputInfo?.let { "${it.api} ${it.sampleRate / 1000}k buf ${"%.1f".format(it.bufferMillis)}ms ~${it.latencyMillis?.let { l -> "%.0f".format(l) } ?: "?"}ms xr ${it.xruns}" } ?: "NATIVE ${audio.outputSampleRate}Hz" }, Modifier.fillMaxWidth(), Ink.muted, 10)
}

/**
 * Portrait, one screen, top → bottom: deck info, stacked detail waves (A over B), mixer (channel strips flank
 * Beat FX; XF under it), minimaps (A left, B right), stems, pads, then per deck loop → jump → CUE/PLAY →
 * bend → pitch at the thumb edge.
 */
@Composable private fun Portrait(model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit, modifier: Modifier, height: Dp, band: Dp) {
    val tight = height < 860.dp
    val gap = if (tight) 5.dp else Gap
    val a = model.decks.getValue(DeckId.A); val b = model.decks.getValue(DeckId.B)
    val bottomBlock = ControlRow * 3 + TransportRow + 40.dp + gap * 4
    val waveHeight = if (tight) 50.dp else 66.dp
    val pad = Modifier.padding(horizontal = Gap)
    Box(modifier) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(gap)) {
            TopBar(model, pad.fillMaxWidth().height(maxOf(band, 44.dp)))
            if (ux.outputDebug) Box(pad) { OutputLine(model) }
            Column(pad, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                for (ui in listOf(a, b)) DetailWave(ui, model, ux, Modifier.fillMaxWidth().height(waveHeight))
            }
            // The browser replaces the controls region (full-bleed); waves above and CUE/PLAY below stay.
            if (model.browser != null) {
                LibraryPanel(model, ux, Modifier.fillMaxWidth().weight(1f), pick, tapTarget = null)
                Row(pad.fillMaxWidth().height(TransportRow).screenSafe(), horizontalArrangement = Arrangement.spacedBy(DeckGap)) {
                    for (ui in listOf(a, b)) Row(Modifier.weight(1f).fillMaxHeight()) { CueKey(ui, model, Modifier.weight(1f).fillMaxHeight()); PlayKey(ui, model, Modifier.weight(1f).fillMaxHeight()) }
                }
                return@Column
            }
            Row(pad.fillMaxWidth().weight(1f)) {
                KnobColumn(a, ux, model, Modifier.width(58.dp).fillMaxHeight())
                ChannelFader(a, model, Modifier.width(54.dp).fillMaxHeight())
                Column(Modifier.weight(1f).fillMaxHeight().padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(gap)) {
                    FxSection(ux, model, Modifier.fillMaxWidth(), compact = true)
                    GlobalControls(model, ux, Modifier.fillMaxWidth().weight(1f))
                    Crossfader(model, ux, Modifier.fillMaxWidth().height(48.dp))
                }
                ChannelFader(b, model, Modifier.width(54.dp).fillMaxHeight())
                KnobColumn(b, ux, model, Modifier.width(58.dp).fillMaxHeight())
            }
            // Minimaps flank the centre BROWSE key.
            Row(pad.fillMaxWidth().height(if (tight) 36.dp else 44.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Minimap(a, model, ux.waves[a.source?.id ?: ""], Modifier.weight(1f).fillMaxHeight(), preview = ux.seekPreview)
                BrowseKey(model, ux, Modifier.width(84.dp).fillMaxHeight())
                Minimap(b, model, ux.waves[b.source?.id ?: ""], Modifier.weight(1f).fillMaxHeight(), preview = ux.seekPreview)
            }
            Row(pad.fillMaxWidth().height(28.dp), horizontalArrangement = Arrangement.spacedBy(DeckGap)) { for (ui in listOf(a, b)) StemsStrip(ui, ux, model, Modifier.weight(1f).fillMaxHeight()) }
            Row(pad.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(DeckGap)) { for (ui in listOf(a, b)) Pads(ui, model, ux, Modifier.weight(1f), 4, if (tight) 46.dp else PadRow) }
            Row(pad.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(DeckGap)) {
                for (ui in listOf(a, b)) Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(gap)) {
                    LoopStrip(ui, ux, model, Modifier.fillMaxWidth().height(ControlRow).screenSafe())
                    JumpStrip(ui, ux, model, Modifier.fillMaxWidth().height(ControlRow).screenSafe())
                    Row(Modifier.fillMaxWidth().height(TransportRow).screenSafe()) { CueKey(ui, model, Modifier.weight(1f).fillMaxHeight()); PlayKey(ui, model, Modifier.weight(1f).fillMaxHeight()) }
                    BendStrip(ui, model, Modifier.fillMaxWidth().height(ControlRow).screenSafe())
                    PitchKey(ui, model, ux, Modifier.fillMaxWidth().height(40.dp).screenSafe())
                }
            }
        }
        AnimatedVisibility(model.pitchDrawer != null, Modifier.align(Alignment.BottomCenter).padding(bottom = bottomBlock - 4.dp), enter = fadeIn(tween(150)) + scaleIn(initialScale = .92f), exit = fadeOut(tween(120))) {
            PitchPopup(model, ux, Modifier.widthIn(max = 400.dp).fillMaxWidth())
        }
    }
}

/**
 * Landscape: each deck's side (info, minimap, pads, stems, loop, jump, transport, bend + pitch) flanks the
 * mixer. BROWSE slides the whole strip sideways (#65): the strip is [browser][A][mixer][B][browser], one deck
 * wider than the screen on each side and centred; the outgoing deck (coveredDeck) moves toward the centre with
 * the mixer, the load-target deck slides off, the browser slides in. One translation via graphicsLayer (no
 * relayout per frame), interruptible and reversible.
 */
@Composable private fun Landscape(model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit, modifier: Modifier) {
    val a = model.decks.getValue(DeckId.A); val b = model.decks.getValue(DeckId.B)
    BoxWithConstraints(modifier.clipToBounds()) {
        val mixerWidth = 372.dp
        val screen = maxWidth
        val side = (screen - mixerWidth - 12.dp) / 2
        val sidePx = with(LocalDensity.current) { side.toPx() }
        // Outgoing A stays: strip moves right (+side); outgoing B: left (−side); closed: centred.
        val target = when (model.browser) { DeckId.A -> sidePx; DeckId.B -> -sidePx; else -> 0f }
        val shift = remember { androidx.compose.animation.core.Animatable(0f) }
        LaunchedEffect(target) { shift.animateTo(target, androidx.compose.animation.core.spring(dampingRatio = 1f, stiffness = 500f)) }
        // Which browser slot is (or was, while animating out) on screen.
        val browserSlot = when { model.browser != null -> model.browser; shift.value > 1f -> DeckId.A; shift.value < -1f -> DeckId.B; else -> null }
        Row(Modifier.wrapContentWidth(unbounded = true).requiredWidth(screen + side * 2).fillMaxHeight().graphicsLayer { translationX = shift.value }) {
            Box(Modifier.width(side).fillMaxHeight()) { if (browserSlot == DeckId.A) LibraryPanel(model, ux, Modifier.fillMaxSize().padding(start = 6.dp).screenSafe(), pick, tapTarget = DeckId.B) }
            Row(Modifier.width(screen).fillMaxHeight().padding(horizontal = 6.dp)) {
                DeckSide(a, model, ux, pick, Modifier.weight(1f).fillMaxHeight())
                Column(Modifier.width(mixerWidth).fillMaxHeight().padding(horizontal = DeckGap), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.fillMaxWidth().weight(1f)) {
                        KnobColumn(a, ux, model, Modifier.width(54.dp).fillMaxHeight().padding(top = 4.dp), 34.dp)
                        ChannelFader(a, model, Modifier.width(48.dp).fillMaxHeight())
                        Row(Modifier.weight(1f).fillMaxHeight().padding(horizontal = 3.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                            for (ui in listOf(a, b)) DetailWave(ui, model, ux, Modifier.weight(1f).fillMaxHeight(), vertical = true)
                        }
                        ChannelFader(b, model, Modifier.width(48.dp).fillMaxHeight())
                        KnobColumn(b, ux, model, Modifier.width(54.dp).fillMaxHeight().padding(top = 4.dp), 34.dp)
                    }
                    // Symmetric flanks keep the crossfader centred on the screen.
                    Row(Modifier.fillMaxWidth().height(44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        BrowseKey(model, ux, Modifier.width(76.dp).height(40.dp))
                        Crossfader(model, ux, Modifier.weight(1f).fillMaxHeight())
                        Row(Modifier.width(76.dp), verticalAlignment = Alignment.CenterVertically) { QuantizeKey(model, ux, Modifier.weight(1f).height(32.dp)); SettingsKey(ux, Modifier.size(38.dp)) }
                    }
                    FxSection(ux, model, Modifier.fillMaxWidth().height(54.dp).padding(bottom = 4.dp), horizontal = true)
                }
                DeckSide(b, model, ux, pick, Modifier.weight(1f).fillMaxHeight())
            }
            Box(Modifier.width(side).fillMaxHeight()) { if (browserSlot == DeckId.B) LibraryPanel(model, ux, Modifier.fillMaxSize().padding(end = 6.dp).screenSafe(), pick, tapTarget = DeckId.A) }
        }
    }
}

@Composable private fun DeckSide(ui: DeckUi, model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit, modifier: Modifier) {
    Box(modifier) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            DeckInfo(ui, model, Modifier.fillMaxWidth().height(38.dp).screenSafe(), compact = true)
            Minimap(ui, model, ux.waves[ui.source?.id ?: ""], Modifier.fillMaxWidth().height(40.dp).screenSafe(), preview = ux.seekPreview)
            Pads(ui, model, ux, Modifier.fillMaxWidth().weight(1f), 4, Dp.Unspecified, perCellSafe = true)
            StemsStrip(ui, ux, model, Modifier.fillMaxWidth().height(26.dp).screenSafe())
            LoopStrip(ui, ux, model, Modifier.fillMaxWidth().height(40.dp).screenSafe())
            JumpStrip(ui, ux, model, Modifier.fillMaxWidth().height(40.dp).screenSafe())
            Row(Modifier.fillMaxWidth().height(TransportRow).screenSafe()) { CueKey(ui, model, Modifier.weight(1f).fillMaxHeight()); PlayKey(ui, model, Modifier.weight(1f).fillMaxHeight()) }
            Row(Modifier.fillMaxWidth().height(42.dp).screenSafe()) { BendStrip(ui, model, Modifier.weight(1f).fillMaxHeight()); PitchKey(ui, model, ux, Modifier.weight(1.6f).fillMaxHeight()) }
        }
        // Deck popups are confined to this deck's side: they never cover the mixer.
        AnimatedVisibility(model.pitchDrawer == ui.id, Modifier.align(Alignment.BottomCenter).padding(bottom = 40.dp), enter = fadeIn(tween(150)) + scaleIn(initialScale = .92f), exit = fadeOut(tween(120))) {
            PitchPopup(model, ux, Modifier.widthIn(max = 380.dp).fillMaxWidth())
        }
    }
}

/**
 * Two-finger pinch on a detail wave zooms both decks' waves (shared ux.waveSeconds, so beats line up),
 * anchored on the playhead; persisted on release. One finger is left alone.
 */
private fun Modifier.pinchZoom(ux: UiModel): Modifier = pointerInput(Unit) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false)
        var d0 = 0f; var s0 = ux.waveSeconds; var zooming = false
        while (true) {
            val event = awaitPointerEvent()
            val down = event.changes.filter { it.pressed }
            if (down.isEmpty()) break
            if (down.size >= 2) {
                val d = (down[0].position - down[1].position).getDistance()
                if (!zooming) { zooming = true; d0 = d; s0 = ux.waveSeconds }
                else if (d > 8f) ux.waveSeconds = (s0 * d0 / d).coerceIn(3.0, 48.0)
                down.forEach { it.consume() }
            } else if (zooming) { zooming = false; ux.chooseWaveSeconds(ux.waveSeconds) }
        }
        if (zooming) ux.chooseWaveSeconds(ux.waveSeconds)
    }
}

/**
 * One wall-clock timescale for every detail wave (desktop): a deck's track-time window = zoom × its tempo
 * rate (see tempoRate; bend excluded), so synced decks show equal beat spacing and scroll at the same px/s. The
 * playhead stays at a fixed fraction, so rate changes rescale around it without a jump.
 */
fun playbackRate(ui: DeckUi): Double {
    val s = ui.snapshot
    val pitch = s?.pitchPercent ?: ui.pitch; val bend = s?.bendPercent ?: ui.bend
    return ((1 + pitch / 100) * (1 + bend / 100)).coerceIn(.25, 4.0)
}

/** Tempo rate (fader / Sync) only — the waveform SCALE ignores momentary bend (#60); bend still moves position. */
fun tempoRate(ui: DeckUi): Double = (1 + (ui.snapshot?.pitchPercent ?: ui.pitch) / 100).coerceIn(.25, 4.0)
