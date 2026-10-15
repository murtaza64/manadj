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
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.manadj.audio.AudioCommand
import dev.manadj.audio.DeckId
import dev.manadj.audio.QuantizeMode

/** Device orientation picks the layout: portrait one-screen, landscape dense. No manual view switch. */
@Composable fun PerformanceApp(model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit) {
    // Session recording (#395, session lane): always on while the app runs; re-points after recreation.
    val appContext = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(model) { dev.manadj.app.session.SessionRecording.attach(model, appContext) }
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
    LaunchedEffect(canQuantize) { if (canQuantize) ux.setQuantize(model) }
    // Played-this-session: a library deck that starts playing.
    // Snapshot reads here would recompose the whole app per engine tick (UH9): derived only.
    for (id in model.visibleDecks) {
        val playingTrack by remember(id) { derivedStateOf { if (model.decks.getValue(id).snapshot?.playing == true) dev.manadj.app.library.LibraryHolder.trackOn(model, id)?.toLong() else null } }
        LaunchedEffect(playingTrack) { val t = playingTrack; if (t != null && t !in ux.played) ux.played.add(t) }
    }
    // Record what was heard (strip per source position) so the waveform behind the playhead keeps it.
    val anyPlaying by remember { derivedStateOf { model.visibleDecks.any { model.decks.getValue(it).snapshot?.playing == true } } }
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
        dev.manadj.app.viz.VizBackdrop(model, ux, Modifier.fillMaxSize()) // visualizer spike (android-viz #394): Settings › Visualizer
        val band = with(LocalDensity.current) { screen.topBand.toDp() }
        val landscape = maxWidth > maxHeight
        val screenHeight = maxHeight
        val modal = model.replace != null || model.outputPanel
        val blur by animateDpAsState(if (modal) 8.dp else 0.dp, tween(220), label = "backdrop")
        Box(Modifier.fillMaxSize().blur(blur)) {
            // One-handed portrait spike (android-onehand): Settings › Layout picks a dev.manadj.app.onehand layout; STANDARD = this file's Portrait.
            if (landscape) Landscape(model, ux, pick, Modifier.fillMaxSize()) else if (dev.manadj.app.onehand.OneHand.layout(view.context) != dev.manadj.app.onehand.OneHandLayout.STANDARD) dev.manadj.app.onehand.OneHandApp(model, ux, pick, Modifier.fillMaxSize(), band) else Portrait(model, ux, pick, Modifier.fillMaxSize(), screenHeight, band)
        }
        if (model.outputPanel) OutputPanel(model, Modifier.fillMaxSize())
        if (ux.sessions) dev.manadj.app.session.SessionScreen(model, ux, Modifier.fillMaxSize().padding(top = band))
        dev.manadj.app.edit.TrackEditNav.request?.let { dev.manadj.app.edit.TrackEditScreen(model, ux, it, Modifier.fillMaxSize().padding(top = band)) }
        ReplaceDialog(model, ux)
        KnobPopupOverlay(ux)
        WheelOverlay(ux)
        Banners(model, ux, Modifier.align(Alignment.TopCenter).padding(top = maxOf(band, 44.dp)).widthIn(max = 520.dp).fillMaxWidth().padding(horizontal = 8.dp))
    }
    }
}

