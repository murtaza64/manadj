package dev.manadj.app

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.manadj.audio.DeckId
import kotlinx.coroutines.*
import kotlin.math.*

enum class KeyStyle { BOX, PILL, BARE }

/**
 * A press snaps in and springs back; pressed/engaged glows. The halo stays inside the node (see [halo]).
 * Signature prefix kept for engine-lane panels (OutputPanel).
 */
@Composable fun Key(
    text: String, modifier: Modifier, color: Color = Ink.accent, enabled: Boolean = true, engaged: Boolean = false, description: String = text,
    icon: Glyph? = null, style: KeyStyle = KeyStyle.BOX, pulse: Float = 0f, textSize: Int = 13, textColor: Color? = null, pending: Boolean = false, longPress: (() -> Unit)? = null, action: () -> Unit,
) {
    val haptic = LocalHapticFeedback.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .93f else 1f, if (pressed) tween(0) else spring(dampingRatio = .45f, stiffness = 900f), label = "key")
    val heat by animateFloatAsState(if (pressed) 1f else if (engaged) .5f else 0f, tween(if (pressed) 0 else 240), label = "glow")
    val tint = if (enabled) color else Ink.surface2
    val shape = if (style == KeyStyle.PILL) RoundedCornerShape(50) else RoundedCornerShape(2.dp)
    val inset = if (style == KeyStyle.BARE) 0.dp else 3.dp
    Box(modifier.halo(tint, (heat + pulse) * .8f, inset + 3.dp, style == KeyStyle.PILL).semantics { contentDescription = description; if (!enabled) disabled() }
        .then(if (longPress == null) Modifier.clickable(interactionSource = interaction, indication = null, enabled = enabled || pending) { haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); action() }
            else Modifier.combinedClickable(interactionSource = interaction, indication = null, enabled = enabled || pending, onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); longPress() }) { haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); action() })
        .padding(inset).graphicsLayer { scaleX = scale; scaleY = scale }
        .then(if (style == KeyStyle.BARE) Modifier else Modifier.clip(shape).background(Ink.panel).background(tint.copy(alpha = .28f * heat)).border(1.5.dp, tint.copy(alpha = if (engaged || pressed) 1f else .6f), shape))
        .padding(horizontal = 3.dp), contentAlignment = Alignment.Center) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            val ink = textColor ?: if (engaged || pressed) Ink.text else tint
            if (icon != null) GlyphIcon(icon, if (enabled) ink else Ink.surface2, (textSize + 3).dp)
            if (text.isNotEmpty()) Text(text, color = if (enabled) ink else Ink.muted, size = textSize, bold = true)
        }
        if (pending) PendingTag(Modifier.align(Alignment.TopEnd))
        if (style == KeyStyle.BARE && engaged) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth(.6f).height(2.dp).background(tint))
    }
}

@Composable fun PendingTag(modifier: Modifier = Modifier) {
    Text("PENDING", modifier.background(Color.Black).padding(horizontal = 2.dp), Ink.pending, 7, true)
}

/**
 * Rail fader: thumb grab keeps its offset, rail touch jumps (desktop). [doubleTapCenter] (crossfader) recentres.
 * Fill from the floor in the owner's color shows level at a glance.
 */
