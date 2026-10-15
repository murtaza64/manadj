package dev.manadj.app.onehand

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import dev.manadj.app.*
import dev.manadj.audio.AudioCommand
import dev.manadj.audio.DeckId
import dev.manadj.audio.LoopChange
import kotlinx.coroutines.*
import kotlin.math.*

/**
 * Concept C — CHORDS. A small dock of chord keys in the corner is all that is ever on screen; the waves stay
 * big. Tap = the key's primary action; press-and-drag opens a transient palette under the thumb (hot cue fan,
 * loop length wheel, jump arm, 2-D mix pad, FX pad, EQ pad) that commits on release. Haptics confirm every entry
 * so the eyes can stay on the waveforms. The FX target follows the focused deck.
 */
@Composable fun ChordsLayout(model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit, modifier: Modifier, band: Dp) {
    // Block: the dock (chips + two key rows), as wide as the screen allows, centred on the reach zone.
    OneHandScaffold(model, ux, pick, modifier, band, waveHeight = 128.dp, blockSize = { _, s -> DpSize(s.width - 16.dp, 34.dp + 68.dp + TransportRow + 12.dp) }) { frame ->
        val f = OneHand.focus
        val ui = model.decks.getValue(f)
        val color = deckColor(f)
        val state = remember { ChordState() }
        state.density = LocalDensity.current.density
        var macro by remember { mutableStateOf(MixMacro.BASS) }
        val haptic = LocalHapticFeedback.current
        Box(Modifier.fillMaxSize().onGloballyPositioned { state.zoneOrigin = it.positionInRoot() }) {
            Column(Modifier.absoluteOffset(x = frame.left).width(frame.width).focusFlick(), verticalArrangement = Arrangement.spacedBy(6.dp), horizontalAlignment = Alignment.End) {
                Row(Modifier.height(34.dp), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End)) {
                    Key("", Modifier.width(44.dp).fillMaxHeight(), Ink.muted, description = "Settings", icon = Glyph.Gear, style = KeyStyle.PILL, textSize = 10) { ux.toggleSettings(model) }
                    val q = model.output?.quantizeMode ?: ux.quantizeMode
                    Key("Q", Modifier.width(44.dp).fillMaxHeight(), Ink.accent, model.supports("quantize"), q.quantized, "Quantize", style = KeyStyle.PILL, textSize = 11) { ux.setQuantize(model, on = !q.quantized) }
                    val sync = model.syncState.decks[f] ?: dev.manadj.audio.SyncStatus.OFF
                    Key("SYNC", Modifier.width(64.dp).fillMaxHeight(), Ink.play, model.supports("sync"), sync != dev.manadj.audio.SyncStatus.OFF, "$f sync", style = KeyStyle.PILL, textSize = 11) { model.toggleSync(f) }
                    Key("PITCH", Modifier.width(66.dp).fillMaxHeight(), color, model.supports("varispeed"), model.pitchDrawer == f, "$f pitch panel", style = KeyStyle.PILL, textSize = 11) { model.pitchDrawer = if (model.pitchDrawer == f) null else f }
                    BrowseKey(model, ux, Modifier.width(84.dp).fillMaxHeight(), textSize = 11)
                }
                val keyW = 76.dp; val keyH = 68.dp
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    // FADERS (OH3): tap = both to full; hold = two lanes (A left / B right of the finger), ↕ moves the lane's fader.
                    ChordKey("FADERS", Ink.accent, Modifier.size(keyW, keyH), state, sub = "A %d · B %d".format((model.decks.getValue(DeckId.A).fader * 100).roundToInt(), (model.decks.getValue(DeckId.B).fader * 100).roundToInt()), enabled = model.supports("fader"),
                        tap = { model.updateFader(DeckId.A, 1.0); model.updateFader(DeckId.B, 1.0) }) { origin -> fadersSession(model, ux, f, origin, state) }
                    // EQ: tap = bass kill toggle (the one-tap mix move); hold = cut-only LOW (x) × HI (y) pad (OH1).
                    ChordKey("EQ", Ink.bands[0], Modifier.size(keyW, keyH), state, sub = if (ui.eq[0] <= .001) "LOW KILL" else "LOW·HI", lit = ui.eq[0] <= .001, enabled = model.supports("eq"),
                        tap = { model.updateEq(f, 0, doubleTapTarget(KnobKind.EQ_LOW, ui.eq[0])) }) { origin -> eqSession(model, ux, f, origin, state) }
                    ChordKey("JUMP", color, Modifier.size(keyW, keyH), state, sub = "◀ ${beatText(ui.jumpBeats)} ▶", enabled = model.supports("beat-jump") && ui.ready && ui.snapshot?.bpm != null,
                        tap = { model.jump(f, 1) }) { origin -> jumpSession(model, ux, f, origin, state) }
                    val looping = ui.snapshot?.loop != null
                    ChordKey("LOOP", if (looping) Ink.play else color, Modifier.size(keyW, keyH), state, sub = beatText(ui.snapshot?.loop?.beats ?: ui.snapshot?.pendingLoopBeats ?: 4.0), lit = looping, enabled = model.supports("loop") && ui.ready && ui.snapshot?.bpm != null,
                        tap = { model.toggleLoop(f) }) { origin -> loopSession(model, ux, f, origin, state) }
                    ChordKey("PADS", Ink.cues[0], Modifier.size(keyW, keyH), state, sub = "HOLD · SLIDE", enabled = ui.ready && model.supports("hot-cue-gate"), tap = { haptic.performHapticFeedback(HapticFeedbackType.Reject) }) { origin -> padsSession(model, ux, f, origin, state) }
                }
                Row(Modifier.height(TransportRow).screenSafe(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FocusChip(model, Modifier.width(72.dp).fillMaxHeight(), textSize = 10)
                    ChordKey("MIX", Ink.accent, Modifier.size(keyW, TransportRow), state, sub = macro.label, enabled = model.supports("crossfade"),
                        tap = { macro = MixMacro.entries[(macro.ordinal + 1) % MixMacro.entries.size] }) { origin -> mixSession(model, ux, f, macro, origin, state) }
                    val fxLive = model.supports("beat-fx") || ux.previewPending
                    ChordKey("FX", Color(ux.fx.effect.color), Modifier.size(keyW, TransportRow), state, sub = "${ux.fx.effect.short} ${beatText(FX_BEATS[ux.fx.beats])}", lit = ux.fx.on, enabled = fxLive,
                        tap = { ux.fx.target = f.ordinal; ux.fx.on = !ux.fx.on }, doubleTap = { ux.fx.effect = FxEffect.entries[(ux.fx.effect.ordinal + 1) % FxEffect.entries.size] }) { origin -> fxSession(model, ux, f, origin, state) }
                    CueKey(ui, model, Modifier.width(90.dp).fillMaxHeight())
                    PlayKey(ui, model, Modifier.width(100.dp).fillMaxHeight())
                }
            }
            // Palette overlay: drawn in zone coordinates at the chord's origin.
            state.session?.let { s -> Box(Modifier.matchParentSize()) { s.palette(this, state.origin - state.zoneOrigin) } }
            androidx.compose.animation.AnimatedVisibility(model.pitchDrawer == f, Modifier.matchParentSize().padding(8.dp)) { PitchPanel(ui, model, ux, Modifier.fillMaxSize()) }
        }
        // FX section is written whole from the UI state (same contract as FxSection).
        if (model.supports("beat-fx")) LaunchedEffect(Unit) {
            snapshotFlow { dev.manadj.audio.BeatFxState(dev.manadj.audio.BeatFxEffect.entries[ux.fx.effect.ordinal], listOf(dev.manadj.audio.BeatFxTarget.A, dev.manadj.audio.BeatFxTarget.B, dev.manadj.audio.BeatFxTarget.MASTER)[ux.fx.target], ux.fx.on, ux.fx.depth * 2 - 1, FX_BEATS[ux.fx.beats]) }.collect { model.updateBeatFx(it) }
        }
        Spacer(Modifier.height(4.dp))
    }
}