@Composable internal fun DetailWave(ui: DeckUi, model: PlayerModel, ux: UiModel, modifier: Modifier, vertical: Boolean = false) {
    val wave = ux.waves[ui.source?.id ?: ""]
    val e = ux.extras.getValue(ui.id)
    val moving = ui.snapshot.let { it?.playing == true || it?.previewing == true }
    val display = remember(ui.id) { HeardDisplay() }
    // Keep drawing through a stop's heard tail (HeardDisplay), then settle on the engine position.
    var tail by remember(ui.id) { mutableStateOf(false) }
    LaunchedEffect(moving) { if (!moving) { tail = true; repeat(3) { withFrameNanos { } }; while (display.inTail(System.nanoTime())) withFrameNanos { }; tail = false } }
    val frame = frameNanos(moving || tail)
    // Stem bank loaded: fetch the desktop stem waveforms for the masked composite.
    val stems by remember(ui) { derivedStateOf { ui.snapshot?.stems == true } }
    val track = if (stems) dev.manadj.app.library.LibraryHolder.trackOn(model, ui.id) else null
    LaunchedEffect(track, ui.source?.id) { val id = ui.source?.id; if (track != null && id != null) ux.ensureStemWaves(id, track) }
    // Display = heard time (#111.5): audibleSeconds backs off Android's reported latency; HEARD shifts the rest
    // (calibrated − reported) at the deck's speed. Sampled at System.nanoTime(), not the frame clock (#110).
    // Only read model.output while moving or in a stop tail: it changes every engine tick.
    // Heard display (#137/#138): HeardDisplay holds at the launch point until heard and draws the stop's tail.
    fun heard(now: Long): Double {
        ux.seekPreview[ui.id]?.let { return it }
        val rate = playbackRate(ui)
        val out = if (moving || tail) model.output else null
        if (out == null || ui.source?.id != ui.snapshot?.sourceId) return display.at(now, moving, { position(ui) }, position(ui), rate, 0.0)
        val reported = out.reportedLatencySeconds() ?: 0.0
        val extra = if (out.quantizeMode.heard) out.heardLatencySeconds - reported else 0.0
        return display.at(now, moving, { out.audibleSeconds(ui.id, now) - extra * rate }, position(ui), rate, reported + extra)
    }
    Box(modifier) {
    WaveView(wave, { frame.value; tail; heard(System.nanoTime()) }, ui.durationSeconds, marksOf(ui), Modifier.fillMaxSize().semantics { contentDescription = "${ui.id} detail wave" }.waveTouch(ui, model, ux, vertical),
        vertical = vertical, windowSeconds = ux.waveSeconds * tempoRate(ui), live = { ux.strip(ui) }, history = e.history, accent = deckColor(ui.id),
        stemWave = { mask -> val id = ui.source?.id; if (wave == null || id == null) null else ux.stemWave(id, wave, mask) },
        status = when { ui.source == null -> "${ui.id} · no track"; wave == null -> if (ux.waveSource[ui.source?.id] == "failed") "no waveform" else "analysing…"; !wave.complete -> "analysing ${(100 * wave.frames * wave.bandHop / wave.sampleRate / (ui.durationSeconds ?: 1.0)).toInt().coerceIn(0, 99)}%"; else -> null })
    // While browsing (#136): effective BPM + OpenKey on the wave's far edge (away from the playhead).
    if (model.browser != null && ui.source != null) DeckTempoKeyTag(ui, model, ux, vertical, Modifier.align(if (vertical) Alignment.BottomCenter else Alignment.TopEnd).padding(3.dp))
    }
}

/** Deck info in the camera band (A left of the hole, B right); each half dodges the hole and corner arcs. */
@Composable private fun TopBar(model: PlayerModel, modifier: Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(DeckGap)) {
        for (id in listOf(DeckId.A, DeckId.B)) Box(Modifier.weight(1f).fillMaxHeight()) {
            DeckInfo(model.decks.getValue(id), model, Modifier.align(Alignment.BottomStart).fillMaxWidth().height(44.dp).screenSafe())
        }
    }
}


/**
 * Portrait centre (#153): a 2-column grid of equal keys — QUANT·H / XF, SESSIONS / SETTINGS, SHIFT / BROWSE (UH24) — top-aligned, with the
 * FX card below at the bottom of the mixer (UH16); the space between is left free for future keys.
 */
@Composable private fun GlobalControls(model: PlayerModel, ux: UiModel, modifier: Modifier, gap: Dp) {
    val mode by remember { derivedStateOf { model.output?.quantizeMode ?: ux.quantizeMode } }
    val q = mode.quantized
    val h = Modifier.fillMaxWidth().height(40.dp)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(gap)) {
        Row(h, horizontalArrangement = Arrangement.spacedBy(gap)) {
            Key(if (mode.heard) "QUANT·H" else "QUANT", Modifier.weight(1f).fillMaxHeight(), Ink.accent, model.supports("quantize"), q, if (q) "Quantize on" else "Quantize off", style = KeyStyle.PILL, textSize = 11, longPress = { ux.setQuantize(model, heard = !ux.quantizeHeard) }) { ux.setQuantize(model, on = !q) }
            Key("XF", Modifier.weight(1f).fillMaxHeight(), Ink.accent, engaged = ux.crossfaderEnabled, description = "Crossfader enable", style = KeyStyle.PILL, textSize = 11) {
                ux.crossfaderEnabled = !ux.crossfaderEnabled
                if (!ux.crossfaderEnabled) model.updateCrossfade(.5)
            }
        }
        Row(h, horizontalArrangement = Arrangement.spacedBy(gap)) {
            SessionsKey(ux, Modifier.weight(1f).fillMaxHeight())
            SettingsKey(model, ux, Modifier.weight(1f).fillMaxHeight())
        }
        // UH24: SHIFT (both decks) + a second BROWSE in the centre cluster.
        Row(h, horizontalArrangement = Arrangement.spacedBy(gap)) {
            ShiftKey(listOf(DeckId.A, DeckId.B), ux, Modifier.weight(1f).fillMaxHeight())
            BrowseKey(model, ux, Modifier.weight(1f).fillMaxHeight(), textSize = 11)
        }
    }
}

