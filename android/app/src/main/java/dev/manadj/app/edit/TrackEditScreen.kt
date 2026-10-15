package dev.manadj.app.edit

import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.manadj.app.*
import dev.manadj.library.LadderProjection
import dev.manadj.library.parseHexColor
import kotlin.math.abs
import kotlinx.coroutines.launch

private enum class EditTab(val label: String) { GRID("GRID · METER"), CUES("CUE DETAILS") }

/** Reset-mark colour (magenta: distinct from every cue/deck identity). */
private val MarkColor = Color(0xffff2dd4)

/**
 * Single-track edit view (#379): title/artist, Beatgrid, Metric ladder Reset marks, Hot Cues and Main cue
 * for one Track, over a zoomable detail waveform. Auditions on the deck it was opened from, else on the
 * spare edit deck ([EDIT_DECK]); edits journal through the #375 Device sync.
 */
@Composable fun TrackEditScreen(model: PlayerModel, ux: UiModel, request: EditRequest, modifier: Modifier) {
    val context = LocalContext.current.applicationContext
    val edit = remember(request) { TrackEditModel(context, request.trackId, request.deck ?: EDIT_DECK, model, ux) }
    var error by remember(request) { mutableStateOf<String?>(null) }
    val close = { TrackEditNav.request = null }
    androidx.activity.compose.BackHandler { close() }
    // Session replay drives all four engine decks (C/D included): never load the edit deck under it.
    val sessionBusy = request.deck == null && ux.sessions
    LaunchedEffect(request, ux.synced != null, sessionBusy) { if (!sessionBusy) edit.prepare { error = it } }
    val ready = edit.ready
    LaunchedEffect(ready) { if (ready) edit.route() }
    val ui = edit.ui
    LaunchedEffect(ui.source?.id) { ux.ensureWave(ui.source, (model.visibleDecks + edit.deck).mapNotNull { model.decks.getValue(it).source?.id }.toSet()) }
    DisposableEffect(edit) { onDispose { edit.leave() } }
    val track = edit.library
    // Opaque full-screen sheet: swallow touches meant for the performance UI beneath.
    BoxWithConstraints(modifier.background(Ink.background).clickable(remember { MutableInteractionSource() }, null) {}) {
        if (track == null || sessionBusy) {
            Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(if (sessionBusy) "Session replay is using every deck: close it to audition here (or edit from a loaded deck)." else "Track ${request.trackId} is not in the synced Library.", color = Ink.warning, size = 14, bold = true, lines = 3)
                Key("CLOSE", Modifier.width(120.dp).height(44.dp), Ink.muted, icon = Glyph.Close) { close() }
            }
            return@BoxWithConstraints
        }
        val landscape = maxWidth > maxHeight
        val height = maxHeight
        var tab by rememberSaveable { mutableStateOf(EditTab.GRID) }
        if (landscape) {
            Column(Modifier.fillMaxSize()) {
                Header(edit, ux, error, close)
                Row(Modifier.weight(1f)) {
                    Column(Modifier.weight(1.4f).fillMaxHeight()) {
                        EditWave(edit, model, ux, Modifier.weight(1f).fillMaxWidth())
                        Minimap(ui, model, ux.waves[ui.source?.id ?: ""], Modifier.fillMaxWidth().height(28.dp))
                        CueRow(edit, model, ux, Modifier.fillMaxWidth().height(44.dp))
                        Transport(edit, model, Modifier.fillMaxWidth().height(48.dp))
                    }
                    Column(Modifier.weight(1f).fillMaxHeight().padding(start = 6.dp)) {
                        Tabs(tab) { tab = it }
                        Panel(edit, ux, tab, Modifier.weight(1f))
                    }
                }
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                Header(edit, ux, error, close)
                EditWave(edit, model, ux, Modifier.fillMaxWidth().height(height * .26f))
                Minimap(ui, model, ux.waves[ui.source?.id ?: ""], Modifier.fillMaxWidth().height(30.dp))
                CueRow(edit, model, ux, Modifier.fillMaxWidth().height(46.dp))
                Transport(edit, model, Modifier.fillMaxWidth().height(50.dp))
                Tabs(tab) { tab = it }
                Panel(edit, ux, tab, Modifier.weight(1f))
            }
        }
    }
}