/** A palette in flight: [move] gets the drag from the origin (px), [close] commits or cancels, [palette] draws it. */
class ChordSession(val move: (Offset) -> Unit, val close: (Boolean) -> Unit, val palette: @Composable BoxScope.(origin: Offset) -> Unit)

class ChordState {
    var session by mutableStateOf<ChordSession?>(null)
    var origin by mutableStateOf(Offset.Zero)
    var zoneOrigin by mutableStateOf(Offset.Zero)
    var drag by mutableStateOf(Offset.Zero)
    var density = 2.75f
}

/** Chord key: tap = [tap]; hold 160 ms or move 10 dp = [open] a palette that follows the drag; [doubleTap] optional. */
@Composable fun ChordKey(label: String, color: Color, modifier: Modifier, state: ChordState, sub: String? = null, lit: Boolean = false, enabled: Boolean = true, tap: () -> Unit, doubleTap: (() -> Unit)? = null, open: (Offset) -> ChordSession) {
    val haptic = LocalHapticFeedback.current
    var held by remember { mutableStateOf(false) }
    val heat by animateFloatAsState(if (held) 1f else if (lit) .5f else 0f, tween(if (held) 0 else 240), label = "chord")
    val tint = if (enabled) color else Ink.surface2
    val shape = RoundedCornerShape(12.dp)
    val currentTap by rememberUpdatedState(tap); val currentDouble by rememberUpdatedState(doubleTap); val currentOpen by rememberUpdatedState(open); val currentEnabled by rememberUpdatedState(enabled)
    val isEnabled = { currentEnabled }
    var root by remember { mutableStateOf(Offset.Zero) }
    Box(modifier.onGloballyPositioned { root = it.positionInRoot() }.halo(tint, heat * .8f, 6.dp).semantics { contentDescription = "$label chord" }.pointerInput(Unit) {
        var lastTap = -1000L
        val scope = kotlinx.coroutines.CoroutineScope(currentCoroutineContext())
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            if (!isEnabled()) return@awaitEachGesture
            down.consume(); held = true
            var session: ChordSession? = null; var cancelled = false
            val originRoot = root + down.position
            fun openNow() {
                if (session != null) return
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                state.origin = originRoot; state.drag = Offset.Zero
                session = currentOpen(originRoot); state.session = session
            }
            val hold = scope.launch { kotlinx.coroutines.delay(160); openNow() }
            try {
                while (true) {
                    val c = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                    if (c == null || (!c.pressed && c.isConsumed)) { cancelled = true; break }
                    val d = c.position - down.position
                    if (!c.pressed) {
                        if (session == null) {
                            hold.cancel()
                            if (currentDouble != null && c.uptimeMillis - lastTap < 300) { currentDouble!!(); lastTap = -1000; haptic.performHapticFeedback(HapticFeedbackType.LongPress) }
                            else { lastTap = c.uptimeMillis; haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); currentTap() }
                        }
                        break
                    }
                    if (session == null && d.getDistance() > 10.dp.toPx()) { hold.cancel(); openNow() }
                    session?.let { state.drag = d; it.move(d) }
                    c.consume()
                }
            } catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { hold.cancel(); held = false; session?.close(cancelled); if (state.session === session) state.session = null }
        }
    }.padding(3.dp).clip(shape).background(Ink.panel).background(tint.copy(alpha = .28f * heat)).border(1.5.dp, tint.copy(alpha = if (lit || held) 1f else .6f), shape), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(label, color = if (lit || held) Ink.text else if (enabled) tint else Ink.muted, size = 14, bold = true)
            if (sub != null) Text(sub, color = tint.copy(alpha = .85f), size = 8, bold = true)
        }
    }
}