/** Gear: Settings takes over like the browser (#396); lit while open. */
@Composable private fun SettingsKey(model: PlayerModel, ux: UiModel, modifier: Modifier) =
    Key("", modifier, if (ux.settings) Ink.accent else Ink.muted, engaged = ux.settings, description = "Settings", icon = Glyph.Gear, style = KeyStyle.PILL, textSize = 11) { ux.toggleSettings(model) }

/** Session replay (#153; moved out of Settings). */
@Composable private fun SessionsKey(ux: UiModel, modifier: Modifier, textSize: Int = 11) =
    Key("SESSIONS", modifier, Ink.accent, description = "Sessions replay", style = KeyStyle.PILL, textSize = textSize) { ux.sessions = true }

@Composable private fun QuantizeKey(model: PlayerModel, ux: UiModel, modifier: Modifier) {
    val mode by remember { derivedStateOf { model.output?.quantizeMode ?: ux.quantizeMode } }
    val on = mode.quantized
    Key(if (mode.heard) "Q·H" else "Q", modifier, Ink.accent, model.supports("quantize"), on, if (on) "Quantize on" else "Quantize off", style = KeyStyle.PILL, textSize = 12, longPress = { ux.setQuantize(model, heard = !ux.quantizeHeard) }) { ux.setQuantize(model, on = !on) }
}

/**
 * The one BROWSE button: swaps controls for the browser and back. `model.browser` = the deck whose controls
 * the browser covers — in landscape the outgoing deck (coveredDeck, decided once on open); portrait covers all.
 */
