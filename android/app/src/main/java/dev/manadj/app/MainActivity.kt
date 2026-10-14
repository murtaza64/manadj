package dev.manadj.app

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.view.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import dev.manadj.audio.*
import kotlinx.coroutines.CancellationException

class MainActivity : ComponentActivity() {
    private val model by viewModels<PlayerModel>()
    private val picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> model.pickerResult(uri) }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.attributes = window.attributes.apply { layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES }
        immerse()
        setContent {
            BackHandler(model.browser != null || model.pitchDrawer != null || model.replace != null || model.outputPanel) { model.browser = null; model.pitchDrawer = null; model.replace = null; model.outputPanel = false }
            PerformanceApp(model) { deck -> model.pickerTarget = deck; picker.launch(arrayOf("audio/*")) }
        }
    }
    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) immerse() }
    override fun onPause() { model.cancelGestures(); super.onPause() }
    private fun immerse() { WindowInsetsControllerCompat(window, window.decorView).apply { systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE; hide(WindowInsetsCompat.Type.systemBars()) } }
}

/** Honest source-time ruler until matching analysis exists; it never manufactures audio amplitudes. */
@Composable private fun SourceRuler(ui: DeckUi, model: PlayerModel, modifier: Modifier, detail: Boolean = false, vertical: Boolean = false) {
    val ready by remember(ui) { derivedStateOf { ui.ready } }
    val currentReady by rememberUpdatedState(ready)
    var seekPreview by remember(ui.id) { mutableStateOf<Double?>(null) }
    Box(modifier.background(Ink.background).clipToBounds().semantics { contentDescription = "${ui.id} ${if (detail) "source detail" else "seek ruler"}" }.pointerInput(ui.id, detail, vertical) {
        if (detail) return@pointerInput // Signed PCM scratch is not implemented by this engine slice.
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val duration = ui.durationSeconds
            if (!currentReady || duration == null || duration <= 0) return@awaitEachGesture
            val id = model.beginGesture(ui.id, "SEEK") { seekPreview = null }
            fun preview(at: Float) { seekPreview = (at / size.width * duration).coerceIn(0.0, duration) }
            preview(down.position.x); down.consume()
            var cancelled = false
            try {
                while (true) {
                    val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                    if (change == null || (!change.pressed && change.isConsumed)) { cancelled = true; break }
                    if (!change.pressed || !model.gestureActive(id)) break
                    preview(change.position.x); change.consume()
                }
                if (!cancelled && model.gestureActive(id)) seekPreview?.let { model.submit(AudioCommand.Seek(ui.id, it, id)) }
            } catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { seekPreview = null; model.finishGesture(id, cancelled) }
        }
    }) {
        Canvas(Modifier.fillMaxSize()) {
            val position = if (ui.source?.id == ui.snapshot?.sourceId) ui.snapshot?.sourceSeconds ?: 0.0 else 0.0
            val duration = ui.durationSeconds ?: 0.0
            val axis = if (vertical) size.height else size.width
            val start = if (detail) position - 5 else 0.0
            val span = if (detail) 20.0 else duration.coerceAtLeast(1.0)
            val at = (((seekPreview ?: position) - start) / span * axis).toFloat().coerceIn(0f, axis)
            if (detail) {
                for (step in 0..10) {
                    val tick = step * axis / 10
                    drawLine(Ink.edge, if (vertical) Offset(0f, tick) else Offset(tick, 0f), if (vertical) Offset(size.width, tick) else Offset(tick, size.height), 1f)
                }
            } else drawRect(deckColor(ui.id).copy(alpha = .15f), size = Size(at, size.height))
            drawLine(Ink.playhead, if (vertical) Offset(0f, at) else Offset(at, 0f), if (vertical) Offset(size.width, at) else Offset(at, size.height), 3.dp.toPx())
            ui.hotCues.forEachIndexed { index, seconds -> seconds?.let { cue ->
                val p = ((cue - start) / span * axis).toFloat()
                if (p in 0f..axis) drawLine(Ink.cues[index], if (vertical) Offset(0f, p) else Offset(p, 0f), if (vertical) Offset(size.width, p) else Offset(p, size.height), 2.dp.toPx())
            } }
        }
        Text(if (seekPreview != null) "Seek ${clock(seekPreview!!)}" else if (detail) "Analysis\npending" else "Waveform pending", Modifier.align(Alignment.Center).background(Color.Black.copy(alpha = .7f)).padding(2.dp), Ink.muted, 10, lines = if (detail) 2 else 1)
    }
}

