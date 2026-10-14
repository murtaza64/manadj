package dev.manadj.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.manadj.audio.AudioCommand
import dev.manadj.audio.BpmMatch
import dev.manadj.audio.SyncStatus
import kotlin.math.*

/**
 * In-place pitch panel (#104/#105/#106): replaces one deck's control area (same bounds, full-bleed); the other
 * deck and the mixer stay live. Pitch fader, KEY LOCK · SYNC · = , jog strip (bend with momentum), VINYL-gated
 * scratch platter (always when paused), EDIT-gated grid controls.
 */
@Composable fun PitchPanel(ui: DeckUi, model: PlayerModel, ux: UiModel, modifier: Modifier) {
    val target = ui.id
    val color = deckColor(target)
    val varispeed = model.supports("varispeed")
    val bpm = ui.snapshot?.bpm
    val playing = ui.snapshot?.playing == true
    val vinyl = ux.vinyl[target] == true
    var edit by remember(target) { mutableStateOf(false) }
    Column(modifier.background(Ink.background).border(1.5.dp, color.copy(alpha = .7f))
        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}.padding(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        // Readout + close.
        Row(Modifier.fillMaxWidth().height(36.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("%+.2f%%".format(ui.pitch), color = color, size = 20, bold = true)
            Spacer(Modifier.width(8.dp))
            Text(bpm?.let { "%.2f".format(it * (1 + ui.pitch / 100)) } ?: "—", Modifier.weight(1f), if (bpm != null) Ink.text else Ink.muted, 12, true)
            Key("", Modifier.size(36.dp), Ink.muted, description = "Close pitch panel", icon = Glyph.Close, style = KeyStyle.BARE) { model.pitchDrawer = null }
        }
        // KEY LOCK · SYNC · = (desktop small match button).
        Row(Modifier.fillMaxWidth().height(38.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            val keyLock = model.supports("key-lock")
            val requested = ui.snapshot?.keyLock == true
            val waiting = keyLock && requested && ui.snapshot?.keyLockActive != true && ui.ready
            Key(if (waiting) "KEY…" else "KEY", Modifier.weight(1f).fillMaxHeight(), color, keyLock, requested, "$target key lock", Glyph.Lock, KeyStyle.PILL, textSize = 11) { model.setKeyLock(target, !requested) }
            val canSync = model.supports("sync")
            val status = model.syncState.decks[target] ?: SyncStatus.OFF
            var refused by remember(target) { mutableStateOf(false) }
            val label = when (status) { SyncStatus.SYNCED -> "SYNC ●"; SyncStatus.OUT_OF_LOCK -> "SYNC ⚠"; SyncStatus.WAITING -> "SYNC …"; else -> if (refused) "REACH" else "SYNC" }
            Key(label, Modifier.weight(1f).fillMaxHeight(), if (status == SyncStatus.OUT_OF_LOCK || refused) Ink.warning else color, canSync && bpm != null, status != SyncStatus.OFF, "$target sync", style = KeyStyle.PILL, textSize = 11) {
                refused = model.toggleSync(target) == BpmMatch.OutOfReach
            }
            Key("=", Modifier.width(44.dp).fillMaxHeight(), color, canSync && bpm != null, description = "$target match", style = KeyStyle.PILL, textSize = 16) { refused = model.match(target) == BpmMatch.OutOfReach }
        }
        Row(Modifier.fillMaxWidth().weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            // Long pitch fader: more travel, same relative drag + double-tap centre as before.
            PhysicalFader("PITCH", ((ui.pitch + 8) / 16).coerceIn(0.0, 1.0), model, target, Modifier.width(60.dp).fillMaxHeight(), varispeed, horizontal = false, doubleTapCenter = true, color = color) { v, id -> model.updatePitch(target, v * 16 - 8, id) }
            Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (vinyl || !playing) ScratchPlatter(ui, model, Modifier.fillMaxWidth().weight(1f))
                else Box(Modifier.fillMaxWidth().weight(1f).border(1.dp, Ink.surface0), contentAlignment = Alignment.Center) {
                    Text("VINYL off · jog bends", color = Ink.muted, size = 10, bold = true)
                }
                JogStrip(ui, model, Modifier.fillMaxWidth().height(56.dp))
            }
        }
        Row(Modifier.fillMaxWidth().height(34.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Key("VINYL", Modifier.weight(1f).fillMaxHeight(), color, model.supports("scratch"), vinyl, "$target vinyl", style = KeyStyle.PILL, textSize = 11) { ux.vinyl[target] = !vinyl }
            Key("EDIT GRID", Modifier.weight(1f).fillMaxHeight(), Ink.warning, engaged = edit, description = "$target edit grid", style = KeyStyle.PILL, textSize = 11) { edit = !edit }
        }
        if (edit) GridEdit(ui, model, color)
    }
}

/** Grid edit (behind EDIT so it can't be hit by accident): nudge, ½× / 2×, downbeat here, tap tempo. */
@Composable private fun GridEdit(ui: DeckUi, model: PlayerModel, color: Color) {
    val target = ui.id
    val bpm = ui.snapshot?.bpm
    val grid = model.supports("grid") && ui.ready
    val anchor = ui.snapshot?.gridAnchorSeconds ?: 0.0
    var taps by remember(target) { mutableStateOf(listOf<Long>()) }
    Text(bpm?.let { "GRID %.2f BPM · 1.1 @ %.3fs".format(it, anchor) } ?: "no grid — TAP the tempo", color = Ink.muted, size = 10, bold = true)
    Row(Modifier.fillMaxWidth().height(36.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        Key("◄", Modifier.weight(1f).fillMaxHeight(), color, grid && bpm != null, description = "$target grid earlier") { model.setGrid(target, bpm!!, anchor - .01) }
        Key("►", Modifier.weight(1f).fillMaxHeight(), color, grid && bpm != null, description = "$target grid later") { model.setGrid(target, bpm!!, anchor + .01) }
        Key("½×", Modifier.weight(1f).fillMaxHeight(), color, grid && bpm != null, description = "$target BPM halve", textSize = 11) { model.setGrid(target, bpm!! / 2, anchor) }
        Key("2×", Modifier.weight(1f).fillMaxHeight(), color, grid && bpm != null, description = "$target BPM double", textSize = 11) { model.setGrid(target, bpm!! * 2, anchor) }
    }
    Row(Modifier.fillMaxWidth().height(36.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        Key("1.1 HERE", Modifier.weight(1f).fillMaxHeight(), color, grid && bpm != null, description = "$target set downbeat here", textSize = 11) { model.setGrid(target, bpm!!, position(ui)) }
        Key("TAP", Modifier.weight(1f).fillMaxHeight(), color, grid, description = "$target tap tempo", textSize = 11) {
            val now = System.currentTimeMillis()
            taps = (taps.filter { now - it < 2500 } + now).takeLast(9)
            if (taps.size >= 4) model.setGrid(target, 60 / ((taps.last() - taps.first()) / 1000.0 / (taps.size - 1)), position(ui))
        }
    }
}

/**
 * Jog strip (#104.2): swipes spin a virtual jog edge. Platter velocity follows the finger (a swipe slower than the
 * spinning platter doesn't brake it; an opposite swipe does), then coasts with friction (τ 350 ms). Bend follows
 * desktop's mouse jog curve (mouseJogSettings: 8·(|v|·2/6000)^1.8, smoothed τ 50 ms, engine clamp ±8 %), so many
 * fast swipes move fast and slow swipes give fine nudges; bend is key-locked by the engine when Key Lock is on.
 * Paused: the swipe seeks (desktop mouseControl: speed-scaled seconds per dp). Haptic tick per swipe.
 */
@Composable fun JogStrip(ui: DeckUi, model: PlayerModel, modifier: Modifier) {
    val haptic = LocalHapticFeedback.current
    val density = LocalDensity.current.density
    val color = deckColor(ui.id)
    val ready by remember(ui) { derivedStateOf { ui.ready && model.supports("bend") } }
    val currentReady by rememberUpdatedState(ready)
    val state = remember(ui.id) { JogState() }
    // Physics ticker: runs while the platter moves or a bend is still applied.
    LaunchedEffect(ui.id, state.active) {
        if (!state.active) return@LaunchedEffect
        var last = withFrameNanos { it }
        while (true) {
            val now = withFrameNanos { it }
            val dt = ((now - last) / 1e9).coerceIn(0.0, .05); last = now
            if (!state.touching) state.velocity *= exp(-dt / .35)
            state.phase += (state.velocity * dt).toFloat()
            val v = abs(state.velocity)
            val target = sign(state.velocity) * min(8.0, 8 * (v * 2 / 6000).pow(1.8))
            state.bend += (1 - exp(-dt / .05)) * (target - state.bend)
            if (!state.touching && v < 2 && abs(state.bend) < .01) { state.bend = 0.0; state.velocity = 0.0; if (state.sent != 0.0) { model.updateBend(ui.id, 0.0); state.sent = 0.0 }; state.active = false; break }
            if (abs(state.bend - state.sent) > .004) { model.updateBend(ui.id, state.bend); state.sent = state.bend }
        }
    }
    Box(modifier.clip(RoundedCornerShape(6.dp)).background(Ink.crust).border(1.dp, color.copy(alpha = .6f), RoundedCornerShape(6.dp)).semantics { contentDescription = "${ui.id} jog" }.pointerInput(ui.id) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            if (!currentReady) return@awaitEachGesture
            down.consume(); haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            val paused = ui.snapshot?.playing != true
            var lastX = down.position.x; var lastT = down.uptimeMillis
            var finger = 0.0 // dp/s, smoothed
            var seekTo = position(ui)
            state.touching = true; if (!paused) state.active = true
            try {
                while (true) {
                    val c = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                    if (!c.pressed) break
                    val dxDp = (c.position.x - lastX) / density
                    val dt = ((c.uptimeMillis - lastT) / 1000.0).coerceAtLeast(.001)
                    lastX = c.position.x; lastT = c.uptimeMillis
                    val inst = dxDp / dt
                    finger += (1 - exp(-dt / .05)) * (inst - finger)
                    if (paused) {
                        val speed = abs(finger)
                        val k = ((speed - 150) / 1850).coerceIn(0.0, 1.0).let { it * it * (3 - 2 * it) }
                        seekTo += dxDp * (.00125 + .04875 * k)
                        state.phase += dxDp
                        model.submit(AudioCommand.Seek(ui.id, seekTo))
                    } else if (dxDp != 0f) {
                        // A slower same-direction swipe rides on the spinning platter; opposite or faster drives it.
                        state.velocity = if (sign(finger) == sign(state.velocity) && abs(finger) < abs(state.velocity)) state.velocity else finger
                    }
                    c.consume()
                }
            } finally { state.touching = false }
        }
    }) {
        Canvas(Modifier.fillMaxSize()) {
            // Ridges drift with the platter: motion you can see.
            val gap = 14.dp.toPx(); val off = ((state.phase * density) % gap + gap) % gap
            var x = off - gap
            while (x < size.width) { drawLine(color.copy(alpha = .35f), Offset(x, size.height * .2f), Offset(x, size.height * .8f), 2.dp.toPx()); x += gap }
            val b = state.bend.toFloat() / 8f
            if (b != 0f) drawRect(color.copy(alpha = .25f), Offset(if (b < 0) size.width / 2 * (1 + b) else size.width / 2, 0f), androidx.compose.ui.geometry.Size(size.width / 2 * abs(b), size.height))
        }
        Text(if (ui.snapshot?.playing == true) "JOG · NUDGE" else "JOG · SEEK", Modifier.align(Alignment.Center).background(Ink.crust).padding(horizontal = 4.dp), Ink.muted, 10, true)
    }
}

private class JogState {
    var velocity = 0.0      // dp/s, signed
    var bend = 0.0
    var sent = 0.0
    var phase by mutableFloatStateOf(0f)
    var touching = false
    var active by mutableStateOf(false)
}

/**
 * Vinyl scratch platter (#104.4): circular drag turns the record — angle → track seconds at 33⅓ rpm (1.8 s per
 * turn), through the engine scratch path (desktop scratchMotion parity is engine-side). The marker follows the
 * deck position.
 */
@Composable fun ScratchPlatter(ui: DeckUi, model: PlayerModel, modifier: Modifier) {
    val color = deckColor(ui.id)
    val ready by remember(ui) { derivedStateOf { ui.ready && model.supports("scratch") } }
    val currentReady by rememberUpdatedState(ready)
    val haptic = LocalHapticFeedback.current
    Box(modifier.semantics { contentDescription = "${ui.id} scratch platter" }.pointerInput(ui.id) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            if (!currentReady) return@awaitEachGesture
            down.consume(); haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            val center = Offset(size.width / 2f, size.height / 2f)
            var lastAngle = atan2(down.position.y - center.y, down.position.x - center.x)
            var scratching = false
            try {
                while (true) {
                    val c = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                    if (!c.pressed) break
                    val a = atan2(c.position.y - center.y, c.position.x - center.x)
                    var d = a - lastAngle; lastAngle = a
                    if (d > PI) d -= (2 * PI).toFloat() else if (d < -PI) d += (2 * PI).toFloat()
                    if (d != 0f) {
                        if (!scratching) { scratching = true; model.scratchBegin(ui.id) }
                        model.scratchMove(ui.id, d / (2 * PI) * 1.8) // clockwise = forward
                    }
                    c.consume()
                }
            } finally { if (scratching) model.scratchEnd(ui.id) }
        }
    }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = min(size.width, size.height) / 2 - 3.dp.toPx()
            val c = Offset(size.width / 2, size.height / 2)
            drawCircle(Ink.crust, r, c)
            drawCircle(color.copy(alpha = .7f), r, c, style = Stroke(2.dp.toPx()))
            for (k in 1..3) drawCircle(Ink.surface0, r * (.45f + .17f * k), c, style = Stroke(1.dp.toPx()))
            val angle = (position(ui) / 1.8 * 2 * PI - PI / 2).toFloat()
            drawLine(color, c + Offset(cos(angle), sin(angle)) * (r * .3f), c + Offset(cos(angle), sin(angle)) * (r * .95f), 4.dp.toPx())
            drawCircle(color.copy(alpha = .5f), r * .12f, c)
        }
        Text("VINYL", color = Ink.muted, size = 9, bold = true)
    }
}