@Composable fun BrowseKey(model: PlayerModel, ux: UiModel, modifier: Modifier, textSize: Int = 12) {
    fun toggle() { ux.settings = false; model.browser = if (model.browser != null) null else coveredDeck(mixOf(model, ux, DeckId.A), mixOf(model, ux, DeckId.B)) }
    // Toggles on pointer-down (the slide starts with the press); the click only covers accessibility actions.
    var downToggled by remember { mutableStateOf(false) }
    Key("BROWSE", modifier.pointerInput(Unit) {
        awaitEachGesture { awaitFirstDown(requireUnconsumed = false, pass = androidx.compose.ui.input.pointer.PointerEventPass.Initial); downToggled = true; toggle()
            // A press that never clicks (dragged off) must not swallow the next accessibility click.
            do { val e = awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Final) } while (e.changes.any { it.pressed })
            downToggled = false
        }
    }, Ink.warning, engaged = model.browser != null, textSize = textSize, style = KeyStyle.PILL) { if (downToggled) downToggled = false else toggle() }
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
    val sheet = rememberBrowserSheet(model, ux)
    var sheetTop by remember { mutableIntStateOf(0) }
    Box(modifier.clipToBounds()) {
        Column(Modifier.fillMaxSize().browserSwipeUp(sheet), verticalArrangement = Arrangement.spacedBy(gap)) {
            TopBar(model, pad.fillMaxWidth().height(maxOf(band, 44.dp)))
            if (ux.outputDebug) Box(pad) { OutputLine(model) }
            Column((if (dev.manadj.app.viz.Glass.on) Modifier else pad).onGloballyPositioned { sheetTop = (it.positionInParent().y + it.size.height).toInt() }, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                for (ui in listOf(a, b)) DetailWave(ui, model, ux, Modifier.fillMaxWidth().height(waveHeight))
            }
            // UH21: the sheet pushes everything below the waves up and out (clipped under the waves) instead of
            // covering it. Body below kept at its old indentation so concurrent lane edits merge cleanly.
            Box(Modifier.fillMaxWidth().weight(1f).clipToBounds()) { Column(Modifier.fillMaxSize().graphicsLayer {
                val push = (sheet.height - sheet.offset).coerceIn(0f, sheet.height)
                translationY = -push; alpha = if (push >= size.height - 1f && push > 0f) 0f else 1f
            }, verticalArrangement = Arrangement.spacedBy(gap)) {
            Row(pad.fillMaxWidth().weight(1f)) {
                KnobColumn(a, ux, model, Modifier.width(58.dp).fillMaxHeight().then(dev.manadj.app.viz.Glass.softPanel()))
                ChannelFader(a, model, Modifier.width(54.dp).fillMaxHeight())
                Column(Modifier.weight(1f).fillMaxHeight().padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(gap)) {
                    // UH16: app keys on top; FX sits directly above the crossfader (or, XF off, directly above BROWSE).
                    GlobalControls(model, ux, Modifier.fillMaxWidth().weight(1f), gap)
                    FxSection(ux, model, Modifier.fillMaxWidth(), compact = true)
                    if (ux.crossfaderEnabled) Crossfader(model, ux, Modifier.fillMaxWidth().height(48.dp))
                }
                ChannelFader(b, model, Modifier.width(54.dp).fillMaxHeight())
                KnobColumn(b, ux, model, Modifier.width(58.dp).fillMaxHeight().then(dev.manadj.app.viz.Glass.softPanel()))
            }
            // Minimaps flank the centre BROWSE key (the #94 swap is landscape-only, #101).
            Row((if (dev.manadj.app.viz.Glass.on) Modifier else pad).fillMaxWidth().height(if (tight) 36.dp else 44.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Minimap(a, model, ux.waves[a.source?.id ?: ""], Modifier.weight(1f).fillMaxHeight(), preview = ux.seekPreview, ux = ux, compactCues = true)
                // UH24: BROWSE moved to the stems strip's outer edges and the centre cluster; the link key (#398) sits here.
                LinkKey(model, ux, Modifier.width(84.dp).fillMaxHeight())
                Minimap(b, model, ux.waves[b.source?.id ?: ""], Modifier.weight(1f).fillMaxHeight(), preview = ux.seekPreview, ux = ux, compactCues = true)
            }
            // Deck control areas; the pitch panel replaces one deck's half in place (#105).
            Box(Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(gap)) {
                    Row(pad.fillMaxWidth().height(28.dp), horizontalArrangement = Arrangement.spacedBy(DeckGap)) { for (ui in listOf(a, b)) StemsStrip(ui, ux, model, Modifier.weight(1f).fillMaxHeight().underPitchPanel(model, ui.id)) { m -> BrowseKey(model, ux, m, textSize = 10) } }
                    Row(pad.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(DeckGap)) { for (ui in listOf(a, b)) Pads(ui, model, ux, Modifier.weight(1f).underPitchPanel(model, ui.id), 4, if (tight) 46.dp else PadRow) }
                    Row(pad.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(DeckGap)) {
                        for (ui in listOf(a, b)) Column(Modifier.weight(1f).underPitchPanel(model, ui.id), verticalArrangement = Arrangement.spacedBy(gap)) {
                            LoopStrip(ui, ux, model, Modifier.fillMaxWidth().height(ControlRow).screenSafe())
                            JumpStrip(ui, ux, model, Modifier.fillMaxWidth().height(ControlRow).screenSafe())
                            Row(Modifier.fillMaxWidth().height(TransportRow).screenSafe()) { CueKey(ui, model, Modifier.weight(1f).fillMaxHeight(), ux); PlayKey(ui, model, Modifier.weight(1f).fillMaxHeight(), ux) }
                            BendStrip(ui, model, Modifier.fillMaxWidth().height(ControlRow).screenSafe())
                            PitchKey(ui, model, ux, Modifier.fillMaxWidth().height(40.dp).screenSafe())
                        }
                    }
                }
                Row(Modifier.matchParentSize().then(pad), horizontalArrangement = Arrangement.spacedBy(DeckGap)) {
                    for (id in listOf(DeckId.A, DeckId.B)) Box(Modifier.weight(1f).fillMaxHeight()) { PitchArea(model, ux, id, Modifier.fillMaxSize()) }
                }
            }
            } } // UH21 push wrapper
        }
        // The browser sheet takes everything below the waves (CUE/PLAY row at its foot); translate-only (#132).
        val topDp = with(LocalDensity.current) { sheetTop.toDp() }
        BrowserSheet(sheet, Modifier.fillMaxSize().padding(top = topDp)) {
            Column(Modifier.fillMaxSize().then(dev.manadj.app.viz.Glass.sheet(Ink.background))) {
                // Grabber (UH14): the sheet swipes down to dismiss.
                Box(Modifier.fillMaxWidth().height(16.dp).semantics { contentDescription = "Drag down to close browser" }, contentAlignment = Alignment.Center) {
                    Box(Modifier.size(40.dp, 4.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(50)).background(Ink.muted.copy(alpha = .7f)))
                }
                LibraryPanel(model, ux, Modifier.fillMaxWidth().weight(1f), pick, tapTarget = null)
                Row(pad.fillMaxWidth().height(TransportRow).screenSafe(), horizontalArrangement = Arrangement.spacedBy(DeckGap)) {
                    for (ui in listOf(a, b)) Row(Modifier.weight(1f).fillMaxHeight()) { CueKey(ui, model, Modifier.weight(1f).fillMaxHeight(), ux); PlayKey(ui, model, Modifier.weight(1f).fillMaxHeight(), ux) }
                }
            }
        }
        // Settings (#396) takes the browser's place: everything below the waves.
        val settle = spring<androidx.compose.ui.unit.IntOffset>(dampingRatio = 1f, stiffness = 900f)
        AnimatedVisibility(ux.settings, Modifier.fillMaxSize().padding(top = topDp), enter = slideInVertically(settle) { it }, exit = slideOutVertically(settle) { it }) {
            SettingsPanel(model, ux, Modifier.fillMaxSize().padding(top = 3.dp))
        }
    }
}

