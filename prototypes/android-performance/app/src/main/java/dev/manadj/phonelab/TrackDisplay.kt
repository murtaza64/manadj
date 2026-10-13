package dev.manadj.phonelab

import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.*
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
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*
import kotlinx.coroutines.CancellationException
import kotlin.math.*

val cueNames = listOf("IN", "A", "B", "DROP", "C", "BRK", "D", "OUT")
fun identityColor(id: String) = when (id) { "A" -> Palette.cyan; "B" -> Palette.pink; "C" -> Palette.yellow; "D" -> Palette.success; else -> Palette.accent }
fun trackClock(seconds: Double) = "%d:%02d".format(seconds.toInt() / 60, seconds.toInt() % 60)

/** Port of styles.ts additive-rgb grouping/soft knee over generated eight-band analysis. */
private fun envelope(track: DemoTrack, vertical: Boolean): ImageBitmap {
    val width = track.waveform.size
    val height = 96
    val pixels = IntArray(width * height)
    for (x in 0 until width) {
        val groups = FloatArray(3)
        for (band in 0..7) { val group = if (band < 3) 0 else if (band < 5) 1 else 2; groups[group] += track.bands[band][x].pow(2) }
        for (group in 0..2) {
            val gain = floatArrayOf(.7f, 1.05f, 1.5f)[group]
            val raw = sqrt(groups[group]) * gain
            groups[group] = (if (raw <= .6f) raw else .6f + .4f * (1 - exp(-(raw - .6f) / .4f))) * .85f
        }
        for (y in 0 until height) {
            val amplitude = abs(y / (height - 1f) - .5f) * 2
            val low = if (amplitude < groups[0]) 1f else 0f
            val mid = if (amplitude < groups[1]) 1f else 0f
            val high = if (amplitude < groups[2]) 1f else 0f
            pixels[y * width + x] = Color((low + .2f * high).coerceAtMost(1f), (.1f * low + mid + .45f * high).coerceAtMost(1f), (.1f * low + .25f * mid + high).coerceAtMost(1f)).toArgb()
        }
    }
    val bitmap = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
    return (if (vertical) Bitmap.createBitmap(bitmap, 0, 0, width, height, Matrix().apply { postRotate(90f) }, false) else bitmap).asImageBitmap()
}

@Composable fun TrackOverview(deck: Deck, model: DjModel, modifier: Modifier, dense: Boolean = false, navigation: Boolean = false) {
    val color = identityColor(deck.id)
    val largeFont = LocalDensity.current.fontScale > 1.15f
    val clock by remember(deck) { derivedStateOf { trackClock(deck.positionSeconds) } }
    Column(modifier.border(if (model.active == deck.id) 2.dp else 1.dp, if (model.active == deck.id) color else Palette.surface)) {
        if (dense) Row(Modifier.fillMaxWidth().height(24.dp), verticalAlignment = Alignment.CenterVertically) {
            if (navigation) Key("${model.variant + 1}/3", Modifier.width(38.dp).fillMaxHeight(), Palette.accent) { model.chooseVariant((model.variant + 1) % 3) }
            Label("${deck.id} ${deck.name}", Modifier.weight(1f).clickable { model.chooseDeck(deck.id) }.semantics { contentDescription = "Select deck ${deck.id}" }, color, 14, true)
            Label("${"%.1f".format(deck.tempo)} ${deck.track.key}", color = color, size = 16, bold = true)
        } else Column(Modifier.fillMaxWidth().height(40.dp).clickable { model.chooseDeck(deck.id) }.semantics { contentDescription = "Select deck ${deck.id}" }.padding(horizontal = 4.dp)) {
            Label("${deck.id} ${deck.name}", color = color, size = if (largeFont) 14 else 16, bold = true)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Label("${"%.1f".format(deck.tempo)}", Modifier.weight(1f), color, if (largeFont) 16 else 17, true)
                Label("${deck.track.key} $clock", color = Palette.text, size = 14, bold = true)
            }
        }
        TrackWave(deck, model, Modifier.fillMaxWidth().weight(1f), overview = true)
    }
}