@Composable fun PhysicalFader(
    label: String, value: Double, model: PlayerModel, deck: DeckId, modifier: Modifier, enabled: Boolean, horizontal: Boolean = false,
    doubleTapCenter: Boolean = false, color: Color? = null, set: (Double, String?) -> Unit,
) {
    val current by rememberUpdatedState(value)
    val setter by rememberUpdatedState(set)
    val tint = color ?: if (label == "XF") Ink.accent else deckColor(deck)
    val haptic = LocalHapticFeedback.current
    var held by remember { mutableStateOf(false) }
    val heat by animateFloatAsState(if (held) 1f else 0f, tween(if (held) 60 else 300), label = "fader")
    BoxWithConstraints(modifier.semantics { contentDescription = "${deck.name} $label"; stateDescription = "${(value * 100).roundToInt()}%"; if (!enabled) disabled() }.pointerInput(deck, label, enabled, horizontal) {
        if (!enabled) return@pointerInput
        var lastTap = -1000L
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val start = current
            val id = model.beginGesture(deck, label) { setter(start, it) }
            val low = if (horizontal) 22.dp.toPx() else 18.dp.toPx()
            val high = (if (horizontal) size.width.toFloat() else size.height.toFloat()) - low
            val travel = (high - low).coerceAtLeast(1f)
            val thumb = low + travel * (if (horizontal) start else 1 - start).toFloat()
            val origin = if (horizontal) down.position.x else down.position.y
            val onThumb = abs(origin - thumb) <= (if (horizontal) 24.dp.toPx() else 16.dp.toPx())
            val grab = if (onThumb) origin - thumb else 0f
            var moved = false
            fun update(coordinate: Float) { if (!model.gestureActive(id)) return; val fraction = ((coordinate - grab - low) / travel).coerceIn(0f, 1f).toDouble(); setter(if (horizontal) fraction else 1 - fraction, id) }
            down.consume(); held = true
            // A double-tap target must not jump on the first tap: the rail only jumps for non-recentring faders.
            if (!doubleTapCenter || onThumb) update(origin)
            var cancelled = false
            try {
                while (true) {
                    val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                    if (change == null || (!change.pressed && change.isConsumed)) { cancelled = true; break }
                    if (!change.pressed) {
                        if (doubleTapCenter && !moved && change.uptimeMillis - down.uptimeMillis < 250) {
                            if (down.uptimeMillis - lastTap < 320) { setter(.5, id); haptic.performHapticFeedback(HapticFeedbackType.LongPress); lastTap = -1000 } else lastTap = change.uptimeMillis
                        }
                        break
                    }
                    val c = if (horizontal) change.position.x else change.position.y
                    if (abs(c - origin) > 4.dp.toPx()) moved = true
                    if (moved || !doubleTapCenter) update(c)
                    change.consume()
                }
            } catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { held = false; model.finishGesture(id, cancelled) }
        }
    }) {
        val v = value.toFloat()
        Canvas(Modifier.fillMaxSize()) {
            val low = if (horizontal) 22.dp.toPx() else 18.dp.toPx()
            val high = (if (horizontal) size.width else size.height) - low
            val at = low + (high - low) * (if (horizontal) v else 1 - v)
            val rail = Ink.surface.copy(alpha = if (enabled) 1f else .5f)
            if (horizontal) {
                drawLine(rail, Offset(low, center.y), Offset(high, center.y), 4.dp.toPx(), StrokeCap.Round)
                drawLine(Ink.muted, Offset((low + high) / 2, center.y - 9.dp.toPx()), Offset((low + high) / 2, center.y + 9.dp.toPx()), 1.5f)
            } else {
                drawLine(rail, Offset(center.x, low), Offset(center.x, high), 4.dp.toPx(), StrokeCap.Round)
                if (enabled) drawLine(tint.copy(alpha = .35f + .4f * v), Offset(center.x, at), Offset(center.x, high), 4.dp.toPx(), StrokeCap.Round)
                repeat(9) { i -> val y = low + (high - low) * i / 8; drawLine(Ink.surface2, Offset(center.x - 11.dp.toPx(), y), Offset(center.x - 6.dp.toPx(), y), 1.5f); drawLine(Ink.surface2, Offset(center.x + 6.dp.toPx(), y), Offset(center.x + 11.dp.toPx(), y), 1.5f) }
            }
        }
        val handle = if (horizontal) Modifier.align(Alignment.CenterStart).offset(x = (maxWidth - 44.dp) * v) else Modifier.align(Alignment.TopCenter).offset(y = 6.dp + (maxHeight - 36.dp) * (1 - v))
        val hw = if (horizontal) 44.dp else min(maxWidth.value, 52f).dp
        Box(handle.width(hw).height(if (horizontal) 30.dp else 24.dp).halo(tint, heat * .9f, 4.dp).padding(2.dp).clip(RoundedCornerShape(3.dp)).background(Ink.crust).border(1.5.dp, if (enabled) tint else Ink.edge, RoundedCornerShape(3.dp)), contentAlignment = Alignment.Center) {
            Box(Modifier.fillMaxWidth(.8f).height(2.dp).background(if (enabled) tint else Ink.edge))
        }
    }
}

