package dev.manadj.app

import android.graphics.BlurMaskFilter
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.manadj.audio.DeckId
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** OLED black + bright saturated colors; mirrors DESIGN.md / frontend/src/theme tokens. */
object Ink {
    val background = Color.Black
    val panel = Color(0xff080a0c)
    val crust = Color(0xff111111)
    val surface = Color(0xff45454f)
    /** Desktop --surface0: row dividers (TrackRow.css). */
    val surface0 = Color(0xff313136)
    val surface2 = Color(0xff58585b)
    val overlay1 = Color(0xff7f849c)
    val text = Color(0xffcdd6f4)
    val muted = Color(0xffa6adc8)
    val edge = Color(0xff3c424c)
    val accent = Color(0xff4a9eff)
    val play = Color(0xff00e676)
    val warning = Color(0xffffcc00)
    val orange = Color(0xffff9500)
    val playhead = Color(0xfff5c2e7)
    val pending = Color(0xffff6a00)
    val cues = listOf(Color(0xff1e90ff), Color(0xffffd400), Color(0xffff8800), Color(0xffff4455), Color(0xff2ed573), Color(0xffff5cc8), Color(0xffa855f7), Color(0xff00cec9))
    // Desktop automationColors.ts / knobAppearance.ts.
    val trim = Color(0xffc9c9d4)
    val filterHpf = Color(0xff00ffc4)
    val filterLpf = Color(0xffff8a00)
    val fxDepth = Color(0xffff2dd4)
    val neutralStroke = Color(140, 140, 150)
    /** Desktop ADDITIVE_COLORS: low / mid / high waveform groups and EQ knobs. */
    val bands = listOf(Color(1f, .1f, .1f), Color(0f, 1f, .25f), Color(.2f, .45f, 1f))
    val stems = listOf(Color(0xffff4fd8), Color(0xffffe600), Color(0xffff2d2d), Color(0xff2dff6a))
}

fun deckColor(id: DeckId) = when (id) { DeckId.A -> Color(0xff00e5ff); DeckId.B -> Color(0xffff2d95); DeckId.C -> Ink.warning; DeckId.D -> Ink.play }
/** m:ss; pre-roll (negative) reads "-m:ss". */
fun clock(seconds: Double): String { val s = kotlin.math.abs(seconds).toInt(); return (if (seconds <= -1) "-" else "") + "%d:%02d".format(s / 60, s % 60) }

val Mono = FontFamily(Font(R.font.ubuntu_mono_regular), Font(R.font.ubuntu_mono_bold, FontWeight.Bold))
val Gap = 8.dp
val DeckGap = 14.dp

@Composable fun Text(text: String, modifier: Modifier = Modifier, color: Color = Ink.text, size: Int = 13, bold: Boolean = false, lines: Int = 1) {
    BasicText(text, modifier, TextStyle(color = color, fontSize = size.sp, fontFamily = Mono, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal), maxLines = lines, overflow = TextOverflow.Ellipsis)
}

/**
 * Halo drawn strictly INSIDE the node bounds (inset by [halo]); callers inset their body by the same amount.
 * Drawing outside a node's bounds leaves stale pixels (Android damage tracking) — the round-4 "stuck border" bug.
 */
fun Modifier.halo(color: Color, amount: Float, halo: Dp, round: Boolean = false): Modifier = drawBehind {
    val a = amount.coerceIn(0f, 1f)
    if (a < .01f) return@drawBehind
    val r = halo.toPx()
    drawIntoCanvas { canvas ->
        val paint = Paint().asFrameworkPaint().apply {
            this.color = color.copy(alpha = a).toArgb()
            maskFilter = BlurMaskFilter(r * .9f, BlurMaskFilter.Blur.NORMAL)
        }
        val radius = if (round) (size.minDimension / 2 - r) else 0f
        canvas.nativeCanvas.drawRoundRect(r, r, size.width - r, size.height - r, radius, radius, paint)
    }
}

/** Beat phase 0..1 from source position and effective BPM (null when no grid is known). */
fun beatPhase(seconds: Double, bpm: Double?): Float = if (bpm == null || bpm <= 0) 0f else (((seconds * bpm / 60) % 1.0 + 1.0) % 1.0).toFloat()

enum class Glyph { Play, Pause, Cue, Loop, Back, Forward, Fx, Load, Pitch, Info, Gear, Lock, Grid, Search, Follow, Headphones, Stems, Close }

@Composable fun GlyphIcon(glyph: Glyph, color: Color, size: Dp = 16.dp) { Canvas(Modifier.size(size)) { drawGlyph(glyph, color) } }