/** Palette chrome: a card placed relative to the origin (clamped inside the zone). */
@Composable private fun BoxScope.PaletteCard(origin: Offset, w: Dp, h: Dp, color: Color, dx: Dp, dy: Dp, content: @Composable BoxScope.() -> Unit) {
    val density = LocalDensity.current
    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.matchParentSize()) {
        val maxW = with(density) { maxWidth.toPx() }; val maxH = with(density) { maxHeight.toPx() }
        val wp = with(density) { w.toPx() }; val hp = with(density) { h.toPx() }
        val mirror = OneHand.mirror
        val x = (origin.x + with(density) { (if (mirror) -dx - w else dx).toPx() }).coerceIn(4f, (maxW - wp - 4f).coerceAtLeast(4f))
        val y = (origin.y + with(density) { dy.toPx() } - hp).coerceIn(4f, (maxH - hp - 4f).coerceAtLeast(4f))
        Box(Modifier.offset { IntOffset(x.roundToInt(), y.roundToInt()) }.size(w, h).halo(color, .5f, 8.dp).padding(8.dp).clip(RoundedCornerShape(10.dp)).background(Ink.panel.copy(alpha = .96f)).border(1.5.dp, color, RoundedCornerShape(10.dp)).padding(6.dp), content = content)
    }
}

