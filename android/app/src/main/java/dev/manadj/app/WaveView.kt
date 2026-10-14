package dev.manadj.app

import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.manadj.audio.AudioCommand
import kotlinx.coroutines.CancellationException
import kotlin.math.*
import kotlin.math.roundToInt

private val GROUP_GAINS = floatArrayOf(.7f, 1.05f, 1.5f)
private const val MASTER = 1f // desktop shipped default (additive-soft full)
private fun softLimit(x: Float) = if (x <= .6f) x else .6f + .4f * (1 - exp(-(x - .6f) / .4f))

/**
 * Desktop 'additive-soft' style (frontend/src/waveform/styles.ts) with backend/shipped_defaults.json params:
 * additive at the fringes; where groups overlap the core takes the groups' energy-balance hue, whitened by
 * coreWhite (+coreBloom with stacking depth). Until the synced manadj.waveformStyles lands.
 */
class WaveStyle(val colors: Array<FloatArray>, val coreWhite: Float, val coreBloom: Float, val master: Float) {
    companion object {
        val FULL = WaveStyle(arrayOf(floatArrayOf(.7804f, .0588f, .0588f), floatArrayOf(.2353f, .6863f, .0706f), floatArrayOf(.0588f, .5922f, 1f)), .32f, .3f, 1f)
        val MINIMAP = WaveStyle(arrayOf(floatArrayOf(.8039f, .0157f, .0157f), floatArrayOf(.0196f, .6392f, .1765f), floatArrayOf(.1333f, .6235f, .9255f)), .12f, .42f, 1.16f)
    }
    /** Color of the [mask] subset (bit0 low, bit1 mid, bit2 high) given the column's groups [g]; weights quantized. */
    fun color(mask: Int, g: FloatArray): Int {
        var r = 0f; var gr = 0f; var b = 0f
        for (i in 0..2) if (mask and (1 shl i) != 0) { r += colors[i][0]; gr += colors[i][1]; b += colors[i][2] }
        val over = (max(r, max(gr, b)) - 1f).coerceIn(0f, 1f)
        r = min(r, 1f); gr = min(gr, 1f); b = min(b, 1f)
        if (over > 0f) {
            // Energy-balance hue from g^2 weights, quantized to 1/8 steps so columns batch into few draw calls.
            val w = FloatArray(3) { (g[it] * g[it] * 8).roundToInt() / 8f }
            val sw = w.sum() + 1e-6f
            var dr = 0f; var dg = 0f; var db = 0f
            for (i in 0..2) { dr += w[i] * colors[i][0]; dg += w[i] * colors[i][1]; db += w[i] * colors[i][2] }
            dr /= sw; dg /= sw; db /= sw
            val dm = max(dr, max(dg, db)) + 1e-6f
            dr /= dm; dg /= dm; db /= dm
            val white = (coreWhite + coreBloom * over).coerceIn(0f, 1f)
            val cr = dr + (1 - dr) * white; val cg = dg + (1 - dg) * white; val cb = db + (1 - db) * white
            val t = (over / .5f).coerceIn(0f, 1f).let { it * it * (3 - 2 * it) }
            r += (cr - r) * t; gr += (cg - gr) * t; b += (cb - b) * t
        }
        return Color(r, gr, b).toArgb()
    }
}

