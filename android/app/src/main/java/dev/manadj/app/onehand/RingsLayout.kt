package dev.manadj.app.onehand

import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerId
import androidx.compose.ui.input.pointer.changedToDownIgnoreConsumed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.manadj.app.*
import dev.manadj.audio.AudioCommand
import dev.manadj.audio.DeckId
import dev.manadj.audio.LoopChange
import kotlinx.coroutines.CancellationException
import kotlin.math.*

/**
 * Concept B — RINGS. Everything the thumb touches is a concentric arc around its pivot (the bottom corner):
 * the radius picks the control, the angle is the value or the sector. Sweeps (XF, EQ, FILTER, DEPTH, BEND) are
 * relative drags along a ring — a thumb's natural motion; sectors (PLAY/CUE, hot cues, loop/jump, FX choices) are
 * stabs. The hub is the focused deck (tap = switch); the mode ring (PERF / MIX / FX) repopulates rings 3–6.
 */
@Composable fun RingsLayout(model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit, modifier: Modifier, band: Dp) {
    OneHandScaffold(model, ux, pick, modifier, band, waveHeight = 96.dp, blockSize = null) { frame ->
        var mode by remember { mutableStateOf(RingMode.PERFORM) }
        Column(Modifier.fillMaxSize()) {
            // Global chips above the rings (least reachable; also: swipe up anywhere free = browser).
            Row(Modifier.fillMaxWidth().padding(horizontal = Gap).height(34.dp), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End)) {
                Key("", Modifier.width(44.dp).fillMaxHeight(), Ink.muted, description = "Settings", icon = Glyph.Gear, style = KeyStyle.PILL, textSize = 10) { ux.toggleSettings(model) }
                val q = model.output?.quantizeMode ?: ux.quantizeMode
                Key("Q", Modifier.width(44.dp).fillMaxHeight(), Ink.accent, model.supports("quantize"), q.quantized, "Quantize", style = KeyStyle.PILL, textSize = 11) { ux.setQuantize(model, on = !q.quantized) }
                val f = OneHand.focus
                val sync = model.syncState.decks[f] ?: dev.manadj.audio.SyncStatus.OFF
                Key("SYNC", Modifier.width(64.dp).fillMaxHeight(), Ink.play, model.supports("sync"), sync != dev.manadj.audio.SyncStatus.OFF, "$f sync", style = KeyStyle.PILL, textSize = 11) { model.toggleSync(f) }
                Key("PITCH", Modifier.width(66.dp).fillMaxHeight(), deckColor(f), model.supports("varispeed"), model.pitchDrawer == f, "$f pitch panel", style = KeyStyle.PILL, textSize = 11) { model.pitchDrawer = if (model.pitchDrawer == f) null else f }
                BrowseKey(model, ux, Modifier.width(84.dp).fillMaxHeight(), textSize = 11)
            }
            Box(Modifier.fillMaxWidth().weight(1f)) {
                RingZone(model, ux, mode, { mode = it }, frame, Modifier.fillMaxSize())
                androidx.compose.animation.AnimatedVisibility(model.pitchDrawer == OneHand.focus, Modifier.matchParentSize().padding(8.dp)) {
                    PitchPanel(model.decks.getValue(OneHand.focus), model, ux, Modifier.fillMaxSize())
                }
            }
        }
    }
}

enum class RingMode(val label: String) { PERFORM("PERF"), MIX("MIX"), FX("FX") }

/** A stab target on a ring: [press] runs on touch-down and returns the release (cancelled = torn down). */
class Sector(val label: String, val color: Color, val sub: String? = null, val lit: () -> Boolean = { false }, val enabled: () -> Boolean = { true }, val press: () -> ((Boolean) -> Unit)?)

/**
 * A relative sweep along a ring span: [value] 0..1 displayed from [anchor] (0 = from the start, .5 = from the
 * middle); dragging adds (Δt / span). [momentary] snaps back to [neutral] on release (bend).
 */