/** PADS: two arcs of hot cues fan out from the thumb; sliding into a cell = HotCueDown (or SET when empty), leaving = HotCueUp. */
private fun padsSession(model: PlayerModel, ux: UiModel, f: DeckId, origin: Offset, state: ChordState): ChordSession {
    val ui = model.decks.getValue(f)
    val mirror = OneHand.mirror
    val sx = if (mirror) -1f else 1f
    // Cell centres in px relative to the origin: 1–4 on the near arc, 5–8 on the far one, fanned from "across"
    // (away from the thumb's side) to "straight up".
    val density = state.density
    val cells = (0 until 8).map { i -> val r = (if (i < 4) 132f else 204f) * density; val th = Math.toRadians(16.0 + (i % 4) * 27.0); Offset(-(cos(th) * r).toFloat() * sx, -(sin(th) * r).toFloat()) }
    var active by mutableStateOf<Int?>(null)
    var release: ((Boolean) -> Unit)? = null
    var gesture: String? = null
    fun enter(slot: Int) {
        val set = ui.hotCues[slot] != null
        val id = model.beginGesture(f, "HOTCUE$slot") { if (set) model.submit(AudioCommand.HotCueUp(f, slot, it)) }
        gesture = id
        model.submit(if (set) AudioCommand.HotCueDown(f, slot, id) else AudioCommand.SetHotCue(f, slot, id))
        if (!set) ux.journalCueWhenSet(model, f, slot)
        release = { cancelled -> if (!cancelled && set && model.gestureActive(id)) model.submit(AudioCommand.HotCueUp(f, slot, id)); model.finishGesture(id, cancelled) }
    }
    fun leave(cancelled: Boolean) { release?.invoke(cancelled); release = null; active = null }
    return ChordSession(move = { d ->
        val hit = cells.indices.minByOrNull { (cells[it] - d).getDistance() }?.takeIf { (cells[it] - d).getDistance() < 32 * density }
        if (hit != active) { leave(false); if (hit != null) { active = hit; enter(hit) } }
    }, close = { cancelled -> leave(cancelled) }, palette = { origin ->
        Canvas(Modifier.matchParentSize()) {
            for ((i, c) in cells.withIndex()) {
                val p = origin + c
                val stored = ui.hotCues[i]
                val tint = Ink.cues[i]
                val on = active == i
                drawCircle(Ink.panel, 28.dp.toPx(), p)
                drawCircle(tint.copy(alpha = if (on) .6f else if (stored != null) .18f else .05f), 28.dp.toPx(), p)
                drawCircle(tint.copy(alpha = if (stored != null) 1f else .4f), 28.dp.toPx(), p, style = Stroke((if (on) 3f else 1.5f).dp.toPx()))
                drawContext.canvas.nativeCanvas.apply {
                    val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { typeface = android.graphics.Typeface.create(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD); textAlign = android.graphics.Paint.Align.CENTER }
                    paint.textSize = 15.dp.toPx(); paint.color = (if (on) Ink.text else tint).toArgb()
                    drawText("${i + 1}", p.x, p.y + 2.dp.toPx(), paint)
                    paint.textSize = 8.dp.toPx(); paint.color = tint.copy(alpha = .9f).toArgb()
                    drawText(stored?.let(::clock) ?: "SET", p.x, p.y + 13.dp.toPx(), paint)
                }
            }
            // Thumb trail from the origin.
            drawCircle(Ink.text.copy(alpha = .5f), 6.dp.toPx(), origin + Offset(0f, 0f))
        }
    })
}

/** LOOP: x drags the length wheel (live resize while looping); release keeps it. */
private fun loopSession(model: PlayerModel, ux: UiModel, f: DeckId, origin: Offset, state: ChordState): ChordSession {
    val ui = model.decks.getValue(f)
    val start = LOOP_CHOICES.indices.minBy { abs(ln(LOOP_CHOICES[it] / (ui.snapshot?.loop?.beats ?: ui.snapshot?.pendingLoopBeats ?: 4.0))) }
    var index by mutableIntStateOf(start)
    val step = 36f * state.density
    return ChordSession(move = { d ->
        val next = (start + (d.x / step).roundToInt()).coerceIn(LOOP_CHOICES.indices)
        if (next != index) { index = next; model.submit(AudioCommand.LoopResize(f, LoopChange.SET, LOOP_CHOICES[next])) }
    }, close = { }, palette = { origin ->
        PaletteCard(origin, 300.dp, 64.dp, Ink.play, dx = -250.dp, dy = -40.dp) {
            Column(Modifier.fillMaxSize()) {
                Text("LOOP LENGTH · slide", color = Ink.play, size = 9, bold = true)
                Row(Modifier.fillMaxWidth().weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    for (i in LOOP_CHOICES.indices) Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                        Text(beatText(LOOP_CHOICES[i]), color = if (i == index) Ink.text else Ink.muted, size = if (i == index) 16 else 10, bold = i == index)
                    }
                }
            }
        }
    })
}