@Composable private fun SourceHeader(ui: DeckUi, model: PlayerModel, modifier: Modifier, dense: Boolean = false, navigation: Boolean = false) {
    val time by remember(ui) { derivedStateOf { clock(if (ui.source?.id == ui.snapshot?.sourceId) ui.snapshot?.sourceSeconds ?: 0.0 else 0.0) } }
    val status by remember(ui) { derivedStateOf { when {
        ui.importing -> "Opening document"
        ui.error != null -> ui.error!!
        ui.snapshot?.loadState == LoadState.ERROR -> ui.snapshot?.error ?: "Decode failed"
        ui.snapshot?.loadState == LoadState.LOADING -> "Decoding…"
        ui.ready && ui.snapshot?.atEnd == true && ui.snapshot?.playing != true -> "END"
        ui.ready && ui.snapshot?.filling == true -> "Buffering…"
        ui.ready -> if (ui.source?.persistentGrant == true) "LOCAL" else "SESSION URI"
        else -> "Choose a track"
    } } }
    Column(modifier.border(2.dp, deckColor(ui.id).copy(alpha = if (model.selected == ui.id) 1f else .35f))) {
        Column(Modifier.fillMaxWidth().height(if (dense) 24.dp else 40.dp).clickable { model.chooseDeck(ui.id) }.semantics { contentDescription = "Select ${ui.id}" }.padding(horizontal = 4.dp)) {
            if (dense) Row(Modifier.fillMaxWidth()) { if (navigation) Key(Layout.DENSE.label, Modifier.width(40.dp).fillMaxHeight(), description = "Layout ${Layout.DENSE.label}, switch") { model.chooseLayout(Layout.PORTRAIT) }; Text("${ui.id} ${ui.source?.title ?: "Load a track"}", Modifier.weight(1f), deckColor(ui.id), 13, true); Text(time, size = 12) }
            else { Text("${ui.id} ${ui.source?.title ?: "Load a track"}", color = deckColor(ui.id), size = 14, bold = true); Text("$time · $status", color = if (ui.error != null || ui.snapshot?.loadState == LoadState.ERROR) Ink.warning else Ink.muted, size = 11) }
        }
        SourceRuler(ui, model, Modifier.weight(1f).fillMaxWidth())
    }
}

@Composable private fun PlayKey(ui: DeckUi, model: PlayerModel, modifier: Modifier) {
    val playing by remember(ui) { derivedStateOf { ui.snapshot?.playing == true } }
    val ready by remember(ui) { derivedStateOf { ui.ready } }
    Key("${ui.id} ${if (playing) "Ⅱ" else "▶"}", modifier, Ink.play, ready || playing, playing, "${ui.id} play pause") { model.submit(if (playing) AudioCommand.Pause(ui.id) else AudioCommand.Play(ui.id)) }
}

@Composable private fun Transport(ui: DeckUi, model: PlayerModel, modifier: Modifier) {
    val ready by remember(ui) { derivedStateOf { ui.ready } }
    Column(modifier) {
        Row(Modifier.fillMaxWidth().height(48.dp)) {
            Key("−5s", Modifier.width(48.dp).fillMaxHeight(), deckColor(ui.id), ready, description = "${ui.id} seek backward") { model.submit(AudioCommand.Seek(ui.id, ((ui.snapshot?.sourceSeconds ?: 0.0) - 5).coerceAtLeast(0.0))) }
            Key("${"%+.1f".format(ui.pitch)}%", Modifier.weight(1f).fillMaxHeight(), deckColor(ui.id), model.supports("varispeed"), description = "${ui.id} pitch panel") { model.pitchDrawer = ui.id }
            Key("+5s", Modifier.width(48.dp).fillMaxHeight(), deckColor(ui.id), ready, description = "${ui.id} seek forward") { model.submit(AudioCommand.Seek(ui.id, ((ui.snapshot?.sourceSeconds ?: 0.0) + 5).coerceAtMost(ui.durationSeconds ?: Double.MAX_VALUE))) }
        }
        Row(Modifier.fillMaxWidth().weight(1f)) {
            CueKey(ui, model, Modifier.weight(1f).fillMaxHeight())
            PlayKey(ui, model, Modifier.weight(1f).fillMaxHeight())
            Key("LOAD", Modifier.width(48.dp).fillMaxHeight(), Ink.warning, description = "${ui.id} load") { model.browser = ui.id }
        }
    }
}