class Sweep(val label: String, val color: (Double) -> Color, val value: () -> Double, val readout: (Double) -> String, val anchor: Float, val neutral: Double, val momentary: Boolean = false, val enabled: () -> Boolean = { true }, val gesture: String, val deck: DeckId, val set: (Double, String?) -> Unit)

/** One span of a ring: [t0]..[t1] of the quarter sweep (0 = along the bottom edge, 1 = straight up the side). */
class Band(val t0: Float, val t1: Float, val sector: Sector? = null, val sweep: Sweep? = null)
/** A ring's content; its radius band comes from the reach zone (innermost first). */
class Ring(val bands: List<Band>)

private fun sectors(items: List<Sector>, t0: Float = .05f, t1: Float = .97f): List<Band> {
    val n = items.size; val gap = .012f
    return items.mapIndexed { i, s -> val a = t0 + (t1 - t0) * i / n; Band(a + gap / 2, a + (t1 - t0) / n - gap / 2, sector = s) }
}

@Composable private fun rings(model: PlayerModel, ux: UiModel, mode: RingMode, setMode: (RingMode) -> Unit): List<Ring> {
    val f = OneHand.focus
    val ui = model.decks.getValue(f)
    val color = deckColor(f)
    val haptic = LocalHapticFeedback.current
    fun hot(slot: Int) = Sector("${slot + 1}", Ink.cues[slot], sub = ui.hotCues[slot]?.let(::clock) ?: "SET", lit = { ui.snapshot?.previewSlot == slot }, enabled = { ui.ready && model.supports("hot-cue-gate") }) {
        val set = ui.hotCues[slot] != null
        haptic.performHapticFeedback(HapticFeedbackType.VirtualKey)
        val id = model.beginGesture(f, "HOTCUE$slot") { if (set) model.submit(AudioCommand.HotCueUp(f, slot, it)) }
        model.submit(if (set) AudioCommand.HotCueDown(f, slot, id) else AudioCommand.SetHotCue(f, slot, id))
        if (!set) ux.journalCueWhenSet(model, f, slot)
        ;{ cancelled -> if (!cancelled && set && model.gestureActive(id)) model.submit(AudioCommand.HotCueUp(f, slot, id)); model.finishGesture(id, cancelled) }
    }
    fun tap(label: String, c: Color, sub: String? = null, lit: () -> Boolean = { false }, enabled: () -> Boolean = { true }, action: () -> Unit) =
        Sector(label, c, sub, lit, enabled) { haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); action(); null }
    val eq = model.supports("eq"); val filter = model.supports("filter")
    // Cut-only EQ (OH1): the sweep runs kill → unity, unity at the end of travel; the ring shows what is cut.
    fun eqSweep(label: String, band: Int) = Sweep(label, { knobColor(listOf(KnobKind.EQ_LOW, KnobKind.EQ_MID, KnobKind.EQ_HIGH)[band], cutToEq(it)) }, { eqToCut(ui.eq[band]) }, { knobReadout(KnobKind.EQ_LOW, cutToEq(it)) }, 1f, 1.0, enabled = { eq }, gesture = "EQ$band", deck = f) { g, id -> model.updateEq(f, band, cutToEq(g), id) }
    fun faderSweep(d: DeckId) = Sweep("FADER ${d.name}", { deckColor(d) }, { model.decks.getValue(d).fader }, { "%d%%".format((it * 100).roundToInt()) }, 1f, 1.0, enabled = { model.supports("fader") }, gesture = "FADER", deck = d) { v, id -> model.updateFader(d, v, id) }
    val macro = MixMacro.BASS
    val hub = listOf(
        Ring(sectors(listOf(tap("⇄${other(f)}", deckColor(other(f))) { haptic.performHapticFeedback(HapticFeedbackType.LongPress); OneHand.focus = other(f) }) + RingMode.entries.map { m -> tap(m.label, if (m == RingMode.FX) Color(ux.fx.effect.color) else Ink.accent, lit = { mode == m }) { setMode(m) } })),
        Ring(listOf(
            Band(.05f, .49f, sector = Sector(if (ui.snapshot?.playing == true) "PAUSE" else "PLAY", Ink.play, lit = { ui.snapshot?.playing == true }, enabled = { ui.ready || ui.snapshot?.playing == true }) {
                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); model.submit(if (ui.snapshot?.playing == true) AudioCommand.Pause(f) else AudioCommand.Play(f)); null }),
            Band(.51f, .97f, sector = Sector("CUE", Ink.warning, enabled = { ui.ready }) {
                haptic.performHapticFeedback(HapticFeedbackType.VirtualKey)
                val id = model.beginGesture(f, "CUE") { model.submit(AudioCommand.CueUp(f, it)) }
                model.submit(AudioCommand.CueDown(f, id))
                ;{ cancelled -> if (!cancelled && model.gestureActive(id)) model.submit(AudioCommand.CueUp(f, id)); model.finishGesture(id, cancelled) }
            }),
        )),
    )
    val content = when (mode) {
        RingMode.PERFORM -> {
            val snap = ui.snapshot; val gridded = snap?.bpm != null; val looping = snap?.loop != null
            val loopBeats = snap?.loop?.beats ?: snap?.pendingLoopBeats ?: 4.0
            listOf(
                Ring(sectors((0..3).map(::hot))),
                Ring(sectors((4..7).map(::hot))),
                Ring(sectors(listOf(
                    tap("÷2", color, enabled = { model.supports("loop") }) { model.resizeLoop(f, LoopChange.HALVE) },
                    tap("LOOP", if (looping) Ink.play else color, sub = if (gridded) beatText(loopBeats) else "NO BPM", lit = { looping }, enabled = { ui.ready && gridded && model.supports("loop") }) { model.toggleLoop(f) },
                    tap("×2", color, enabled = { model.supports("loop") }) { model.resizeLoop(f, LoopChange.DOUBLE) },
                    tap("◀", color, sub = beatText(ui.jumpBeats), enabled = { ui.ready && gridded && model.supports("beat-jump") }) { model.jump(f, -1) },
                    tap("JUMP", color, sub = "${beatText(ui.jumpBeats)} ÷×", enabled = { model.supports("beat-jump") }) { ui.jumpBeats = if (ui.jumpBeats >= 128) 1.0 else ui.jumpBeats * 2 },
                    tap("▶", color, sub = beatText(ui.jumpBeats), enabled = { ui.ready && gridded && model.supports("beat-jump") }) { model.jump(f, 1) },
                ))),
                Ring(listOf(Band(.05f, .97f, sweep = Sweep("BEND", { color }, { (ui.bend + 8) / 16 }, { "%+.1f%%".format(it * 16 - 8) }, .5f, .5, momentary = true, enabled = { ui.ready && model.supports("bend") }, gesture = "BEND", deck = f) { v, id -> model.updateBend(f, v * 16 - 8, id) }))),
            )
        }
        RingMode.MIX -> listOf(
            Ring(listOf(Band(.05f, .97f, sweep = Sweep("XF · ${macro.label}", { Ink.accent }, { model.crossfade }, { "A %d · B %d".format(((1 - it) * 100).roundToInt(), (it * 100).roundToInt()) }, .5f, .5, enabled = { model.supports("crossfade") }, gesture = "LEVER", deck = DeckId.A) { v, id -> applyMixMacro(model, ux, macro, v, id) }))),
            Ring(listOf(Band(.05f, .49f, sweep = faderSweep(DeckId.A)), Band(.51f, .97f, sweep = faderSweep(DeckId.B)))),
            Ring(listOf(Band(.05f, .97f, sweep = Sweep("FILTER", { knobColor(KnobKind.FILTER, it) }, { (ui.filter + 1) / 2 }, { knobReadout(KnobKind.FILTER, it) }, .5f, .5, enabled = { filter }, gesture = "FILTER", deck = f) { v, id -> model.updateFilter(f, v * 2 - 1, id) }))),
            Ring(listOf(Band(.05f, .97f, sweep = eqSweep("LOW", 0)))),
            Ring(listOf(Band(.05f, .49f, sweep = eqSweep("MID", 1)), Band(.51f, .97f, sweep = eqSweep("HI", 2)))),
        )
        RingMode.FX -> {
            val fx = ux.fx; val tone = Color(fx.effect.color); val live = model.supports("beat-fx") || ux.previewPending
            listOf(
                Ring(sectors(listOf(
                    tap(if (fx.on) "ON" else "OFF", tone, lit = { fx.on }, enabled = { live }) { fx.on = !fx.on },
                    tap("→A", deckColor(DeckId.A), lit = { fx.target == 0 }, enabled = { live }) { fx.target = 0 },
                    tap("→B", deckColor(DeckId.B), lit = { fx.target == 1 }, enabled = { live }) { fx.target = 1 },
                    tap("→MST", Ink.accent, lit = { fx.target == 2 }, enabled = { live }) { fx.target = 2 },
                ))),
                Ring(sectors(FxEffect.entries.map { e -> tap(e.short, Color(e.color), lit = { fx.effect == e }, enabled = { live }) { fx.effect = e } })),
                Ring(sectors(FX_BEATS.indices.map { i -> tap(beatText(FX_BEATS[i]), tone, lit = { fx.beats == i }, enabled = { live }) { fx.beats = i } })),
                Ring(listOf(Band(.05f, .97f, sweep = Sweep("DEPTH", { knobColor(KnobKind.FX_DEPTH, it) }, { fx.depth }, { knobReadout(KnobKind.FX_DEPTH, it) }, 0f, 0.0, enabled = { live }, gesture = "FXDEPTH", deck = DeckId.A) { v, _ -> fx.depth = v }))),
            )
        }
    }
    // FX section is written whole from the UI state (same contract as FxSection).
    if (model.supports("beat-fx")) LaunchedEffect(Unit) {
        snapshotFlow { dev.manadj.audio.BeatFxState(dev.manadj.audio.BeatFxEffect.entries[ux.fx.effect.ordinal], listOf(dev.manadj.audio.BeatFxTarget.A, dev.manadj.audio.BeatFxTarget.B, dev.manadj.audio.BeatFxTarget.MASTER)[ux.fx.target], ux.fx.on, ux.fx.depth * 2 - 1, FX_BEATS[ux.fx.beats]) }.collect { model.updateBeatFx(it) }
    }
    return hub + content
}

