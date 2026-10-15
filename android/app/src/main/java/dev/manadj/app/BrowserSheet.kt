package dev.manadj.app

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.Velocity
import dev.manadj.audio.DeckId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * Portrait browser as a direct-manipulation sheet (#132): [offset] = translationY (0 open, [height] closed). Drags
 * move it 1:1; [isOpen]/[setOpen] are the open/closed truth (PlayerModel.browser in the app).
 *
 * UH30 rules (shared with the VH12 pitch sheet): a partial position never sticks. Every release, cancel or lost
 * stream settles to an anchor; the direction of the last movement decides (a fling's sign when fast), not the
 * distance travelled; a tap always toggles fully, also mid-settle (it reverses the spring).
 */
@Stable class BrowserSheetState(private val isOpen: () -> Boolean, private val setOpen: (Boolean) -> Unit, private val scope: CoroutineScope) {
    var height by mutableFloatStateOf(0f)
        internal set
    var offset by mutableFloatStateOf(if (isOpen()) 0f else CLOSED_UNMEASURED)
        private set
    /** The panel is composed once opened, dragged or prewarmed, then kept (no build on press). */
    var composed by mutableStateOf(isOpen())
        private set
    /** Pre-build the panel shortly after start so the first swipe doesn't hitch on composition. */
    internal fun prewarm() { composed = true }
    var dragging = false
        private set
    private var settleJob: Job? = null
    private var settleTarget = Float.NaN
    /** Sign of the last real movement: -1 up (toward open), +1 down (toward closed), 0 none yet. */
    private var lastDir = 0
    val open get() = isOpen()

    internal fun measured(h: Float) {
        height = h
        if (!dragging && settleJob?.isActive != true) offset = if (open) 0f else h
    }

    fun dragBy(dy: Float) {
        if (!dragging) { dragging = true; composed = true; settleJob?.cancel(); settleTarget = Float.NaN; lastDir = 0 }
        val h = if (height > 0) height else return
        if (abs(dy) >= .5f) lastDir = if (dy < 0) -1 else 1
        offset = (offset.coerceAtMost(h) + dy).coerceIn(0f, h)
    }

    /** End of a drag (release, fling, cancel): always lands on an anchor. [velocity] px/s, positive = down. */
    fun settle(velocity: Float) {
        if (!dragging) return
        dragging = false
        val openIt = settleOpen(velocity, lastDir, offset, height)
        setOpen(openIt)
        animateTo(if (openIt) 0f else height, velocity)
    }

    /** Tap: toggle fully from wherever it is (a held drag is ended first). */
    fun toggle() {
        if (dragging) { dragging = false }
        setOpen(!open); follow()
    }

    internal fun follow() {
        if (!dragging) { if (open) composed = true; animateTo(if (open) 0f else height, 0f) } }

    private fun animateTo(target: Float, velocity: Float) {
        if (height <= 0) { offset = if (open) 0f else CLOSED_UNMEASURED; return }
        if (target == settleTarget && settleJob?.isActive == true) return
        settleJob?.cancel(); settleTarget = target
        settleJob = scope.launch {
            try { animate(offset.coerceAtMost(height), target, velocity, spring(dampingRatio = 1f, stiffness = 900f)) { v, _ -> offset = v } }
            finally { if (!dragging && settleTarget == target) offset = target } // interrupted by anything but a drag: still land
        }
    }

    /** List at the top: an overscroll-down drags the sheet closed; while pulled, an upward scroll lifts it back first. */
    val nested = object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            if (dragging && available.y < 0 && offset > 0) { val c = maxOf(available.y, -offset); dragBy(c); return Offset(0f, c) }
            return Offset.Zero
        }
        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            if (source == NestedScrollSource.UserInput && available.y > 0) { dragBy(available.y); return Offset(0f, available.y) }
            return Offset.Zero
        }
        override suspend fun onPreFling(available: Velocity): Velocity {
            if (!dragging) return Velocity.Zero
            settle(available.y); return available
        }
    }

    companion object {
        private const val CLOSED_UNMEASURED = 1e5f
    }
}

/** Fast enough to trust the fling's sign (px/s). */
internal const val SHEET_FLING = 150f
/**
 * Open after a drag? Fast: the fling's sign. Otherwise the last movement's direction (up = open). No movement
 * (a held-then-released finger): nearer anchor.
 */