/** One column's group heights (0..1): desktop groupAmps over the column's box-filtered band frames. */
private fun columnGroups(data: WaveformData, t0: Double, t1: Double, out: FloatArray) {
    val fps = data.framesPerSecond
    val x0 = t0 * fps - data.stftWindow * .5 / data.bandHop
    val x1 = t1 * fps - data.stftWindow * .5 / data.bandHop
    val b = FloatArray(8)
    if (x1 - x0 < 1) {
        val i0 = floor((x0 + x1) / 2).toInt().coerceIn(0, max(0, data.frames - 2)); val fr = (((x0 + x1) / 2) - i0).toFloat().coerceIn(0f, 1f)
        if (data.frames == 0) { out.fill(0f); return }
        val i1 = min(i0 + 1, data.frames - 1)
        for (k in 0..7) { val v = ((data.bands[i0 * 8 + k].toInt() and 0xff) * (1 - fr) + (data.bands[i1 * 8 + k].toInt() and 0xff) * fr) / 255f; b[k] = v * v }
    } else {
        val i0 = floor(x0).toInt().coerceIn(0, max(0, data.frames - 1)); val i1 = floor(x1).toInt().coerceIn(i0, max(0, data.frames - 1))
        if (data.frames == 0 || x0 >= data.frames) { out.fill(0f); return }
        // Box-filter mean over the column's frames (desktop bands8Column, ADR 0015).
        val step = max(1, (i1 - i0) / 12); var n = 0
        val acc = FloatArray(8)
        var i = i0
        while (i <= i1) { for (k in 0..7) acc[k] += (data.bands[i * 8 + k].toInt() and 0xff) / 255f; n++; i += step }
        for (k in 0..7) { val v = acc[k] / n; b[k] = v * v }
    }
    var lo = 0f; var mid = 0f; var hi = 0f
    for (k in 0..7) { val e = b[k] * b[k]; if (k < 3) lo += e else if (k < 5) mid += e else hi += e }
    out[0] = softLimit(sqrt(lo) * GROUP_GAINS[0]) * MASTER; out[1] = softLimit(sqrt(mid) * GROUP_GAINS[1]) * MASTER; out[2] = softLimit(sqrt(hi) * GROUP_GAINS[2]) * MASTER
}

/**
 * Batched painter: segments bucketed per (nesting level, style color) so a column's outer bands draw first
 * and the whole lane costs a few drawLines calls.
 */
private class Lines(private val style: WaveStyle) {
    private class Bucket(var buf: FloatArray, var count: Int = 0)
    private val levels = Array(3) { LinkedHashMap<Int, Bucket>() }
    fun reset() { for (l in levels) for (b in l.values) b.count = 0 }
    fun column(g: FloatArray, emit: (level: Int, color: Int, extent: Float) -> Unit) {
        val idx = intArrayOf(0, 1, 2).sortedByDescending { g[it] }
        for (level in 0..2) {
            val h = g[idx[level]]
            if (h <= .002f) break
            var mask = 0
            for (i in 0..2) if (g[i] >= h) mask = mask or (1 shl i)
            emit(level, style.color(mask, g), h)
        }
    }
    fun add(level: Int, color: Int, x0: Float, y0: Float, x1: Float, y1: Float) {
        val b = levels[level].getOrPut(color) { Bucket(FloatArray(256)) }
        if (b.count + 4 > b.buf.size) b.buf = b.buf.copyOf(b.buf.size * 2)
        b.buf[b.count] = x0; b.buf[b.count + 1] = y0; b.buf[b.count + 2] = x1; b.buf[b.count + 3] = y1; b.count += 4
    }
    fun draw(canvas: android.graphics.Canvas, paint: Paint) {
        for (l in levels) for ((color, b) in l) if (b.count > 0) { paint.color = color; canvas.drawLines(b.buf, 0, b.count, paint) }
    }
}

data class WaveMarks(val cue: Double?, val hotCues: List<Double?>, val loop: ClosedFloatingPointRange<Double>? = null, val bpm: Double? = null, val anchor: Double = 0.0)

fun marksOf(ui: DeckUi) = ui.snapshot.let { s -> WaveMarks(s?.cueSeconds, ui.hotCues, s?.loop?.let { it.start..it.end }, s?.bpm, s?.gridAnchorSeconds ?: 0.0) }

/**
 * Detail (scrolling, playhead at [playheadAt]) or overview waveform. [vertical] runs time downward.
 * Detail split mode (desktop performance-mode 10): ahead of the playhead the top lobe shows the live strip
 * and the bottom lobe the raw track; behind it both show the strip as it was heard.
 */