/** Pivot + sweep geometry in px. [mirror] puts the pivot at the bottom-left and runs the sweep the other way. */
private class Polar(val w: Float, val h: Float, val mirror: Boolean, val overshoot: Float, val tMin: Float = 0f, val tMax: Float = 1f) {
    val px = if (mirror) -overshoot else w + overshoot
    val py = h + overshoot
    val sx = if (mirror) -1f else 1f
    /** Normalized sweep t (0..1 across the zone's angular window) → absolute quarter fraction. */
    fun abs(t: Float) = tMin + t * (tMax - tMin)
    fun point(r: Float, t: Float) = Offset(px - sx * r * cos(abs(t) * PI / 2).toFloat(), py - r * sin(abs(t) * PI / 2).toFloat())
    /** (r, t) of a touch, t normalized to the window; outside 0..1 = off the arcs. */
    fun polar(p: Offset): Pair<Float, Float> { val dx = (px - p.x) * sx; val dy = py - p.y; val q = (atan2(dy, dx) / (PI / 2)).toFloat(); return hypot(dx, dy) to (q - tMin) / (tMax - tMin) }
    /** Compose drawArc start angle (degrees, clockwise from +x) for normalized sweep t. */
    fun degrees(t: Float) = if (mirror) 360f - abs(t) * 90f else 180f + abs(t) * 90f
}