enum class KnobKind(val neutral: Double) { TRIM(.5), EQ_LOW(.5), EQ_MID(.5), EQ_HIGH(.5), FILTER(.5), FX_DEPTH(0.0) }

private fun mix(a: Color, b: Color, t: Float) = Color(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t)

/** Desktop knobAppearance.ts + laneShade strokeColorAt: value color and arc anchor per control kind. */
fun knobColor(kind: KnobKind, value: Double): Color {
    val p = value.toFloat().coerceIn(0f, 1f)
    fun stroke(hue: Color, t: Float) = mix(Ink.neutralStroke, hue, t.coerceIn(0f, 1f)).copy(alpha = .6f + .4f * t.coerceIn(0f, 1f))
    return when (kind) {
        KnobKind.EQ_LOW, KnobKind.EQ_MID, KnobKind.EQ_HIGH -> stroke(Ink.bands[kind.ordinal - 1], min(1f, p * 2))
        KnobKind.TRIM -> stroke(Ink.trim, abs(p - .5f) / .5f / .6f)
        KnobKind.FX_DEPTH -> stroke(Ink.fxDepth, p)
        KnobKind.FILTER -> {
            val off = p - .5f
            val s = .5f + sign(off) * abs(off * 2).pow(.2f) / 2
            val hue = if (s >= .5f) mix(Ink.filterHpf, Color.White, .45f) else mix(Ink.filterLpf, Color.Black, .35f)
            stroke(hue, abs(s - .5f) / .5f / .6f)
        }
    }
}

/** Draws a desktop-style knob centered in this scope at radius [r]. */
fun DrawScope.drawKnob(kind: KnobKind, value: Double, r: Float, enabled: Boolean) {
    val p = value.toFloat().coerceIn(0f, 1f)
    val color = if (enabled) knobColor(kind, value) else Ink.surface2
    val ring = r * .12f
    val anchor = if (kind == KnobKind.EQ_LOW || kind == KnobKind.EQ_MID || kind == KnobKind.EQ_HIGH || kind == KnobKind.FX_DEPTH) 0f else .5f
    val filter = kind == KnobKind.FILTER
    val arcR = r - ring / 2
    val dial = if (filter) r * .72f else if (kind == KnobKind.TRIM) r * .74f else r * .82f
    // EQ boost glows (desktop: only boost adds glow, not more saturation).
    val boost = if (anchor == 0f && kind != KnobKind.FX_DEPTH) max(0f, p * 2 - 1) else 0f
    if (enabled && boost > 0f) drawCircle(color.copy(alpha = .35f * boost), r * 1.05f)
    drawArc(Ink.surface2, 135f, 270f, false, center - Offset(arcR, arcR), Size(arcR * 2, arcR * 2), style = Stroke(ring, cap = StrokeCap.Butt))
    val from = min(anchor, p) * 270; val to = max(anchor, p) * 270
    if (to > from) drawArc(color, 135f + from, to - from, false, center - Offset(arcR, arcR), Size(arcR * 2, arcR * 2), style = Stroke(ring * 1.25f, cap = StrokeCap.Butt))
    if (filter) drawCircle(Ink.overlay1, dial + ring * .9f, style = Stroke(1.dp.toPx()))
    drawCircle(Ink.crust, dial)
    drawCircle(if (kind == KnobKind.TRIM) Ink.overlay1 else Color.Transparent, dial, style = Stroke(1.dp.toPx()))
    if (anchor == .5f) drawLine(Ink.muted, Offset(center.x, center.y - r - ring * .2f), Offset(center.x, center.y - r + ring * 1.2f), 1.dp.toPx())
    val a = Math.toRadians((135 + 270 * p).toDouble())
    val d = Offset(cos(a).toFloat(), sin(a).toFloat())
    drawLine(if (enabled) color.copy(alpha = 1f) else Ink.surface2, center + d * (dial * .2f), center + d * (dial * .92f), max(2f, r * .1f), StrokeCap.Round)
}

