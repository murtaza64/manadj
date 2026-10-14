package dev.manadj.app.session

import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import androidx.compose.animation.core.AnimationState
import androidx.compose.animation.core.animateDecay
import androidx.compose.animation.splineBasedDecay
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.manadj.app.*
import dev.manadj.audio.DeckId
import dev.manadj.library.session.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlin.math.*

/** Timeline lanes top to bottom: desktop C, A, B, D (the mixer's channel order). */
val LANE_ORDER = intArrayOf(2, 0, 1, 3)
/** The lanes a Session needs: decks that never played take no space on a phone. */
fun lanesOf(tl: SessionTimeline): IntArray = LANE_ORDER.filter { d -> tl.runs[d].isNotEmpty() }.toIntArray().takeIf { it.isNotEmpty() } ?: LANE_ORDER
private const val TILE = 256
/** Desktop max zoom (60 px/s), in dp. */
const val MAX_DP_PER_SECOND = 60.0

private fun fxColor(effect: String) = Color(when (effect) {
    "echo" -> FxEffect.ECHO.color; "lowCutEcho" -> FxEffect.LOW_CUT_ECHO.color; "reverb" -> FxEffect.REVERB.color
    "flanger" -> FxEffect.FLANGER.color; "trans" -> FxEffect.TRANS.color; "roll" -> FxEffect.ROLL.color; else -> 0xffffffff
})
private fun fxShort(effect: String) = when (effect) {
    "echo" -> FxEffect.ECHO.short; "lowCutEcho" -> FxEffect.LOW_CUT_ECHO.short; "reverb" -> FxEffect.REVERB.short
    "flanger" -> FxEffect.FLANGER.short; "trans" -> FxEffect.TRANS.short; "roll" -> FxEffect.ROLL.short; else -> effect.uppercase()
}

/**
 * Waveform tiles: [TILE]-px columns of all four lanes at power-of-two zoom levels (level L = 2^L px/s),
 * rendered off the main thread and drawn scaled/translated, so pan, follow and pinch never re-render per frame.
 * Each column is the run's track audio (styled like every other waveform), modulated by EQ and fader·trim,
 * over the audibility fill (height = Master gain / 0.5). Inaudible stretches draw dimmed.
 */