/** The in-place pitch panel over [id]'s control area: opens/closes with a short rigid fade + slide. */
@Composable private fun PitchArea(model: PlayerModel, ux: UiModel, id: DeckId, modifier: Modifier) {
    // #400: slides up from the bottom edge of the deck's control area (clipped there) and replaces the controls.
    AnimatedVisibility(model.pitchDrawer == id, modifier.clipToBounds(), enter = slideInVertically(tween(240, easing = FastOutSlowInEasing)) { it } + fadeIn(tween(140)),
        exit = slideOutVertically(tween(200, easing = FastOutSlowInEasing)) { it } + fadeOut(tween(160, delayMillis = 40))) {
        PitchPanel(model.decks.getValue(id), model, ux, Modifier.fillMaxSize())
    }
}

/** Where the landscape browser pane sits: beside one deck (slot) or over both decks from a fixed side. */
private enum class PaneKind { LEFT_SLOT, RIGHT_SLOT, BOTH_LEFT, BOTH_RIGHT }

/**
 * Landscape: each deck's side (info, minimap, pads, stems, loop, jump, transport, bend + pitch) flanks the
 * mixer. BROWSE slides the whole strip sideways (#65): the strip is [A][mixer][B], centred, with a browser pane
 * entering from an edge. Settings › Browse beside ([BrowseBeside]): LOADING keeps the load target beside the
 * browser, PLAYING keeps the outgoing deck, BOTH moves the mixer to the far edge and the pane covers both decks.
 * Rigid: everything is laid out once at full size and only translated (graphicsLayer); the pane stays composed
 * after its first open, and screenSafe insets are computed at rest ([LocalSafeFrame]) — no relayout mid-slide.
 */
