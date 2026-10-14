package dev.manadj.app

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.changedToDownIgnoreConsumed
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.manadj.audio.*
import kotlinx.coroutines.CancellationException

val PadRow = 52.dp
val TransportRow = 54.dp
val ControlRow = 44.dp

/** Deck identity, unboxed: tap selects. Play state shows as a lit ▶ + green clock. */
@Composable fun DeckInfo(ui: DeckUi, model: PlayerModel, modifier: Modifier, compact: Boolean = false) {
    val color = deckColor(ui.id)
    val selected by animateFloatAsState(if (model.selected == ui.id) 1f else 0f, tween(200), label = "select")
    val time by remember(ui) { derivedStateOf { clock(position(ui)) } }
    val remain by remember(ui) { derivedStateOf { ui.durationSeconds?.let { "-" + clock((it - position(ui)).coerceAtLeast(0.0)) } ?: "" } }
    val status = when {
        ui.importing -> "OPENING"; ui.error != null -> ui.error!!
        ui.snapshot?.loadState == LoadState.ERROR -> ui.snapshot?.error ?: "DECODE FAILED"
        ui.snapshot?.loadState == LoadState.LOADING -> "DECODING…"
        ui.ready && ui.snapshot?.filling == true -> "BUFFERING"
        ui.ready && ui.snapshot?.atEnd == true && ui.snapshot?.playing != true -> "END"
        else -> null
    }
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(4.dp).fillMaxHeight().padding(vertical = 4.dp).background(color.copy(alpha = .3f + .7f * selected)))
        Column(Modifier.weight(1f).fillMaxHeight().clickable { model.chooseDeck(ui.id) }.semantics { contentDescription = "Select ${ui.id}" }.padding(horizontal = 6.dp), verticalArrangement = Arrangement.Center) {
            Text("${ui.id}  ${ui.source?.title ?: "LOAD A TRACK"}", color = color, size = if (compact) 12 else 14, bold = true)
            Row { Text(ui.source?.artist?.ifBlank { null } ?: "local file", Modifier.weight(1f), Ink.muted, 11); val playing = ui.snapshot?.playing == true; Text(status ?: "${if (playing) "▶ " else ""}$time $remain", color = if (status != null && (ui.error != null || ui.snapshot?.loadState == LoadState.ERROR)) Ink.warning else if (playing) Ink.play else Ink.text, size = 11, bold = true) }
        }
    }
}

/** Hot cue pads stay rectangles. All feedback is drawn inside the pad's own bounds (fixes stuck borders). */
@Composable fun Pads(ui: DeckUi, model: PlayerModel, ux: UiModel, modifier: Modifier, columns: Int = 4, rowHeight: Dp = PadRow) {
    Column(modifier) { repeat(8 / columns) { row -> Row(Modifier.fillMaxWidth().then(if (rowHeight == Dp.Unspecified) Modifier.weight(1f) else Modifier.height(rowHeight))) { repeat(columns) { col -> Hotcue(ui, row * columns + col, model, ux, Modifier.weight(1f).fillMaxHeight()) } } } }
}

