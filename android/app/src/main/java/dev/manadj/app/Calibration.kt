package dev.manadj.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.manadj.audio.LatencyCalibrator
import dev.manadj.audio.TapCalibrator
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * Tap-along (#127/#129, engine API): optional warm-up (4 slow clicks, when nothing is calibrated) resolves the wrap,
 * then accented clicks at ≈110 BPM; the meter shows accepted taps and the spread locking in (±20 ms over 6 taps);
 * the engine finishes by itself once locked.
 */
@Composable fun TapAlong(model: PlayerModel) {
    val warmUp = model.reactionPrePass
    var warmTaps by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        snapshotFlow { model.reactionPrePass to model.reactionCoarse }.collect { (pre, coarse) ->
            if (!pre && coarse != null && !model.tapCalibrating) model.startTapCalibration()
        }
    }
    val haptic = LocalHapticFeedback.current
    val s = model.tapState
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.fillMaxWidth().height(110.dp).clip(RoundedCornerShape(10.dp)).background(Ink.accent.copy(alpha = .18f)).border(2.dp, if (s?.locked == true) Ink.play else Ink.accent, RoundedCornerShape(10.dp))
            .semantics { contentDescription = "Tap on each click" }
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    if (model.reactionPrePass) warmTaps++
                    model.tap(System.nanoTime())
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                }
            }, contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (warmUp) "WARM-UP" else "TAP", color = Ink.accent, size = 28, bold = true)
                Text(if (warmUp) "tap each slow click · $warmTaps / ${LatencyCalibrator.REACTION_CLICKS}" else "on every click you hear", color = Ink.muted, size = 11)
            }
        }
        if (!warmUp) LockMeter(s)
        Text(
            if (warmUp) "Rough estimate first, so the fast taps can't land a beat off."
            else "wrap from ${model.coarseSource} %.0f ms".format(model.coarseLatency * 1000),
            color = Ink.muted, size = 10,
        )
        Row(Modifier.fillMaxWidth().height(36.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (warmUp) Key("SKIP WARM-UP", Modifier.weight(1f).fillMaxHeight(), Ink.accent, description = "Skip warm-up", textSize = 11, style = KeyStyle.PILL) { model.startTapCalibration() }
            else if (s?.candidateSeconds == null) Key("STOP", Modifier.weight(1f).fillMaxHeight(), Ink.warning, description = "Stop tap calibration", textSize = 11, style = KeyStyle.PILL) { model.finishTapCalibration() }
            else Key("SAVE %.0f ms".format(s.candidateSeconds!! * 1000), Modifier.weight(1f).fillMaxHeight(), Ink.play, description = "Save tap calibration", textSize = 11, style = KeyStyle.PILL) { model.finishTapCalibration() }
        }
    }
}

/** Accepted taps toward [TapCalibrator.LOCK_TAPS], then the spread closing on ±20 ms. */
@Composable private fun LockMeter(s: TapCalibrator.State?) {
    val spread = s?.spreadMillis
    val lockMs = TapCalibrator.LOCK_SPREAD * 1000
    val fill = when {
        s == null -> 0f
        spread == null -> .5f * s.accepted / TapCalibrator.LOCK_TAPS
        else -> (.5f + .5f * ((60 - spread) / (60 - lockMs)).toFloat()).coerceIn(.5f, 1f)
    }
    val color = if (s?.locked == true) Ink.play else Ink.accent
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Box(Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp)).background(Ink.surface).drawBehind {
            drawRect(color, size = Size(size.width * fill, size.height))
        })
        Row {
            Text(when {
                s == null -> "starting…"
                spread == null -> "${s.accepted} / ${TapCalibrator.LOCK_TAPS} taps"
                s.locked -> "locked"
                else -> "±%.0f ms → ±%.0f".format(spread, lockMs)
            }, Modifier.weight(1f), color, 11, true)
            s?.candidateSeconds?.let { Text("%.0f ms".format(it * 1000), color = Ink.text, size = 13, bold = true) }
        }
    }
}