private class Tiles(val tl: SessionTimeline, val lanes: IntArray, val origin: Double, val laneH: Int, val gap: Int, val waves: Map<Int, TimelineWave>, val scope: CoroutineScope) {
    val height = laneH * lanes.size + gap * (lanes.size - 1)
    private class Tile(val bitmap: Bitmap, val gen: Int)
    private val cache = object : LinkedHashMap<Long, Tile>(64, .75f, true) { override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, Tile>?) = size > 44 }
    private val queued = HashSet<Long>()
    private val requests = Channel<Long>(Channel.UNLIMITED)
    /** Waves generation (bumps as waveforms arrive; older tiles redraw). */
    @Volatile var gen = 0
    /** Bumps when a tile lands (the canvas reads it to redraw). */
    var landed by mutableIntStateOf(0)
    @Volatile var wantLevel = 0

    init {
        repeat(2) {
            scope.launch(Dispatchers.Default) {
                for (key in requests) {
                    val level = (key ushr 48).toInt() - 128
                    val k = (key shl 16) shr 16
                    if (level != wantLevel) { synchronized(queued) { queued.remove(key) }; continue }
                    val g = gen
                    val started = System.nanoTime()
                    val bm = render(level, k)
                    if (k % 8 == 0L) android.util.Log.d("ManadjSession", "timeline tile L$level k$k %.1f ms".format((System.nanoTime() - started) / 1e6))
                    withContext(Dispatchers.Main) { cache[key] = Tile(bm, g); synchronized(queued) { queued.remove(key) }; landed++ }
                }
            }
        }
    }

    private fun key(level: Int, k: Long) = ((level + 128).toLong() shl 48) or (k and 0xffffffffffffL)
    fun tileSeconds(level: Int) = TILE / 2.0.pow(level)

    /** Cached tile (maybe stale), requesting a fresh one when missing or stale. */
    fun get(level: Int, k: Long, request: Boolean): Bitmap? {
        val key = key(level, k)
        val t = cache[key]
        if (request && (t == null || t.gen != gen) && synchronized(queued) { queued.add(key) }) requests.trySend(key)
        return t?.bitmap
    }
    fun peek(level: Int, k: Long): Bitmap? = cache[key(level, k)]?.bitmap

    private fun render(level: Int, k: Long): Bitmap {
        val pps = 2.0.pow(level)
        val t0 = origin + k * TILE / pps
        val col = 1 / pps
        val bm = Bitmap.createBitmap(TILE, height, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(bm)
        val style = WaveStyle.full ?: WaveStyle.FULL
        val paint = Paint().apply { strokeWidth = 1f }
        val fill = Paint()
        val g = FloatArray(3)
        for ((i, d) in lanes.withIndex()) {
            val y0 = i * (laneH + gap).toFloat()
            val mid = y0 + laneH / 2f; val half = laneH / 2f - 2
            val color = deckColor(DeckId.entries[d])
            fill.color = color.copy(alpha = .16f).toArgb()
            val placeholder = Paint().apply { this.color = color.copy(alpha = .45f).toArgb(); strokeWidth = 1f }
            val heard = Lines(style); val unheard = Lines(style)
            val runs = tl.runs[d]
            var ri = tl.runIndex(d, t0)
            for (x in 0 until TILE) {
                val ta = t0 + x * col; val tb = ta + col; val tc = ta + col / 2
                val mix = tl.mixAt(d, tc)
                if (mix.gain > 0) { val h = min(1.0, mix.gain / .5).toFloat() * laneH; canvas.drawRect(x.toFloat(), y0 + laneH - h, x + 1f, y0 + laneH, fill) }
                while (ri < runs.size && runs[ri].t1 <= tc) ri++
                val run = runs.getOrNull(ri)?.takeIf { it.t0 <= tc } ?: continue
                val a = run.at(max(ta, run.t0)); val b = run.at(min(tb, run.t1))
                val hi = max(a, b); val lo = max(0.0, min(a, b))
                if (hi < 0) continue
                val wave = waves[run.trackId]
                if (wave == null) { canvas.drawLine(x + .5f, mid - half * .2f, x + .5f, mid + half * .2f, placeholder); continue }
                if (lo >= wave.data.duration) continue
                columnGroups(wave.data, lo, max(hi, lo + 1e-3), g)
                val level0 = (wave.fill * mix.level).toFloat()
                g[0] = (g[0] * level0 * mix.low.toFloat()).coerceAtMost(1f)
                g[1] = (g[1] * level0 * mix.mid.toFloat()).coerceAtMost(1f)
                g[2] = (g[2] * level0 * mix.high.toFloat()).coerceAtMost(1f)
                val lines = if (mix.audible) heard else unheard
                lines.column(g) { lv, c, e -> lines.add(lv, c, x + .5f, mid - e * half, x + .5f, mid + e * half) }
            }
            heard.draw(canvas, paint)
            canvas.saveLayerAlpha(0f, y0, TILE.toFloat(), y0 + laneH, 100)
            unheard.draw(canvas, paint)
            canvas.restore()
        }
        return bm
    }

    fun close() { requests.close() }
}

/** A drawn track label (hit target for focus taps). */
private class LabelHit(val a: Appearance, val l: Float, val t: Float, val r: Float, val b: Float)

/**
 * The Session timeline (desktop SessionTimelineView, phone-sized): ruler, then lanes C/A/B/D with waveform
 * segments, audibility fill, load flags, staggered sticky track labels, Beat FX bands, loops, gesture marks
 * (when zoomed to 10 min or less), machine holds, played veil and the playhead.
 * Touch: drag/fling pans, pinch zooms at the fingers, tap seeks, tap a label focuses its track, double-tap fits.
 */