/** Hot cue pad. With SHIFT active a stored pad shows DEL and a tap deletes it (UNDO chip follows). */
@Composable fun Hotcue(ui: DeckUi, slot: Int, model: PlayerModel, ux: UiModel, modifier: Modifier) {
    val ready by remember(ui) { derivedStateOf { ui.ready && model.supports("hot-cue-gate") } }
    val currentReady by rememberUpdatedState(ready)
    val stored = ui.hotCues[slot]
    val shift = ux.shifted(ui.id)
    val currentShift by rememberUpdatedState(shift)
    var held by remember(ui.id, slot) { mutableStateOf(false) }
    val previewing = ui.snapshot?.previewSlot == slot
    val haptic = LocalHapticFeedback.current
    val cue = Ink.cues[slot]
    val tint = if (ready) cue else Ink.edge
    val lit by animateFloatAsState(if (held || previewing) 1f else 0f, tween(if (held) 0 else 220), label = "pad")
    val scale by animateFloatAsState(if (held) .92f else 1f, if (held) tween(0) else spring(dampingRatio = .4f, stiffness = 800f), label = "bounce")
    val ring = remember { Animatable(1f) }
    LaunchedEffect(held) { if (held) { ring.snapTo(0f); ring.animateTo(1f, tween(360, easing = LinearOutSlowInEasing)) } }
    Box(modifier.drawBehind {
        // Expanding ring lives in the 3dp margin between pads — still inside this node.
        val r = ring.value
        if (r < 1f) { val m = 3.dp.toPx() * (1 - r); drawRect(cue.copy(alpha = (1 - r) * .9f), Offset(m, m), Size(size.width - 2 * m, size.height - 2 * m), style = Stroke(2.dp.toPx())) }
    }.semantics { contentDescription = "${ui.id} hotcue ${slot + 1}"; if (!ready) disabled() }.pointerInput(ui.id, slot) {
        momentaryPresses({ currentReady }) {
            if (currentShift) {
                if (ui.hotCues[slot] != null) { haptic.performHapticFeedback(HapticFeedbackType.LongPress); ux.deleteCue(model, ui.id, slot) }
                return@momentaryPresses { }
            }
            held = true; haptic.performHapticFeedback(HapticFeedbackType.VirtualKey)
            val set = ui.hotCues[slot] != null
            val id = model.beginGesture(ui.id, "HOTCUE$slot") { if (set) model.submit(AudioCommand.HotCueUp(ui.id, slot, it)) }
            model.submit(if (set) AudioCommand.HotCueDown(ui.id, slot, id) else AudioCommand.SetHotCue(ui.id, slot, id))
            if (!set) ux.journalCueWhenSet(model, ui.id, slot)
            ;{ cancelled -> held = false; if (!cancelled && set && model.gestureActive(id)) model.submit(AudioCommand.HotCueUp(ui.id, slot, id)); model.finishGesture(id, cancelled) }
        }
    }.padding(3.dp).graphicsLayer { scaleX = scale; scaleY = scale }.background(Ink.panel).background(tint.copy(alpha = if (stored != null) .1f + .5f * lit else .5f * lit)).border(if (stored != null) 1.5.dp else 1.dp, tint.copy(alpha = if (stored != null) 1f else .45f)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("${slot + 1}", color = if (lit > .5f) Ink.text else tint, size = 15, bold = true)
            if (shift && stored != null) Text("DEL", color = Ink.warning, size = 9, bold = true)
            else Text(if (stored == null) "SET" else clock(stored), color = tint.copy(alpha = .8f), size = 8)
        }
    }
}

/** CUE: round, yellow text (round-5 feedback); desktop gated semantics via the engine. */
@Composable fun CueKey(ui: DeckUi, model: PlayerModel, modifier: Modifier) {
    val ready by remember(ui) { derivedStateOf { ui.ready } }
    val currentReady by rememberUpdatedState(ready)
    var held by remember(ui.id) { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    val heat by animateFloatAsState(if (held) 1f else 0f, tween(if (held) 0 else 300), label = "cue")
    val scale by animateFloatAsState(if (held) .93f else 1f, if (held) tween(0) else spring(dampingRatio = .4f, stiffness = 900f), label = "cue press")
    val tint = if (ready) Ink.warning else Ink.edge
    val shape = RoundedCornerShape(50)
    Box(modifier.halo(Ink.warning, heat * .9f, 7.dp, round = true).semantics { contentDescription = "${ui.id} CUE"; if (!ready) disabled() }.pointerInput(ui.id) {
        momentaryPresses({ currentReady }) {
            val id = model.beginGesture(ui.id, "CUE") { model.submit(AudioCommand.CueUp(ui.id, it)) }
            held = true; haptic.performHapticFeedback(HapticFeedbackType.VirtualKey); model.submit(AudioCommand.CueDown(ui.id, id))
            ;{ cancelled -> held = false; if (!cancelled && model.gestureActive(id)) model.submit(AudioCommand.CueUp(ui.id, id)); model.finishGesture(id, cancelled) }
        }
    }.padding(4.dp).graphicsLayer { scaleX = scale; scaleY = scale }.clip(shape).background(Ink.panel).background(Ink.warning.copy(alpha = .9f * heat)).border(2.dp, tint, shape), contentAlignment = Alignment.Center) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            // Same metrics as PLAY (Key: icon textSize+3, label textSize 15).
            GlyphIcon(Glyph.Cue, if (held) Color.Black else tint, 18.dp)
            Text("CUE", color = if (held) Color.Black else tint, size = 15, bold = true)
        }
    }
}