@Composable private fun Landscape(model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit, modifier: Modifier) {
    val a = model.decks.getValue(DeckId.A); val b = model.decks.getValue(DeckId.B)
    BoxWithConstraints(modifier.clipToBounds()) {
        val mixerWidth = 372.dp
        val screen = maxWidth
        val side = (screen - mixerWidth - 12.dp) / 2
        val bothWidth = side * 2 + 6.dp
        val density = LocalDensity.current
        val sidePx = with(density) { side.toPx() }
        val screenPx = with(density) { screen.toPx() }
        val bothPx = with(density) { bothWidth.toPx() }
        val targetDeck = model.browser?.let(::other)
        val kind = when {
            model.browser == null -> null
            ux.browseBeside == BrowseBeside.BOTH -> if (ux.browseBothRight) PaneKind.BOTH_RIGHT else PaneKind.BOTH_LEFT
            // The deck kept on screen: the loading target or the outgoing (playing) deck; the pane sits on its outer side.
            (if (ux.browseBeside == BrowseBeside.LOADING) targetDeck else model.browser) == DeckId.A -> PaneKind.LEFT_SLOT
            else -> PaneKind.RIGHT_SLOT
        }
        // Strip translation at rest per kind: browser left → strip right (+side), browser right → strip left.
        fun goalOf(k: PaneKind?) = when (k) { PaneKind.LEFT_SLOT, PaneKind.BOTH_LEFT -> sidePx; PaneKind.RIGHT_SLOT, PaneKind.BOTH_RIGHT -> -sidePx; null -> 0f }
        // Pane translation for strip shift [s]: slots ride with the strip; the wide pane travels its own width
        // over the same slide (off-screen at s = 0, flush against the mixer at rest).
        fun paneX(k: PaneKind, s: Float) = when (k) {
            PaneKind.LEFT_SLOT -> s - sidePx
            PaneKind.RIGHT_SLOT -> s + screenPx
            PaneKind.BOTH_LEFT -> (s - sidePx) * bothPx / sidePx
            PaneKind.BOTH_RIGHT -> screenPx - bothPx + (s + sidePx) * bothPx / sidePx
        }
        // Settings (#396) takes the wide browser's place: the mixer slides to the right edge, settings covers both decks.
        val stripKind = if (ux.settings) PaneKind.BOTH_LEFT else kind
        val shift = remember { androidx.compose.animation.core.Animatable(0f) }
        LaunchedEffect(stripKind, sidePx) { shift.animateTo(goalOf(stripKind), androidx.compose.animation.core.spring(dampingRatio = 1f, stiffness = 1200f)) }
        // The pane keeps its kind/target while sliding out; composed once opened, then kept (no build on press).
        var pane by remember { mutableStateOf<PaneKind?>(null) }
        var paneTarget by remember { mutableStateOf<DeckId?>(null) }
        LaunchedEffect(kind, targetDeck) { if (kind != null) { pane = kind; paneTarget = if (kind == PaneKind.BOTH_LEFT || kind == PaneKind.BOTH_RIGHT) null else targetDeck } }
        // UH21: the wide pane's covered deck fades out as the pane slides over it (slot panes push the deck off-screen).
        fun covered(id: DeckId) = when {
            id == DeckId.A && pane == PaneKind.BOTH_LEFT -> (shift.value / sidePx).coerceIn(0f, 1f)
            id == DeckId.B && pane == PaneKind.BOTH_RIGHT -> (-shift.value / sidePx).coerceIn(0f, 1f)
            else -> 0f
        }
        val stripFrame = remember(shift) { SafeFrame { shift.value } }
        CompositionLocalProvider(LocalSafeFrame provides stripFrame) {
            Row(Modifier.width(screen).fillMaxHeight().graphicsLayer { translationX = shift.value }.padding(horizontal = 6.dp)) {
                DeckSide(a, model, ux, pick, Modifier.weight(1f).fillMaxHeight().graphicsLayer { alpha = 1f - covered(DeckId.A) })
                // XF off (UH13): the waves leave the knob/fader row and run the full mixer height to the screen edge,
                // under the XF row (crossfader slot left empty) and the FX card (scrimmed for legibility).
                val xf = ux.crossfaderEnabled
                Box(Modifier.width(mixerWidth).fillMaxHeight().padding(horizontal = DeckGap)) {
                    @Composable fun Waves(m: Modifier) = Row(m, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                        for (ui in listOf(a, b)) DetailWave(ui, model, ux, Modifier.weight(1f).fillMaxHeight(), vertical = true)
                    }
                    if (!xf) Waves(Modifier.fillMaxHeight().fillMaxWidth().padding(horizontal = 54.dp + 48.dp + 3.dp))
                    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(Modifier.fillMaxWidth().weight(1f)) {
                            KnobColumn(a, ux, model, Modifier.width(54.dp).fillMaxHeight().then(dev.manadj.app.viz.Glass.softPanel()).padding(top = 4.dp), 34.dp)
                            ChannelFader(a, model, Modifier.width(48.dp).fillMaxHeight())
                            if (xf) Waves(Modifier.weight(1f).fillMaxHeight().padding(horizontal = 3.dp)) else Spacer(Modifier.weight(1f))
                            ChannelFader(b, model, Modifier.width(48.dp).fillMaxHeight())
                            KnobColumn(b, ux, model, Modifier.width(54.dp).fillMaxHeight().then(dev.manadj.app.viz.Glass.softPanel()).padding(top = 4.dp), 34.dp)
                        }
                        // Symmetric flanks keep the crossfader centred at full width (#153): two stacked equal keys each,
                        // Q·H over settings left, SESSIONS over BROWSE right (#94 swap).
                        Row(Modifier.fillMaxWidth().height(80.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            val key = Modifier.width(76.dp).height(36.dp)
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                QuantizeKey(model, ux, key)
                                SettingsKey(model, ux, key)
                            }
                            // Link toggle (#398) centred over the crossfader.
                            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                LinkKey(model, ux, Modifier.width(96.dp).height(32.dp), textSize = 10)
                                if (xf) Crossfader(model, ux, Modifier.fillMaxWidth().height(44.dp))
                            }
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                SessionsKey(ux, key, textSize = 10)
                                BrowseKey(model, ux, key)
                            }
                        }
                        FxSection(ux, model, Modifier.fillMaxWidth().height(54.dp).padding(bottom = 4.dp)
                            .then(if (xf) Modifier else Modifier.background(Ink.background.copy(alpha = .82f), androidx.compose.foundation.shape.RoundedCornerShape(10.dp))), horizontal = true)
                    }
                }
                DeckSide(b, model, ux, pick, Modifier.weight(1f).fillMaxHeight().graphicsLayer { alpha = 1f - covered(DeckId.B) })
            }
        }
        val k = pane
        if (k != null) {
            val wide = k == PaneKind.BOTH_LEFT || k == PaneKind.BOTH_RIGHT
            val left = k == PaneKind.LEFT_SLOT || k == PaneKind.BOTH_LEFT
            val rest = paneX(k, goalOf(k))
            val paneFrame = remember(shift, k, sidePx, screenPx) { SafeFrame { paneX(k, shift.value) - rest } }
            CompositionLocalProvider(LocalSafeFrame provides paneFrame) {
                Box(Modifier.width(if (wide) bothWidth else side).fillMaxHeight().graphicsLayer { translationX = paneX(k, shift.value) }.then(dev.manadj.app.viz.Glass.sheet(Ink.background))) {
                    LibraryPanel(model, ux, Modifier.fillMaxSize().padding(start = if (left) 6.dp else 0.dp, end = if (left) 0.dp else 6.dp).screenSafe(), pick, tapTarget = paneTarget, sidebar = true)
                }
            }
        }
        // Composed while open or still sliding out.
        val settingsShown by remember(sidePx, bothPx) { derivedStateOf { ux.settings || paneX(PaneKind.BOTH_LEFT, shift.value) > -bothPx + 1f } }
        if (settingsShown) {
            val rest = paneX(PaneKind.BOTH_LEFT, goalOf(PaneKind.BOTH_LEFT))
            val settingsFrame = remember(shift, sidePx, bothPx) { SafeFrame { paneX(PaneKind.BOTH_LEFT, shift.value) - rest } }
            CompositionLocalProvider(LocalSafeFrame provides settingsFrame) {
                Box(Modifier.width(bothWidth).fillMaxHeight().graphicsLayer { translationX = paneX(PaneKind.BOTH_LEFT, shift.value) }.background(Ink.background)) {
                    SettingsPanel(model, ux, Modifier.fillMaxSize().padding(start = 6.dp).screenSafe())
                }
            }
        }
    }
}