@Composable fun SessionTimelineView(model: SessionModel, player: PlayerModel, log: SessionLog, tl: SessionTimeline, lanes: IntArray, laneHeight: Dp, rulerHeight: Dp, modifier: Modifier = Modifier, gap: Dp = 3.dp) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val density = androidx.compose.ui.platform.LocalDensity.current
    val laneH = with(density) { laneHeight.roundToPx() }
    val gapPx = with(density) { gap.roundToPx() }
    val tiles = remember(tl, lanes, laneH, gapPx) { Tiles(tl, lanes, log.activeStart, laneH, gapPx, model.waves, scope) }
    DisposableEffect(tiles) { onDispose { tiles.close() } }
    val playing = model.playing
    val focused = model.focus != null
    LaunchedEffect(playing, focused) { if (playing || focused) while (true) withFrameNanos { model.frame(it) } }
    val typeface = remember { androidx.core.content.res.ResourcesCompat.getFont(context, dev.manadj.app.R.font.ubuntu_mono_bold) }
    val text = remember { Paint(Paint.ANTI_ALIAS_FLAG).apply { this.typeface = typeface } }
    val bitmapPaint = remember { Paint(Paint.FILTER_BITMAP_FLAG) }
    val src = remember { Rect() }; val dst = remember { RectF() }
    val hits = remember { ArrayList<LabelHit>() }
    val currentModel by rememberUpdatedState(model)
    val lanesTop = with(density) { rulerHeight.toPx() }

    Canvas(modifier.fillMaxWidth().height(rulerHeight + laneHeight * lanes.size + gap * (lanes.size - 1)).clipToBounds().testTag("session-timeline")
        .semantics { contentDescription = "Four deck Session timeline; tap to seek, drag to pan, pinch to zoom, double-tap to fit" }
        .pointerInput(log) { timelineGestures(this, { currentModel }, player, hits, scope) }) {
        model.minViewWidth = size.width / density.density / MAX_DP_PER_SECOND
        tiles.landed // redraw when tiles land
        tiles.gen = model.waves.size // and when waveforms arrive (older tiles re-render)
        val now = model.displayTime
        val vs = model.viewStart; val vw = model.viewWidth
        val w = size.width
        val pps = w / vw
        fun x(t: Double) = ((t - vs) * pps).toFloat()
        fun laneY(i: Int) = lanesTop + i * (laneH + gapPx)
        val dp = density.density
        val lanesBottom = laneY(lanes.size - 1) + laneH

        // Lanes.
        for ((i, d) in lanes.withIndex()) {
            val c = deckColor(DeckId.entries[d])
            drawRect(c.copy(alpha = .05f), Offset(0f, laneY(i)), Size(w, laneH.toFloat()))
        }
        // Machine holds (tenure): the surface was not the human's.
        for (h in tl.holds) {
            val l = x(h.t0); val r = x(h.t1)
            if (r < 0 || l > w) continue
            drawRect(Ink.text.copy(alpha = .06f), Offset(l, lanesTop), Size(max(r - l, 3f), lanesBottom - lanesTop))
        }
        // Ruler.
        val step = TimelineLayout.rulerStep(vw, w / dp, 90f)
        text.textSize = 9 * dp; text.color = Ink.overlay1.toArgb()
        var tick = ceil((vs - log.activeStart) / step) * step
        while (log.activeStart + tick <= vs + vw) {
            val px = x(log.activeStart + tick)
            drawLine(Ink.surface.copy(alpha = .55f), Offset(px, lanesTop - 5 * dp), Offset(px, lanesBottom), 1f)
            drawContext.canvas.nativeCanvas.drawText(hmsShort(tick), px + 3 * dp, lanesTop - 6 * dp, text)
            tick += step
        }
        // Waveform tiles at the level just above the current zoom (downscaled <= 2x).
        val level = ceil(log2(pps)).toInt().coerceIn(-12, 12)
        tiles.wantLevel = level
        val ts = tiles.tileSeconds(level)
        val k0 = floor((vs - log.activeStart) / ts).toLong(); val k1 = floor((vs + vw - log.activeStart) / ts).toLong()
        val nc = drawContext.canvas.nativeCanvas
        for (k in k0..k1) {
            val t0 = log.activeStart + k * ts
            val l = x(t0); val r = x(t0 + ts)
            fun blit(bm: Bitmap, sx0: Int, sx1: Int, dl: Float, dr: Float) { src.set(sx0, 0, sx1, tiles.height); dst.set(dl, lanesTop, dr, lanesTop + tiles.height); nc.drawBitmap(bm, src, dst, bitmapPaint) }
            val bm = tiles.get(level, k, request = true)
            if (bm != null) { blit(bm, 0, TILE, l, r); continue }
            // Not rendered yet: a neighbouring level stands in.
            val finer0 = tiles.peek(level + 1, 2 * k); val finer1 = tiles.peek(level + 1, 2 * k + 1)
            if (finer0 != null && finer1 != null) { val m = (l + r) / 2; blit(finer0, 0, TILE, l, m); blit(finer1, 0, TILE, m, r); continue }
            val kc = Math.floorDiv(k, 2L)
            tiles.peek(level - 1, kc)?.let { c -> val off = ((k - 2 * kc) * TILE / 2).toInt(); blit(c, off, off + TILE / 2, l, r) }
        }
        // Played veil: what the Session already played dims (like the deck overviews).
        val head = x(now)
        if (head > 0) drawRect(Color.Black.copy(alpha = .38f), Offset(0f, lanesTop), Size(min(head, w), lanesBottom - lanesTop))

        val detail = pps / dp >= 2.5 // gesture marks once there is room (desktop: <= 10 min on a wide screen)
        val labelSize = 11 * dp; val rowH = 16 * dp
        val maxRows = max(1, ((laneH - 8 * dp) / rowH).toInt())
        hits.clear()
        val titles = HashMap<Int, String>()
        for ((i, d) in lanes.withIndex()) {
            val y = laneY(i)
            val c = deckColor(DeckId.entries[d])
            // Beat FX band (top 4dp): effect colour, opacity by depth.
            for (f in tl.fx) {
                if (f.deck != null && f.deck != d) continue
                val l = x(f.t0); val r = x(f.t1)
                if (r < 0 || l > w) continue
                val depth = ((f.depth.coerceIn(-1.0, 1.0) + 1) / 2).pow(2)
                drawRect(fxColor(f.effect).copy(alpha = (.25 + .75 * depth).toFloat()), Offset(l, y), Size(max(r - l, 2f), 4 * dp))
            }
            // Loops: bracket near the lane bottom.
            for (lp in tl.loops) {
                if (lp.deck != d) continue
                val l = x(lp.t0); val r = max(x(lp.t1), l + 4 * dp)
                if (r < 0 || l > w) continue
                val by = y + laneH - 5 * dp
                drawLine(c, Offset(l, by), Offset(r, by), 1.5f * dp); drawLine(c, Offset(l, by), Offset(l, by - 4 * dp), 1.5f * dp); drawLine(c, Offset(r, by), Offset(r, by - 4 * dp), 1.5f * dp)
            }
            // Gesture marks (detail zoom): dashed tick + staggered label.
            if (detail) {
                text.textSize = 9 * dp
                val raw = tl.gestures.filter { it.deck == d && x(it.t) in -40f..w }
                // A burst of the same gesture (repeated beat jumps) reads as one mark with a count.
                val marks = ArrayList<Pair<SessionTimeline.Gesture, Int>>()
                for (g in raw) {
                    val last = marks.lastOrNull()
                    if (last != null && last.first.label == g.label && x(g.t) - x(last.first.t) < text.measureText(g.label) + 14 * dp) marks[marks.size - 1] = last.first to last.second + 1
                    else marks += g to 1
                }
                val labels = marks.map { (g, n) -> if (n > 1) "${g.label}×$n" else g.label }
                val rows = TimelineLayout.staggerRows(marks.mapIndexed { m, (g, _) -> val gx = x(g.t); gx to gx + text.measureText(labels[m]) + 6 * dp }, min(3, max(1, ((laneH - 22 * dp) / (10 * dp)).toInt())))
                val dash = PathEffect.dashPathEffect(floatArrayOf(2 * dp, 2 * dp))
                for (g in raw) { val gx = x(g.t); drawLine(Ink.text.copy(alpha = .4f), Offset(gx, y + 6 * dp), Offset(gx, y + laneH - 3 * dp), 1f, pathEffect = dash) }
                for ((m, p) in marks.withIndex()) {
                    val g = p.first
                    text.color = (if (g.action == "hotCue") Ink.orange else Ink.text).toArgb()
                    nc.drawText(labels[m], x(g.t) + 2 * dp, y + laneH - 8 * dp - rows[m] * 10 * dp, text)
                }
            }
            // Load flags + track labels (sticky at the left edge, staggered, truncated before the next on their row).
            val apps = log.appearances.filter { it.deck == d && x(it.end) > 0 && x(it.start) < w }
            text.textSize = labelSize
            val placed = apps.map { a ->
                val ax = x(a.start)
                val label = titles.getOrPut(a.trackId) { model.track(a.trackId)?.title ?: "#${a.trackId}" }
                val sx = if (ax < 6 * dp) min(6 * dp, x(a.end) - 8 * dp) else ax + 2 * dp
                Triple(a, sx, label)
            }
            val widths = placed.map { text.measureText(it.third) + 12 * dp }
            val rows = TimelineLayout.staggerRows(placed.mapIndexed { k, p -> p.second to p.second + min(widths[k], max(8 * labelSize * .5f, (placed.getOrNull(k + 1)?.second ?: Float.MAX_VALUE) - p.second - 12 * dp)) }, maxRows)
            val nextOnRow = FloatArray(placed.size) { Float.MAX_VALUE }
            run { val last = HashMap<Int, Float>(); for (k in placed.indices.reversed()) { nextOnRow[k] = last[rows[k]] ?: w + 1000; last[rows[k]] = placed[k].second } }
            for ((k, p) in placed.withIndex()) {
                val (a, sx, label) = p
                val ax = x(a.start)
                if (ax in 0f..w) {
                    // Dense loads (zoomed far out) keep just the flag; the full-height line returns with room.
                    val prevX = placed.getOrNull(k - 1)?.let { x(it.first.start) } ?: -1e9f
                    if (ax - prevX > 14 * dp) drawLine(c.copy(alpha = .8f), Offset(ax, y), Offset(ax, y + laneH), 1.5f * dp)
                    drawPath(androidx.compose.ui.graphics.Path().apply { moveTo(ax, y); lineTo(ax + 6 * dp, y + 4 * dp); lineTo(ax, y + 8 * dp); close() }, c)
                }
                val room = min(widths[k], nextOnRow[k] - sx - 4 * dp)
                if (room < 44 * dp) continue
                val n = text.breakText(label, true, room - 10 * dp, null)
                val shown = if (n < label.length) label.take(max(1, n - 1)) + "…" else label
                val ty = y + 6 * dp + rows[k] * rowH
                val tw = text.measureText(shown) + 8 * dp
                drawRect(Ink.crust.copy(alpha = .86f), Offset(sx, ty), Size(tw, 14 * dp))
                text.color = c.toArgb()
                nc.drawText(shown, sx + 4 * dp, ty + 11 * dp, text)
                hits += LabelHit(a, sx, ty - 4 * dp, sx + tw, ty + 18 * dp)
            }
        }
        // Spotlight: a focused track occurrence stays lit; everything else dims.
        model.focus?.let { f ->
            val lane = lanes.indexOf(f.deck)
            val (fs, fe) = tl.playedSpan(f) ?: (f.start to f.end)
            val l = x(fs).coerceIn(0f, w); val r = x(fe).coerceIn(0f, w)
            for (i in lanes.indices) {
                val y = laneY(i)
                if (i != lane) drawRect(Color.Black.copy(alpha = .6f), Offset(0f, y), Size(w, laneH.toFloat()))
                else { drawRect(Color.Black.copy(alpha = .6f), Offset(0f, y), Size(l, laneH.toFloat())); drawRect(Color.Black.copy(alpha = .6f), Offset(r, y), Size(w - r, laneH.toFloat())) }
            }
        }
        // Playhead (dashed while paused).
        if (head in 0f..w) {
            drawLine(Ink.playhead, Offset(head, lanesTop - 4 * dp), Offset(head, lanesBottom), 2 * dp, pathEffect = if (model.playing) null else PathEffect.dashPathEffect(floatArrayOf(4 * dp, 3 * dp)))
            drawPath(androidx.compose.ui.graphics.Path().apply { moveTo(head - 5 * dp, lanesTop - 9 * dp); lineTo(head + 5 * dp, lanesTop - 9 * dp); lineTo(head, lanesTop - 2 * dp); close() }, Ink.playhead)
        }
    }
}