@Composable fun WaveView(
    data: WaveformData?, position: () -> Double, duration: Double?, marks: WaveMarks, modifier: Modifier,
    overview: Boolean = false, vertical: Boolean = false, windowSeconds: Double = 16.0, playheadAt: Float = .3f,
    live: () -> Strip = { Strip() }, history: StripHistory? = null, accent: Color = Ink.accent, status: String? = null,
) {
    val paint = remember { Paint().apply { strokeWidth = 2f; isAntiAlias = false } }
    val ink = remember { Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.MONOSPACE; isFakeBoldText = true } }
    var lines by remember { mutableStateOf<Lines?>(null) }
    val columns = remember { ColumnCache() }
    // Overview body depends only on data + size: cache it as a bitmap, overlay markers per frame.
    var cache by remember { mutableStateOf<Triple<WaveformData, IntSize2, ImageBitmap>?>(null) }
    Box(modifier.clipToBounds().background(Ink.background)) {
        Canvas(Modifier.fillMaxSize()) {
            val along = if (vertical) size.height else size.width
            val across = if (vertical) size.width else size.height
            val dur = duration ?: data?.duration ?: 0.0
            val pos = position()
            val start = if (overview) 0.0 else pos - windowSeconds * playheadAt
            val span = if (overview) dur.coerceAtLeast(1.0) else windowSeconds
            // Vertical detail runs future-up (playhead low), like a deck's vertical waveform.
            val flip = vertical && !overview
            fun at(t: Double) = ((t - start) / span * along).toFloat().let { if (flip) along - it else it }
            if (data != null) {
                if (overview) {
                    val key = IntSize2(size.width.toInt(), size.height.toInt())
                    val c = cache
                    val image = if (c != null && c.first === data && c.second == key) c.third else renderOverview(data, key, dur, vertical).also { cache = Triple(data, key, it) }
                    drawImage(image)
                    val p = at(pos).coerceIn(0f, along)
                    drawRect(Color.Black.copy(alpha = .5f), Offset.Zero, if (vertical) Size(size.width, p) else Size(p, size.height))
                } else {
                    // Columns live in absolute track coordinates (column k always covers the same audio) and
                    // the body translates by a whole-pixel offset: pixel-consistent scrolling, no resampling.
                    val step = 2
                    val count = (along / step).toInt() + 2
                    val l = lines ?: Lines(WaveStyle.FULL).also { lines = it }
                    l.reset()
                    val g = FloatArray(3); val top = FloatArray(3)
                    val liveStrip = live()
                    val half = across / 2
                    val colSeconds = span / along * step
                    val firstCol = floor(start / colSeconds).toLong()
                    val offset = ((firstCol * colSeconds - start) / span * along).roundToInt().toFloat()
                    columns.prepare(data, colSeconds)
                    for (i in 0 until count) {
                        val k = firstCol + i
                        val t0 = k * colSeconds; val t1 = t0 + colSeconds
                        if (t1 < 0 || t0 > dur) continue
                        val q = offset + i * step
                        val p = if (flip) along - q - step else q
                        columns.groups(data, k, t0, t1, g)
                        for (j in 0..2) g[j] = (g[j] * columns.fill).coerceAtMost(1f)
                        val behind = t0 < pos
                        val strip = if (behind) history?.at(t0, liveStrip) ?: liveStrip else liveStrip
                        top[0] = (g[0] * strip.low * strip.gain).coerceIn(0f, 1f); top[1] = (g[1] * strip.mid * strip.gain).coerceIn(0f, 1f); top[2] = (g[2] * strip.high * strip.gain).coerceIn(0f, 1f)
                        val bottom = if (behind) top else g
                        l.column(top) { level, mask, h -> if (vertical) l.add(level, mask, half, p, half - h * half, p) else l.add(level, mask, p, half, p, half - h * half) }
                        l.column(bottom) { level, mask, h -> if (vertical) l.add(level, mask, half, p, half + h * half, p) else l.add(level, mask, p, half, p, half + h * half) }
                    }
                    paint.strokeWidth = step.toFloat()
                    drawIntoCanvas { l.draw(it.nativeCanvas, paint) }
                }
            }
            fun line(t: Double, color: Color, width: Float) { val p = at(t); if (p in 0f..along) drawLine(color, if (vertical) Offset(0f, p) else Offset(p, 0f), if (vertical) Offset(size.width, p) else Offset(p, size.height), width) }
            // Beat grid (desktop tiers: bar lines brighter, phrase lines brightest).
            if (!overview) marks.bpm?.let { bpm ->
                val beat = 60.0 / bpm
                val first = floor((start - marks.anchor) / beat).toInt()
                val count = ceil(span / beat).toInt() + 1
                if (count < 400) for (k in first..first + count) {
                    val tier = when { k % 64 == 0 -> 4; k % 32 == 0 -> 3; k % 16 == 0 -> 2; k % 4 == 0 -> 1; else -> 0 }
                    line(marks.anchor + k * beat, Color.White.copy(alpha = floatArrayOf(.14f, .32f, .45f, .6f, .75f)[tier]), floatArrayOf(1f, 1.5f, 2f, 2.5f, 3f)[tier].dp.toPx())
                }
            }
            marks.loop?.let { loop ->
                val x = at(loop.start).coerceIn(0f, along); val y = at(loop.endInclusive).coerceIn(0f, along); val a = min(x, y); val b = max(x, y)
                if (b > a) drawRect(Ink.play.copy(alpha = .2f), if (vertical) Offset(0f, a) else Offset(a, 0f), if (vertical) Size(size.width, b - a) else Size(b - a, size.height))
            }
            marks.cue?.let { cue ->
                line(cue, Ink.orange, 2.dp.toPx())
                val p = at(cue)
                if (!vertical && p in 0f..along) drawPath(Path().apply { moveTo(p, size.height - 7.dp.toPx()); lineTo(p - 5.dp.toPx(), size.height); lineTo(p + 5.dp.toPx(), size.height); close() }, Ink.orange)
            }
            marks.hotCues.forEachIndexed { slot, cue -> cue?.let {
                line(it, Ink.cues[slot], (if (overview) 1.5f else 2f).dp.toPx())
                val p = at(it)
                if (p in 0f..along) {
                    // Overview labels stay small (round-5 feedback): a 10dp flag with the slot digit only.
                    val flag = (if (overview) 10 else 14).dp.toPx()
                    val x = if (vertical) 0f else p.coerceAtMost(size.width - flag)
                    val y = if (vertical) p.coerceAtMost(size.height - flag) else 0f
                    drawRect(Ink.cues[slot], Offset(x, y), Size(flag, flag))
                    ink.color = android.graphics.Color.BLACK; ink.textSize = (if (overview) 8.5f else 11f).dp.toPx()
                    drawContext.canvas.nativeCanvas.drawText("${slot + 1}", x + flag * .22f, y + flag * .82f, ink)
                }
            } }
            line(pos, Ink.playhead, (if (overview) 2 else 3).dp.toPx())
            if (data == null || !data.complete) {
                // Analysis still filling: hairline axis so the lane never reads as silence.
                if (data == null) drawLine(accent.copy(alpha = .35f), if (vertical) Offset(size.width / 2, 0f) else Offset(0f, size.height / 2), if (vertical) Offset(size.width / 2, size.height) else Offset(size.width, size.height / 2), 1.dp.toPx())
            }
        }
        if (status != null) Text(status, Modifier.align(Alignment.Center).background(Color.Black.copy(alpha = .7f)).padding(horizontal = 3.dp), Ink.muted, 10)
    }
}