/** JUMP: drag left/right past 48 dp arms ◀ / ▶ (commits on release); drag up/down steps the size. */
private fun jumpSession(model: PlayerModel, ux: UiModel, f: DeckId, origin: Offset, state: ChordState): ChordSession {
    val ui = model.decks.getValue(f)
    val start = BEAT_CHOICES.indices.minBy { abs(ln(BEAT_CHOICES[it] / ui.jumpBeats)) }
    var armed by mutableIntStateOf(0)
    val px = state.density
    return ChordSession(move = { d ->
        armed = when { d.x < -48 * px -> -1; d.x > 48 * px -> 1; else -> 0 }
        val size = (start - (d.y / (40 * px)).roundToInt()).coerceIn(BEAT_CHOICES.indices)
        if (BEAT_CHOICES[size] != ui.jumpBeats) ui.jumpBeats = BEAT_CHOICES[size]
    }, close = { cancelled -> if (!cancelled && armed != 0) model.jump(f, armed) }, palette = { origin ->
        PaletteCard(origin, 220.dp, 70.dp, deckColor(f), dx = -200.dp, dy = -40.dp) {
            Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Text("◀", color = if (armed < 0) Ink.text else deckColor(f).copy(alpha = .5f), size = if (armed < 0) 24 else 16, bold = true)
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("JUMP ${beatText(ui.jumpBeats)}", color = Ink.text, size = 16, bold = true)
                    Text("↕ size · ↔ arm · release", color = Ink.muted, size = 8)
                }
                Text("▶", color = if (armed > 0) Ink.text else deckColor(f).copy(alpha = .5f), size = if (armed > 0) 24 else 16, bold = true)
            }
        }
    })
}

/** MIX: 2-D pad — x = the transition macro throw (A ← → B), y = the focused deck's FILTER (up = HPF). Relative. */
private fun mixSession(model: PlayerModel, ux: UiModel, f: DeckId, macro: MixMacro, origin: Offset, state: ChordState): ChordSession {
    val ui = model.decks.getValue(f)
    val x0 = model.crossfade; val y0 = (ui.filter + 1) / 2
    val id = model.beginGesture(DeckId.A, "LEVER") { applyMixMacro(model, ux, macro, x0, it); model.updateFilter(f, y0 * 2 - 1, it) }
    val px = state.density
    return ChordSession(move = { d ->
        if (!model.gestureActive(id)) return@ChordSession
        val sx = if (OneHand.mirror) -1f else 1f
        applyMixMacro(model, ux, macro, (x0 + sx * d.x / (220 * px)).coerceIn(0.0, 1.0), id)
        model.updateFilter(f, ((y0 - d.y / (200 * px)).coerceIn(0.0, 1.0)) * 2 - 1, id)
    }, close = { cancelled -> model.finishGesture(id, cancelled) }, palette = { origin ->
        PaletteCard(origin, 236.dp, 216.dp, Ink.accent, dx = -236.dp, dy = -16.dp) {
            val fx = model.crossfade.toFloat(); val fy = ((ui.filter + 1) / 2).toFloat()
            Canvas(Modifier.fillMaxSize()) {
                drawRect(Ink.crust)
                drawLine(Ink.surface, Offset(size.width / 2, 0f), Offset(size.width / 2, size.height), 1.5f)
                drawLine(Ink.surface, Offset(0f, size.height / 2), Offset(size.width, size.height / 2), 1.5f)
                val p = Offset(size.width * fx, size.height * (1 - fy))
                drawLine(Ink.accent.copy(alpha = .5f), Offset(p.x, 0f), Offset(p.x, size.height), 2.dp.toPx())
                drawLine(knobColor(KnobKind.FILTER, fy.toDouble()).copy(alpha = .6f), Offset(0f, p.y), Offset(size.width, p.y), 2.dp.toPx())
                drawCircle(Ink.accent, 9.dp.toPx(), p); drawCircle(Ink.crust, 4.dp.toPx(), p)
            }
            Text("A", Modifier.align(Alignment.CenterStart), deckColor(DeckId.A), 14, true)
            Text("B", Modifier.align(Alignment.CenterEnd), deckColor(DeckId.B), 14, true)
            Text("HPF", Modifier.align(Alignment.TopCenter), Ink.filterHpf, 10, true)
            Text("LPF", Modifier.align(Alignment.BottomCenter), Ink.filterLpf, 10, true)
            Text(macro.label, Modifier.align(Alignment.TopStart).background(Color.Black).padding(2.dp), Ink.accent, 9, true)
            Text("$f FILTER ${knobReadout(KnobKind.FILTER, fy.toDouble())}", Modifier.align(Alignment.BottomEnd).background(Color.Black).padding(2.dp), Ink.text, 9, true)
        }
    })
}