private fun hmsShort(s: Double): String { val v = s.roundToInt().coerceAtLeast(0); return if (v >= 3600) "%d:%02d:%02d".format(v / 3600, v / 60 % 60, v % 60) else "%d:%02d".format(v / 60, v % 60) }

private suspend fun timelineGestures(scope0: androidx.compose.ui.input.pointer.PointerInputScope, model: () -> SessionModel, player: PlayerModel, hits: List<LabelHit>, scope: CoroutineScope) = with(scope0) {
    val decay = splineBasedDecay<Float>(this)
    var fling: Job? = null
    var lastTap = 0L; var lastTapAt = Offset.Zero
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false)
        fling?.cancel()
        val m = model()
        val tracker = VelocityTracker().apply { addPosition(down.uptimeMillis, down.position) }
        var moved = false; var pinched = false
        var prev = down.position; var prevSpan = 0f; var prevCount = 1
        while (true) {
            val ev = awaitPointerEvent()
            val pressed = ev.changes.filter { it.pressed }
            if (pressed.isEmpty()) break
            val c = Offset(pressed.map { it.position.x }.average().toFloat(), pressed.map { it.position.y }.average().toFloat())
            if (pressed.size >= 2) {
                pinched = true
                val span = pressed.map { (it.position - c).getDistance() }.average().toFloat()
                if (prevCount == pressed.size && prevSpan > 0f) {
                    m.zoom((span / prevSpan).toDouble(), (c.x / size.width).toDouble().coerceIn(0.0, 1.0))
                    m.pan(-(c.x - prev.x) / size.width.toDouble())
                    m.holdFollow()
                }
                prevSpan = span
            } else {
                val p = pressed[0]
                if (prevCount == 1 && !pinched) {
                    if (!moved && (p.position - down.position).getDistance() > viewConfiguration.touchSlop) moved = true
                    if (moved) { m.pan(-(c.x - prev.x) / size.width.toDouble()); tracker.addPosition(p.uptimeMillis, p.position) }
                }
                prevSpan = 0f
            }
            prev = c; prevCount = pressed.size
            ev.changes.forEach { if (it.positionChanged()) it.consume() }
        }
        if (pinched) return@awaitEachGesture
        if (moved) {
            val v = tracker.calculateVelocity().x
            if (abs(v) > 80) fling = scope.launch {
                var last = 0f
                AnimationState(0f, v).animateDecay(decay) { m.pan(-(value - last) / size.width.toDouble()); last = value }
            }
            return@awaitEachGesture
        }
        val now = down.uptimeMillis
        if (now - lastTap < 320 && (down.position - lastTapAt).getDistance() < 48 * density) { m.fit(); lastTap = 0L; return@awaitEachGesture }
        lastTap = now; lastTapAt = down.position
        val hit = hits.lastOrNull { down.position.x in it.l..it.r && down.position.y in it.t..it.b }
        if (hit != null) m.focusOn(hit.a)
        else m.seek(m.viewStart + down.position.x / size.width * m.viewWidth, player)
    }
}