/** Radius band + angular window the rings may use, read off the reach zone polygon around the pivot. */
private class RingFit(val rMin: Float, val rMax: Float, val tMin: Float, val tMax: Float)
private fun fitRings(frame: ReachFrame, density: Float, w: Float, h: Float, mirror: Boolean, overshoot: Float): RingFit {
    val geo = Polar(w, h, mirror, overshoot)
    val sw = frame.screen.width.value * density; val sh = frame.screen.height.value * density; val top = frame.top.value * density
    val pts = frame.zone.points.map { Offset(it.x * sw, it.y * sh - top) }.map { geo.polar(it) }.filter { it.second in -.05f..1.05f }
    if (pts.size < 3) return RingFit(60 * density, min(w, h), 0f, 1f)
    val rs = pts.map { it.first }.sorted(); val ts = pts.map { it.second.coerceIn(0f, 1f) }.sorted()
    val rMin = max(40 * density, rs[rs.size / 10]); val rMax = max(rMin + 240 * density, rs[rs.size * 9 / 10])
    val tMin = ts[ts.size / 20].coerceIn(0f, .3f); val tMax = ts[ts.size * 19 / 20].coerceIn(.7f, 1f)
    return RingFit(rMin, rMax, tMin, tMax)
}

@Composable private fun RingZone(model: PlayerModel, ux: UiModel, mode: RingMode, setMode: (RingMode) -> Unit, frame: ReachFrame, modifier: Modifier) {
    val ringList = rings(model, ux, mode, setMode)
    val current by rememberUpdatedState(ringList)
    val mirror = OneHand.mirror
    val haptic = LocalHapticFeedback.current
    val f = OneHand.focus
    val ui = model.decks.getValue(f)
    // Held sectors (for lit feedback) and sweeps in flight, by pointer.
    val heldSectors = remember { mutableStateMapOf<Long, Sector>() }
    val paint = remember { android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD); textAlign = android.graphics.Paint.Align.CENTER } }
    val density = androidx.compose.ui.platform.LocalDensity.current.density
    val currentFrame by rememberUpdatedState(frame)
    // Rings fill the zone's radius band evenly (innermost = mode ring); their arcs span the zone's angular window.
    fun radii(fit: RingFit, n: Int): List<Pair<Float, Float>> { val band = (fit.rMax - fit.rMin) / n; return (0 until n).map { i -> (fit.rMin + i * band) to (fit.rMin + (i + 1) * band - 2 * density) } }
    Canvas(modifier.semantics { contentDescription = "Ring zone" }.pointerInput(mirror) {
        val fit0 = fitRings(currentFrame, density, size.width.toFloat(), size.height.toFloat(), mirror, 10.dp.toPx())
        val geo = Polar(size.width.toFloat(), size.height.toFloat(), mirror, 10.dp.toPx(), fit0.tMin, fit0.tMax)
        class Live(val release: ((Boolean) -> Unit)?, val sweep: Sweep?, val band: Band?, val gesture: String?, val start: Double, val t0: Float, val sector: Sector?)
        val live = HashMap<PointerId, Live>()
        var lastTap = -1000L; var lastTapRing = -1
        fun begin(p: Offset, upMs: Long): Live? {
            val (r, t) = geo.polar(p)
            val rings = current
            val rad = radii(fit0, rings.size)
            val ri = rad.indexOfFirst { (a, b) -> r >= a && r < b }
            if (ri < 0 || t !in 0f..1f) return null
            val band = rings[ri].bands.firstOrNull { t >= it.t0 && t <= it.t1 } ?: return null
            band.sector?.let { s -> if (!s.enabled()) return null; return Live(s.press(), null, band, null, 0.0, t, s) }
            val sw = band.sweep ?: return null
            if (!sw.enabled()) return null
            // Double-tap on a sweep = reset to neutral (knob rule).
            if (upMs - lastTap < 320 && lastTapRing == ri) { sw.set(sw.neutral, null); haptic.performHapticFeedback(HapticFeedbackType.LongPress); lastTap = -1000 }
            lastTapRing = ri
            val start = sw.value()
            val id = model.beginGesture(sw.deck, sw.gesture) { sw.set(start, it) }
            return Live(null, sw, band, id, start, t, null)
        }
        awaitEachGesture {
            val first = awaitFirstDown(requireUnconsumed = false)
            first.consume()
            begin(first.position, first.uptimeMillis)?.let { live[first.id] = it; it.sector?.let { s -> heldSectors[first.id.value] = s } }
            fun end(id: PointerId, cancelled: Boolean, upMs: Long) {
                val l = live.remove(id) ?: return
                heldSectors.remove(id.value)
                l.release?.invoke(cancelled)
                val sw = l.sweep; val g = l.gesture
                if (sw != null && g != null) {
                    if (!cancelled && sw.momentary && model.gestureActive(g)) sw.set(sw.neutral, g)
                    if (!cancelled && abs(sw.value() - l.start) < .002) lastTap = upMs
                    model.finishGesture(g, cancelled)
                }
            }
            try {
                while (true) {
                    val event = awaitPointerEvent()
                    for (c in event.changes) {
                        if (c.changedToDownIgnoreConsumed() && c.id !in live) { c.consume(); begin(c.position, c.uptimeMillis)?.let { live[c.id] = it; it.sector?.let { s -> heldSectors[c.id.value] = s } } }
                        val l = live[c.id]
                        if (l != null && c.pressed) {
                            val sw = l.sweep; val g = l.gesture
                            if (sw != null && g != null && model.gestureActive(g)) {
                                val (_, t) = geo.polar(c.position)
                                val span = (l.band!!.t1 - l.band.t0)
                                sw.set((l.start + (t - l.t0) / span).coerceIn(0.0, 1.0), g)
                            }
                            c.consume()
                        }
                        if (l != null && !c.pressed) end(c.id, false, c.uptimeMillis)
                    }
                    if (event.changes.none { it.pressed }) break
                }
            } catch (cancel: CancellationException) { for (id in live.keys.toList()) end(id, true, 0); throw cancel }
            finally { for (id in live.keys.toList()) end(id, true, 0) }
        }
    }) {
        val fit = fitRings(frame, density, size.width, size.height, mirror, 10.dp.toPx())
        val geo = Polar(size.width, size.height, mirror, 10.dp.toPx(), fit.tMin, fit.tMax)
        val held = heldSectors.values.toSet()
        // Hub: the focused deck, inside the innermost ring (dead space below the zone — a wrist rest).
        val hubR = max(fit.rMin - 6.dp.toPx(), 30.dp.toPx())
        drawCircle(deckColor(f).copy(alpha = .14f), hubR, Offset(geo.px, geo.py))
        val hp = geo.point(hubR * .62f, .5f)
        paint.textSize = 15.dp.toPx(); paint.color = deckColor(f).toArgb()
        drawContext.canvas.nativeCanvas.drawText("$f${if (ui.snapshot?.playing == true) "▶" else ""}", hp.x, hp.y + 5.dp.toPx(), paint)
        val rad = radii(fit, ringList.size)
        for ((i, ring) in ringList.withIndex()) {
            val (inner, outer) = rad[i]; val mid = (inner + outer) / 2; val width = outer - inner
            for (band in ring.bands) {
                band.sector?.let { s -> drawSector(geo, mid, width, band, s, s in held || s.lit(), paint) }
                band.sweep?.let { s -> drawSweep(geo, mid, width, band, s, paint) }
            }
        }
    }
}