@Composable private fun Header(edit: TrackEditModel, ux: UiModel, error: String?, close: () -> Unit) {
    val track = edit.library ?: return
    val accent = deckColor(edit.deck)
    Row(Modifier.fillMaxWidth().height(58.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Key("", Modifier.size(44.dp), Ink.muted, description = "Close edit view", icon = Glyph.Close, style = KeyStyle.BARE) { close() }
        Column(Modifier.weight(1f).padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            var title by remember(edit) { mutableStateOf(edit.titleDraft ?: track.title) }
            var artist by remember(edit) { mutableStateOf(edit.artistDraft ?: track.artist.orEmpty()) }
            Field(title, Modifier.fillMaxWidth(), "title", 15, bold = true, description = "Title") { title = it; edit.saveTitle(it) }
            Field(artist, Modifier.fillMaxWidth(), "artist", 12, color = Ink.muted, description = "Artist") { artist = it; edit.saveArtist(it) }
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(if (edit.deck == EDIT_DECK) "EDIT DECK" else "DECK ${edit.deck}", color = accent, size = 11, bold = true)
            val status = when {
                error != null -> error
                !edit.ready -> "LOADING…"
                !edit.routedToMaster -> "HEADPHONES"
                edit.deck == EDIT_DECK && edit.otherDeckPlaying() -> "ON MASTER!"
                else -> null
            }
            status?.let { Text(it, color = if (it == "ON MASTER!" || error != null) Ink.warning else Ink.muted, size = 10, bold = true) }
            val pending = ux.syncState.pendingEdits
            Text(if (pending > 0) "$pending TO SYNC" else "SYNCED", color = if (pending > 0) Ink.orange else Ink.play, size = 10, bold = true)
        }
    }
}

@Composable private fun Field(
    value: String, modifier: Modifier, placeholder: String, size: Int, color: Color = Ink.text, bold: Boolean = false, description: String,
    keyboard: KeyboardType = KeyboardType.Text, done: () -> Unit = {}, change: (String) -> Unit,
) {
    val focus = LocalFocusManager.current
    Box(modifier.clip(RoundedCornerShape(3.dp)).background(Ink.crust).padding(horizontal = 6.dp, vertical = 3.dp)) {
        if (value.isEmpty()) Text(placeholder, color = Ink.surface2, size = size)
        BasicTextField(
            value, change, Modifier.fillMaxWidth().semantics { contentDescription = description }, singleLine = true,
            textStyle = TextStyle(color = color, fontSize = size.sp, fontFamily = Mono, fontWeight = if (bold) androidx.compose.ui.text.font.FontWeight.Bold else null),
            cursorBrush = SolidColor(Ink.accent),
            keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { done(); focus.clearFocus() }),
        )
    }
}

