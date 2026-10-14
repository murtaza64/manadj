package dev.manadj.app

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.manadj.audio.*
import kotlinx.coroutines.CancellationException
import kotlin.math.*

object Ink {
    val background = Color.Black
    val panel = Color(0xff090b0d)
    val text = Color(0xffd5d9e5)
    val muted = Color(0xff939aa8)
    val edge = Color(0xff3c424c)
    val accent = Color(0xff4a9eff)
    val play = Color(0xff00e676)
    val warning = Color(0xffffcc00)
    val playhead = Color(0xfff5c2e7)
    val cues = listOf(Color(0xff1e90ff), Color(0xffffd400), Color(0xffff8800), Color(0xffff4455), Color(0xff2ed573), Color(0xffff5cc8), Color(0xffa855f7), Color(0xff00cec9))
}
fun deckColor(id: DeckId) = when (id) { DeckId.A -> Color(0xff00e5ff); DeckId.B -> Color(0xffff2d95); DeckId.C -> Ink.warning; DeckId.D -> Ink.play }
fun clock(seconds: Double) = "%d:%02d".format(seconds.toInt() / 60, seconds.toInt() % 60)

@Composable fun Text(text: String, modifier: Modifier = Modifier, color: Color = Ink.text, size: Int = 13, bold: Boolean = false, lines: Int = 1) {
    BasicText(text, modifier, TextStyle(color = color, fontSize = size.sp, fontFamily = FontFamily.Monospace, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal), maxLines = lines, overflow = TextOverflow.Ellipsis)
}

@Composable fun Key(text: String, modifier: Modifier, color: Color = Ink.accent, enabled: Boolean = true, engaged: Boolean = false, description: String = text, action: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    Box(modifier.border(1.5.dp, if (enabled) color else Ink.edge).background(if (engaged) color.copy(alpha = .2f) else Ink.panel)
        .semantics { contentDescription = description; if (!enabled) disabled() }
        .clickable(enabled = enabled) { haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); action() }
        .padding(horizontal = 3.dp), contentAlignment = Alignment.Center) {
        Text(text, color = if (enabled) color else Ink.muted, bold = true)
    }
}

@Composable fun PhysicalFader(label: String, value: Double, model: PlayerModel, deck: DeckId, modifier: Modifier, enabled: Boolean, horizontal: Boolean = false, set: (Double, String?) -> Unit) {
    val current by rememberUpdatedState(value)
    val setter by rememberUpdatedState(set)
    val color = if (label == "XF") Ink.accent else deckColor(deck)
    BoxWithConstraints(modifier.semantics { contentDescription = "${deck.name} $label"; stateDescription = "${(value * 100).roundToInt()}%"; if (!enabled) disabled() }.pointerInput(deck, label, enabled, horizontal) {
        if (!enabled) return@pointerInput
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val start = current
            val id = model.beginGesture(deck, label) { setter(start, it) }
            val low = if (horizontal) 22.dp.toPx() else 16.dp.toPx()
            val high = (if (horizontal) size.width.toFloat() else size.height.toFloat()) - low
            val travel = (high - low).coerceAtLeast(1f)
            val thumb = low + travel * (if (horizontal) start else 1 - start)
            val origin = if (horizontal) down.position.x else down.position.y
            val grab = if (abs(origin - thumb) <= (if (horizontal) 22.dp.toPx() else 14.dp.toPx())) origin - thumb else 0.0
            fun update(coordinate: Float) { if (!model.gestureActive(id)) return; val fraction = ((coordinate - grab - low) / travel).coerceIn(0.0, 1.0); setter(if (horizontal) fraction else 1 - fraction, id) }
            down.consume(); update(origin)
            var cancelled = false
            try {
                while (true) {
                    val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                    if (change == null || (!change.pressed && change.isConsumed)) { cancelled = true; break }
                    if (!change.pressed) break
                    update(if (horizontal) change.position.x else change.position.y); change.consume()
                }
            } catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { model.finishGesture(id, cancelled) }
        }
    }) {
        Canvas(Modifier.fillMaxSize()) {
            val low = if (horizontal) 22.dp.toPx() else 16.dp.toPx()
            val high = (if (horizontal) size.width else size.height) - low
            if (horizontal) drawLine(Ink.edge, Offset(low, center.y), Offset(high, center.y), 3.dp.toPx())
            else drawLine(Ink.edge, Offset(center.x, low), Offset(center.x, high), 3.dp.toPx())
            repeat(9) { i ->
                val at = low + (high - low) * i / 8
                if (horizontal) drawLine(Ink.muted, Offset(at, center.y - 5.dp.toPx()), Offset(at, center.y + 5.dp.toPx()), 1f)
                else drawLine(Ink.muted, Offset(center.x - 8.dp.toPx(), at), Offset(center.x + 8.dp.toPx(), at), 1f)
            }
        }
        val handle = if (horizontal) Modifier.align(Alignment.CenterStart).offset(x = (maxWidth - 44.dp) * value.toFloat()) else Modifier.align(Alignment.TopCenter).offset(y = 4.dp + (maxHeight - 32.dp) * (1 - value.toFloat()))
        Box(handle.width(44.dp).height(24.dp).background(Ink.background).border(2.dp, if (enabled) color else Ink.edge), contentAlignment = Alignment.Center) { Text(label, color = if (enabled) color else Ink.muted, size = 11, bold = true) }
    }
}