/**
 * Relative-drag rotary (vertical travel, desktop feel): notch at neutral, double-tap reset, hold still 350ms
 * for fine mode with an enlarged copy beside the finger ([UiModel.knob]).
 */
@Composable fun Knob(
    label: String, kind: KnobKind, value: Double, ui: UiModel, model: PlayerModel, deck: DeckId, modifier: Modifier,
    live: Boolean, size: Dp = 36.dp, labelColor: Color? = null, tagPending: Boolean = true, set: (Double, String?) -> Unit,
) {
    val interactive = live || ui.previewPending
    val current by rememberUpdatedState(value)
    val setter by rememberUpdatedState(set)
    val haptic = LocalHapticFeedback.current
    var root by remember { mutableStateOf(Offset.Zero) }
    var held by remember { mutableStateOf(false) }
    val heat by animateFloatAsState(if (held) 1f else 0f, tween(if (held) 60 else 300), label = "knob")
    val tag = "${deck.name} $label"
    Box(modifier.onGloballyPositioned { root = it.positionInRoot() }.semantics { contentDescription = "$tag control"; stateDescription = "${(value * 100).roundToInt()}%"; if (!live) disabled() }.pointerInput(tag, interactive) {
        if (!interactive) { awaitEachGesture { awaitFirstDown(); ui.pending(label) }; return@pointerInput }
        val scope = CoroutineScope(currentCoroutineContext())
        var lastTap = -1000L
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val first = current
            val id = model.beginGesture(deck, label) { setter(first, it) }
            held = true; down.consume()
            var baseline = first; var baseY = down.position.y; var lastY = down.position.y
            var moved = false; var fine = false; var cancelled = false
            var notch = abs(first - kind.neutral) < .001; var notchY = baseY; var previous = first
            var popupResets = 0
            val hold = scope.launch {
                delay(350)
                if (!moved) {
                    fine = true; baseline = current; baseY = lastY
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    ui.knob = KnobPopup(tag, kind, current, if (live) knobColor(kind, current) else Ink.pending, root.x + down.position.x, root.y + lastY, { setter(kind.neutral, id) })
                }
            }
            try {
                while (true) {
                    val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                    if (change == null || (!change.pressed && change.isConsumed)) { cancelled = true; break }
                    if (!change.pressed) {
                        if (!moved && !fine && change.uptimeMillis - down.uptimeMillis < 250) {
                            if (down.uptimeMillis - lastTap < 320) { setter(kind.neutral, id); haptic.performHapticFeedback(HapticFeedbackType.LongPress); lastTap = -1000 } else lastTap = change.uptimeMillis
                        }
                        break
                    }
                    if (!model.gestureActive(id)) break
                    val y = change.position.y; lastY = y
                    if (abs(y - down.position.y) > 6.dp.toPx() && !fine) { moved = true; hold.cancel() }
                    val popup = ui.knob
                    if (fine && popup != null && popup.label == tag && popup.resetVersion != popupResets) { popupResets = popup.resetVersion; baseline = kind.neutral; baseY = y; notch = true; notchY = y }
                    if (moved || fine) {
                        val span = 180.dp.toPx() * (if (fine) 3.5f else 1f)
                        var next = (baseline - (y - baseY) / span).coerceIn(0.0, 1.0)
                        val escape = (if (fine) 2.dp else 6.dp).toPx()
                        if (notch) {
                            val travel = y - notchY
                            if (abs(travel) <= escape) next = kind.neutral
                            else { notch = false; baseline = kind.neutral; baseY = notchY + sign(travel) * escape; next = (kind.neutral - (y - baseY) / span).coerceIn(0.0, 1.0) }
                        } else if (kind.neutral in 0.01..0.99 && previous != kind.neutral && (previous - kind.neutral) * (next - kind.neutral) <= 0) {
                            next = kind.neutral; notch = true; notchY = y; haptic.performHapticFeedback(HapticFeedbackType.SegmentTick)
                        }
                        previous = next
                        setter(next, id)
                        if (fine) ui.knob = ui.knob?.copy(value = next, color = if (live) knobColor(kind, next) else Ink.pending, fingerY = root.y + y)
                        change.consume()
                    }
                }
            } catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { hold.cancel(); held = false; if (ui.knob?.label == tag) ui.knob = null; model.finishGesture(id, cancelled) }
        }
    }, contentAlignment = Alignment.Center) {
        // Label sits in the arc's open bottom, so it can only belong to this knob.
        Box(contentAlignment = Alignment.BottomCenter) {
            Canvas(Modifier.size(size).halo(knobColor(kind, value), heat * .6f, 4.dp, round = true)) { drawKnob(kind, value, this.size.minDimension / 2 - 4.dp.toPx(), interactive) }
            Text(label, Modifier.offset(y = 6.dp).background(Color.Black).padding(horizontal = 2.dp), color = when { !live -> Ink.muted; held -> labelColor ?: Ink.text; else -> labelColor ?: Ink.muted }, size = 9, bold = true)
        }
        if (!live && tagPending) PendingTag(Modifier.align(Alignment.TopEnd))
    }
}

