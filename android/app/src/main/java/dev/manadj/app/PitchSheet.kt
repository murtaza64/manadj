package dev.manadj.app

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChangeIgnoreConsumed
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import dev.manadj.audio.DeckId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * Pitch sheet physics (VH6, VH12): one [progress] per deck (0 = lowered into its tab, 1 = up), driven by a critically
 * damped spring (no overshoot) or the finger. Everything reads it in draw-phase lambdas (graphicsLayer
 * translation / alpha), so a slide never relayouts or recomposes. [PlayerModel.pitchDrawer] is the open/closed
 * truth (the anchor); the sheet follows it, and a released drag writes it.
 *
 * VH12 guarantee: a partial position never sticks. Whenever no finger holds the sheet, [PitchSheetHost]'s settle
 * loop drives it to the anchor, retrying if anything (a stray snap, recomposition) interrupts the spring.
 */
@Stable class PitchSheetState {
    val progress = Animatable(0f)
    /** Travel in px (panel height − tab height); set from layout. */
    var travel by mutableFloatStateOf(1f)
    /** A finger holds the sheet (set/cleared only by the holding gesture, cleared in its finally). */
    var dragging by mutableStateOf(false)
        internal set
    /** Bumped on every release so the settle loop re-arms even if the anchor did not change. */
    internal var releases by mutableIntStateOf(0)
    /** VH9: corner-arc insets (left, right px) of the tab face, measured at the closed tab's rest position; the risen copy reuses them. */
    var faceInsets by mutableStateOf(0f to 0f)
    private val tracker = VelocityTracker()
    private var held = 0f
    internal var settleVelocity = 0f

    internal fun grab(scope: CoroutineScope) { dragging = true; held = progress.value; scope.launch(start = CoroutineStart.UNDISPATCHED) { progress.stop() } }
    internal fun dragBy(scope: CoroutineScope, dyPx: Float) {
        held = (held - dyPx / travel).coerceIn(0f, 1f)
        val to = held
        scope.launch(start = CoroutineStart.UNDISPATCHED) { progress.snapTo(to) }
    }

    /** Release (or cancel) a held sheet: the anchor follows the direction of the last movement (VH12), never the position. */
    internal fun release(model: PlayerModel, id: DeckId, velocityPxPerS: Float, lastDy: Float) {
        val v = -velocityPxPerS / travel // progress per second (up = +)
        val open = releaseOpens(v, -lastDy, progress.value)
        model.pitchDrawer = if (open) id else if (model.pitchDrawer == id) null else model.pitchDrawer
        settleVelocity = v.coerceIn(-12f, 12f).let { if ((it > 0) == open) it else 0f }
        dragging = false
        releases++
    }
    internal fun track(timeMs: Long, y: Float) = tracker.addPosition(timeMs, androidx.compose.ui.geometry.Offset(0f, y))
    internal fun velocity(): Float { val v = tracker.calculateVelocity().y; tracker.resetTracking(); return v }
    internal fun resetTracking() = tracker.resetTracking()

    companion object { val SPRING = spring<Float>(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = 900f) }
}

/**
 * VH12 release rule: swipe up = open, swipe down = close, decided by the direction of the last movement — the
 * release velocity if it is clear, else the last move. [v] and [lastUp] are up-positive; [at] breaks a dead tie.
 */
fun releaseOpens(v: Float, lastUp: Float, at: Float): Boolean = when {
    abs(v) > .15f -> v > 0
    lastUp != 0f -> lastUp > 0
    else -> at > .5f
}

object PitchSheets {
    private val states = DeckId.entries.associateWith { PitchSheetState() }
    fun of(id: DeckId): PitchSheetState = states.getValue(id)
}

/**
 * Vertical sheet drag on [id]'s tab or panel chrome: past the touch slop the gesture moves the sheet with the finger;
 * release or cancel settles it to an anchor (VH12). With [tap] set, any gesture that never passed the slop (and whose
 * moves no child claimed) is a tap: it toggles [PlayerModel.pitchDrawer] — also mid-spring, reversing it (VH11).
 * Consumption of the up does not cancel the tap. Sliders/jog/platter keep their streams.
 */