@Composable fun TrimKnob(ui: DeckUi, model: PlayerModel, modifier: Modifier) =
    Knob(ui, model, "TRIM", ui.trim, model.supports("trim"), modifier) { v, id -> model.updateTrim(ui.id, v, id) }

/** Relative-drag knob 0..1 with a sticky haptic notch at .5 and double-tap reset. */
@Composable fun Knob(ui: DeckUi, model: PlayerModel, label: String, value: Double, enabled: Boolean, modifier: Modifier, set: (Double, String?) -> Unit) {
    val current by rememberUpdatedState(value)
    val setter by rememberUpdatedState(set)
    val haptic = LocalHapticFeedback.current
    Box(modifier.semantics { contentDescription = "${ui.id} $label"; if (!enabled) disabled() }.pointerInput(ui.id, label, enabled) {
        if (!enabled) return@pointerInput
        var lastTap = -1000L
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val start = current
            val id = model.beginGesture(ui.id, label) { setter(start, it) }
            var moved = false
            var cancelled = false
            var notch = abs(start - .5) < .001
            var notchY = down.position.y
            var baselineY = down.position.y
            var baseline = start
            var last = start
            down.consume()
            try {
                while (true) {
                    val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                    if (change == null || (!change.pressed && change.isConsumed)) { cancelled = true; break }
                    if (!change.pressed) {
                        if (!moved && change.uptimeMillis - down.uptimeMillis < 250) {
                            if (down.uptimeMillis - lastTap < 300) { setter(.5, id); lastTap = -1000; haptic.performHapticFeedback(HapticFeedbackType.LongPress) }
                            else lastTap = change.uptimeMillis
                        }
                        break
                    }
                    if (!model.gestureActive(id)) break
                    val dy = change.position.y - baselineY
                    if (abs(dy) > 3.dp.toPx()) moved = true
                    var next = (baseline - dy / 180.dp.toPx()).coerceIn(0.0, 1.0)
                    if (notch) {
                        val distance = change.position.y - notchY
                        if (abs(distance) < 6.dp.toPx()) next = .5
                        else { notch = false; baselineY = notchY + sign(distance) * 6.dp.toPx(); baseline = .5; next = (.5 - (change.position.y - baselineY) / 180.dp.toPx()).coerceIn(0.0, 1.0) }
                    } else if (last != .5 && (last - .5) * (next - .5) <= 0) { notch = true; notchY = change.position.y; next = .5; haptic.performHapticFeedback(HapticFeedbackType.SegmentTick) }
                    last = next; setter(next, id); change.consume()
                }
            } catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { model.finishGesture(id, cancelled) }
        }
    }, contentAlignment = Alignment.Center) {
        Text(label, Modifier.offset(y = (-17).dp), if (enabled) deckColor(ui.id) else Ink.muted, 10, true)
        Canvas(Modifier.size(30.dp).offset(y = 6.dp)) {
            val r = size.minDimension * .4f
            drawArc(Ink.edge, 135f, 270f, false, center - Offset(r, r), Size(r * 2, r * 2), style = Stroke(2.dp.toPx()))
            val angle = Math.toRadians(135 + value * 270)
            drawLine(if (enabled) deckColor(ui.id) else Ink.muted, center, center + Offset(cos(angle).toFloat(), sin(angle).toFloat()) * r, 2.dp.toPx())
        }
    }
}

