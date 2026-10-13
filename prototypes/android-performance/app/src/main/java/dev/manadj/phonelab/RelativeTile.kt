package dev.manadj.phonelab

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.border
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.min
import kotlin.math.sign

/** Rotary motion is relative; visible faders map to their physical rail and preserve handle grab offset. */
@Composable fun RelativeTile(label: String, value: Float, onValue: (Float) -> Unit, model: DjModel, modifier: Modifier, horizontal: Boolean = false, neutral: Float? = 0.5f, owner: String = model.active, fader: Boolean = label == "VOL" || label == "PITCH") {
    val currentValue by rememberUpdatedState(value)
    val currentSetter by rememberUpdatedState(onValue)
    var rootY by remember { mutableFloatStateOf(0f) }
    var rootX by remember { mutableFloatStateOf(0f) }
    val controlId = "$owner / $label"
    val touched = model.touches[controlId] == true
    val color = if (owner == "A") Palette.cyan else if (owner == "B") Palette.pink else Palette.accent
    val haptic = LocalHapticFeedback.current
    BoxWithConstraints(modifier
        .background(if (touched) color.copy(alpha = .09f) else Palette.base)
        .semantics {
            contentDescription = "$owner $label control"; stateDescription = "${(value * 100).toInt()}%"
            customActions = listOf(CustomAccessibilityAction("Reset $label") { currentSetter(neutral ?: currentValue); true })
        }
        .onGloballyPositioned { rootY = it.positionInRoot().y; rootX = it.positionInRoot().x }
        .pointerInput(controlId, horizontal, fader) {
            val scope = CoroutineScope(currentCoroutineContext())
            var lastTap = -1000L
            var lastTapPosition = Offset.Zero
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                val firstValue = currentValue
                if (fader || horizontal) {
                    val lo = if (horizontal) 22.dp.toPx() else 16.dp.toPx()
                    val hi = (if (horizontal) size.width.toFloat() else size.height.toFloat()) - lo
                    val span = (hi - lo).coerceAtLeast(1f)
                    val thumb = lo + span * (if (horizontal) firstValue else 1 - firstValue)
                    val origin = if (horizontal) down.position.x else down.position.y
                    val grab = if (abs(origin - thumb) <= (if (horizontal) 22.dp.toPx() else 14.dp.toPx())) origin - thumb else 0f
                    fun write(coordinate: Float) {
                        val at = ((coordinate - grab - lo) / span).coerceIn(0f, 1f)
                        currentSetter(if (horizontal) at else 1 - at)
                    }
                    model.beginTouch(controlId); down.consume(); write(origin)
                    var cancelled = false
                    try {
                        while (true) {
                            val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                            if (change == null || (!change.pressed && change.isConsumed)) { cancelled = true; break }
                            if (!change.pressed) break
                            write(if (horizontal) change.position.x else change.position.y); change.consume()
                        }
                    } catch (cancel: CancellationException) { cancelled = true; throw cancel }
                    finally { if (cancelled) currentSetter(firstValue); model.releaseTouch(controlId, cancelled) }
                    return@awaitEachGesture
                }
                var baseline = firstValue
                var baselineCoordinate = if (horizontal) down.position.x else down.position.y
                var lastCoordinate = baselineCoordinate
                var lastY = down.position.y
                var moved = false
                var fine = false
                var cancelled = false
                var observedReset = 0
                var previousValue = firstValue
                var inNotch = neutral != null && abs(firstValue - neutral) < .001f
                var notchCoordinate = baselineCoordinate
                model.beginTouch(controlId)
                val hold = scope.launch {
                    delay(350)
                    if (!moved) {
                        fine = true
                        baseline = currentValue
                        baselineCoordinate = lastCoordinate
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        model.showPrecision(Precision(controlId, currentValue, rootY + lastY, firstValue, neutral ?: firstValue, reset = { currentSetter(neutral ?: firstValue) }, anchorX = rootX + down.position.x))
                    }
                }
                try {
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (!change.pressed) {
                            if (change.isConsumed) { cancelled = true; currentSetter(firstValue) }
                            val tap = !moved && !fine && !cancelled && change.uptimeMillis - down.uptimeMillis < 250
                            if (tap && down.uptimeMillis - lastTap < 300 && (down.position - lastTapPosition).getDistance() < 32.dp.toPx()) {
                                currentSetter(neutral ?: firstValue)
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                lastTap = -1000L
                            } else {
                                lastTap = if (tap) change.uptimeMillis else -1000L
                                lastTapPosition = down.position
                            }
                            break
                        }
                        val coordinate = if (horizontal) change.position.x else change.position.y
                        lastY = change.position.y
                        lastCoordinate = coordinate
                        if (abs(coordinate - baselineCoordinate) > 6.dp.toPx()) moved = true
                        if (coordinate != baselineCoordinate || moved) {
                            if (moved && !fine) hold.cancel()
                            val feedback = model.precision[controlId]
                            if (fine && feedback != null && feedback.resetVersion != observedReset) {
                                baseline = feedback.value
                                baselineCoordinate = coordinate
                                observedReset = feedback.resetVersion
                            }
                            val span = (if (horizontal) 220.dp.toPx() else 180.dp.toPx()) * (if (fine) 3.5f else 1f)
                            val direction = if (horizontal) 1 else -1
                            var next = (baseline + direction * (coordinate - baselineCoordinate) / span).coerceIn(0f, 1f)
                            if (neutral != null) {
                                val escape = (if (fine) 2.dp else 6.dp).toPx()
                                if (inNotch) {
                                    val travel = coordinate - notchCoordinate
                                    if (abs(travel) <= escape) next = neutral
                                    else {
                                        inNotch = false; baseline = neutral
                                        baselineCoordinate = notchCoordinate + sign(travel) * escape
                                        next = (neutral + direction * (coordinate - baselineCoordinate) / span).coerceIn(0f, 1f)
                                    }
                                } else if (previousValue != neutral && (previousValue - neutral) * (next - neutral) <= 0) {
                                    next = neutral; inNotch = true; notchCoordinate = coordinate
                                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                }
                            }
                            previousValue = next
                            currentSetter(next)
                            if (fine) model.updatePrecision(controlId, next)
                            change.consume()
                        }
                    }
                } catch (cancel: CancellationException) {
                    cancelled = true
                    currentSetter(firstValue)
                    throw cancel
                } finally {
                    hold.cancel()
                    model.releaseTouch(controlId, cancelled)
                }
            }
        }
    ) {
        if (!horizontal && !fader) Label(label, Modifier.align(Alignment.Center).offset(y = (-16).dp), color = if (touched) color else Palette.muted, size = 11, bold = true)
        Canvas(if (horizontal || fader) Modifier.fillMaxSize().padding(8.dp) else Modifier.align(Alignment.Center).offset(y = 6.dp).size(30.dp)) {
            if (horizontal) {
                val y = size.height / 2
                val left = 14.dp.toPx(); val travel = (size.width - left * 2).coerceAtLeast(1f)
                drawLine(Palette.surface, Offset(left, y), Offset(left + travel, y), 2.dp.toPx())
                repeat(9) { i -> val x = left + travel * i / 8; drawLine(Palette.muted.copy(alpha = .4f), Offset(x, y - 4.dp.toPx()), Offset(x, y + 4.dp.toPx()), 1f) }
            } else if (fader) {
                val x = size.width / 2
                val top = 8.dp.toPx(); val bottom = (size.height - top).coerceAtLeast(top)
                drawLine(Palette.surface, Offset(x, top), Offset(x, bottom), 3.dp.toPx())
                repeat(9) { i -> val y = top + (bottom - top) * i / 8; drawLine(Palette.muted.copy(alpha = .4f), Offset(x - 9.dp.toPx(), y), Offset(x + 9.dp.toPx(), y), 1f) }
            } else {
                val radius = min(min(size.width, size.height) / 2 - 3.dp.toPx(), 27.dp.toPx()).coerceAtLeast(2f)
                val c = Offset(size.width / 2, size.height / 2)
                drawArc(Palette.surface, 135f, 270f, false, Offset(c.x - radius, c.y - radius), Size(radius * 2, radius * 2), style = Stroke(2.dp.toPx()))
                drawArc(color, 135f, 270f * value, false, Offset(c.x - radius, c.y - radius), Size(radius * 2, radius * 2), style = Stroke(2.dp.toPx()))
                drawCircle(Palette.mantle, radius * .77f, c)
                drawCircle(Palette.surface, radius * .77f, c, style = Stroke(1.dp.toPx()))
                val angle = Math.toRadians((135 + 270 * value).toDouble())
                drawLine(color, c + Offset(cos(angle).toFloat(), sin(angle).toFloat()) * (radius * .35f), c + Offset(cos(angle).toFloat(), sin(angle).toFloat()) * (radius * .73f), 2.dp.toPx())
            }
        }
        if (horizontal) Box(Modifier.align(Alignment.CenterStart).offset(x = (maxWidth - 44.dp) * value).width(44.dp).height(24.dp).border(2.dp, color).background(Palette.base), contentAlignment = Alignment.Center) { Label(label, color = color, size = 12, bold = true) }
        else if (fader) Box(Modifier.align(Alignment.TopCenter).offset(y = 4.dp + (maxHeight - 32.dp) * (1 - value)).width(44.dp).height(24.dp).border(2.dp, color).background(Palette.base), contentAlignment = Alignment.Center) { Label(label, color = color, size = 12, bold = true) }
    }
}
