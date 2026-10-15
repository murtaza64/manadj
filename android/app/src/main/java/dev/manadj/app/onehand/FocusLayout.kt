package dev.manadj.app.onehand

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import dev.manadj.app.*
import dev.manadj.audio.DeckId
import kotlinx.coroutines.CancellationException
import kotlin.math.abs

/**
 * Concept A — FOCUS. One deck's full control set sits under the thumb (stair-stepped toward the bottom-right);
 * the other deck is a chip + its wave up top. A vertical MIX LEVER on the right edge drives the transition
 * macro (XF / bass swap / filter out) with a thumb flexion. Flick the pad block sideways (or tap the chip) to
 * switch focus; FX swaps the pads for the Beat FX card; PITCH overlays the deck's pitch panel.
 */
@Composable fun FocusLayout(model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit, modifier: Modifier, band: Dp) {
    // Block: as wide as the drawn zone (≥ 420 dp: the 4-pad grid + strips + the fader/lever column), 352 dp tall, centred on the zone.
    OneHandScaffold(model, ux, pick, modifier, band, waveHeight = 96.dp, blockSize = { z, s -> DpSize(maxOf(420.dp, (z.bbox.width * s.width.value).dp + 24.dp), 352.dp) }) { frame ->
        val f = OneHand.focus
        val ui = model.decks.getValue(f)
        val color = deckColor(f)
        var fx by remember { mutableStateOf(false) }
        var macro by remember { mutableStateOf(MixMacro.BASS) }
        val gap = 6.dp
        Box(Modifier.absoluteOffset(x = frame.left).width(frame.width)) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(gap)) {
                // Chips: rarely used, so they take the least reachable row; right-aligned toward the thumb.
                Row(Modifier.fillMaxWidth().height(34.dp), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End)) {
                    Key("", Modifier.width(44.dp).fillMaxHeight(), Ink.muted, description = "Settings", icon = Glyph.Gear, style = KeyStyle.PILL, textSize = 10) { ux.toggleSettings(model) }
                    val mode = model.output?.quantizeMode ?: ux.quantizeMode
                    Key("Q", Modifier.width(44.dp).fillMaxHeight(), Ink.accent, model.supports("quantize"), mode.quantized, "Quantize", style = KeyStyle.PILL, textSize = 11) { ux.setQuantize(model, on = !mode.quantized) }
                    val sync = model.syncState.decks[f] ?: dev.manadj.audio.SyncStatus.OFF
                    Key("SYNC", Modifier.width(60.dp).fillMaxHeight(), Ink.play, model.supports("sync"), sync != dev.manadj.audio.SyncStatus.OFF, "$f sync", style = KeyStyle.PILL, textSize = 11) { model.toggleSync(f) }
                    Key("PITCH", Modifier.width(62.dp).fillMaxHeight(), color, model.supports("varispeed"), model.pitchDrawer == f, "$f pitch panel", style = KeyStyle.PILL, textSize = 11) { model.pitchDrawer = if (model.pitchDrawer == f) null else f }
                    Key("FX", Modifier.width(50.dp).fillMaxHeight(), androidx.compose.ui.graphics.Color(ux.fx.effect.color), engaged = fx || ux.fx.on, description = "Beat FX page", style = KeyStyle.PILL, textSize = 11) { fx = !fx }
                    BrowseKey(model, ux, Modifier.width(80.dp).fillMaxHeight(), textSize = 11)
                }
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(gap)) {
                    Column(Modifier.weight(1f).focusFlick(), verticalArrangement = Arrangement.spacedBy(gap)) {
                        // Mixer strip for the focused deck: cut-only EQ (OH1), FILTER and LOW nearest the thumb.
                        Row(Modifier.fillMaxWidth().height(66.dp), horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                            Key("", Modifier.width(40.dp).height(34.dp), color, model.supports("pfl"), ui.snapshot?.pfl == true, "$f headphone cue", Glyph.Headphones, KeyStyle.PILL, textSize = 11) { model.togglePfl(f) }
                            val eq = model.supports("eq"); val filter = model.supports("filter")
                            val e = ux.extras.getValue(f)
                            val k = Modifier.width(56.dp).fillMaxHeight()
                            Knob("TRIM", KnobKind.TRIM, ui.trim, ux, model, f, Modifier.width(48.dp).fillMaxHeight(), model.supports("trim"), 30.dp) { v, id -> model.updateTrim(f, v, id) }
                            CutKnob("HI", KnobKind.EQ_HIGH, if (eq) ui.eq[2] else e.eqHigh, model, f, k, eq, 36.dp) { v, id -> if (eq) model.updateEq(f, 2, v, id) else e.eqHigh = v }
                            CutKnob("MID", KnobKind.EQ_MID, if (eq) ui.eq[1] else e.eqMid, model, f, k, eq, 36.dp) { v, id -> if (eq) model.updateEq(f, 1, v, id) else e.eqMid = v }
                            CutKnob("LOW", KnobKind.EQ_LOW, if (eq) ui.eq[0] else e.eqLow, model, f, k, eq, 36.dp) { v, id -> if (eq) model.updateEq(f, 0, v, id) else e.eqLow = v }
                            Knob("FILTER", KnobKind.FILTER, if (filter) (ui.filter + 1) / 2 else e.filter, ux, model, f, k, filter, 40.dp) { v, id -> if (filter) model.updateFilter(f, v * 2 - 1, id) else e.filter = v }
                        }
                        if (fx) FxSection(ux, model, Modifier.fillMaxWidth(), compact = true)
                        else Pads(ui, model, ux, Modifier.fillMaxWidth(), 4, 48.dp)
                        Row(Modifier.fillMaxWidth().height(ControlRow), horizontalArrangement = Arrangement.spacedBy(gap)) {
                            LoopStrip(ui, ux, model, Modifier.weight(1f).fillMaxHeight())
                            JumpStrip(ui, ux, model, Modifier.weight(1f).fillMaxHeight())
                        }
                    }
                    // Right column (OH3): both channel faders over the transition lever.
                    Column(Modifier.width(84.dp).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(gap)) {
                        FaderPair(model, Modifier.fillMaxWidth().height(120.dp))
                        MixLever(model, ux, macro, { macro = MixMacro.entries[(macro.ordinal + 1) % MixMacro.entries.size] }, Modifier.fillMaxWidth().weight(1f))
                    }
                }
                Row(Modifier.fillMaxWidth().height(TransportRow).screenSafe(), horizontalArrangement = Arrangement.spacedBy(gap)) {
                    FocusChip(model, Modifier.width(88.dp).fillMaxHeight(), textSize = 11)
                    BendStrip(ui, model, Modifier.weight(1f).fillMaxHeight())
                    CueKey(ui, model, Modifier.width(96.dp).fillMaxHeight())
                    PlayKey(ui, model, Modifier.width(116.dp).fillMaxHeight())
                }
            }
            // Pitch panel over the focused deck's block (transport stays).
            androidx.compose.animation.AnimatedVisibility(model.pitchDrawer == f, Modifier.matchParentSize().padding(bottom = TransportRow + gap), enter = fadeIn(tween(120)) + slideInVertically(tween(160)) { it / 14 }, exit = fadeOut(tween(110)) + slideOutVertically(tween(140)) { it / 14 }) {
                PitchPanel(ui, model, ux, Modifier.fillMaxSize())
            }
        }
    }
}