@Composable private fun Tabs(tab: EditTab, choose: (EditTab) -> Unit) {
    Row(Modifier.fillMaxWidth().height(36.dp).padding(horizontal = 4.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (t in EditTab.entries) Key(t.label, Modifier.weight(1f).fillMaxHeight(), Ink.accent, engaged = t == tab, style = KeyStyle.PILL, textSize = 12) { choose(t) }
    }
}

/** Hot cue row on the audition deck: the performance pads (tap = desktop hot-cue rules, empty = set) + SHIFT for delete. */
@Composable private fun CueRow(edit: TrackEditModel, model: PlayerModel, ux: UiModel, modifier: Modifier) {
    val deck = edit.deck
    val shift = ux.shifted(deck)
    Row(modifier.padding(horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Key("SHIFT", Modifier.width(54.dp).fillMaxHeight().padding(vertical = 2.dp), Ink.warning, engaged = shift, description = "Shift: next pad tap deletes", style = KeyStyle.PILL, textSize = 10) {
            ux.shiftLatched[deck] = !(ux.shiftLatched[deck] ?: false)
        }
        for (slot in 0 until 8) Hotcue(edit.ui, slot, model, ux, Modifier.weight(1f).fillMaxHeight())
    }
}

/** CUE and PLAY exactly as the performance deck (gated cue, slide-to-lock), beat/bar jumps, playhead readout. */
@Composable private fun Transport(edit: TrackEditModel, model: PlayerModel, modifier: Modifier) {
    val ready = edit.ready
    Row(modifier.padding(horizontal = 2.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        CueKey(edit.ui, model, Modifier.weight(1.5f).fillMaxHeight())
        PlayKey(edit.ui, model, Modifier.weight(1.7f).fillMaxHeight())
        Key("", Modifier.weight(.7f).fillMaxHeight(), Ink.muted, ready, description = "Back one bar", icon = Glyph.Back, style = KeyStyle.BARE) { edit.jumpBeats(-4.0) }
        Key("1", Modifier.weight(.7f).fillMaxHeight(), Ink.muted, ready, description = "Back one beat", icon = Glyph.Back, style = KeyStyle.BARE, textSize = 11) { edit.jumpBeats(-1.0) }
        Key("1", Modifier.weight(.7f).fillMaxHeight(), Ink.muted, ready, description = "Forward one beat", icon = Glyph.Forward, style = KeyStyle.BARE, textSize = 11) { edit.jumpBeats(1.0) }
        Key("", Modifier.weight(.7f).fillMaxHeight(), Ink.muted, ready, description = "Forward one bar", icon = Glyph.Forward, style = KeyStyle.BARE) { edit.jumpBeats(4.0) }
        Column(Modifier.weight(1.6f), horizontalAlignment = Alignment.End) {
            val t = edit.playhead
            Text("%d:%06.3f".format(t.toInt() / 60, t % 60), color = Ink.text, size = 12, bold = true)
            Text(edit.barLabel() ?: if (edit.expansion == null) "no grid" else "—", color = MarkColor, size = 13, bold = true)
        }
    }
}

@Composable private fun Panel(edit: TrackEditModel, ux: UiModel, tab: EditTab, modifier: Modifier) {
    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 6.dp, vertical = 3.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        when (tab) {
            EditTab.GRID -> GridMeterPanel(edit)
            EditTab.CUES -> CuePanel(edit, ux)
        }
    }
}

private fun bpmText(bpm: Double) = "%.2f".format(bpm).trimEnd('0').trimEnd('.')
private fun timeText(t: Double) = "%d:%06.3f".format(t.toInt() / 60, t % 60)
private val Row40 = 40.dp

/** Grid and Metric ladder on one page: tempo, nudge, downbeat / drop anchor, Reset marks. */
@Composable private fun GridMeterPanel(edit: TrackEditModel) {
    val bpm = edit.bpm
    val grid = edit.grid
    val canGrid = edit.changes != null
    val ready = edit.ready
    val meter = ready && edit.expansion != null
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(bpm?.let(::bpmText) ?: "—", color = Ink.text, size = 24, bold = true)
        Text(" BPM", color = Ink.muted, size = 11, bold = true)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(when { grid == null && canGrid -> "PLACEHOLDER"; grid == null -> "NO GRID"; else -> grid.origin.uppercase() } + if (edit.variable) " · VARIABLE ${edit.changes?.size}" else "", color = if (grid == null) Ink.warning else Ink.play, size = 10, bold = true)
            grid?.anchorTime?.let { Text("ANCHOR ${timeText(it)}", color = Ink.muted, size = 10, bold = true) }
        }
        Text(edit.barLabel() ?: "—", color = MarkColor, size = 20, bold = true)
    }
    val tempo = canGrid && !edit.variable && bpm != null
    Row(Modifier.fillMaxWidth().height(Row40), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
        Key("÷2", Modifier.weight(.8f).fillMaxHeight(), Ink.accent, tempo, description = "Halve BPM") { edit.scaleBpm(.5) }
        Key("GROW", Modifier.weight(1.1f).fillMaxHeight(), Ink.accent, tempo, description = "Grow: BPM down 0.03", textSize = 11) { edit.growShrink(true) }
        Key("SHRINK", Modifier.weight(1.1f).fillMaxHeight(), Ink.accent, tempo, description = "Shrink: BPM up 0.03", textSize = 11) { edit.growShrink(false) }
        Key("×2", Modifier.weight(.8f).fillMaxHeight(), Ink.accent, tempo, description = "Double BPM") { edit.scaleBpm(2.0) }
        var typed by remember(edit) { mutableStateOf("") }
        val apply = { typed.toDoubleOrNull()?.let { if (edit.retempo(it)) typed = "" } }
        Field(typed, Modifier.weight(1.2f), "BPM", 14, description = "Type BPM", keyboard = KeyboardType.Decimal, done = { apply() }) { typed = it.filter { c -> c.isDigit() || c == '.' } }
        Key("SET", Modifier.weight(.8f).fillMaxHeight(), Ink.accent, typed.toDoubleOrNull()?.let { it in 40.0..300.0 } == true && !edit.variable, description = "Set typed BPM", textSize = 11) { apply() }
    }
    Row(Modifier.fillMaxWidth().height(Row40), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        IconKey("10", Modifier.weight(1f).fillMaxHeight(), Ink.accent, canGrid, "Grid earlier 10 ms", Icons.nudgeLeft) { edit.nudgeGrid(-10.0) }
        IconKey("1", Modifier.weight(1f).fillMaxHeight(), Ink.accent, canGrid, "Grid earlier 1 ms", Icons.nudgeLeft) { edit.nudgeGrid(-1.0) }
        IconKey("1", Modifier.weight(1f).fillMaxHeight(), Ink.accent, canGrid, "Grid later 1 ms", Icons.nudgeRight, iconAfter = true) { edit.nudgeGrid(1.0) }
        IconKey("10", Modifier.weight(1f).fillMaxHeight(), Ink.accent, canGrid, "Grid later 10 ms", Icons.nudgeRight, iconAfter = true) { edit.nudgeGrid(10.0) }
    }
    Row(Modifier.fillMaxWidth().height(46.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        IconKey("DOWNBEAT", Modifier.weight(1f).fillMaxHeight(), Ink.play, ready && canGrid, "Set downbeat at playhead (anchors the grid)", Icons.anchor) { edit.setDownbeatHere() }
        IconKey("DROP", Modifier.weight(1f).fillMaxHeight(), Ink.orange, ready && canGrid, "Drop anchor at playhead: downbeat + Reset mark + Hot Cue 4 (3/2/1 fill empty at -8/-16/-32 bars)", Icons.drop) { edit.dropAnchor() }
        IconKey("RESET", Modifier.weight(1f).fillMaxHeight(), MarkColor, meter, "Mark a Reset at the nearest downbeat", Icons.resetMark) { edit.markHere() }
        IconKey("RESET", Modifier.weight(1f).fillMaxHeight(), Ink.warning, meter && edit.marks.isNotEmpty(), "Delete the Reset mark nearest the playhead", Icons.resetMarkDelete) { edit.deleteNearestMark() }
    }
    val downbeats = edit.expansion?.downbeats
    val marks = edit.marks.sorted()
    if (marks.isEmpty()) Text("No Reset marks — ladder counts from the Grid origin. First mark = Ladder anchor.", color = Ink.muted, size = 10, lines = 2)
    marks.forEachIndexed { i, m ->
        val ordinal = downbeats?.takeIf { it.isNotEmpty() }?.let { LadderProjection.nearestDownbeatOrdinal(it, m) }
        Row(Modifier.fillMaxWidth().height(34.dp).clip(RoundedCornerShape(3.dp)).background(Ink.crust).clickable { edit.seek(m) }.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(if (i == 0) "ANCHOR" else "RESET", Modifier.width(64.dp), MarkColor, 11, true)
            Text(timeText(m), Modifier.weight(1f), Ink.text, 12, true)
            ordinal?.let { Text("bar ${it + 1}", Modifier.padding(end = 8.dp), Ink.muted, 11) }
            Key("", Modifier.size(32.dp), Ink.warning, description = "Delete reset mark at ${timeText(m)}", icon = Glyph.Close, style = KeyStyle.BARE) { edit.deleteMark(m) }
        }
    }
}

/** A box key with a desktop-parity icon (16-unit viewBox, MeterIcons/GridIcons/AnchorIcon) and a short label. */
@Composable private fun IconKey(text: String, modifier: Modifier, color: Color, enabled: Boolean, description: String, icon: DrawScope.(Color) -> Unit, iconAfter: Boolean = false, action: () -> Unit) {
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    val tint = if (enabled) color else Ink.surface2
    val shape = RoundedCornerShape(2.dp)
    Box(modifier.padding(2.dp).clip(shape).background(Ink.panel).border(1.5.dp, tint.copy(alpha = .7f), shape)
        .clickable(enabled = enabled) { haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.TextHandleMove); action() }
        .semantics { contentDescription = description }, contentAlignment = Alignment.Center) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            val glyph = @Composable { Canvas(Modifier.size(18.dp)) { icon(tint) } }
            if (!iconAfter) glyph()
            Text(text, color = tint, size = 11, bold = true)
            if (iconAfter) glyph()
        }
    }
}