@Composable fun PlayKey(ui: DeckUi, model: PlayerModel, modifier: Modifier) {
    val playing by remember(ui) { derivedStateOf { ui.snapshot?.playing == true } }
    val ready by remember(ui) { derivedStateOf { ui.ready } }
    // Breathes on the beat when the deck has a grid.
    val bpm = ui.snapshot?.bpm
    val pulse = if (playing && bpm != null) (1 - beatPhase(position(ui) - (ui.snapshot?.gridAnchorSeconds ?: 0.0), bpm)).let { it * it } * .35f else 0f
    Key(if (playing) "PAUSE" else "PLAY", modifier, Ink.play, ready || playing, playing, "${ui.id} play pause", if (playing) Glyph.Pause else Glyph.Play, KeyStyle.PILL, pulse, 15) {
        model.submit(if (playing) AudioCommand.Pause(ui.id) else AudioCommand.Play(ui.id))
    }
}

/** One outline around adjacent segments; hairline dividers instead of doubled borders (round-5). */
@Composable fun Segmented(modifier: Modifier, color: Color, content: @Composable RowScope.() -> Unit) {
    val shape = RoundedCornerShape(50)
    Row(modifier.padding(3.dp).clip(shape).background(Ink.panel).border(1.5.dp, color.copy(alpha = .7f), shape), verticalAlignment = Alignment.CenterVertically, content = content)
}
@Composable fun RowScope.Divider(color: Color) { Box(Modifier.width(1.dp).fillMaxHeight(.6f).background(color.copy(alpha = .45f))) }

private fun nearest(choices: List<Double>, v: Double) = choices.indices.minBy { kotlin.math.abs(kotlin.math.ln(choices[it] / v)) }

/** Beat jump (engine): arrows jump by the hold-wheel size; needs a grid (BPM). */
/** End-segment width shared by the loop and jump strips so their columns line up. */
val StripEnd = 48.dp

@Composable fun JumpStrip(ui: DeckUi, ux: UiModel, model: PlayerModel, modifier: Modifier) {
    val live = model.supports("beat-jump")
    val gridded = ui.snapshot?.bpm != null
    val usable = live && ui.ready && gridded
    val color = if (live) deckColor(ui.id) else Ink.surface2
    Box(modifier) {
        Segmented(Modifier.fillMaxSize(), color) {
            Key("", Modifier.width(StripEnd).fillMaxHeight(), color, usable, description = "${ui.id} jump backward", icon = Glyph.Back, style = KeyStyle.BARE) { model.jump(ui.id, -1) }
            Divider(color)
            ValueWheel("${ui.id} jump size", BEAT_CHOICES.map(::beatText), nearest(BEAT_CHOICES, ui.jumpBeats), ux, model, ui.id, Modifier.weight(1f).fillMaxHeight(), color, if (live && !gridded && ui.ready) "NO BPM" else "${beatText(ui.jumpBeats)} BEATS", live = live, bare = true) { ui.jumpBeats = BEAT_CHOICES[it] }
            Divider(color)
            Key("", Modifier.width(StripEnd).fillMaxHeight(), color, usable, description = "${ui.id} jump forward", icon = Glyph.Forward, style = KeyStyle.BARE) { model.jump(ui.id, 1) }
        }
        if (!live) PendingTag(Modifier.align(Alignment.TopCenter))
    }
}

