package dev.manadj.app

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.manadj.app.browse.LibrarySort
import dev.manadj.app.browse.LibraryTrack
import dev.manadj.app.browse.keyOrder
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.roundToInt

/** A labelled waypoint on the scrubber track: the first row of a section of the active sort. */
data class Waypoint(val row: Int, val label: String, val color: Color? = null)

private val MONTH = DateTimeFormatter.ofPattern("MMM yy")
private val DAY = DateTimeFormatter.ofPattern("d MMM yyyy")

/** Coarse section of [t] (row [i]) for the active sort (#167): letters, BPM tens, OpenKey, month, index step, energy, minute. */
fun sectionOf(t: LibraryTrack, i: Int, sort: LibrarySort, count: Int): String = when (sort) {
    LibrarySort.TITLE -> initial(t.title)
    LibrarySort.ARTIST -> initial(t.artist)
    LibrarySort.BPM -> t.bpm?.let { "${(it / 10).toInt() * 10}" } ?: "—"
    LibrarySort.KEY -> toOpenKey(t.key) ?: "—"
    LibrarySort.DATE_ADDED -> t.dateAdded?.format(MONTH) ?: "—"
    LibrarySort.ENERGY -> t.energy?.toString() ?: "—"
    LibrarySort.DURATION -> t.durationSeconds?.let { "${(it / 60).toInt()}m" } ?: "—"
    LibrarySort.PLAY_ORDER, LibrarySort.RANK -> { val step = indexStep(count); "${i / step * step + 1}" }
}

/** Precise value beside the thumb (#167b). */
fun preciseOf(t: LibraryTrack, i: Int, sort: LibrarySort): String = when (sort) {
    LibrarySort.TITLE -> t.title.take(18)
    LibrarySort.ARTIST -> t.artist.ifBlank { "—" }.take(18)
    LibrarySort.BPM -> t.bpm?.let { "%.1f BPM".format(it) } ?: "no BPM"
    LibrarySort.KEY -> toOpenKey(t.key) ?: "no key"
    LibrarySort.DATE_ADDED -> t.dateAdded?.format(DAY) ?: "—"
    LibrarySort.ENERGY -> t.energy?.let { "energy $it" } ?: "—"
    LibrarySort.DURATION -> t.durationSeconds?.let { clock(it) } ?: "—"
    LibrarySort.PLAY_ORDER, LibrarySort.RANK -> "#${i + 1}"
}

private fun initial(s: String) = s.trim().firstOrNull()?.uppercaseChar()?.let { if (it.isLetter()) "$it" else "#" } ?: "#"
private fun indexStep(count: Int) = listOf(10, 25, 50, 100, 250, 500).firstOrNull { count / it <= 12 } ?: 1000

/**
 * Waypoints for one list + sort, computed once (#167): every section start, thinned so labels stay at least
 * [minGap] (fraction of the track) apart — a dense region keeps more labels, sparse ones fewer, never an empty
 * section. Bigger sections win when two collide.
 */
fun waypoints(rows: List<LibraryTrack>, sort: LibrarySort, minGap: Float): List<Waypoint> {
    if (rows.isEmpty()) return emptyList()
    val n = rows.size
    data class Sec(val row: Int, val label: String, var size: Int)
    val secs = ArrayList<Sec>()
    rows.forEachIndexed { i, t ->
        val s = sectionOf(t, i, sort, n)
        if (secs.isEmpty() || secs.last().label != s) secs += Sec(i, s, 1) else secs.last().size++
    }
    // Greedy by size, then keep in row order those not crowding an already-kept label.
    val kept = ArrayList<Sec>()
    for (s in secs.sortedByDescending { it.size }) {
        val f = s.row.toFloat() / n
        if (kept.none { abs(it.row.toFloat() / n - f) < minGap }) kept += s
    }
    return kept.sortedBy { it.row }.map { s -> Waypoint(s.row, s.label, if (sort == LibrarySort.KEY) keyColor(s.label) else null) }
}

/**
 * Fast-scroll scrubber + jump-to-top over a track list (#166/#167). Track along the right edge appears while
 * scrolling (hides after idle); dragging the thumb scrubs (row ∝ finger), snapping to a waypoint within 10 dp with
 * a haptic tick at each section change; while dragging, the waypoint scale is drawn along the track and a bubble
 * shows the precise value. [rowItem] maps a row to its LazyColumn item index; [itemRow] the reverse.
 */