@Composable private fun DeckSide(ui: DeckUi, model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit, modifier: Modifier) {
    Box(modifier) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            // Mirrored toward the mixer (UH1): A right-aligned, B left-aligned.
            CompositionLocalProvider(androidx.compose.ui.platform.LocalLayoutDirection provides if (ui.id == DeckId.A) androidx.compose.ui.unit.LayoutDirection.Rtl else androidx.compose.ui.unit.LayoutDirection.Ltr) {
                DeckInfo(ui, model, Modifier.fillMaxWidth().height(38.dp).screenSafe(), compact = true)
            }
            Minimap(ui, model, ux.waves[ui.source?.id ?: ""], Modifier.fillMaxWidth().height(40.dp).screenSafe(), preview = ux.seekPreview, ux = ux)
            // #400: everything below the minimap fades out while the pitch panel slides up over it.
            Column(Modifier.fillMaxWidth().weight(1f).underPitchPanel(model, ui.id), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            // Pads stay identical; the camera hole simply obscures part of one (touch still works around it).
            Pads(ui, model, ux, Modifier.fillMaxWidth().weight(1f), 4, Dp.Unspecified)
            // SHIFT keeps its mirrored outer-edge spot in both rotations (#147): no camera-hole dodge here.
            StemsStrip(ui, ux, model, Modifier.fillMaxWidth().height(26.dp))
            LoopStrip(ui, ux, model, Modifier.fillMaxWidth().height(40.dp).screenSafe())
            JumpStrip(ui, ux, model, Modifier.fillMaxWidth().height(40.dp).screenSafe())
            Row(Modifier.fillMaxWidth().height(TransportRow).screenSafe()) { CueKey(ui, model, Modifier.weight(1f).fillMaxHeight(), ux); PlayKey(ui, model, Modifier.weight(1f).fillMaxHeight(), ux) }
            Row(Modifier.fillMaxWidth().height(42.dp).screenSafe()) { BendStrip(ui, model, Modifier.weight(1f).fillMaxHeight()); PitchKey(ui, model, ux, Modifier.weight(1.6f).fillMaxHeight()) }
            }
        }
        // The pitch panel replaces this deck's controls below info + minimap (#105); the mixer and other deck stay.
        PitchArea(model, ux, ui.id, Modifier.fillMaxSize().padding(top = 88.dp).screenSafe())
    }
}