/** Loop (engine): tap toggles, hold-wheel sets length, ÷2 / ×2 resize (same segment widths as the jump strip). Pulses while looping. */
@Composable fun LoopStrip(ui: DeckUi, ux: UiModel, model: PlayerModel, modifier: Modifier) {
    val live = model.supports("loop")
    val snap = ui.snapshot
    val gridded = snap?.bpm != null
    val active = snap?.loop != null
    val beats = snap?.loop?.beats ?: snap?.pendingLoopBeats ?: 4.0
    val base = if (live) deckColor(ui.id) else Ink.surface2
    val color = if (active) Ink.play else base
    val usable = live && ui.ready && gridded
    val pulse = if (active) (1 - beatPhase(position(ui) - (snap?.gridAnchorSeconds ?: 0.0), snap?.bpm)) * .3f else 0f
    Box(modifier) {
        Segmented(Modifier.fillMaxSize(), color) {
            Key("÷2", Modifier.width(StripEnd).fillMaxHeight(), base, live, description = "${ui.id} halve loop", style = KeyStyle.BARE, textSize = 15) { model.resizeLoop(ui.id, LoopChange.HALVE) }
            Divider(base)
            ValueWheel("${ui.id} loop size", LOOP_CHOICES.map(::beatText), nearest(LOOP_CHOICES, beats), ux, model, ui.id, Modifier.weight(1f).fillMaxHeight(), color,
                if (live && !gridded && ui.ready) "NO BPM" else "LOOP ${beatText(beats)}", icon = Glyph.Loop, live = live, bare = true, pulse = pulse,
                onTap = { if (usable) model.toggleLoop(ui.id) }) { model.submit(AudioCommand.LoopResize(ui.id, LoopChange.SET, LOOP_CHOICES[it])) }
            Divider(base)
            Key("×2", Modifier.width(StripEnd).fillMaxHeight(), base, live, description = "${ui.id} double loop", style = KeyStyle.BARE, textSize = 15) { model.resizeLoop(ui.id, LoopChange.DOUBLE) }
        }
        if (!live) PendingTag(Modifier.align(Alignment.TopCenter))
    }
}

/** Pitch key carries its own readouts: BPM (when gridded), key, and pitch adjustment. Opens the pitch popup. */
@Composable fun PitchKey(ui: DeckUi, model: PlayerModel, ux: UiModel, modifier: Modifier) {
    val color = deckColor(ui.id)
    val open = model.pitchDrawer == ui.id
    val e = ux.extras.getValue(ui.id)
    Box(modifier) {
        Key("", Modifier.fillMaxSize(), color, model.supports("varispeed"), open, "${ui.id} pitch panel") { model.pitchDrawer = if (open) null else ui.id }
        Row(Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("%+.2f%%".format(ui.pitch), color = if (ui.pitch == 0.0) Ink.text else color, size = 14, bold = true)
            Spacer(Modifier.weight(1f))
            Column(horizontalAlignment = Alignment.End) {
                // Synced: lit SYNC tag and the Group Tempo; out of lock / waiting flagged.
                val sync = model.syncState.decks[ui.id] ?: dev.manadj.audio.SyncStatus.OFF
                val groupTempo = model.syncState.tempo.takeIf { sync == dev.manadj.audio.SyncStatus.SYNCED }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (sync != dev.manadj.audio.SyncStatus.OFF) Text(when (sync) { dev.manadj.audio.SyncStatus.SYNCED -> "SYNC "; dev.manadj.audio.SyncStatus.OUT_OF_LOCK -> "SYNC⚠ "; else -> "SYNC… " }, color = if (sync == dev.manadj.audio.SyncStatus.SYNCED) Ink.play else Ink.warning, size = 9, bold = true)
                    Text(groupTempo?.let { "%.1f".format(it) } ?: ui.snapshot?.bpm?.let { "%.1f".format(it * (1 + (ui.pitch + ui.bend) / 100)) } ?: "— BPM", color = if (ui.snapshot?.bpm != null) Ink.text else Ink.muted, size = 12, bold = true)
                }
                Row(verticalAlignment = Alignment.CenterVertically) { if (ui.snapshot?.keyLock == true || (e.keyLock && !model.supports("key-lock"))) GlyphIcon(Glyph.Lock, color, 9.dp); Text(" KEY —", color = Ink.muted, size = 10) }
            }
        }
    }
}