@Composable fun ScrubOverlay(
    state: LazyListState, rows: List<LibraryTrack>, sort: LibrarySort, rowItem: (Int) -> Int, itemRow: (Int) -> Int, modifier: Modifier,
    onDragging: (Boolean) -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    val density = LocalDensity.current
    var heightPx by remember { mutableIntStateOf(0) }
    var dragging by remember { mutableStateOf(false) }
    var dragRow by remember { mutableIntStateOf(0) }
    val minGap = with(density) { if (heightPx > 0) 20.dp.toPx() / heightPx else .05f }
    val points = remember(rows, sort, minGap) { waypoints(rows, sort, minGap) }
    val n = rows.size
    val draggingNow by rememberUpdatedState(onDragging)
    LaunchedEffect(Unit) { snapshotFlow { dragging }.collect { draggingNow(it) } }
    FrameMeter(state, "browser scrub") { dragging }
    // UH26: one scrollToItem per frame at most (touch events arrive faster than frames; each forces a relayout).
    val currentRowItem by rememberUpdatedState(rowItem)
    LaunchedEffect(state, dragging) {
        if (!dragging) return@LaunchedEffect
        var shown = -1
        while (true) { withFrameNanos { }; val r = dragRow; if (r != shown) { shown = r; state.scrollToItem(currentRowItem(r)) } }
    }
    // Shown while scrolling or dragging; lingers 1.2 s.
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(state) {
        snapshotFlow { state.isScrollInProgress }.collect { if (it) visible = true }
    }
    LaunchedEffect(visible, dragging, state.isScrollInProgress) { if (visible && !dragging && !state.isScrollInProgress) { delay(1200); visible = false } }
    val firstRow by remember(rows) { derivedStateOf { itemRow(state.firstVisibleItemIndex).coerceIn(0, (n - 1).coerceAtLeast(0)) } }
    val showTop by remember { derivedStateOf { state.firstVisibleItemIndex > 6 } }
    Box(modifier.onSizeChanged { heightPx = it.height }) {
        // Jump to top: thumb reach, left of the scrubber track.
        AnimatedVisibility(showTop && !dragging, Modifier.align(Alignment.BottomEnd).padding(end = 30.dp, bottom = 10.dp), enter = fadeIn(), exit = fadeOut()) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(50)).background(Ink.panel).border(1.5.dp, Ink.accent, RoundedCornerShape(50))
                .semantics { contentDescription = "Jump to top" }
                .pointerInput(Unit) { awaitEachGesture { awaitFirstDown().consume(); scope.launch { if (state.firstVisibleItemIndex > 30) state.scrollToItem(30); state.animateScrollToItem(0) } } },
                contentAlignment = Alignment.Center) { Text("▲", color = Ink.accent, size = 16, bold = true) }
        }
        if (n < 30 || heightPx == 0) return@Box
        val h = heightPx.toFloat()
        val thumbH = with(density) { 36.dp.toPx() }
        val row = if (dragging) dragRow else firstRow
        val thumbY = (row.toFloat() / (n - 1).coerceAtLeast(1)) * (h - thumbH)
        AnimatedVisibility(visible || dragging, Modifier.align(Alignment.TopEnd).fillMaxHeight(), enter = fadeIn(), exit = fadeOut()) {
            Box(Modifier.fillMaxHeight().width(if (dragging) 220.dp else 28.dp)) {
                // Waypoint scale along the track while scrubbing (#167a).
                if (dragging) for (p in points) {
                    val y = p.row.toFloat() / n * h
                    Text(p.label, Modifier.align(Alignment.TopEnd).graphicsLayer { translationY = y - 7.dp.toPx() }.padding(end = 26.dp)
                        .background(Ink.background.copy(alpha = .8f)).padding(horizontal = 3.dp), p.color ?: Ink.muted, 10, true)
                }
                Box(Modifier.align(Alignment.TopEnd).fillMaxHeight().width(28.dp).semantics { contentDescription = "Fast scroll" }.pointerInput(rows, sort, points) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false); down.consume()
                        dragging = true; visible = true
                        val snapPx = 10.dp.toPx()
                        var lastSection: String? = null
                        fun go(y: Float) {
                            var r = ((y - thumbH / 2) / (size.height - thumbH)).coerceIn(0f, 1f).let { (it * (n - 1)).roundToInt() }
                            // Snap to a waypoint within 10 dp (#167c).
                            points.minByOrNull { abs(it.row.toFloat() / n * size.height - y) }?.let { if (abs(it.row.toFloat() / n * size.height - y) < snapPx) r = it.row }
                            dragRow = r
                            val sec = sectionOf(rows[r], r, sort, n)
                            if (sec != lastSection) { if (lastSection != null) haptic.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick); lastSection = sec }
                        }
                        go(down.position.y)
                        try {
                            while (true) {
                                val c = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                                if (!c.pressed) break
                                go(c.position.y); c.consume()
                            }
                        } finally { dragging = false }
                    }
                }) {
                    Box(Modifier.align(Alignment.TopCenter).fillMaxHeight().width(3.dp).background(Ink.surface0))
                    Box(Modifier.align(Alignment.TopCenter).graphicsLayer { translationY = thumbY }.size(if (dragging) 10.dp else 6.dp, 36.dp).clip(RoundedCornerShape(50)).background(Ink.accent))
                }
                // Precise value bubble beside the thumb (#167b).
                if (dragging && dragRow < n) Text(preciseOf(rows[dragRow], dragRow, sort),
                    Modifier.align(Alignment.TopEnd).graphicsLayer { translationY = (thumbY + thumbH / 2 - 14.dp.toPx()).coerceAtLeast(0f) }.padding(end = 70.dp)
                        .clip(RoundedCornerShape(6.dp)).background(Ink.accent).padding(horizontal = 8.dp, vertical = 4.dp), Color.Black, 13, true)
            }
        }
    }
}