/** The enlarged knob beside the finger while a knob is held still (fine mode). */
@Composable fun KnobPopupOverlay(ui: UiModel) {
    val popup = ui.knob ?: return
    val density = androidx.compose.ui.platform.LocalDensity.current
    val reveal = remember(popup.label) { Animatable(0f) }
    LaunchedEffect(popup.label) { reveal.animateTo(1f, spring(dampingRatio = .6f, stiffness = 500f)) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = 150.dp; val h = 176.dp
        val fx = with(density) { popup.fingerX.toDp() }; val fy = with(density) { popup.fingerY.toDp() }
        // Beside the finger, on the side with more room, never under it.
        val x = if (fx < maxWidth / 2) (fx + 44.dp).coerceAtMost(maxWidth - w) else (fx - 44.dp - w).coerceAtLeast(0.dp)
        val y = (fy - h / 2).coerceIn(0.dp, (maxHeight - h).coerceAtLeast(0.dp))
        Column(Modifier.offset(x, y).size(w, h).graphicsLayer { alpha = reveal.value; scaleX = .85f + .15f * reveal.value; scaleY = scaleX }
            .halo(popup.color, .5f, 8.dp).padding(8.dp).clip(RoundedCornerShape(10.dp)).background(Ink.panel).border(1.5.dp, popup.color, RoundedCornerShape(10.dp)).padding(6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(popup.label + " · FINE", color = popup.color.copy(alpha = 1f), size = 11, bold = true)
            Canvas(Modifier.size(96.dp)) { drawKnob(popup.kind, popup.value, size.minDimension / 2 - 4.dp.toPx(), true) }
            Text(knobReadout(popup.kind, popup.value), size = 14, bold = true)
            Key("RESET", Modifier.fillMaxWidth().height(30.dp), popup.color.copy(alpha = 1f), textSize = 11) { popup.reset(); ui.knob = popup.copy(value = popup.kind.neutral, resetVersion = popup.resetVersion + 1) }
        }
    }
}

fun knobReadout(kind: KnobKind, v: Double): String = when (kind) {
    KnobKind.TRIM -> "%+.1f dB".format((v - .5) * 24 - 6)
    KnobKind.EQ_LOW, KnobKind.EQ_MID, KnobKind.EQ_HIGH -> if (v <= .001) "KILL" else "%+.1f dB".format(20 * log10(eqValueToGain(v).toDouble()))
    KnobKind.FILTER -> if (abs(v - .5) < .01) "BYPASS" else if (v < .5) "LPF %d%%".format(((.5 - v) * 200).roundToInt()) else "HPF %d%%".format(((v - .5) * 200).roundToInt())
    KnobKind.FX_DEPTH -> "%d%% WET".format((v * 100).roundToInt())
}

/**
 * Tap = [onTap] (or the step), hold 350ms then slide sideways to scroll values, lift to commit
 * (the jump-size gesture; FX effect/target/beats reuse it). Feedback floats above the control.
 */
@Composable fun ValueWheel(
    label: String, choices: List<String>, index: Int, ui: UiModel, model: PlayerModel, deck: DeckId, modifier: Modifier, color: Color,
    text: String = choices[index], icon: Glyph? = null, live: Boolean = true, pulse: Float = 0f, bare: Boolean = false, tagPending: Boolean = true, onTap: (() -> Unit)? = null, onIndex: (Int) -> Unit,
) {
    val interactive = live || ui.previewPending
    val latest by rememberUpdatedState(index)
    val setter by rememberUpdatedState(onIndex)
    val tap by rememberUpdatedState(onTap)
    val haptic = LocalHapticFeedback.current
    var root by remember { mutableStateOf(Offset.Zero) }
    var width by remember { mutableFloatStateOf(0f) }
    var held by remember { mutableStateOf(false) }
    val heat by animateFloatAsState(if (held) 1f else 0f, tween(if (held) 60 else 280), label = "wheel")
    val tint = if (interactive) color else Ink.surface2
    Box(modifier.onGloballyPositioned { root = it.positionInRoot(); width = it.size.width.toFloat() }
        .halo(tint, (heat * .8f + pulse).coerceAtMost(1f), 6.dp)
        .semantics { contentDescription = label; stateDescription = choices[index]; onClick { if (!interactive) ui.pending(label) else tap?.invoke(); true } }
        .pointerInput(label, choices, interactive) {
            if (!interactive) { awaitEachGesture { awaitFirstDown(); ui.pending(label) }; return@pointerInput }
            val scope = CoroutineScope(currentCoroutineContext())
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                down.consume(); held = true
                val start = latest; var chosen = start; var open = false; var cancelled = false
                val id = model.beginGesture(deck, label) { setter(start) }
                val hold = scope.launch {
                    delay(350); open = true
                    ui.wheel = WheelFeedback(label, choices, chosen, root.x + width / 2, root.y, tint)
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                }
                try {
                    while (true) {
                        val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                        if (change == null || (!change.pressed && change.isConsumed)) { cancelled = true; break }
                        if (!change.pressed || !model.gestureActive(id)) break
                        val dx = change.position.x - down.position.x
                        if (open) {
                            val next = (start + (dx / 30.dp.toPx()).roundToInt()).coerceIn(choices.indices)
                            if (next != chosen) { chosen = next; setter(next); haptic.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick) }
                            ui.wheel = WheelFeedback(label, choices, chosen, root.x + width / 2, root.y, tint)
                            change.consume()
                        } else if (abs(dx) > 12.dp.toPx() || abs(change.position.y - down.position.y) > 12.dp.toPx()) { cancelled = true; break }
                    }
                    if (!open && !cancelled) tap?.invoke()
                } catch (cancel: CancellationException) { cancelled = true; throw cancel }
                finally {
                    hold.cancel(); held = false
                    if (cancelled && open) setter(start)
                    if (open) haptic.performHapticFeedback(if (cancelled) HapticFeedbackType.Reject else HapticFeedbackType.Confirm)
                    if (ui.wheel?.label == label) ui.wheel = null
                    model.finishGesture(id, cancelled && open)
                }
            }
        }.padding(3.dp).then(if (bare) Modifier else Modifier.clip(RoundedCornerShape(2.dp)).background(Ink.panel).background(tint.copy(alpha = .06f + .22f * heat))), contentAlignment = Alignment.Center) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            if (icon != null) GlyphIcon(icon, tint, 15.dp)
            Text(text, color = if (interactive) tint else Ink.muted, size = 15, bold = true)
        }
        if (!live && tagPending && !bare) PendingTag(Modifier.align(Alignment.TopEnd))
    }
}