/** Stems surface (vocals / drums / bass / other). Separation is pending in the engine; rendered and marked. */
@Composable fun StemsStrip(ui: DeckUi, ux: UiModel, model: PlayerModel, modifier: Modifier) {
    val live = model.supports("stems")
    val e = ux.extras.getValue(ui.id)
    val undo = ux.undoCue?.takeIf { it.first == ui.id }
    // Mirrored between decks: SHIFT sits on the outer edge (A left, B right).
    val outerRight = ui.id == DeckId.B
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (!outerRight) { ShiftKey(ui.id, ux, Modifier.width(50.dp).fillMaxHeight()); Spacer(Modifier.width(2.dp)) }
        if (undo != null) {
            if (outerRight) Key("UNDO", Modifier.width(72.dp).fillMaxHeight(), Ink.warning, style = KeyStyle.PILL, textSize = 11) { ux.undoDelete(model) }
            Text("CUE ${undo.second + 1} DELETED", Modifier.weight(1f).padding(horizontal = 4.dp), Ink.muted, 10, true)
            if (!outerRight) Key("UNDO", Modifier.width(72.dp).fillMaxHeight(), Ink.warning, style = KeyStyle.PILL, textSize = 11) { ux.undoDelete(model) }
        } else {
            if (!live && outerRight) PendingTag()
            listOf("VOC", "DRM", "BAS", "OTH").forEachIndexed { i, name ->
                val on = e.stems[i]
                Key(name, Modifier.weight(1f).fillMaxHeight(), Ink.stems[i], live || ux.previewPending, on && (live || ux.previewPending), "${ui.id} stem $name", style = KeyStyle.BARE, textSize = 10) { if (live || ux.previewPending) e.stems[i] = !on else ux.pending("Stems") }
            }
            if (!live && !outerRight) PendingTag()
        }
        if (outerRight) { Spacer(Modifier.width(2.dp)); ShiftKey(ui.id, ux, Modifier.width(50.dp).fillMaxHeight()) }
    }
}

/** SHIFT: hold for momentary, short tap latches it for the next pad press (tap again to cancel). */
@Composable fun ShiftKey(deck: DeckId, ux: UiModel, modifier: Modifier) {
    val on = ux.shifted(deck)
    val shape = RoundedCornerShape(50)
    Box(modifier.semantics { contentDescription = "$deck shift" }.pointerInput(deck) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false); down.consume()
            val wasLatched = ux.shiftLatched[deck] == true
            ux.shiftHeld[deck] = true
            val start = down.uptimeMillis
            var up = down.uptimeMillis
            try { while (true) { val c = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break; up = c.uptimeMillis; if (!c.pressed) break } }
            finally { ux.shiftHeld[deck] = false }
            if (up - start < 250) ux.shiftLatched[deck] = !wasLatched else ux.shiftLatched[deck] = false
        }
    }.padding(vertical = 2.dp).clip(shape).background(if (on) Ink.warning else Ink.panel).border(1.5.dp, Ink.warning, shape), contentAlignment = Alignment.Center) {
        Text("SHIFT", color = if (on) Color.Black else Ink.warning, size = 10, bold = true)
    }
}

/**
 * Momentary press where every pointer DOWN is a fresh press acting immediately — stabbing with one or
 * alternating fingers. A new finger releases the previous press first; [press] returns its release
 * (`cancelled` = the gesture was torn down rather than lifted).
 */
suspend fun androidx.compose.ui.input.pointer.PointerInputScope.momentaryPresses(enabled: () -> Boolean, press: () -> (Boolean) -> Unit) {
    awaitEachGesture {
        val first = awaitFirstDown(requireUnconsumed = false)
        if (!enabled()) return@awaitEachGesture
        first.consume()
        var current = first.id
        var release: ((Boolean) -> Unit)? = press()
        try {
            while (true) {
                val event = awaitPointerEvent()
                event.changes.firstOrNull { it.changedToDownIgnoreConsumed() && it.id != current }?.let { fresh ->
                    fresh.consume(); release?.invoke(false); current = fresh.id
                    release = if (enabled()) press() else null
                }
                val c = event.changes.firstOrNull { it.id == current }
                if (release != null && (c == null || !c.pressed)) { release!!.invoke(c == null); release = null }
                event.changes.forEach { if (it.pressed) it.consume() }
                if (event.changes.none { it.pressed }) break
            }
        } catch (cancel: CancellationException) { release?.invoke(true); release = null; throw cancel }
        finally { release?.invoke(true) }
    }
}