@Composable private fun Pads(ui: DeckUi, model: PlayerModel, modifier: Modifier, columns: Int = 4) {
    Column(modifier.border(2.dp, deckColor(ui.id))) { repeat(8 / columns) { row -> Row(Modifier.weight(1f).fillMaxWidth()) { repeat(columns) { col -> Hotcue(ui, row * columns + col, model, Modifier.weight(1f).fillMaxHeight()) } } } }
}

@Composable private fun Pending(text: String, modifier: Modifier) { Box(modifier.background(Ink.panel).border(1.dp, Ink.edge).semantics { contentDescription = "$text unavailable"; disabled() }, contentAlignment = Alignment.Center) { Text(text, color = Ink.muted, size = 10, lines = 3) } }
@Composable private fun Channel(ui: DeckUi, model: PlayerModel, modifier: Modifier, mirrored: Boolean = false) {
    Row(modifier) {
        if (mirrored) PhysicalFader("VOL", ui.fader, model, ui.id, Modifier.width(48.dp).fillMaxHeight(), model.supports("fader")) { value, id -> model.updateFader(ui.id, value, id) }
        Column(Modifier.width(48.dp).fillMaxHeight()) {
            TrimKnob(ui, model, Modifier.fillMaxWidth().height(48.dp))
            Key("CUE", Modifier.fillMaxWidth().height(40.dp), deckColor(ui.id), model.supports("pfl"), ui.snapshot?.pfl == true, "${ui.id} headphone cue") { model.togglePfl(ui.id) }
            Pending("EQ /\nFILTER\nPENDING", Modifier.weight(1f).fillMaxWidth())
        }
        if (!mirrored) PhysicalFader("VOL", ui.fader, model, ui.id, Modifier.width(48.dp).fillMaxHeight(), model.supports("fader")) { value, id -> model.updateFader(ui.id, value, id) }
    }
}

@Composable private fun Mixer(model: PlayerModel, modifier: Modifier, detail: Boolean = false) {
    Column(modifier) {
        Row(Modifier.weight(1f).fillMaxWidth()) {
            Channel(model.decks.getValue(DeckId.A), model, Modifier.width(96.dp).fillMaxHeight())
            if (detail) SourceRuler(model.decks.getValue(model.selected), model, Modifier.weight(1f).fillMaxHeight(), detail = true)
            else Pending("ONE SHARED MIXER\nBEAT FX PENDING", Modifier.weight(1f).fillMaxHeight())
            Channel(model.decks.getValue(DeckId.B), model, Modifier.width(96.dp).fillMaxHeight(), true)
        }
        PhysicalFader("XF", model.crossfade, model, DeckId.A, Modifier.fillMaxWidth().height(48.dp), model.supports("crossfade"), true) { value, id -> model.updateCrossfade(value, id) }
    }
}

@Composable private fun Workspace(model: PlayerModel, modifier: Modifier, landscape: Boolean) {
    Column(modifier) {
        Row(Modifier.fillMaxWidth().height(48.dp)) { for (tab in listOf("PADS", "MIX")) Key(tab, Modifier.weight(1f).fillMaxHeight(), engaged = model.workspace == tab) { model.workspace = tab }; Pending("BEAT FX\nPENDING", Modifier.weight(1f).fillMaxHeight()) }
        if (model.workspace == "MIX") Mixer(model, Modifier.weight(1f).fillMaxWidth())
        else Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (id in model.visibleDecks) Column(Modifier.weight(1f).fillMaxHeight()) { Pads(model.decks.getValue(id), model, Modifier.weight(1f).fillMaxWidth(), if (landscape) 4 else 2); if (!landscape) Pending("BEAT JUMPS / LOOPS · GRID PENDING", Modifier.fillMaxWidth().height(48.dp)) }
        }
    }
}