@Composable fun WheelOverlay(ui: UiModel) {
    val wheel = ui.wheel ?: return
    val density = androidx.compose.ui.platform.LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = min(maxWidth.value, 340f).dp
        val x = with(density) { wheel.anchorX.toDp() - w / 2 }.coerceIn(0.dp, maxWidth - w)
        val y = with(density) { wheel.anchorY.toDp() - 76.dp }.coerceIn(0.dp, maxHeight - 70.dp)
        Column(Modifier.offset(x, y).width(w).halo(wheel.color, .45f, 8.dp).padding(8.dp).clip(RoundedCornerShape(8.dp)).background(Ink.panel).border(1.5.dp, wheel.color, RoundedCornerShape(8.dp)).padding(horizontal = 6.dp, vertical = 2.dp)) {
            Text(wheel.label.uppercase(), color = wheel.color, size = 10, bold = true)
            Row(Modifier.fillMaxWidth().height(36.dp), verticalAlignment = Alignment.CenterVertically) {
                for (offset in -2..2) {
                    val i = wheel.index + offset
                    Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                        Text(if (i in wheel.choices.indices) wheel.choices[i] else "", color = if (offset == 0) Ink.text else Ink.muted.copy(alpha = 1f - abs(offset) * .3f), size = if (offset == 0) 20 else 13, bold = offset == 0)
                    }
                }
            }
        }
    }
}