/** EQ (OH1): cut-only 2-D pad — x = LOW, y = HI of the focused deck, kill → unity across the pad (relative; no boost here). */
private fun eqSession(model: PlayerModel, ux: UiModel, f: DeckId, origin: Offset, state: ChordState): ChordSession {
    val ui = model.decks.getValue(f)
    val x0 = eqToCut(ui.eq[0]); val y0 = eqToCut(ui.eq[2]); val e0 = ui.eq[0]; val e2 = ui.eq[2]
    val id = model.beginGesture(f, "EQPAD") { model.updateEq(f, 0, e0, it); model.updateEq(f, 2, e2, it) }
    val px = state.density
    return ChordSession(move = { d ->
        if (!model.gestureActive(id)) return@ChordSession
        val sx = if (OneHand.mirror) -1f else 1f
        model.updateEq(f, 0, cutToEq(x0 + sx * d.x / (220 * px)), id)
        model.updateEq(f, 2, cutToEq(y0 - d.y / (200 * px)), id)
    }, close = { cancelled -> model.finishGesture(id, cancelled) }, palette = { origin ->
        PaletteCard(origin, 236.dp, 216.dp, Ink.bands[0], dx = -236.dp, dy = -16.dp) {
            val lx = eqToCut(ui.eq[0]).toFloat(); val hy = eqToCut(ui.eq[2]).toFloat()
            Canvas(Modifier.fillMaxSize()) {
                drawRect(Ink.crust)
                drawLine(Ink.surface, Offset(size.width / 2, 0f), Offset(size.width / 2, size.height), 1.5f)
                drawLine(Ink.surface, Offset(0f, size.height / 2), Offset(size.width, size.height / 2), 1.5f)
                val p = Offset(size.width * lx, size.height * (1 - hy))
                drawLine(Ink.bands[0].copy(alpha = .6f), Offset(p.x, 0f), Offset(p.x, size.height), 2.dp.toPx())
                drawLine(Ink.bands[2].copy(alpha = .6f), Offset(0f, p.y), Offset(size.width, p.y), 2.dp.toPx())
                drawCircle(Ink.text, 9.dp.toPx(), p); drawCircle(Ink.crust, 4.dp.toPx(), p)
            }
            Text("LOW ${knobReadout(KnobKind.EQ_LOW, lx.toDouble())}", Modifier.align(Alignment.BottomStart).background(Color.Black).padding(2.dp), Ink.bands[0], 10, true)
            Text("HI ${knobReadout(KnobKind.EQ_HIGH, hy.toDouble())}", Modifier.align(Alignment.TopEnd).background(Color.Black).padding(2.dp), Ink.bands[2], 10, true)
            Text("KILL → 0 dB · MID: stub", Modifier.align(Alignment.TopStart).background(Color.Black).padding(2.dp), Ink.pending, 8, true)
        }
    })
}