/** Desktop icons (frontend/src/components/icons) drawn on a 16×16 grid. */
private object Icons {
    private fun DrawScope.u() = size.minDimension / 16f
    private fun DrawScope.stroke(w: Float) = androidx.compose.ui.graphics.drawscope.Stroke(w * u(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
    private fun DrawScope.path(build: Path.(Float) -> Unit) = Path().apply { build(u()) }

    /** DropAnchorIcon: a drop landing on a baseline. */
    val drop: DrawScope.(Color) -> Unit = { c ->
        drawPath(path { k -> moveTo(8 * k, 1.5f * k); cubicTo(6.5f * k, 4 * k, 4.5f * k, 6.2f * k, 4.5f * k, 8.6f * k); cubicTo(4.5f * k, 13.3f * k, 11.5f * k, 13.3f * k, 11.5f * k, 8.6f * k); cubicTo(11.5f * k, 6.2f * k, 9.5f * k, 4 * k, 8 * k, 1.5f * k); close() }, c)
        drawLine(c, Offset(2 * u(), 13.5f * u()), Offset(14 * u(), 13.5f * u()), 1.4f * u())
    }
    /** ResetMarkIcon: a flag on a tick. */
    val resetMark: DrawScope.(Color) -> Unit = { c ->
        drawLine(c, Offset(4 * u(), 2.5f * u()), Offset(4 * u(), 13.5f * u()), 1.3f * u())
        drawPath(path { k -> moveTo(4 * k, 3 * k); lineTo(12 * k, 3 * k); lineTo(9.5f * k, 5.25f * k); lineTo(12 * k, 7.5f * k); lineTo(4 * k, 7.5f * k); close() }, c)
    }
    /** ResetMarkDeleteIcon: outlined flag with a minus. */
    val resetMarkDelete: DrawScope.(Color) -> Unit = { c ->
        drawLine(c, Offset(4 * u(), 2.5f * u()), Offset(4 * u(), 13.5f * u()), 1.3f * u())
        drawPath(path { k -> moveTo(4 * k, 3 * k); lineTo(12 * k, 3 * k); lineTo(9.5f * k, 5.25f * k); lineTo(12 * k, 7.5f * k); lineTo(4 * k, 7.5f * k); close() }, c, style = stroke(1.1f))
        drawLine(c, Offset(8 * u(), 12 * u()), Offset(15 * u(), 12 * u()), 1.6f * u())
    }
    /** AnchorIcon: set-downbeat. */
    val anchor: DrawScope.(Color) -> Unit = { c ->
        drawCircle(c, 1.7f * u(), Offset(8 * u(), 3.2f * u()), style = stroke(1.3f))
        drawLine(c, Offset(8 * u(), 4.9f * u()), Offset(8 * u(), 13.5f * u()), 1.3f * u())
        drawLine(c, Offset(5.2f * u(), 7 * u()), Offset(10.8f * u(), 7 * u()), 1.3f * u())
        drawPath(path { k -> moveTo(2 * k, 9.5f * k); cubicTo(2.4f * k, 12.6f * k, 4.8f * k, 13.9f * k, 8 * k, 13.9f * k); cubicTo(11.2f * k, 13.9f * k, 13.6f * k, 12.6f * k, 14 * k, 9.5f * k); lineTo(11.9f * k, 10.6f * k) }, c, style = stroke(1.3f))
        drawLine(c, Offset(2 * u(), 9.5f * u()), Offset(4.1f * u(), 10.6f * u()), 1.3f * u())
    }
    /** GridNudgeLeft/RightIcon: solid triangles. */
    val nudgeLeft: DrawScope.(Color) -> Unit = { c -> drawPath(path { k -> moveTo(5.5f * k, 4.5f * k); lineTo(1 * k, 8 * k); lineTo(5.5f * k, 11.5f * k); close() }, c); drawLine(c, Offset(7 * u(), 3 * u()), Offset(7 * u(), 13 * u()), 1.3f * u()) }
    val nudgeRight: DrawScope.(Color) -> Unit = { c -> drawPath(path { k -> moveTo(10.5f * k, 4.5f * k); lineTo(15 * k, 8 * k); lineTo(10.5f * k, 11.5f * k); close() }, c); drawLine(c, Offset(9 * u(), 3 * u()), Offset(9 * u(), 13 * u()), 1.3f * u()) }
}

@Composable private fun CuePanel(edit: TrackEditModel, ux: UiModel) {
    val ready = edit.ready
    val q = ux.quantize
    Row(Modifier.fillMaxWidth().height(40.dp).clip(RoundedCornerShape(3.dp)).background(Ink.crust).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("MAIN CUE", Modifier.width(76.dp), Ink.orange, 11, true)
        val main = edit.mainCue
        Text(main?.let(::timeText) ?: "—", Modifier.weight(1f).clickable(enabled = main != null) { main?.let(edit::seek) }, if (main != null) Ink.text else Ink.muted, 12, true)
        Key("SET", Modifier.width(52.dp).fillMaxHeight().padding(vertical = 2.dp), Ink.orange, ready, description = "Set main cue at playhead", textSize = 11) { edit.setMainCue(edit.quantized(edit.playhead)) }
        Key("", Modifier.size(36.dp), Ink.warning, main != null, description = "Clear main cue", icon = Glyph.Close, style = KeyStyle.BARE) { edit.setMainCue(null) }
    }
    Text("SET places at the playhead${if (q) " (Quantize on: snapped to the beat)" else ""}; tap a time to jump; tap a swatch for colour.", color = Ink.muted, size = 10, lines = 2)
    var palette by remember(edit) { mutableStateOf<Int?>(null) }
    for (slot in 1..8) {
        val cue = edit.cue(slot)
        val color = Color(parseHexColor(cueHex(slot, cue?.color)) ?: Ink.cues[slot - 1].toArgb())
        Row(Modifier.fillMaxWidth().height(44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Box(Modifier.size(34.dp).clip(RoundedCornerShape(3.dp)).background(if (cue != null) color else Ink.crust).border(1.5.dp, color, RoundedCornerShape(3.dp))
                .clickable(enabled = cue != null) { palette = if (palette == slot) null else slot }.semantics { contentDescription = "Hot cue $slot colour" }, contentAlignment = Alignment.Center) {
                Text("$slot", color = if (cue != null) Color.Black else color, size = 14, bold = true)
            }
            var label by remember(edit, slot, cue == null) { mutableStateOf(cue?.label.orEmpty()) }
            if (cue != null) Field(label, Modifier.weight(1f), "label", 12, description = "Hot cue $slot label") { label = it; edit.decorate(slot, it, cue.color) }
            else Spacer(Modifier.weight(1f))
            Text(cue?.time?.let(::timeText) ?: "—", Modifier.width(70.dp).clickable(enabled = cue != null) { cue?.let { edit.seek(it.time) } }, if (cue != null) Ink.text else Ink.muted, 12, true)
            Key("", Modifier.width(30.dp).fillMaxHeight(), color, cue != null, description = "Hot cue $slot earlier 10 ms", icon = Glyph.Back, style = KeyStyle.BARE) { edit.nudgeCue(slot, -.01) }
            Key("", Modifier.width(30.dp).fillMaxHeight(), color, cue != null, description = "Hot cue $slot later 10 ms", icon = Glyph.Forward, style = KeyStyle.BARE) { edit.nudgeCue(slot, .01) }
            Key("SET", Modifier.width(48.dp).fillMaxHeight().padding(vertical = 2.dp), color, ready, description = "Set hot cue $slot at playhead", textSize = 11) { edit.setCueHere(slot) }
            Key("", Modifier.width(32.dp).fillMaxHeight(), Ink.warning, cue != null, description = "Delete hot cue $slot", icon = Glyph.Close, style = KeyStyle.BARE) { edit.clearCue(slot); if (palette == slot) palette = null }
        }
        if (palette == slot && cue != null) Row(Modifier.fillMaxWidth().height(36.dp).padding(start = 37.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            CUE_PALETTE.forEachIndexed { i, hex ->
                val c = Color(parseHexColor(hex)!!)
                val chosen = cueHex(slot, cue.color).equals(hex, ignoreCase = true)
                Box(Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(3.dp)).background(c).border(if (chosen) 3.dp else 0.dp, Color.White, RoundedCornerShape(3.dp))
                    .clickable { edit.decorate(slot, cue.label, if (hex == CUE_PALETTE[slot - 1]) null else hex); palette = null }.semantics { contentDescription = "Colour ${i + 1}" })
            }
        }
    }
}

/**
 * Detail waveform for the edit view: the shared renderer (synced palette) plus an overlay of the draft grid
 * (beats, bars by ladder tier, bar counts, parenthetical bars), Reset marks, anchor, Main cue and labelled
 * Hot Cues. Playhead centred. One finger drags the track under the playhead (seek-scrub: the wave follows the
 * finger exactly, seeks stream behind it); two fingers zoom.
 */
@Composable private fun EditWave(edit: TrackEditModel, model: PlayerModel, ux: UiModel, modifier: Modifier) {
    val ui = edit.ui
    val wave = ux.waves[ui.source?.id ?: ""]
    var window by rememberSaveable { mutableDoubleStateOf(8.0) }
    var scrub by remember { mutableStateOf<Double?>(null) }
    val scope = rememberCoroutineScope()
    val moving = ui.snapshot.let { it?.playing == true || it?.previewing == true }
    val frame = frameNanos(moving)
    val clock = remember(ui.id) { SmoothClock() }
    fun heard(now: Long): Double { if (now == 0L) return position(ui); val out = model.output; return if (out != null && ui.source?.id == ui.snapshot?.sourceId) out.audibleSeconds(ui.id, now) else position(ui) }
    val pos = { scrub ?: clock.at(frame.value, heard(frame.value), ui.snapshot?.playing == true && frame.value != 0L, playbackRate(ui)) }
    val ink = remember { Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.MONOSPACE; isFakeBoldText = true } }
    val currentReady by rememberUpdatedState(edit.ready)
    Box(modifier.clipToBounds().semantics { contentDescription = "Edit waveform" }.pointerInput(edit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            var dragging = false; var zooming = false; var d0 = 0f; var w0 = window
            var base = 0.0; var lastSeek = 0L
            fun seek(t: Double, force: Boolean) {
                val now = System.nanoTime()
                if (force || now - lastSeek > 60_000_000L) { lastSeek = now; edit.seek(t) }
            }
            try {
                while (true) {
                    val event = awaitPointerEvent()
                    val pressed = event.changes.filter { it.pressed }
                    if (pressed.isEmpty()) break
                    if (pressed.size >= 2) {
                        if (dragging) { dragging = false; scrub?.let { seek(it, true) } }
                        val d = (pressed[0].position - pressed[1].position).getDistance()
                        if (!zooming) { zooming = true; d0 = d; w0 = window } else if (d > 8f) window = (w0 * d0 / d).coerceIn(.5, 64.0)
                        pressed.forEach { it.consume() }
                        continue
                    }
                    if (zooming) continue
                    val c = pressed.first()
                    val dx = c.position.x - down.position.x
                    if (!dragging && abs(dx) > viewConfiguration.touchSlop && currentReady) { dragging = true; base = position(ui) + dx / size.width * window }
                    if (dragging) {
                        val t = (base - dx / size.width * window).coerceIn(0.0, edit.duration)
                        scrub = t; seek(t, false); c.consume()
                    }
                }
            } finally {
                val t = scrub
                if (dragging && t != null) {
                    seek(t, true)
                    // Hold the preview until the engine reports the seek (no snap-back flicker).
                    scope.launch { for (i in 0 until 20) { if (abs(position(ui) - t) < .05) break; kotlinx.coroutines.delay(20) }; scrub = null }
                } else scrub = null
            }
        }
    }) {
        WaveView(wave, pos, edit.duration.takeIf { it > 0 }, WaveMarks(null, emptyList()), Modifier.fillMaxSize(), windowSeconds = window, playheadAt = .5f,
            accent = deckColor(edit.deck), status = when { ui.source == null || !edit.ready -> "loading…"; wave == null -> "analysing…"; else -> null })
        Canvas(Modifier.fillMaxSize()) { overlay(edit, pos(), window, ink) }
        Text("${"%.1f".format(window)}s", Modifier.align(Alignment.TopEnd).padding(4.dp), Ink.muted, 10)
    }
}

private fun DrawScope.overlay(edit: TrackEditModel, pos: Double, window: Double, ink: Paint) {
    val w = size.width; val h = size.height
    val start = pos - window * .5
    fun x(t: Double) = ((t - start) / window * w).toFloat()
    fun visible(t: Double) = t >= start - 1 && t <= start + window + 1
    val e = edit.expansion
    val ladder = edit.ladder
    if (e != null) {
        val beatPx = if (e.beats.size > 1) (e.beats[1] - e.beats[0]) / window * w else 0.0
        if (beatPx >= 6) for (t in e.beats) if (visible(t)) drawLine(Color.White.copy(alpha = .16f), Offset(x(t), 0f), Offset(x(t), h), 1.dp.toPx())
        val barPx = beatPx * 4
        for ((i, t) in e.downbeats.withIndex()) {
            if (!visible(t)) continue
            val tier = ladder?.tiers?.getOrNull(i) ?: 0
            val paren = ladder?.parentheticals?.getOrNull(i) == true
            val show = tier >= 2 || barPx >= 14 || tier >= 1 && barPx >= 7
            if (!show) continue
            val color = if (paren) Ink.orange else Color.White
            val alpha = floatArrayOf(.3f, .45f, .65f, .85f, 1f)[tier.coerceIn(0, 4)]
            drawLine((if (tier >= 4 && !paren) Ink.accent else color).copy(alpha = alpha), Offset(x(t), 0f), Offset(x(t), h), floatArrayOf(1.5f, 2f, 2.5f, 3f, 4f)[tier.coerceIn(0, 4)].dp.toPx())
            if (ladder != null && (barPx >= 34 || tier >= 2 && barPx >= 9 || tier >= 4)) {
                val label = ladder.label(i).let { if (barPx >= 60) it else it.substringBefore(" of") }
                ink.color = color.toArgb(); ink.textSize = 10.dp.toPx()
                drawContext.canvas.nativeCanvas.drawText(label, x(t) + 3.dp.toPx(), h - 4.dp.toPx(), ink)
            }
        }
    }
    edit.grid?.anchorTime?.let { a ->
        if (visible(a)) { val p = x(a); drawPath(Path().apply { moveTo(p, h - 16.dp.toPx()); lineTo(p - 6.dp.toPx(), h - 22.dp.toPx()); lineTo(p, h - 28.dp.toPx()); lineTo(p + 6.dp.toPx(), h - 22.dp.toPx()); close() }, Ink.play) }
    }
    for (m in edit.markTimes) if (visible(m)) {
        val p = x(m)
        drawLine(MarkColor, Offset(p, 0f), Offset(p, h), 2.5.dp.toPx())
        drawPath(Path().apply { moveTo(p - 7.dp.toPx(), 0f); lineTo(p + 7.dp.toPx(), 0f); lineTo(p, 12.dp.toPx()); close() }, MarkColor)
    }
    edit.mainCue?.let { c -> if (visible(c)) { val p = x(c); drawLine(Ink.orange, Offset(p, 0f), Offset(p, h), 2.dp.toPx()); drawPath(Path().apply { moveTo(p, h - 9.dp.toPx()); lineTo(p - 6.dp.toPx(), h); lineTo(p + 6.dp.toPx(), h); close() }, Ink.orange) } }
    for (slot in 1..8) {
        val c = edit.cue(slot) ?: continue
        if (!visible(c.time)) continue
        val color = Color(parseHexColor(cueHex(slot, c.color)) ?: Ink.cues[slot - 1].toArgb())
        val p = x(c.time)
        drawLine(color, Offset(p, 0f), Offset(p, h), 2.dp.toPx())
        val text = c.label?.let { "$slot $it" } ?: "$slot"
        ink.textSize = 11.dp.toPx()
        val tw = ink.measureText(text) + 6.dp.toPx()
        val top = 14.dp.toPx()
        drawRect(color, Offset(p, top), Size(tw, 15.dp.toPx()))
        ink.color = android.graphics.Color.BLACK
        drawContext.canvas.nativeCanvas.drawText(text, p + 3.dp.toPx(), top + 11.5f.dp.toPx(), ink)
    }
}
