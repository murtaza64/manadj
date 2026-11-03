package dev.manadj.app.session

import dev.manadj.app.Strip
import dev.manadj.library.session.CaptureEvent
import dev.manadj.library.session.LoopSpan
import dev.manadj.library.session.SessionLog
import dev.manadj.library.session.SessionState
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Immutable, occurrence-scoped evidence for the replay detail waveform's heard side (#469).
 * Built once per log/deck; queries neither reduce events nor depend on observer frames/replay epochs.
 * A query selects the latest Master-audible visit strictly before [at]'s Session time in its current
 * Load occurrence. Unknown/unheard coordinates return null; the caller owns its fallback rendering.
 * Scratch motion is deliberately unknown, not an invented forward run.
 */
class ReplayHeardHistory(log: SessionLog, deck: Int, stripOf: (SessionState, Int) -> Strip) {
    private data class Span(
        val from: Double, val until: Double, val position: Double, val rate: Double,
        val loop: LoopSpan?, val strip: Strip,
    ) {
        private val endPosition get() = position + (until - from) * rate
        val low get() = loop?.start ?: min(position, endPosition)
        val high get() = loop?.end ?: max(position, endPosition)

        fun containsBefore(time: Double, source: Double): Boolean {
            val end = min(until, time)
            if (end <= from) return false
            if (rate == 0.0) return source == position
            val first = from + (source - position) / rate
            val l = loop
            if (l == null) return first >= from && first < end
            if (source < l.start || source >= l.end) return false
            val period = (l.end - l.start) / rate
            var cycle = floor((end - first) / period)
            var visit = first + cycle * period
            // The upper boundary is exclusive even when the query lands exactly on a loop visit.
            if (visit >= end) { cycle--; visit = first + cycle * period }
            return cycle >= 0 && visit >= from && visit < end
        }
    }

    /** Chronological tree with source-range bounds; search newer evidence first and prune unheard ranges. */
    private class Index(spans: List<Span>, begin: Int = 0, end: Int = spans.size) {
        private val leaf: Span?
        private val left: Index?
        private val right: Index?
        private val from: Double
        private val low: Double
        private val high: Double

        init {
            require(begin < end)
            if (end - begin == 1) {
                leaf = spans[begin]; left = null; right = null
                from = leaf.from; low = leaf.low; high = leaf.high
            } else {
                val middle = (begin + end) ushr 1
                leaf = null; left = Index(spans, begin, middle); right = Index(spans, middle, end)
                from = left.from; low = min(left.low, right.low); high = max(left.high, right.high)
            }
        }

        fun at(time: Double, source: Double): Strip? {
            if (time <= from || source < low || source > high) return null
            leaf?.let { return if (it.containsBefore(time, source)) it.strip else null }
            return right!!.at(time, source) ?: left!!.at(time, source)
        }
    }

    private data class Occurrence(val from: Double, val index: Index?)
    private val start = log.start
    private val end = log.end
    private val occurrences: List<Occurrence>

    init {
        require(deck in 0..3)
        val state = SessionState()
        val rows = mutableListOf<Pair<Double, MutableList<Span>>>()
        var current: MutableList<Span>? = null
        var previous = log.start
        for (event in log.replayEvents) {
            if (event.t > previous) {
                val d = state.decks[deck]
                if (current != null && state.audible(deck) && !d.scratching && d.rate.isFinite()) {
                    val region = d.loop?.takeIf { d.rate > 0 && d.playhead >= it.start && d.playhead < it.end }
                    current += Span(previous, event.t, d.playheadAt(previous), d.rate, region, stripOf(state.copy(), deck))
                }
                previous = event.t
            }
            if (event is CaptureEvent.Load && event.deck == deck) {
                current = mutableListOf()
                rows += event.t to current
            }
            SessionLog.reduce(state, event, replay = true)
        }
        occurrences = rows.map { (from, spans) -> Occurrence(from, if (spans.isEmpty()) null else Index(spans)) }
    }

    /** Latest recorded visit to [trackTime] before [sessionTime], within that instant's Load occurrence. */
    fun at(sessionTime: Double, trackTime: Double): Strip? {
        if (!sessionTime.isFinite() || !trackTime.isFinite() || trackTime < 0 || sessionTime < start || sessionTime > end) return null
        var lo = 0
        var hi = occurrences.size
        while (lo < hi) {
            val middle = (lo + hi) ushr 1
            if (occurrences[middle].from <= sessionTime) lo = middle + 1 else hi = middle
        }
        return occurrences.getOrNull(lo - 1)?.index?.at(sessionTime, trackTime)
    }
}