@Composable private fun Dense(model: PlayerModel, modifier: Modifier) {
    Row(modifier) {
        for (part in 0..2) {
            if (part == 1) Column(Modifier.width(312.dp).fillMaxHeight().padding(horizontal = 4.dp)) {
                Row(Modifier.weight(1f).fillMaxWidth()) {
                    Channel(model.decks.getValue(DeckId.A), model, Modifier.width(96.dp).fillMaxHeight())
                    Column(Modifier.weight(1f).fillMaxHeight()) {
                        Row(Modifier.weight(1f).fillMaxWidth()) { for (id in model.visibleDecks) SourceRuler(model.decks.getValue(id), model, Modifier.weight(1f).fillMaxHeight(), detail = true, vertical = true) }
                        PhysicalFader("XF", model.crossfade, model, DeckId.A, Modifier.fillMaxWidth().height(48.dp), model.supports("crossfade"), true) { value, id -> model.updateCrossfade(value, id) }
                    }
                    Channel(model.decks.getValue(DeckId.B), model, Modifier.width(96.dp).fillMaxHeight(), true)
                }
                Pending("CENTRAL BEAT FX · DSP PENDING", Modifier.fillMaxWidth().height(48.dp))
            } else {
                val ui = model.decks.getValue(if (part == 0) DeckId.A else DeckId.B)
                Column(Modifier.weight(1f).fillMaxHeight()) { Pads(ui, model, Modifier.weight(1f).fillMaxWidth()); Pending("LOOP / GRID PENDING", Modifier.fillMaxWidth().height(48.dp)); Bend(ui, model, Modifier.fillMaxWidth().height(48.dp)); Transport(ui, model, Modifier.fillMaxWidth().height(96.dp)) }
            }
        }
    }
}

@Composable private fun SourcesPanel(model: PlayerModel, modifier: Modifier, pick: (DeckId) -> Unit) {
    val target = model.browser ?: return
    Column(modifier.background(Ink.background).border(2.dp, deckColor(target)).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}.padding(6.dp)) {
        Row(Modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) { Text("$target / LOCAL TRACKS", Modifier.weight(1f), deckColor(target), 18, true); Key("CLOSE", Modifier.width(64.dp).fillMaxHeight()) { model.browser = null } }
        Key("CHOOSE AUDIO FILE", Modifier.fillMaxWidth().height(56.dp), Ink.warning, model.output != null) { pick(target) }
        if (model.sources.isEmpty()) Text("Choose a local WAV, MP3, AAC or FLAC. Decoding support is checked by the native engine.", Modifier.padding(8.dp), Ink.muted, lines = 4)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            for (source in model.sources) Column(Modifier.fillMaxWidth().height(64.dp).border(1.dp, Ink.edge).clickable { model.requestImport(target, source.uri) }.padding(6.dp)) { Text(source.title, bold = true); Text(source.artist.ifBlank { "Local source" }, color = Ink.muted, size = 11) }
        }
    }
}

@Composable private fun PitchPanel(model: PlayerModel, modifier: Modifier) {
    val target = model.pitchDrawer ?: return
    val ui = model.decks.getValue(target)
    Column(modifier.background(Ink.background).border(2.dp, deckColor(target)).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}.padding(8.dp)) {
        Row(Modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) { Text("$target / VARISPEED ${"%+.1f".format(ui.pitch)}%", Modifier.weight(1f), deckColor(target), 18, true); Key("CLOSE", Modifier.width(64.dp).fillMaxHeight()) { model.pitchDrawer = null } }
        PhysicalFader("PITCH", ((ui.pitch + 8) / 16).coerceIn(0.0, 1.0), model, target, Modifier.fillMaxWidth().height(56.dp), model.supports("varispeed"), true) { value, id -> model.updatePitch(target, value * 16 - 8, id) }
        Text("Resampling changes pitch and speed. Key lock, BPM sync and scratch are pending.", color = Ink.muted, size = 11, lines = 2)
    }
}