private data class IntSize2(val w: Int, val h: Int)

/** Bottom-anchored minimap body (desktop minimap mode), drawn once into a bitmap. */
private fun renderOverview(data: WaveformData, size: IntSize2, duration: Double, vertical: Boolean): ImageBitmap {
    val bitmap = Bitmap.createBitmap(max(1, size.w), max(1, size.h), Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bitmap)
    val paint = Paint().apply { strokeWidth = 1f }
    val along = if (vertical) size.h else size.w; val across = if (vertical) size.w else size.h
    val l = Lines(WaveStyle.MINIMAP); val g = FloatArray(3)
    val dur = duration.coerceAtLeast(1.0)
    for (p in 0 until along) {
        columnGroups(data, p.toDouble() / along * dur, (p + 1.0) / along * dur, g)
        for (j in 0..2) g[j] = (g[j] * WaveStyle.MINIMAP.master).coerceAtMost(1f)
        l.column(g) { level, mask, h -> val e = h * across; if (vertical) l.add(level, mask, 0f, p + .5f, e, p + .5f) else l.add(level, mask, p + .5f, across.toFloat(), p + .5f, across - e) }
    }
    l.draw(canvas, paint)
    return bitmap.asImageBitmap()
}

/** Overview with tap/drag seek: preview while held, one Seek on release (engine contract). */
@Composable fun Minimap(ui: DeckUi, model: PlayerModel, wave: WaveformData?, modifier: Modifier, vertical: Boolean = false) {
    var seekPreview by remember(ui.id) { mutableStateOf<Double?>(null) }
    val ready by remember(ui) { derivedStateOf { ui.ready } }
    val currentReady by rememberUpdatedState(ready)
    WaveView(wave, { seekPreview ?: position(ui) }, ui.durationSeconds, marksOf(ui), modifier.semantics { contentDescription = "${ui.id} minimap seek" }.pointerInput(ui.id, vertical) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val duration = ui.durationSeconds
            if (!currentReady || duration == null || duration <= 0) return@awaitEachGesture
            val id = model.beginGesture(ui.id, "SEEK") { seekPreview = null }
            fun preview(p: Offset) { seekPreview = ((if (vertical) p.y / size.height else p.x / size.width) * duration).coerceIn(0.0, duration) }
            preview(down.position); down.consume()
            var cancelled = false
            try {
                while (true) {
                    val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                    if (change == null || (!change.pressed && change.isConsumed)) { cancelled = true; break }
                    if (!change.pressed || !model.gestureActive(id)) break
                    preview(change.position); change.consume()
                }
                if (!cancelled && model.gestureActive(id)) seekPreview?.let { model.submit(AudioCommand.Seek(ui.id, it, id)) }
            } catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { seekPreview = null; model.finishGesture(id, cancelled) }
        }
    }, overview = true, vertical = vertical, accent = deckColor(ui.id), status = if (!ui.ready) null else if (wave == null) "analysing…" else null)
}