fun Modifier.pitchSheetDrag(model: PlayerModel, id: DeckId, tap: (() -> Unit)? = null): Modifier = this.then(Modifier.pointerInput(id) {
    val sheet = PitchSheets.of(id)
    val slop = viewConfiguration.touchSlop
    coroutineScope {
        awaitEachGesture {
            // Claim the down in Main (before ancestors' Final): the portrait browser swipe-up (sheetDrag) bails on a
            // consumed down instead of stealing the drag (VH12). Children (fader/jog) already ran their Main pass.
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Main)
            down.consume()
            var total = 0f
            var lastDy = 0f
            var dragging = false
            var claimed = false // past the slop, or a child consumed a move
            sheet.resetTracking(); sheet.track(down.uptimeMillis, down.position.y)
            try {
                while (true) {
                    val e = awaitPointerEvent(PointerEventPass.Final)
                    val c = e.changes.firstOrNull { it.id == down.id } ?: break
                    if (!c.pressed) {
                        if (dragging) { dragging = false; sheet.release(model, id, sheet.velocity(), lastDy) }
                        else if (!claimed && tap != null) { tap(); togglePitchSheet(model, id) }
                        break
                    }
                    val dy = c.positionChangeIgnoreConsumed().y
                    if (c.positionChangeIgnoreConsumed() == androidx.compose.ui.geometry.Offset.Zero) continue
                    if (c.isConsumed && !dragging) { claimed = true; continue } // a child (slider/jog) owns this stream
                    total += dy
                    if (dy != 0f) lastDy = dy
                    sheet.track(c.uptimeMillis, c.position.y)
                    if (!dragging && abs(total) > slop) {
                        claimed = true
                        // At rest lowered only an upward drag grabs, raised only downward; mid-slide either direction.
                        val p = sheet.progress.value
                        if (!sheet.dragging && (p in .02f..0.98f || (p > .98f && total > 0) || (p < .02f && total < 0))) {
                            dragging = true; sheet.grab(this@coroutineScope)
                            if (model.pitchDrawer != id && total < 0) model.pitchDrawer = id
                        }
                    }
                    if (dragging) { sheet.dragBy(this@coroutineScope, dy); c.consume() }
                }
            } finally {
                // Lost pointer, cancelled gesture or detached node mid-drag: release to an anchor, never hold.
                if (dragging) sheet.release(model, id, 0f, lastDy)
            }
        }
    }
})

/** Tap semantics shared by the tab, the risen header and accessibility: toggle against the current target. */
fun togglePitchSheet(model: PlayerModel, id: DeckId) { model.pitchDrawer = if (model.pitchDrawer == id) null else id }

/**
 * The deck's sheet container: [content] composes on first open and stays composed (prewarmed: later opens never
 * build it during the slide), translated by graphicsLayer only. Clipped to the deck's control area.
 */
@Composable fun PitchSheetHost(model: PlayerModel, id: DeckId, modifier: Modifier, content: @Composable () -> Unit) {
    val sheet = PitchSheets.of(id)
    val open = model.pitchDrawer == id
    val tab = with(LocalDensity.current) { PitchTabHeight.toPx() }
    var built by remember { mutableStateOf(false) }
    if (open) built = true
    // VH12 settle loop: whenever no finger holds the sheet, drive it to the anchor; an interrupted spring retries.
    LaunchedEffect(sheet) {
        snapshotFlow { Triple(model.pitchDrawer == id, sheet.dragging, sheet.releases) }.collectLatest { (up, held, _) ->
            if (held) return@collectLatest
            val goal = if (up) 1f else 0f
            var v = sheet.settleVelocity; sheet.settleVelocity = 0f
            while (sheet.progress.value != goal && !sheet.dragging) {
                try { sheet.progress.animateTo(goal, PitchSheetState.SPRING, v) }
                catch (e: kotlinx.coroutines.CancellationException) { currentCoroutineContext().ensureActive() } // interrupted by a snap, not by us
                v = 0f
            }
        }
    }
    if (!built) return
    // Placed only while (partly) up: a lowered sheet takes no input; toggles relayout at the endpoints only.
    // VH14: read the drawer state inside the derivation (a captured `open` went stale and left the lowered sheet's
    // tinted header placed over the tab).
    val visible by remember(sheet, model) { derivedStateOf { sheet.progress.value > 0.001f || model.pitchDrawer == id } }
    Box(modifier.clipToBounds().onSizeChanged { sheet.travel = (it.height - tab).coerceAtLeast(1f) }) {
        Box(Modifier.layout { m, c -> val pl = m.measure(c); layout(pl.width, pl.height) { if (visible) pl.place(0, 0) } }
            .graphicsLayer { translationY = (1 - sheet.progress.value) * sheet.travel }) { content() }
    }
}

private suspend fun <T> coroutineScope(block: suspend CoroutineScope.() -> T): T = kotlinx.coroutines.coroutineScope(block)