fun settleOpen(velocity: Float, lastDir: Int, offset: Float, height: Float): Boolean = when {
    abs(velocity) > SHEET_FLING -> velocity < 0
    lastDir != 0 -> lastDir < 0
    else -> offset < height / 2
}

@Composable fun rememberBrowserSheet(model: PlayerModel, ux: UiModel): BrowserSheetState {
    val scope = rememberCoroutineScope()
    val state = remember {
        BrowserSheetState({ model.browser != null }, { open -> model.browser = if (open) model.browser ?: coveredDeck(mixOf(model, ux, DeckId.A), mixOf(model, ux, DeckId.B)) else null }, scope)
    }
    LaunchedEffect(model.browser != null) { state.follow() }
    LaunchedEffect(Unit) { kotlinx.coroutines.delay(1500); state.prewarm() }
    return state
}

/** Test/host form: [open] is the truth. */
@Composable fun rememberBrowserSheet(open: MutableState<Boolean>): BrowserSheetState {
    val scope = rememberCoroutineScope()
    val state = remember { BrowserSheetState({ open.value }, { open.value = it }, scope) }
    LaunchedEffect(open.value) { state.follow() }
    return state
}

/**
 * Vertical drag on space no child claimed (gaps, labels, info band — knobs, faders, pads and waves consume their
 * down). [start]: whether a drag in that direction (true = up) may begin here.
 */
fun Modifier.sheetDrag(state: BrowserSheetState, translated: Boolean = false, start: (up: Boolean) -> Boolean): Modifier = pointerInput(state) {
    // On the sheet itself, pointer positions move with it: add the translation back for screen-space drags.
    fun y(p: Offset) = p.y + if (translated) state.offset else 0f
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Final)
        if (down.isConsumed) return@awaitEachGesture
        val slop = viewConfiguration.touchSlop
        val vt = VelocityTracker().apply { addPosition(down.uptimeMillis, Offset(0f, y(down.position))) }
        var dragging = false; val downY = y(down.position); var last = downY
        try {
            while (true) {
                val c = awaitPointerEvent(PointerEventPass.Final).changes.firstOrNull { it.id == down.id } ?: break
                if (c.pressed) vt.addPosition(c.uptimeMillis, Offset(0f, y(c.position)))
                if (!c.pressed) { if (dragging) { dragging = false; state.settle(vt.calculateVelocity().y) }; break }
                if (!dragging) {
                    if (c.isConsumed) break
                    val dy = y(c.position) - downY; val dx = c.position.x - down.position.x
                    if (abs(dy) > slop && abs(dy) > abs(dx)) { if (!start(dy < 0)) break; dragging = true; last = y(c.position); c.consume() }
                    else if (abs(dx) > slop) break
                } else { val now = y(c.position); state.dragBy(now - last); last = now; c.consume() }
            }
        } finally { if (dragging) state.settle(0f) }
    }
}

/** Swipe up on the controls' free space opens the browser (only while it is closed). */
fun Modifier.browserSwipeUp(state: BrowserSheetState): Modifier = sheetDrag(state) { up -> up && !state.open }

/** The sheet: always laid out (for its height), panel composed once opened, translated by the offset. */
@Composable fun BrowserSheet(state: BrowserSheetState, modifier: Modifier, content: @Composable () -> Unit) {
    Box(modifier.onSizeChanged { state.measured(it.height.toFloat()) }.graphicsLayer { translationY = state.offset }
        .settleWatchdog(state).nestedScroll(state.nested).sheetDrag(state, translated = true) { up -> !up }) {
        if (state.composed) content()
    }
}

/**
 * UH30 guarantee: whatever drove the drag (own detector, list overscroll via nested scroll), once no finger is down
 * on the sheet a held sheet settles. Observes on the Initial pass without consuming.
 */
private fun Modifier.settleWatchdog(state: BrowserSheetState): Modifier = pointerInput(state) {
    awaitPointerEventScope {
        while (true) {
            val e = awaitPointerEvent(PointerEventPass.Initial)
            if (e.changes.none { it.pressed } && state.dragging) state.settle(0f)
        }
    }
}