/**
 * Align by ear (#129): the engine loops accented clicks every [PlayerModel.EAR_PERIOD]; the pad flashes at each
 * click's render instant + the slider offset, compensated for display latency (the frame drawn for vsync T shows
 * ≈2 frames later). Slide until flash and click coincide; SAVE stores the offset as L.
 */
@Composable fun EarAlign(model: PlayerModel) {
    var offsetMs by remember { mutableIntStateOf((model.heardLatency * 1000).roundToInt().coerceIn(0, MAX_OFFSET_MS)) }
    val haptic = LocalHapticFeedback.current
    var frameTime by remember { mutableLongStateOf(0L) }
    var framePeriod by remember { mutableLongStateOf(8_333_333L) }
    LaunchedEffect(Unit) {
        var last = 0L
        while (true) withFrameNanos {
            if (last != 0L) { val d = it - last; if (d in 4_000_000L..40_000_000L) framePeriod = (framePeriod * 7 + d) / 8 }
            last = it; frameTime = it
        }
    }
    fun set(ms: Int) {
        val v = ms.coerceIn(0, MAX_OFFSET_MS)
        if (v / 10 != offsetMs / 10) haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        offsetMs = v
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.fillMaxWidth().height(110.dp).clip(RoundedCornerShape(10.dp)).background(Ink.surface).drawBehind {
            val visible = (if (frameTime != 0L) frameTime else System.nanoTime()) + 2 * framePeriod
            val target = visible - offsetMs * 1_000_000L
            val clicks = model.clickNanos()
            val known = clicks.filter { it in 1..target }.maxOrNull() ?: return@drawBehind
            val period = (PlayerModel.EAR_PERIOD * 1e9).toLong()
            val click = known + floor((target - known).toDouble() / period).toLong() * period
            val alpha = (1 - (target - click) / 1e9 / FLASH_SECONDS).toFloat().coerceIn(0f, 1f)
            if (alpha > 0) drawRect(Ink.accent.copy(alpha = alpha), Offset.Zero, size)
        }.semantics { contentDescription = "Flash" }, contentAlignment = Alignment.Center) {
            Text("flash = click?", color = Ink.text, size = 13)
        }
        // Slider: 1 ms per step, haptic every 10 ms.
        Box(Modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(8.dp)).border(1.dp, Ink.accent, RoundedCornerShape(8.dp))
            .semantics { contentDescription = "Offset slider" }
            .pointerInput(Unit) {
                val stepPx = 5.dp.toPx(); var acc = 0f
                detectHorizontalDragGestures(onDragStart = { acc = 0f }) { change, dx ->
                    change.consume(); acc += dx
                    val steps = (acc / stepPx).toInt()
                    if (steps != 0) { acc -= steps * stepPx; set(offsetMs + steps) }
                }
            }, contentAlignment = Alignment.Center) {
            Text("◂  %d ms  ▸".format(offsetMs), color = Ink.text, size = 16, bold = true)
        }
        Row(Modifier.fillMaxWidth().height(36.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (step in listOf(-10, -1, 1, 10)) Key((if (step > 0) "+" else "−") + "${kotlin.math.abs(step)}", Modifier.weight(1f).fillMaxHeight(), Ink.accent, description = "Offset $step ms", textSize = 11, style = KeyStyle.PILL) { set(offsetMs + step) }
        }
        Row(Modifier.fillMaxWidth().height(36.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Key("CANCEL", Modifier.weight(1f).fillMaxHeight(), Ink.warning, description = "Cancel align by ear", textSize = 11, style = KeyStyle.PILL) { model.finishEarAlign(null) }
            Key("SAVE $offsetMs ms", Modifier.weight(1f).fillMaxHeight(), Ink.play, description = "Save align by ear", textSize = 11, style = KeyStyle.PILL) { model.finishEarAlign(offsetMs / 1000.0) }
        }
    }
}

private const val MAX_OFFSET_MS = 1000
private const val FLASH_SECONDS = .09