/**
 * Detail-wave touch (#35/#67/#107). One finger: with VINYL on (or the deck paused — same rule as the scratch
 * surface) it scratches; otherwise it scrubs like desktop (WebGLWaveform drag): a playing deck pauses, the
 * content follows the finger (drag toward the past = later), the seek lands on release and playback resumes.
 * A second finger cancels the one-finger action where it stands and pinches the shared zoom from its first
 * frame (no threshold), both decks, persisted on release.
 */
private fun Modifier.waveTouch(ui: DeckUi, model: PlayerModel, ux: UiModel, vertical: Boolean): Modifier = pointerInput(ui.id, vertical) {
    awaitEachGesture {
        val first = awaitFirstDown(requireUnconsumed = false)
        first.consume() // the wave owns its touches (no browser swipe-up from a wave, #132)
        val playing = ui.snapshot?.playing == true
        val scratchMode = model.supports("scratch") && ui.ready && (ux.vinyl[ui.id] == true || !playing)
        val canScrub = ui.ready && model.supports("seek")
        var scratching = false
        var scrubbing = false; var resume = false; var scrubFrom = 0.0; var scrubTo = 0.0
        var last = first.position
        var d0 = 0f; var s0 = ux.waveSeconds; var zooming = false
        val along = if (vertical) size.height else size.width
        fun endScratch() { if (scratching) { scratching = false; model.scratchEnd(ui.id) } }
        fun endScrub(commit: Boolean) {
            if (!scrubbing) return
            scrubbing = false
            if (commit) model.submit(AudioCommand.Seek(ui.id, scrubTo))
            if (resume) model.submit(AudioCommand.Play(ui.id))
            ux.seekPreview.remove(ui.id)
        }
        try {
            while (true) {
                val event = awaitPointerEvent()
                val down = event.changes.filter { it.pressed }
                if (down.isEmpty()) break
                if (down.size >= 2) {
                    endScratch(); endScrub(commit = false)
                    val d = (down[0].position - down[1].position).getDistance()
                    if (!zooming) { zooming = true; d0 = d.coerceAtLeast(1f); s0 = ux.waveSeconds }
                    else ux.waveSeconds = (s0 * d0 / d.coerceAtLeast(1f)).coerceIn(WAVE_MIN_SECONDS, WAVE_MAX_SECONDS)
                    down.forEach { it.consume() }
                } else if (!zooming) {
                    val c = down.firstOrNull { it.id == first.id } ?: continue
                    val delta = c.position - last; last = c.position
                    val px = if (vertical) delta.y else delta.x
                    // Content moving toward the past = track advances.
                    val seconds = -px / along * ux.waveSeconds * tempoRate(ui)
                    if (scratchMode) {
                        if (!scratching && px != 0f) { scratching = true; model.scratchBegin(ui.id) }
                        if (scratching) model.scratchMove(ui.id, seconds)
                    } else if (canScrub && px != 0f) {
                        if (!scrubbing) {
                            scrubbing = true; scrubFrom = position(ui); scrubTo = scrubFrom
                            resume = ui.snapshot?.playing == true
                            if (resume) model.submit(AudioCommand.Pause(ui.id))
                        }
                        scrubTo = (scrubTo + seconds).coerceIn(-dev.manadj.audio.AudioEngine.MAX_LEAD_IN_SECONDS, ui.durationSeconds ?: Double.MAX_VALUE)
                        ux.seekPreview[ui.id] = scrubTo
                    }
                    c.consume()
                }
            }
            endScrub(commit = true)
        } finally { endScratch(); endScrub(commit = false); if (zooming) ux.chooseWaveSeconds(ux.waveSeconds) }
    }
}

/** Detail-wave zoom range (window seconds): 4x the previous zoom-in (#107, ~1 ms/px on a phone). */
const val WAVE_MIN_SECONDS = .75
const val WAVE_MAX_SECONDS = 48.0

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