private fun DrawScope.arc(geo: Polar, r: Float, t0: Float, t1: Float, color: Color, width: Float) {
    val start = geo.degrees(t0); val end = geo.degrees(t1)
    drawArc(color, min(start, end), abs(end - start), false, Offset(geo.px - r, geo.py - r), Size(r * 2, r * 2), style = Stroke(width, cap = StrokeCap.Butt))
}

private fun DrawScope.drawSector(geo: Polar, r: Float, width: Float, band: Band, s: Sector, lit: Boolean, paint: android.graphics.Paint) {
    val enabled = s.enabled()
    val tint = if (enabled) s.color else Ink.edge
    arc(geo, r, band.t0, band.t1, Ink.panel, width - 2.dp.toPx())
    arc(geo, r, band.t0, band.t1, tint.copy(alpha = if (lit) .55f else .12f), width - 2.dp.toPx())
    // Inner + outer edge lines read as the sector's box.
    arc(geo, r - width / 2 + 1.dp.toPx(), band.t0, band.t1, tint.copy(alpha = .6f), 1.5.dp.toPx())
    arc(geo, r + width / 2 - 1.dp.toPx(), band.t0, band.t1, tint.copy(alpha = .6f), 1.5.dp.toPx())
    val tm = (band.t0 + band.t1) / 2
    val p = geo.point(r, tm)
    paint.color = (if (lit) Ink.text else if (enabled) tint else Ink.muted).toArgb()
    paint.textSize = (if (s.label.length > 3) 10 else 13).dp.toPx()
    drawContext.canvas.nativeCanvas.drawText(s.label, p.x, p.y + (if (s.sub != null) 1 else 4).dp.toPx(), paint)
    s.sub?.let { paint.textSize = 8.dp.toPx(); paint.color = tint.copy(alpha = .9f).toArgb(); drawContext.canvas.nativeCanvas.drawText(it, p.x, p.y + 11.dp.toPx(), paint) }
}