/** Momentary bend: unboxed track; hold left/right half and slide. Release/cancel always returns to zero. */
@Composable fun BendStrip(ui: DeckUi, model: PlayerModel, modifier: Modifier) {
    val ready by remember(ui) { derivedStateOf { ui.ready && model.supports("bend") } }
    val currentReady by rememberUpdatedState(ready)
    val color = deckColor(ui.id)
    val amount = (abs(ui.bend) / 8).toFloat()
    Box(modifier.halo(color, if (ui.bend == 0.0) 0f else .2f + .6f * amount, 6.dp).semantics { contentDescription = "${ui.id} momentary bend"; stateDescription = "%+.1f%%".format(ui.bend); if (!ready) disabled() }.pointerInput(ui.id) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            if (!currentReady) return@awaitEachGesture
            val id = model.beginGesture(ui.id, "BEND") { model.updateBend(ui.id, 0.0, it) }
            val start = if (down.position.x < size.width / 2) -2.0 else 2.0
            down.consume(); model.updateBend(ui.id, start, id)
            var cancelled = false
            try {
                while (true) {
                    val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                    if (change == null || (!change.pressed && change.isConsumed)) cancelled = true
                    if (change?.pressed != true || !model.gestureActive(id)) break
                    model.updateBend(ui.id, (start + (change.position.x - down.position.x) / 120.dp.toPx() * 8).coerceIn(-8.0, 8.0), id); change.consume()
                }
            } catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { if (!cancelled && model.gestureActive(id)) model.updateBend(ui.id, 0.0, id); model.finishGesture(id, cancelled) }
        }
    }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize().padding(horizontal = 10.dp, vertical = 8.dp)) {
            val y = size.height / 2
            drawLine(if (ready) color.copy(alpha = .35f) else Ink.edge, Offset(0f, y), Offset(size.width, y), 2.dp.toPx(), StrokeCap.Round)
            for (i in -4..4) { val x = size.width / 2 + i * size.width / 9; drawLine(if (ready) color.copy(alpha = .3f) else Ink.edge, Offset(x, y - (if (i == 0) 8 else 4).dp.toPx()), Offset(x, y + (if (i == 0) 8 else 4).dp.toPx()), 1.5f) }
            val x = size.width * (.5f + ui.bend.toFloat() / 16f)
            if (ui.bend != 0.0) drawLine(color, Offset(size.width / 2, y), Offset(x, y), 6.dp.toPx(), StrokeCap.Round)
            drawCircle(if (ready) color else Ink.edge, 6.dp.toPx(), Offset(x, y))
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("−", color = if (ready) color else Ink.muted, size = 15, bold = true)
            Spacer(Modifier.weight(1f))
            Text(if (ui.bend == 0.0) "BEND" else "%+.1f%%".format(ui.bend), Modifier.background(Color.Black.copy(alpha = .6f)).padding(horizontal = 2.dp), if (ready) color else Ink.muted, 11, true)
            Spacer(Modifier.weight(1f))
            Text("+", color = if (ready) color else Ink.muted, size = 15, bold = true)
        }
    }
}