@Composable fun PerformanceApp(model: PlayerModel, pick: (DeckId) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize().background(Ink.background).windowInsetsPadding(WindowInsets.displayCutout)) {
        val landscape = maxWidth > maxHeight
        val denseFits = landscape && maxWidth >= 760.dp && maxHeight >= 360.dp
        val dense = model.layout == Layout.DENSE && denseFits
        val next = if (model.layout == Layout.PORTRAIT) Layout.DENSE else Layout.PORTRAIT
        Column(Modifier.fillMaxSize().padding(horizontal = 4.dp)) {
            if (!dense) Row(Modifier.fillMaxWidth().height(24.dp), verticalAlignment = Alignment.CenterVertically) {
                val audio = model.output
                Text("${model.selected} · ${when { audio == null -> "OPENING AUDIO"; !audio.outputOpen -> "OUTPUT CLOSED"; else -> model.outputInfo?.let { "${it.api} ${it.sampleRate / 1000}k buf ${"%.1f".format(it.bufferMillis)}ms ~${it.latencyMillis?.let { l -> "%.0f".format(l) } ?: "?"}ms xr ${it.xruns}" } ?: "NATIVE ${audio.outputSampleRate}Hz" }}", Modifier.weight(1f).clickable { model.outputPanel = true }, deckColor(model.selected), 11, true)
                Key(model.layout.label, Modifier.width(48.dp).fillMaxHeight(), description = "Layout ${model.layout.label}, switch to ${next.label}") { model.chooseLayout(next) }
            }
            Row(Modifier.fillMaxWidth().height(if (landscape) 72.dp else 88.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) { for (id in model.visibleDecks) SourceHeader(model.decks.getValue(id), model, Modifier.weight(1f).fillMaxHeight(), landscape, dense && id == DeckId.A) }
            if (dense) Box(Modifier.weight(1f).fillMaxWidth()) {
                Dense(model, Modifier.fillMaxSize())
                if (model.browser != null) SourcesPanel(model, Modifier.fillMaxSize().padding(bottom = 96.dp), pick)
                if (model.pitchDrawer != null) PitchPanel(model, Modifier.fillMaxSize().padding(bottom = 96.dp))
                if (model.outputPanel) OutputPanel(model, Modifier.fillMaxSize())
            } else {
                if (model.layout == Layout.DENSE) Text("L3 needs landscape ≥760×360dp · showing L1", Modifier.fillMaxWidth().height(20.dp), Ink.warning, 12)
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    Workspace(model, Modifier.fillMaxSize(), landscape)
                    if (model.browser != null) SourcesPanel(model, Modifier.fillMaxSize(), pick)
                    if (model.pitchDrawer != null) PitchPanel(model, Modifier.fillMaxSize())
                    if (model.outputPanel) OutputPanel(model, Modifier.fillMaxSize())
                }
                Row(Modifier.fillMaxWidth().height(if (landscape) 96.dp else 144.dp)) {
                    for (id in model.visibleDecks) Column(Modifier.weight(1f).fillMaxHeight()) {
                        val ui = model.decks.getValue(id)
                        if (!landscape) Bend(ui, model, Modifier.fillMaxWidth().height(48.dp))
                        Transport(ui, model, Modifier.weight(1f).fillMaxWidth())
                    }
                }
            }
        }
        model.replace?.let { (deck, uri) ->
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .8f)).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}, contentAlignment = Alignment.Center) {
                Column(Modifier.widthIn(max = 420.dp).fillMaxWidth().background(Ink.panel).border(2.dp, deckColor(deck)).padding(12.dp)) {
                    Text("$deck IS PLAYING", color = deckColor(deck), size = 20, bold = true)
                    Text("Replace this deck with the selected track?", lines = 2)
                    Row(Modifier.fillMaxWidth().height(56.dp)) { Key("KEEP PLAYING", Modifier.weight(1f).fillMaxHeight(), Ink.play) { model.replace = null }; Key("REPLACE", Modifier.weight(1f).fillMaxHeight(), Ink.warning) { model.confirmReplacement() } }
                }
            }
        }
        model.failure?.let { error ->
            Row(Modifier.align(Alignment.TopCenter).fillMaxWidth().background(Ink.panel).border(2.dp, Ink.warning).padding(6.dp), verticalAlignment = Alignment.CenterVertically) { Text(error, Modifier.weight(1f), Ink.warning, 12, lines = 3); Key("OK", Modifier.size(48.dp), Ink.warning) { model.dismissFailure() } }
        }
    }
}