private fun DrawScope.drawSweep(geo: Polar, r: Float, width: Float, band: Band, s: Sweep, paint: android.graphics.Paint) {
    val enabled = s.enabled()
    val v = s.value().toFloat().coerceIn(0f, 1f)
    val color = if (enabled) s.color(v.toDouble()) else Ink.edge
    val span = band.t1 - band.t0
    arc(geo, r, band.t0, band.t1, Ink.surface.copy(alpha = .35f), width - 6.dp.toPx())
    // Ticks: neutral mark at the anchor.
    val ta = band.t0 + span * s.anchor
    val tv = band.t0 + span * v
    if (abs(tv - ta) > .002f) arc(geo, r, min(ta, tv), max(ta, tv), color.copy(alpha = .55f), width - 10.dp.toPx())
    val a0 = geo.point(r - width / 2, ta); val a1 = geo.point(r + width / 2, ta)
    drawLine(Ink.muted, a0, a1, 1.5.dp.toPx())
    val dot = geo.point(r, tv)
    drawCircle(Ink.crust, 9.dp.toPx(), dot); drawCircle(color, 9.dp.toPx(), dot, style = Stroke(2.dp.toPx()))
    // Label at the start of the span, readout at its end (both inside the band).
    fun tag(text: String, p: Offset, size: Float, c: Color) {
        paint.textSize = size
        val tw = paint.measureText(text)
        drawRect(Color.Black.copy(alpha = .7f), Offset(p.x - tw / 2 - 2.dp.toPx(), p.y - size * .8f), Size(tw + 4.dp.toPx(), size * 1.2f))
        paint.color = c.toArgb(); drawContext.canvas.nativeCanvas.drawText(text, p.x, p.y + 3.dp.toPx(), paint)
    }
    tag(s.label, geo.point(r, band.t0 + span * .12f), 9.dp.toPx(), if (enabled) color.copy(alpha = 1f) else Ink.muted)
    tag(s.readout(v.toDouble()), geo.point(r, band.t1 - span * .14f), 8.dp.toPx(), Ink.text)
}