fun DrawScope.drawGlyph(glyph: Glyph, color: Color) {
    val w = size.width; val h = size.height; val sw = w * .12f; val s = Stroke(sw, cap = StrokeCap.Round, join = StrokeJoin.Round)
    fun tri(x0: Float, x1: Float) = Path().apply { moveTo(x0, h * .15f); lineTo(x1, h * .5f); lineTo(x0, h * .85f); close() }
    when (glyph) {
        Glyph.Play -> drawPath(tri(w * .22f, w * .88f), color)
        Glyph.Pause -> { drawRoundRect(color, Offset(w * .2f, h * .15f), Size(w * .2f, h * .7f), CornerRadius(w * .04f)); drawRoundRect(color, Offset(w * .6f, h * .15f), Size(w * .2f, h * .7f), CornerRadius(w * .04f)) }
        // CDJ cue: a vertical bar + triangle (return to cue point).
        Glyph.Cue -> { drawRect(color, Offset(w * .14f, h * .16f), Size(w * .14f, h * .68f)); drawPath(tri(w * .4f, w * .9f), color) }
        Glyph.Loop -> {
            drawArc(color, 200f, 290f, false, Offset(w * .14f, h * .14f), Size(w * .72f, h * .72f), style = s)
            val a = (200 + 290) * PI / 180; val tip = Offset(center.x + cos(a).toFloat() * w * .36f, center.y + sin(a).toFloat() * h * .36f)
            drawPath(Path().apply { moveTo(tip.x - w * .16f, tip.y - h * .12f); lineTo(tip.x + w * .14f, tip.y - h * .04f); lineTo(tip.x - w * .02f, tip.y + h * .18f); close() }, color)
        }
        Glyph.Back -> { drawPath(Path().apply { moveTo(w * .5f, h * .18f); lineTo(w * .12f, h * .5f); lineTo(w * .5f, h * .82f); close() }, color); drawPath(Path().apply { moveTo(w * .88f, h * .18f); lineTo(w * .5f, h * .5f); lineTo(w * .88f, h * .82f); close() }, color) }
        Glyph.Forward -> { drawPath(tri(w * .12f, w * .5f), color); drawPath(tri(w * .5f, w * .88f), color) }
        // Beat FX: a source pulse with decaying echoes — reads as "repeats", not a gear.
        Glyph.Fx -> for (i in 0 until 3) {
            val x = w * (.18f + i * .3f); val half = h * (.38f - i * .1f)
            drawLine(color.copy(alpha = 1f - i * .3f), Offset(x, h / 2 - half), Offset(x, h / 2 + half), sw * 1.3f, StrokeCap.Round)
        }
        Glyph.Load -> { drawLine(color, Offset(w * .5f, h * .1f), Offset(w * .5f, h * .6f), sw, StrokeCap.Round); drawPath(Path().apply { moveTo(w * .24f, h * .42f); lineTo(w * .5f, h * .7f); lineTo(w * .76f, h * .42f); close() }, color); drawLine(color, Offset(w * .15f, h * .9f), Offset(w * .85f, h * .9f), sw, StrokeCap.Round) }
        Glyph.Pitch -> { drawLine(color, Offset(w * .5f, h * .08f), Offset(w * .5f, h * .92f), sw * .8f, StrokeCap.Round); drawRect(color, Offset(w * .22f, h * .4f), Size(w * .56f, h * .2f)) }
        Glyph.Info -> { drawCircle(color, w * .42f, center, style = s); drawLine(color, Offset(w * .5f, h * .45f), Offset(w * .5f, h * .72f), sw, StrokeCap.Round); drawCircle(color, w * .07f, Offset(w * .5f, h * .28f)) }
        Glyph.Gear -> { drawCircle(color, w * .26f, center, style = s); for (i in 0 until 8) { val a = i * PI / 4; val d = Offset(cos(a).toFloat(), sin(a).toFloat()); drawLine(color, center + d * (w * .3f), center + d * (w * .46f), sw * 1.2f, StrokeCap.Round) } }
        Glyph.Lock -> { drawRoundRect(color, Offset(w * .2f, h * .45f), Size(w * .6f, h * .45f), CornerRadius(w * .06f)); drawArc(color, 180f, 180f, false, Offset(w * .3f, h * .14f), Size(w * .4f, h * .6f), style = s) }
        Glyph.Grid -> { for (i in 0..3) { val x = w * (.15f + i * .233f); drawLine(color, Offset(x, h * .15f), Offset(x, h * .85f), if (i == 0) sw * 1.4f else sw * .6f) } }
        Glyph.Search -> { drawCircle(color, w * .28f, Offset(w * .42f, h * .42f), style = s); drawLine(color, Offset(w * .62f, h * .62f), Offset(w * .88f, h * .88f), sw * 1.2f, StrokeCap.Round) }
        Glyph.Follow -> { drawCircle(color, w * .12f, Offset(w * .2f, h * .5f)); drawPath(Path().apply { moveTo(w * .4f, h * .25f); lineTo(w * .65f, h * .5f); lineTo(w * .4f, h * .75f) }, color, style = s); drawPath(Path().apply { moveTo(w * .62f, h * .25f); lineTo(w * .87f, h * .5f); lineTo(w * .62f, h * .75f) }, color, style = s) }
        Glyph.Headphones -> { drawArc(color, 180f, 180f, false, Offset(w * .15f, h * .15f), Size(w * .7f, h * .7f), style = s); drawRoundRect(color, Offset(w * .1f, h * .5f), Size(w * .2f, h * .36f), CornerRadius(w * .05f)); drawRoundRect(color, Offset(w * .7f, h * .5f), Size(w * .2f, h * .36f), CornerRadius(w * .05f)) }
        Glyph.Stems -> for (i in 0 until 4) drawLine(color, Offset(w * .15f, h * (.2f + i * .2f)), Offset(w * (.85f - (i % 2) * .25f), h * (.2f + i * .2f)), sw, StrokeCap.Round)
        Glyph.Close -> { drawLine(color, Offset(w * .2f, h * .2f), Offset(w * .8f, h * .8f), sw * 1.2f, StrokeCap.Round); drawLine(color, Offset(w * .8f, h * .2f), Offset(w * .2f, h * .8f), sw * 1.2f, StrokeCap.Round) }
    }
}