/** FADERS (OH3): two lanes; the finger left of the origin drives A, right drives B (mirrored for the left hand); ↕ = relative fader. */
private fun fadersSession(model: PlayerModel, ux: UiModel, f: DeckId, origin: Offset, state: ChordState): ChordSession {
    val a0 = model.decks.getValue(DeckId.A).fader; val b0 = model.decks.getValue(DeckId.B).fader
    val id = model.beginGesture(DeckId.A, "FADERS") { model.updateFader(DeckId.A, a0, it); model.updateFader(DeckId.B, b0, it) }
    var lane by mutableStateOf(f)
    var laneBase = 0f; var laneStart = if (f == DeckId.A) a0 else b0
    val px = state.density
    return ChordSession(move = { d ->
        if (!model.gestureActive(id)) return@ChordSession
        val sx = if (OneHand.mirror) -1f else 1f
        val want = if (sx * d.x < -28 * px) DeckId.A else if (sx * d.x > 28 * px) DeckId.B else lane
        if (want != lane) { lane = want; laneBase = d.y; laneStart = model.decks.getValue(lane).fader }
        model.updateFader(lane, (laneStart - (d.y - laneBase) / (180 * px)).coerceIn(0.0, 1.0), id)
    }, close = { cancelled -> model.finishGesture(id, cancelled) }, palette = { origin ->
        PaletteCard(origin, 200.dp, 230.dp, Ink.accent, dx = -200.dp, dy = -16.dp) {
            Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (d in listOf(DeckId.A, DeckId.B)) {
                    val v = model.decks.getValue(d).fader.toFloat()
                    Column(Modifier.weight(1f).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("${d.name} ${(v * 100).roundToInt()}%", color = if (lane == d) Ink.text else deckColor(d), size = 12, bold = true)
                        Canvas(Modifier.weight(1f).fillMaxWidth()) {
                            val x = size.width / 2
                            drawLine(Ink.surface, Offset(x, 0f), Offset(x, size.height), 6.dp.toPx(), StrokeCap.Round)
                            drawLine(deckColor(d).copy(alpha = if (lane == d) 1f else .5f), Offset(x, size.height * (1 - v)), Offset(x, size.height), 6.dp.toPx(), StrokeCap.Round)
                            drawRoundRect(if (lane == d) Ink.text else Ink.crust, Offset(x - 18.dp.toPx(), size.height * (1 - v) - 8.dp.toPx()), Size(36.dp.toPx(), 16.dp.toPx()), androidx.compose.ui.geometry.CornerRadius(3.dp.toPx()))
                        }
                    }
                }
            }
            Text("← A · B → pick · ↕ level", Modifier.align(Alignment.BottomCenter).background(Color.Black).padding(2.dp), Ink.muted, 8)
        }
    })
}

/** FX: x = DEPTH (relative), y = BEATS wheel; the target follows the focused deck; release keeps the values. */
private fun fxSession(model: PlayerModel, ux: UiModel, f: DeckId, origin: Offset, state: ChordState): ChordSession {
    val fx = ux.fx
    fx.target = f.ordinal
    val d0 = fx.depth; val b0 = fx.beats
    val px = state.density
    return ChordSession(move = { d ->
        val sx = if (OneHand.mirror) -1f else 1f
        fx.depth = (d0 + sx * d.x / (220 * px)).coerceIn(0.0, 1.0)
        fx.beats = (b0 - (d.y / (36 * px)).roundToInt()).coerceIn(FX_BEATS.indices)
    }, close = { }, palette = { origin ->
        val tone = Color(fx.effect.color)
        PaletteCard(origin, 236.dp, 150.dp, tone, dx = -236.dp, dy = -16.dp) {
            Column(Modifier.fillMaxSize()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(fx.effect.label, Modifier.weight(1f), tone, 14, true)
                    Text("→ $f", color = deckColor(f), size = 12, bold = true)
                    Spacer(Modifier.width(6.dp))
                    Text(if (fx.on) "ON" else "OFF", color = if (fx.on) Ink.text else Ink.muted, size = 12, bold = true)
                }
                Row(Modifier.fillMaxWidth().weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    for (i in FX_BEATS.indices) Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                        Text(beatText(FX_BEATS[i]), color = if (i == fx.beats) Ink.text else Ink.muted, size = if (i == fx.beats) 14 else 9, bold = i == fx.beats)
                    }
                }
                Canvas(Modifier.fillMaxWidth().height(18.dp)) {
                    drawRoundRect(Ink.surface, cornerRadius = androidx.compose.ui.geometry.CornerRadius(4.dp.toPx()))
                    drawRoundRect(knobColor(KnobKind.FX_DEPTH, fx.depth), size = Size(size.width * fx.depth.toFloat(), size.height), cornerRadius = androidx.compose.ui.geometry.CornerRadius(4.dp.toPx()))
                }
                Text("↔ depth ${knobReadout(KnobKind.FX_DEPTH, fx.depth)} · ↕ beats · tap ON · double-tap next FX", color = Ink.muted, size = 8)
            }
        }
    })
}
