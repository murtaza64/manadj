package dev.manadj.phonelab

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import kotlin.math.abs
import kotlin.math.roundToInt

val beatChoices = listOf(1, 2, 4, 8, 16, 32, 64, 128)

/** The original pointer owns the entire hold → detent → release transaction. */
@Composable fun ValueWheel(label: String, choices: List<String>, index: Int, onIndex: (Int) -> Unit, model: DjModel, modifier: Modifier, color: Color, text: String = choices[index], onTap: (() -> Unit)? = null) {
    val latestIndex by rememberUpdatedState(index)
    val setter by rememberUpdatedState(onIndex)
    val tap by rememberUpdatedState(onTap)
    var rootY by remember { mutableFloatStateOf(0f) }
    val haptic = LocalHapticFeedback.current
    fun chooser() { model.wheelChooser = WheelFeedback(label, choices, latestIndex, rootY, { setter(it) }) }
    Box(modifier.border(2.dp, color.copy(alpha = .7f)).background(color.copy(alpha = if (model.touches[label] == true) .2f else .04f))
        .onGloballyPositioned { rootY = it.positionInRoot().y }
        .semantics {
            contentDescription = label; stateDescription = choices[index]
            onClick { if (tap != null) tap?.invoke() else chooser(); true }
            customActions = listOf(CustomAccessibilityAction("Choose value") { chooser(); true })
        }.pointerInput(label, choices) {
            val scope = CoroutineScope(currentCoroutineContext())
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                down.consume(); model.beginTouch(label)
                val startIndex = latestIndex
                var chosen = startIndex
                var open = false
                var cancelled = false
                val hold = scope.launch {
                    delay(350); open = true
                    model.wheels[label] = WheelFeedback(label, choices, chosen, rootY, { setter(it) })
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                }
                try {
                    while (true) {
                        val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                        if (change == null || (!change.pressed && change.isConsumed)) { cancelled = true; break }
                        if (!change.pressed) break
                        val distance = change.position.x - down.position.x
                        if (abs(change.position.y - down.position.y) > 64.dp.toPx()) { cancelled = true; break }
                        if (open) {
                            val next = (startIndex + (distance / 28.dp.toPx()).roundToInt()).coerceIn(choices.indices)
                            if (next != chosen) { chosen = next; setter(next); haptic.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick) }
                            model.wheels[label] = WheelFeedback(label, choices, chosen, rootY, { setter(it) })
                            change.consume()
                        } else if (abs(distance) > 12.dp.toPx()) { cancelled = true; break }
                    }
                    if (!open && !cancelled) { if (tap != null) tap?.invoke() else chooser() }
                } catch (cancel: CancellationException) { cancelled = true; throw cancel }
                finally { hold.cancel(); if (cancelled) setter(startIndex); if (open) haptic.performHapticFeedback(if (cancelled) HapticFeedbackType.Reject else HapticFeedbackType.Confirm); model.releaseTouch(label, cancelled) }
            }
        }, contentAlignment = Alignment.Center) { Label(text, color = color, size = 15, bold = true) }
}

@Composable fun WheelOverlays(model: DjModel) {
    val density = LocalDensity.current
    model.wheels.values.firstOrNull()?.let { wheel ->
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val y = with(density) { (wheel.fingerY.toDp() - 108.dp).coerceIn(4.dp, (maxHeight - 100.dp).coerceAtLeast(4.dp)) }
            Column(Modifier.align(Alignment.TopCenter).offset(y = y).widthIn(max = 420.dp).fillMaxWidth().background(Palette.base).border(2.dp, Palette.accent).padding(6.dp)) {
                Label(wheel.label, color = Palette.accent, bold = true)
                Row(Modifier.fillMaxWidth().height(56.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    for (offset in -2..2) {
                        val i = wheel.index + offset
                        Box(Modifier.weight(1f).fillMaxHeight().border(if (offset == 0) 2.dp else 0.dp, if (offset == 0) Palette.accent else Color.Transparent), contentAlignment = Alignment.Center) {
                            Label(if (i in wheel.choices.indices) wheel.choices[i] else "", color = if (offset == 0) Palette.text else Palette.muted, size = if (offset == 0) 24 else 15, bold = offset == 0)
                        }
                    }
                }
            }
        }
    }
    model.wheelChooser?.let { wheel ->
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .65f)).clickable { model.wheelChooser = null }, contentAlignment = Alignment.Center) {
            Column(Modifier.widthIn(max = 360.dp).fillMaxWidth().background(Palette.base).border(2.dp, Palette.accent).padding(8.dp)) {
                Label(wheel.label, color = Palette.accent, size = 16, bold = true)
                wheel.choices.chunked(4).forEachIndexed { row, values -> Row(Modifier.fillMaxWidth().height(52.dp)) {
                    values.forEachIndexed { col, value -> Box(Modifier.weight(1f).fillMaxHeight().border(1.dp, Palette.accent).clickable { wheel.pick(row * 4 + col); model.wheelChooser = null }.semantics { contentDescription = "${wheel.label} $value" }, contentAlignment = Alignment.Center) { Label(value, size = 18, bold = true) } }
                } }
            }
        }
    }
}

/** Bend is temporary rate displacement, never pitch-fader state or an absolute seek. */
@Composable fun BendStrip(deck: Deck, model: DjModel, modifier: Modifier) {
    val color = if (deck.id == "A") Palette.cyan else Palette.pink
    val haptic = LocalHapticFeedback.current
    Box(modifier.background(color.copy(alpha = .06f)).border(2.dp, color.copy(alpha = .5f)).semantics { contentDescription = "${deck.id} momentary bend"; stateDescription = "${(deck.bend * 100).roundToInt()}%" }.pointerInput(deck) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            down.consume(); model.beginTouch("${deck.id} BEND")
            val initial = if (down.position.x < size.width / 2) -.02f else .02f
            deck.bend = initial
            haptic.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
            var cancelled = false
            try {
                while (true) {
                    val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                    if (change == null || (!change.pressed && change.isConsumed)) { cancelled = true; break }
                    if (!change.pressed) break
                    deck.bend = (initial + (change.position.x - down.position.x) / 120.dp.toPx() * .08f).coerceIn(-.08f, .08f)
                    change.consume()
                }
            } catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { deck.bend = 0f; model.releaseTouch("${deck.id} BEND", cancelled) }
        }
    }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize().padding(6.dp)) {
            val x = size.width * (.5f + deck.bend / .16f)
            drawLine(color, Offset(x, 0f), Offset(x, size.height), 3.dp.toPx())
        }
        Label(if (deck.bend == 0f) "−  BEND  +" else "${"%+.1f".format(deck.bend * 100)}%  ${"%.1f".format(deck.tempo * (1 + deck.bend))}", color = color, size = 13, bold = true)
    }
}