@Composable fun TrackWave(deck: Deck, model: DjModel, modifier: Modifier, overview: Boolean = false, vertical: Boolean = false) {
    val image = remember(deck.track, vertical) { envelope(deck.track, vertical) }
    val ink = remember { Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.MONOSPACE; isFakeBoldText = true } }
    Canvas(modifier.clipToBounds().background(Palette.base).graphicsLayer().semantics { contentDescription = "${deck.id} ${if (overview) "minimap seek" else "wave scratch"}" }.pointerInput(deck, overview, vertical) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            model.chooseDeck(deck.id)
            val label = "${deck.id} ${if (overview) "SEEK" else "SCRATCH"}"
            val start = deck.beginScrub()
            model.beginTouch(label); down.consume()
            val origin = if (vertical) down.position.y else down.position.x
            val travel = (if (vertical) size.height else size.width).toFloat().coerceAtLeast(1f)
            val window = 20.0
            if (overview) deck.seek(origin / travel * deck.track.duration)
            var cancelled = false
            try {
                while (true) {
                    val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                    if (change == null || (!change.pressed && change.isConsumed)) { cancelled = true; break }
                    if (!change.pressed) break
                    val coordinate = if (vertical) change.position.y else change.position.x
                    deck.seek(if (overview) coordinate / travel * deck.track.duration else start.position + (origin - coordinate) / travel * window)
                    change.consume()
                }
            } catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { deck.endScrub(start, cancelled); model.releaseTouch(label, cancelled) }
        }
    }) {
        val axis = if (vertical) size.height else size.width
        val window = if (overview) deck.track.duration else 20.0
        val start = if (overview) 0.0 else deck.positionSeconds - window * .25
        val shift = (-start / window * axis).toFloat()
        withTransform({ translate(if (vertical) 0f else shift, if (vertical) shift else 0f) }) {
            val length = (deck.track.duration / window * axis).roundToInt().coerceAtLeast(1)
            drawImage(image, dstSize = if (vertical) IntSize(size.width.roundToInt(), length) else IntSize(length, size.height.roundToInt()))
        }
        fun marker(at: Double, color: Color, width: Float) {
            val p = ((at - start) / window * axis).toFloat()
            if (p in 0f..axis) drawLine(color, if (vertical) Offset(0f, p) else Offset(p, 0f), if (vertical) Offset(size.width, p) else Offset(p, size.height), width)
        }
        if (!overview) {
            val first = floor(start * deck.bpm / 60).toInt()
            for (beat in first..first + ceil(window * deck.bpm / 60).toInt() + 1) {
                val tier = when { beat % 64 == 0 -> 4; beat % 32 == 0 -> 3; beat % 16 == 0 -> 2; beat % 8 == 0 -> 1; beat % 4 == 0 -> 0; else -> -1 }
                marker(beat * 60.0 / deck.bpm, Color.White.copy(alpha = if (tier < 0) .15f else floatArrayOf(.3f, .38f, .48f, .6f, .75f)[tier]), (if (tier < 0) 1f else floatArrayOf(2f, 2f, 2.5f, 3f, 3.5f)[tier]).dp.toPx())
            }
        }
        if (deck.loopOn) {
            val lo = ((deck.loopStart - start) / window * axis).toFloat().coerceIn(0f, axis)
            val hi = ((deck.loopStart + deck.loopBeats * 60 / deck.bpm - start) / window * axis).toFloat().coerceIn(0f, axis)
            if (hi > lo) drawRect(Palette.success.copy(alpha = if (overview) .85f else .18f), if (vertical) Offset(0f, lo) else Offset(lo, 0f), if (vertical) Size(size.width, hi - lo) else Size(hi - lo, if (overview) 2.dp.toPx() else size.height))
        }
        marker(deck.cuePoint, Palette.orange, 2.dp.toPx())
        val cueAt = ((deck.cuePoint - start) / window * axis).toFloat()
        if (!vertical && cueAt in 0f..axis) {
            val triangle = Path().apply { moveTo(cueAt, size.height - 8.dp.toPx()); lineTo(cueAt - 5.dp.toPx(), size.height); lineTo(cueAt + 5.dp.toPx(), size.height); close() }
            drawPath(triangle, Palette.orange)
        }
        deck.cues.forEachIndexed { slot, cue -> cue?.let {
            val p = ((it - start) / window * axis).toFloat()
            if (p in 0f..axis) {
                marker(it.toDouble(), Palette.cues[slot], 2.dp.toPx())
                val label = if (overview) "${slot + 1}${cueNames[slot]}" else "${slot + 1}"
                val width = if (overview) 32.dp.toPx() else 16.dp.toPx()
                val x = if (vertical) 0f else p.coerceAtMost(size.width - width)
                val y = if (vertical) p.coerceAtMost(size.height - 16.dp.toPx()) else if (overview && size.width < 300.dp.toPx()) (slot % 2) * 17.dp.toPx() else 0f
                drawRect(Palette.cues[slot], Offset(x, y), Size(width, 16.dp.toPx()))
                ink.color = android.graphics.Color.BLACK; ink.textSize = 11.dp.toPx()
                drawContext.canvas.nativeCanvas.drawText(label, x + 2.dp.toPx(), y + 12.dp.toPx(), ink)
            }
        } }
        marker(deck.positionSeconds, Palette.playhead, 3.dp.toPx())
    }
}