fun position(ui: DeckUi) = if (ui.source?.id == ui.snapshot?.sourceId) ui.snapshot?.sourceSeconds ?: 0.0 else 0.0

/** Per-column band groups for one (waveform, zoom): column k is computed once while its frames are analysed. */
private class ColumnCache {
    private var data: WaveformData? = null
    private var colSeconds = 0.0
    private val cache = HashMap<Long, FloatArray>()
    /** Display gain so the track's loud passages reach the lane edge (99th-percentile column peak -> 0.95). */
    var fill = 1f; private set
    private var fillFrames = -1
    fun prepare(d: WaveformData, seconds: Double) {
        if (d !== data || seconds != colSeconds) { data = d; colSeconds = seconds; cache.clear() }
        if (d.frames != fillFrames && (d.complete || d.frames - fillFrames > d.framesPerSecond * 20)) { fillFrames = d.frames; fill = fillGain(d) }
    }
    private fun fillGain(d: WaveformData): Float {
        val dur = d.frames / d.framesPerSecond
        if (dur <= 0) return 1f
        val n = 1500; val g = FloatArray(3); val peaks = FloatArray(n)
        for (i in 0 until n) { val t = dur * i / n; columnGroups(d, t, t + .02, g); peaks[i] = max(g[0], max(g[1], g[2])) }
        peaks.sort()
        val p = peaks[(n * .99).toInt()]
        return if (p <= .01f) 1f else (.95f / p).coerceIn(1f, 3f)
    }
    fun groups(d: WaveformData, k: Long, t0: Double, t1: Double, out: FloatArray) {
        cache[k]?.let { it.copyInto(out); return }
        columnGroups(d, t0, t1, out)
        // Only cache once the column's audio is fully analysed (streaming analysis grows the data).
        if (d.complete || t1 * d.framesPerSecond + 1 < d.frames) { if (cache.size > 20_000) cache.clear(); cache[k] = out.copyOf() }
    }
}

/**
 * Smooth playhead: extrapolates the last engine position at the deck's rate on every display frame and
 * eases toward it (monotonic while playing); jumps (seek, loop wrap, cue) snap.
 */
class SmoothClock {
    private var shown = Double.NaN; private var target = Double.NaN; private var targetAt = 0L; private var last = 0L
    fun at(now: Long, raw: Double, playing: Boolean, rate: Double): Double {
        if (raw != target) { target = raw; targetAt = now }
        val predicted = if (playing) target + (now - targetAt) / 1e9 * rate else target
        if (!playing || shown.isNaN() || last == 0L || now <= last) { shown = predicted; last = now; return shown }
        val dt = (now - last) / 1e9; last = now
        val free = shown + dt * rate
        val err = predicted - free
        shown = if (abs(err) > .25) predicted else max(if (rate > 0) shown else Double.NEGATIVE_INFINITY, free + err * .12)
        return shown
    }
}

/** Display-frame time while [active] (0 otherwise); read it in a draw lambda to redraw every frame. */
@Composable fun frameNanos(active: Boolean): State<Long> = produceState(0L, active) { while (active) withFrameNanos { value = it } }
