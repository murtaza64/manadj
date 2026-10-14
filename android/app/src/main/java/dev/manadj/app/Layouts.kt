package dev.manadj.app

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
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
    // Engine starts with quantize off; push the persisted preference once it can take it.
    val canQuantize = model.supports("quantize")
    LaunchedEffect(canQuantize) { if (canQuantize) model.setQuantize(ux.quantize) }
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
    fun heard(now: Long): Double { if (now == 0L) return position(ui); val out = model.output; return if (out != null && ui.source?.id == ui.snapshot?.sourceId) out.audibleSeconds(ui.id, now) else position(ui) }
    WaveView(wave, { clock.at(frame.value, heard(frame.value), moving && frame.value != 0L, playbackRate(ui)) }, ui.durationSeconds, marksOf(ui), modifier.semantics { contentDescription = "${ui.id} detail wave" }.pinchZoom(ux),
        vertical = vertical, windowSeconds = ux.waveSeconds * playbackRate(ui), live = { ux.strip(ui) }, history = e.history, accent = deckColor(ui.id),
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
    val waveHeight = if (tight) 52.dp else 72.dp
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
                    FxSection(ux, model, Modifier.fillMaxWidth().weight(1f))
                    Crossfader(model, ux, Modifier.fillMaxWidth().height(48.dp))
                }
                ChannelFader(b, model, Modifier.width(54.dp).fillMaxHeight())
                KnobColumn(b, ux, model, Modifier.width(58.dp).fillMaxHeight())
            }
            // Minimaps flank the centre BROWSE + settings keys.
            Row(pad.fillMaxWidth().height(if (tight) 36.dp else 44.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Minimap(a, model, ux.waves[a.source?.id ?: ""], Modifier.weight(1f).fillMaxHeight())
                BrowseKey(model, ux, Modifier.width(72.dp).fillMaxHeight())
                Column(Modifier.width(36.dp).fillMaxHeight()) { QuantizeKey(model, ux, Modifier.fillMaxWidth().weight(1f)); SettingsKey(ux, Modifier.fillMaxWidth().weight(1f)) }
                Minimap(b, model, ux.waves[b.source?.id ?: ""], Modifier.weight(1f).fillMaxHeight())
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
 * mixer. The centre detail waves run from the top edge; deck popups stay over their own side.
 */
@Composable private fun Landscape(model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit, modifier: Modifier) {
    val a = model.decks.getValue(DeckId.A); val b = model.decks.getValue(DeckId.B)
    Row(modifier.padding(horizontal = 6.dp)) {
        DeckSide(a, model, ux, pick, Modifier.weight(1f).fillMaxHeight())
        Column(Modifier.width(372.dp).fillMaxHeight().padding(horizontal = DeckGap), verticalArrangement = Arrangement.spacedBy(6.dp)) {
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
}

@Composable private fun DeckSide(ui: DeckUi, model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit, modifier: Modifier) {
    Box(modifier) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            DeckInfo(ui, model, Modifier.fillMaxWidth().height(38.dp).screenSafe(), compact = true)
            Minimap(ui, model, ux.waves[ui.source?.id ?: ""], Modifier.fillMaxWidth().height(40.dp).screenSafe())
            Pads(ui, model, ux, Modifier.fillMaxWidth().weight(1f).screenSafe(), 4, Dp.Unspecified)
            StemsStrip(ui, ux, model, Modifier.fillMaxWidth().height(26.dp).screenSafe())
            LoopStrip(ui, ux, model, Modifier.fillMaxWidth().height(40.dp).screenSafe())
            JumpStrip(ui, ux, model, Modifier.fillMaxWidth().height(40.dp).screenSafe())
            Row(Modifier.fillMaxWidth().height(TransportRow).screenSafe()) { CueKey(ui, model, Modifier.weight(1f).fillMaxHeight()); PlayKey(ui, model, Modifier.weight(1f).fillMaxHeight()) }
            Row(Modifier.fillMaxWidth().height(42.dp).screenSafe()) { BendStrip(ui, model, Modifier.weight(1f).fillMaxHeight()); PitchKey(ui, model, ux, Modifier.weight(1.6f).fillMaxHeight()) }
        }
        // Deck popups are confined to this deck's side: they never cover the mixer.
        // The browser replaces this side's controls below the deck info (the centre waves stay visible).
        if (model.browser == ui.id) LibraryPanel(model, ux, Modifier.fillMaxSize().padding(top = 43.dp).background(Ink.background).screenSafe(), pick, tapTarget = other(ui.id))
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
 * One wall-clock timescale for every detail wave (desktop): a deck's track-time window = zoom × its actual
 * playback rate (tempo × bend), so synced decks show equal beat spacing and scroll at the same px/s. The
 * playhead stays at a fixed fraction, so rate changes rescale around it without a jump.
 */
fun playbackRate(ui: DeckUi): Double {
    val s = ui.snapshot
    val pitch = s?.pitchPercent ?: ui.pitch; val bend = s?.bendPercent ?: ui.bend
    return ((1 + pitch / 100) * (1 + bend / 100)).coerceIn(.25, 4.0)
}