@Composable fun CueKey(ui: DeckUi, model: PlayerModel, modifier: Modifier) {
    val ready by remember(ui) { derivedStateOf { ui.ready } }
    val currentReady by rememberUpdatedState(ready)
    var held by remember { mutableStateOf(false) }
    Box(modifier.border(2.dp, if (ready) Ink.warning else Ink.edge).background(if (held) Ink.warning.copy(alpha = .3f) else Ink.panel).semantics { contentDescription = "${ui.id} CUE"; if (!ready) disabled() }.pointerInput(ui.id) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            if (!currentReady) return@awaitEachGesture
            val id = model.beginGesture(ui.id, "CUE") { model.submit(AudioCommand.CueUp(ui.id, it)) }
            held = true; down.consume(); model.submit(AudioCommand.CueDown(ui.id, id))
            var cancelled = false
            try { while (true) { val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }; if (change == null || (!change.pressed && change.isConsumed)) cancelled = true; if (change?.pressed != true || !model.gestureActive(id)) break } }
            catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { held = false; if (!cancelled && model.gestureActive(id)) model.submit(AudioCommand.CueUp(ui.id, id)); model.finishGesture(id, cancelled) }
        }
    }, contentAlignment = Alignment.Center) { Text("${ui.id} CUE", color = if (ready) Ink.warning else Ink.muted, bold = true) }
}

/** Empty pad: store a hot cue at the engine's applied position. Set pad: gated trigger (desktop semantics). */
@Composable fun Hotcue(ui: DeckUi, slot: Int, model: PlayerModel, modifier: Modifier) {
    val ready by remember(ui) { derivedStateOf { ui.ready && model.supports("hot-cue-gate") } }
    val currentReady by rememberUpdatedState(ready)
    val stored = ui.hotCues[slot]
    var held by remember { mutableStateOf(false) }
    Box(modifier.border(1.5.dp, if (ready) Ink.cues[slot] else Ink.edge).background(if (held || ui.snapshot?.previewSlot == slot) Ink.cues[slot].copy(alpha = .3f) else Ink.panel).semantics { contentDescription = "${ui.id} hotcue ${slot + 1}"; if (!ready) disabled() }.pointerInput(ui.id, slot) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            if (!currentReady) return@awaitEachGesture
            down.consume(); held = true
            val set = ui.hotCues[slot] != null
            val id = model.beginGesture(ui.id, "HOTCUE$slot") { if (set) model.submit(AudioCommand.HotCueUp(ui.id, slot, it)) }
            model.submit(if (set) AudioCommand.HotCueDown(ui.id, slot, id) else AudioCommand.SetHotCue(ui.id, slot, id))
            var cancelled = false
            try { while (true) { val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }; if (change == null || (!change.pressed && change.isConsumed)) cancelled = true; if (change?.pressed != true || !model.gestureActive(id)) break } }
            catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { held = false; if (!cancelled && set && model.gestureActive(id)) model.submit(AudioCommand.HotCueUp(ui.id, slot, id)); model.finishGesture(id, cancelled) }
        }
    }, contentAlignment = Alignment.Center) { Text("${slot + 1}${if (stored == null) " +" else ""}", color = if (ready) Ink.cues[slot] else Ink.muted, size = 16, bold = true) }
}

@Composable fun Bend(ui: DeckUi, model: PlayerModel, modifier: Modifier) {
    val ready by remember(ui) { derivedStateOf { ui.ready && model.supports("bend") } }
    val currentReady by rememberUpdatedState(ready)
    Box(modifier.border(1.5.dp, if (ready) deckColor(ui.id) else Ink.edge).semantics { contentDescription = "${ui.id} bend"; if (!ready) disabled() }.pointerInput(ui.id) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            if (!currentReady) return@awaitEachGesture
            val id = model.beginGesture(ui.id, "BEND") { model.updateBend(ui.id, 0.0, it) }
            val start = if (down.position.x < size.width / 2) -2.0 else 2.0
            down.consume(); model.updateBend(ui.id, start, id)
            var cancelled = false
            try {
                while (true) { val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }; if (change == null || (!change.pressed && change.isConsumed)) cancelled = true; if (change?.pressed != true || !model.gestureActive(id)) break; model.updateBend(ui.id, (start + (change.position.x - down.position.x) / 120.dp.toPx() * 8).coerceIn(-8.0, 8.0), id); change.consume() }
            } catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { if (!cancelled && model.gestureActive(id)) model.updateBend(ui.id, 0.0, id); model.finishGesture(id, cancelled) }
        }
    }, contentAlignment = Alignment.Center) { Text(if (ready) "− BEND ${"%+.1f".format(ui.bend)}% +" else "BEND · load a track", color = if (ready) deckColor(ui.id) else Ink.muted, size = 12, bold = true) }
}