/**
 * MIX LEVER: vertical, A at the top (its wave is on top) and B at the bottom; relative drag, double-tap recentres,
 * tap the label to cycle the macro. The throw is the crossfader; BASS adds the bass swap, FILT the outgoing high-pass.
 */
@Composable fun MixLever(model: PlayerModel, ux: UiModel, macro: MixMacro, cycle: () -> Unit, modifier: Modifier) {
    val haptic = LocalHapticFeedback.current
    var held by remember { mutableStateOf(false) }
    val heat by animateFloatAsState(if (held) 1f else 0f, tween(if (held) 60 else 300), label = "lever")
    val current by rememberUpdatedState(model.crossfade)
    val currentMacro by rememberUpdatedState(macro)
    Column(modifier) {
        Key(macro.label, Modifier.fillMaxWidth().height(30.dp), Ink.accent, engaged = true, description = "Mix macro ${macro.label}: ${macro.blurb}", style = KeyStyle.PILL, textSize = 9, action = cycle)
        Box(Modifier.fillMaxWidth().weight(1f).halo(Ink.accent, heat * .8f, 6.dp).semantics { contentDescription = "Mix lever" }.pointerInput(Unit) {
            var lastTap = -1000L
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                val start = current
                val id = model.beginGesture(DeckId.A, "LEVER") { applyMixMacro(model, ux, currentMacro, start, it) }
                down.consume(); held = true
                val travel = (size.height - 40.dp.toPx()).coerceAtLeast(1f)
                var moved = false; var cancelled = false
                try {
                    while (true) {
                        val c = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                        if (c == null || (!c.pressed && c.isConsumed)) { cancelled = true; break }
                        if (!c.pressed) {
                            if (!moved && c.uptimeMillis - down.uptimeMillis < 250) {
                                if (down.uptimeMillis - lastTap < 320) { applyMixMacro(model, ux, currentMacro, .5, id); haptic.performHapticFeedback(HapticFeedbackType.LongPress); lastTap = -1000 } else lastTap = c.uptimeMillis
                            }
                            break
                        }
                        if (!model.gestureActive(id)) break
                        val dy = c.position.y - down.position.y
                        if (abs(dy) > 4.dp.toPx()) moved = true
                        if (moved) applyMixMacro(model, ux, currentMacro, (start + dy / travel).coerceIn(0.0, 1.0), id)
                        c.consume()
                    }
                } catch (cancel: CancellationException) { cancelled = true; throw cancel }
                finally { held = false; model.finishGesture(id, cancelled) }
            }
        }) {
            val v = model.crossfade.toFloat()
            Canvas(Modifier.fillMaxSize()) {
                val low = 20.dp.toPx(); val high = size.height - low
                val x = center.x
                drawLine(Ink.surface, Offset(x, low), Offset(x, high), 5.dp.toPx(), StrokeCap.Round)
                // A's share above the thumb, B's below (gain shading).
                val at = low + (high - low) * v
                drawLine(deckColor(DeckId.A).copy(alpha = .25f + .5f * (1 - v)), Offset(x, low), Offset(x, at), 5.dp.toPx(), StrokeCap.Round)
                drawLine(deckColor(DeckId.B).copy(alpha = .25f + .5f * v), Offset(x, at), Offset(x, high), 5.dp.toPx(), StrokeCap.Round)
                drawLine(Ink.muted, Offset(x - 10.dp.toPx(), (low + high) / 2), Offset(x + 10.dp.toPx(), (low + high) / 2), 1.5f)
                val hw = 22.dp.toPx(); val hh = 13.dp.toPx()
                drawRoundRect(Ink.crust, Offset(x - hw, at - hh), Size(hw * 2, hh * 2), androidx.compose.ui.geometry.CornerRadius(4.dp.toPx()))
                drawRoundRect(Ink.accent, Offset(x - hw, at - hh), Size(hw * 2, hh * 2), androidx.compose.ui.geometry.CornerRadius(4.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(1.5.dp.toPx()))
                drawLine(Ink.accent, Offset(x - hw * .6f, at), Offset(x + hw * .6f, at), 2.dp.toPx())
            }
            Text("A", Modifier.align(Alignment.TopCenter).padding(top = 2.dp), deckColor(DeckId.A), 11, true)
            Text("B", Modifier.align(Alignment.BottomCenter).padding(bottom = 2.dp), deckColor(DeckId.B), 11, true)
        }
    }
}
