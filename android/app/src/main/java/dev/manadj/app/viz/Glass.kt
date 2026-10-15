package dev.manadj.app.viz

import androidx.compose.foundation.background
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.runtime.remember
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import dev.manadj.app.KnobKind

/**
 * Backdrop styling (#394 VH2/VH3): while the visualizer backdrop is on, UI surfaces that would paint opaque black
 * become flat glass (one light translucent tint, no gradient — the keys' own hairline borders are the edge) and
 * waveform lanes sit on a soft scrim instead of a black cutout. Off = every helper returns the original opaque
 * styling, unchanged. True backdrop blur would need the WebView's pixels behind each node; the tint is the fallback.
 */
object Glass {
    val on: Boolean get() = Viz.enabled

    /** Flat glass tint over the blurred backdrop (VH6): a dark veil for legibility over bright frames. */
    private val TINT = Color(0xff181a1f).copy(alpha = .36f)

    /**
     * Key / pad / strip fill: [base] when off, frosted glass when on (caller clips to its shape). Frosted = the
     * visualizer page blurs its own pixels inside every registered glass rect ([panes], sent with each feed
     * frame), and the tint sits on top. [corner]: the caller's corner radius (dp; [PILL] = half the height).
     */
    fun fill(base: Color, corner: Float = 2f): Modifier = if (on) Modifier.pane(corner).background(TINT) else Modifier.background(base)
    const val PILL = -1f

    /** Browser sheet / pane: heavier glass (controls underneath must stay out of the way) with the viz blurred through. */
    fun sheet(base: Color): Modifier = if (on) Modifier.pane(0f).background(Color(0xff0b0c0f).copy(alpha = .8f)) else Modifier.background(base)

    /** Containers whose child carries the glass (browser sheet / pane): [base] when off, nothing when on. */
    fun clear(base: Color): Modifier = if (on) Modifier else Modifier.background(base)

    /** Window-space glass rects (x, y, w, h, radius px) keyed per node; read by the JS bridge thread. */
    private val panes = java.util.concurrent.ConcurrentHashMap<Any, FloatArray>()
    /** The backdrop WebView's window origin (rects are sent relative to it). */
    @Volatile var origin = floatArrayOf(0f, 0f)
    /** Registers this node's window bounds as a blurred pane while composed. */
    fun Modifier.pane(corner: Float): Modifier = composed {
        val key = remember { Any() }
        val density = androidx.compose.ui.platform.LocalDensity.current.density
        androidx.compose.runtime.DisposableEffect(key) { onDispose { panes.remove(key) } }
        onGloballyPositioned { c ->
            val b = c.boundsInWindow()
            if (b.width < 1f || b.height < 1f) panes.remove(key)
            else panes[key] = floatArrayOf(b.left, b.top, b.width, b.height, if (corner == PILL) b.height / 2 else corner * density)
        }
    }
    /** JSON array of panes relative to [origin] (device px). */
    fun panesJson(out: StringBuilder) {
        out.append('[')
        var first = true
        for (r in panes.values) {
            if (!first) out.append(',')
            first = false
            out.append('[').append((r[0] - origin[0]).toInt()).append(',').append((r[1] - origin[1]).toInt()).append(',')
                .append(r[2].toInt()).append(',').append(r[3].toInt()).append(',').append(r[4].toInt()).append(']')
        }
        out.append(']')
    }

    /** Small label chips (BEND readout): opaque [base] when off, a light translucent chip when on. */
    fun chip(base: Color): Color = if (on) Color.Black.copy(alpha = .38f) else base

    /** EQ knobs sit in their soft panel under the backdrop: no per-knob HI/MID/LOW labels. */
    fun hideLabel(kind: KnobKind): Boolean = on && (kind == KnobKind.EQ_HIGH || kind == KnobKind.EQ_MID || kind == KnobKind.EQ_LOW)

    /**
     * Waveform lanes: [base] when off. On: detail waves get a shadow scrim fading out across the lane; minimaps
     * ([overview]) a lighter one, and the whole minimap (body + markers) fades to nothing at its bottom edge.
     */
    fun scrim(base: Color, vertical: Boolean, overview: Boolean = false): Modifier = when {
        !on -> Modifier.background(base)
        overview && !vertical -> Modifier.bottomFade().background(Brush.verticalGradient(*MINI))
        else -> Modifier.background(if (vertical) Brush.horizontalGradient(*DETAIL) else Brush.verticalGradient(*DETAIL))
    }
    private val DETAIL = arrayOf(0f to Color.Black.copy(alpha = 0f), .22f to Color.Black.copy(alpha = .55f), .5f to Color.Black.copy(alpha = .68f),
        .78f to Color.Black.copy(alpha = .55f), 1f to Color.Black.copy(alpha = 0f))
    /** Minimap shadow: faint, anchored at the bottom edge under the bottom-anchored body, ramping in fast (no rectangle read). */
    private val MINI = arrayOf(0f to Color.Black.copy(alpha = 0f), .5f to Color.Black.copy(alpha = 0f), .8f to Color.Black.copy(alpha = .1f), 1f to Color.Black.copy(alpha = .18f))
    /** Short rounding fade on the last ~10% (softens the bottom edge without cropping the body). */
    private val FADE = Brush.verticalGradient(0f to Color.Black, .9f to Color.Black, 1f to Color.Transparent)
    private fun Modifier.bottomFade(): Modifier = graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
        .drawWithContent { drawContent(); drawRect(FADE, blendMode = BlendMode.DstIn) }

    private val PLAYED = androidx.compose.ui.graphics.ColorFilter.tint(Color(.5f, .5f, .5f), BlendMode.Modulate)

    /**
     * Minimap body under the backdrop: the played part (before playhead [p] px) is the waveform darkened by half,
     * transparent pixels stay transparent so the lane behind is the same on both sides. False when off (caller
     * draws the original image + black played-side rect).
     */
    fun drawOverview(scope: androidx.compose.ui.graphics.drawscope.DrawScope, image: androidx.compose.ui.graphics.ImageBitmap, p: Float, vertical: Boolean): Boolean {
        if (!on) return false
        val w = image.width; val h = image.height
        val cut = p.toInt().coerceIn(0, if (vertical) h else w)
        val played = if (vertical) androidx.compose.ui.unit.IntSize(w, cut) else androidx.compose.ui.unit.IntSize(cut, h)
        val restAt = if (vertical) androidx.compose.ui.unit.IntOffset(0, cut) else androidx.compose.ui.unit.IntOffset(cut, 0)
        val rest = if (vertical) androidx.compose.ui.unit.IntSize(w, h - cut) else androidx.compose.ui.unit.IntSize(w - cut, h)
        if (played.width > 0 && played.height > 0) scope.drawImage(image, srcSize = played, dstSize = played, colorFilter = PLAYED)
        if (rest.width > 0 && rest.height > 0) scope.drawImage(image, srcOffset = restAt, srcSize = rest, dstOffset = restAt, dstSize = rest)
        return true
    }

    /** Soft panel behind grouped controls (mixer knobs): nothing when off; flat, no gradient. */
    fun softPanel(): Modifier = if (on) Modifier.pane(10f).clip(androidx.compose.foundation.shape.RoundedCornerShape(10.dp)).background(Color.Black.copy(alpha = .34f)) else Modifier
}
