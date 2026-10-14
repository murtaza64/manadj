package dev.manadj.app

import android.os.Build
import android.view.RoundedCorner
import android.view.View
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.sqrt

/** A rounded display corner: arc of [radius] around ([cx], [cy]); window px. [left]/[top] say which corner. */
@Immutable data class ScreenCorner(val left: Boolean, val top: Boolean, val radius: Float, val cx: Float, val cy: Float)

/**
 * The physical screen outline in window px: rounded corners (WindowInsets.getRoundedCorner, API 31+; a
 * conservative 24dp keep-out before that) and display cutouts (DisplayCutout.boundingRects). The UI draws
 * edge-to-edge and keeps interactive controls/text out of these regions via [screenSafe].
 */
@Immutable data class ScreenShape(val corners: List<ScreenCorner> = emptyList(), val cutouts: List<Rect> = emptyList()) {
    /** Horizontal (left, right) padding in px that keeps [b] clear of corner arcs and cutouts. */
    fun keepOut(b: Rect, margin: Float): Pair<Float, Float> {
        var l = 0f; var r = 0f
        for (c in corners) {
            // Worst row of the element inside the corner square: the edge nearest the screen edge.
            val dy = if (c.top) { if (b.top >= c.cy) continue; c.cy - b.top } else { if (b.bottom <= c.cy) continue; b.bottom - c.cy }
            val half = sqrt((c.radius * c.radius - minOf(dy, c.radius).let { it * it }).coerceAtLeast(0f))
            if (c.left) { val arcX = c.cx - half; if (b.left < arcX) l = maxOf(l, arcX - b.left + margin) }
            else { val arcX = c.cx + half; if (b.right > arcX) r = maxOf(r, b.right - arcX + margin) }
        }
        for (k in cutouts) {
            if (!k.overlaps(b)) continue
            if (k.center.x < b.center.x) l = maxOf(l, k.right - b.left + margin) else r = maxOf(r, b.right - k.left + margin)
        }
        return l to r
    }

    /** Lowest window-px y of cutouts touching the top edge (the camera band), 0 when none. */
    val topBand: Float get() = cutouts.filter { it.top <= 1f }.maxOfOrNull { it.bottom } ?: 0f

    companion object {
        fun of(view: View): ScreenShape {
            val insets = view.rootWindowInsets ?: return ScreenShape()
            val w = view.rootView.width.toFloat(); val h = view.rootView.height.toFloat()
            val corners = if (Build.VERSION.SDK_INT >= 31) {
                listOf(RoundedCorner.POSITION_TOP_LEFT, RoundedCorner.POSITION_TOP_RIGHT, RoundedCorner.POSITION_BOTTOM_RIGHT, RoundedCorner.POSITION_BOTTOM_LEFT).mapNotNull { p ->
                    insets.getRoundedCorner(p)?.takeIf { it.radius > 0 }?.let { ScreenCorner(p == RoundedCorner.POSITION_TOP_LEFT || p == RoundedCorner.POSITION_BOTTOM_LEFT, p <= RoundedCorner.POSITION_TOP_RIGHT, it.radius.toFloat(), it.center.x.toFloat(), it.center.y.toFloat()) }
                }
            } else {
                val r = 24 * view.resources.displayMetrics.density
                listOf(ScreenCorner(true, true, r, r, r), ScreenCorner(false, true, r, w - r, r), ScreenCorner(false, false, r, w - r, h - r), ScreenCorner(true, false, r, r, h - r))
            }
            val cutouts = if (Build.VERSION.SDK_INT >= 28) insets.displayCutout?.boundingRects.orEmpty().map { Rect(it.left.toFloat(), it.top.toFloat(), it.right.toFloat(), it.bottom.toFloat()) } else emptyList()
            return ScreenShape(corners, cutouts)
        }
    }
}

val LocalScreenShape = staticCompositionLocalOf { ScreenShape() }

/** Pads this element horizontally so its content stays out of rounded-corner arcs and cutouts it overlaps. */
fun Modifier.screenSafe(margin: Dp = 4.dp): Modifier = composed {
    val shape = LocalScreenShape.current
    val density = LocalDensity.current
    var bounds by remember { mutableStateOf<Rect?>(null) }
    val (l, r) = bounds?.let { shape.keepOut(it, with(density) { margin.toPx() }) } ?: (0f to 0f)
    onGloballyPositioned { val p = it.positionInWindow(); val nb = Rect(p.x, p.y, p.x + it.size.width, p.y + it.size.height); if (nb != bounds) { android.util.Log.d("ScreenSafe", "bounds $bounds -> $nb"); bounds = nb } }
        .padding(start = with(density) { l.toDp() }, end = with(density) { r.toDp() })
}
