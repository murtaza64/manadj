package dev.manadj.library

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Beatgrid operations with desktop semantics (backend/beatgrid_utils.py,
 * beatgrid_ops.py, routers/beatgrids.py; ADR 0016/0027). Pure: every op
 * returns a new [Beatgrid] (origin "edited") the caller journals as a
 * whole-grid edit (#379). A null grid with a BPM is the placeholder (constant
 * tempo, downbeat at 0), exactly what the desktop serves for gridless tracks.
 */
object GridMath {
    class Expansion(val beats: DoubleArray, val downbeats: DoubleArray)

    /** calculate_beats_from_tempo_changes: every segment walked, boundary beat belongs to the next segment. */
    fun expand(changes: List<TempoChange>, duration: Double): Expansion {
        val beats = ArrayList<Double>(); val downbeats = ArrayList<Double>()
        for ((i, tc) in changes.withIndex()) {
            val interval = 60.0 / tc.bpm
            val next = changes.getOrNull(i + 1)?.startTime
            var t = tc.startTime; var bar = tc.barPosition
            while (t <= duration) {
                if (next != null && t >= next - interval / 2) break
                beats += t
                if (bar == 1) downbeats += t
                t += interval
                bar = (bar % tc.timeSignatureNum) + 1
            }
        }
        return Expansion(beats.toDoubleArray(), downbeats.toDoubleArray())
    }

    fun constant(bpm: Double, num: Int = 4, den: Int = 4, start: Double = 0.0) = listOf(TempoChange(start, bpm, num, 1, den))

    /** set_downbeat_at_time: constant grid extended back toward 0 with the bar phase wrapped. */
    fun setDownbeatAt(t: Double, bpm: Double, num: Int = 4, den: Int = 4): List<TempoChange> {
        val interval = 60.0 / bpm
        val back = (t / interval).toInt()
        val first = t - back * interval
        val within = back % num
        return listOf(TempoChange(first, bpm, num, if (within == 0) 1 else num - within + 1, den))
    }

    /** re_anchor_tempo_changes: rigid shift so the downbeat nearest [mark] lands on it (variable grids). */
    fun reAnchor(changes: List<TempoChange>, mark: Double): List<TempoChange> {
        val maxBar = changes.maxOf { it.timeSignatureNum * 60.0 / it.bpm }
        val downbeats = expand(changes, mark + maxBar).downbeats
        if (downbeats.isEmpty()) return changes
        val shift = mark - downbeats.minBy { abs(it - mark) }
        return changes.map { it.copy(startTime = it.startTime + shift) }
    }

    /** nudge_beatgrid: rigid shift, first change clamped to [-0.1, duration]; returns the applied seconds. */
    fun nudge(changes: List<TempoChange>, offsetMs: Double, duration: Double): Pair<List<TempoChange>, Double> {
        val first = changes.first().startTime
        val applied = max(-0.1, min(duration, first + offsetMs / 1000.0)) - first
        return changes.map { it.copy(startTime = it.startTime + applied) } to applied
    }

    fun firstDownbeat(changes: List<TempoChange>): Double {
        val tc = changes.first(); val interval = 60.0 / tc.bpm
        var t = tc.startTime; var pos = tc.barPosition
        while (pos != 1) { t += interval; pos = (pos % tc.timeSignatureNum) + 1 }
        return t
    }

    /** The BPM occupying the most track time (BPM is the grid's projection). */
    fun dominantBpm(changes: List<TempoChange>, duration: Double?): Double {
        if (changes.size == 1 || duration == null) return changes.first().bpm
        val weights = LinkedHashMap<Double, Double>()
        for ((i, tc) in changes.withIndex()) {
            val end = changes.getOrNull(i + 1)?.startTime ?: duration
            weights[tc.bpm] = (weights[tc.bpm] ?: 0.0) + max(0.0, end - tc.startTime)
        }
        return weights.maxBy { it.value }.key
    }

    /** gridOrigin.ts: the earliest downbeat after extending the first segment back in whole beats. */
    fun gridOrigin(changes: List<TempoChange>): Double {
        val tc = changes.first(); val period = 60.0 / tc.bpm; val sig = tc.timeSignatureNum
        val eps = min(0.05, period / 4)
        val back = max(0, floor((tc.startTime + eps) / period).toInt())
        val start = tc.startTime - back * period
        val pos = (((tc.barPosition - 1 - back) % sig) + sig) % sig + 1
        return start + ((sig + 1 - pos) % sig) * period
    }

    /** bpmCommit.growShrinkBpm: ±0.03, snapping to the integer at x.99 / x.01. */
    fun growShrink(bpm: Double, grow: Boolean): Double {
        var next = bpm + if (grow) -0.03 else 0.03
        val decimal = abs(next % 1)
        if (decimal >= 0.99 || decimal <= 0.01) next = next.roundToInt().toDouble()
        return (next * 100).roundToInt() / 100.0
    }

    /** The grid an edit starts from: the saved one, else the placeholder from [bpm]; null when gridless. */
    fun base(grid: Beatgrid?, bpm: Double?): List<TempoChange>? =
        grid?.tempoChanges?.takeIf { it.isNotEmpty() } ?: bpm?.takeIf { it > 0 }?.let { constant(it) }

    /** Set-downbeat (ADR 0016): the mark becomes the anchor; constant grids rebuild through it, variable shift. */
    fun setDownbeat(grid: Beatgrid?, bpm: Double?, at: Double): Beatgrid? {
        val changes = base(grid, bpm) ?: return null
        val next = if (changes.size > 1) reAnchor(changes, at) else changes[0].let { setDownbeatAt(at, it.bpm, it.timeSignatureNum, it.timeSignatureDen) }
        return Beatgrid(EDITED, at, next)
    }

    /** Grid nudge: translate by [offsetMs]; the anchor moves by exactly the applied offset. */
    fun nudge(grid: Beatgrid?, bpm: Double?, offsetMs: Double, duration: Double): Beatgrid? {
        val changes = base(grid, bpm) ?: return null
        val (next, applied) = nudge(changes, offsetMs, duration)
        return Beatgrid(EDITED, grid?.anchorTime?.plus(applied), next)
    }

    /** BPM edit (beatgrid_ops.write_bpm): anchor-preserving re-tempo; null for variable grids (desktop 409). */
    fun retempo(grid: Beatgrid?, bpm: Double?, newBpm: Double): Beatgrid? {
        if (!(newBpm > 0) || !newBpm.isFinite()) return null
        val changes = base(grid, bpm) ?: return Beatgrid(EDITED, null, constant(newBpm))
        if (changes.size > 1) return null
        val tc = changes[0]
        val anchor = grid?.anchorTime ?: firstDownbeat(changes)
        return Beatgrid(EDITED, anchor, setDownbeatAt(anchor, newBpm, tc.timeSignatureNum, tc.timeSignatureDen))
    }

    const val EDITED = "edited"
    /** Desktop GRID_NUDGE_MS step. */
    const val NUDGE_MS = 10.0
}

/**
 * Metric ladder projection (frontend/src/meter/ladder.ts, ADRs 0029/0030):
 * per-downbeat tier, bar ordinal, and parenthetical ("extra") bars, with
 * Reset marks resolved to the nearest downbeat and the earliest mark as the
 * Ladder anchor (pre-anchor region peeled backward).
 */
class LadderProjection(
    val tiers: IntArray, val barIndexes: IntArray, val parentheticals: BooleanArray,
    val parentheticalCounts: IntArray, val tierBars: IntArray, val topBars: IntArray, val topTier: Int,
) {
    /** "13 of 16" or "+2" (barCountLabel). */
    fun label(ordinal: Int): String {
        if (parentheticals[ordinal]) {
            val explicit = parentheticalCounts[ordinal]
            if (explicit > 0) return "+$explicit"
            var k = 1; var i = ordinal - 1
            while (i >= 0 && parentheticals[i]) { k++; i-- }
            return "+$k"
        }
        val top = topBars[ordinal]
        return "${barIndexes[ordinal] % top + 1} of $top"
    }

    companion object {
        val DEFAULT_ARITIES = listOf(2, 2, 2, 2)

        fun nearestDownbeatOrdinal(downbeats: DoubleArray, t: Double): Int {
            var lo = 0; var hi = downbeats.size - 1
            while (lo < hi) { val mid = (lo + hi) ushr 1; if (downbeats[mid] < t) lo = mid + 1 else hi = mid }
            return if (lo > 0 && t - downbeats[lo - 1] <= downbeats[lo] - t) lo - 1 else lo
        }

        /** The stored mark nearest [t] (raw seconds; delete-nearest's target). */
        fun nearestMark(marks: List<Double>, t: Double): Double? = marks.minByOrNull { abs(it - t) }

        fun resolvedMarkTimes(downbeats: DoubleArray, marks: List<Double>): List<Double> =
            if (downbeats.isEmpty()) emptyList()
            else marks.map { nearestDownbeatOrdinal(downbeats, it) }.distinct().sorted().map { downbeats[it] }

        private fun parentheticalCutoff(bars: Int, tierBars: IntArray): Int {
            for (k in tierBars.size - 1 downTo 1) if (tierBars[k] <= bars) return bars / tierBars[k] * tierBars[k]
            return 0
        }

        private fun largestTierThatFits(bars: Int, tierBars: IntArray): Int {
            for (k in tierBars.size - 1 downTo 1) if (tierBars[k] <= bars) return k
            return 0
        }

        fun resolve(changes: List<TempoChange>, downbeats: DoubleArray, marks: List<Double>, arities: List<Int> = DEFAULT_ARITIES): LadderProjection? {
            if (changes.isEmpty() || downbeats.isEmpty()) return null
            val ar = arities.ifEmpty { DEFAULT_ARITIES }
            val topTier = ar.size
            val n = downbeats.size
            val tc = changes[0]
            val barSec = 60.0 / tc.bpm * tc.timeSignatureNum
            val barsOffset = max(0, ((downbeats[0] - GridMath.gridOrigin(changes)) / barSec).roundToInt())
            val tierBars = IntArray(topTier + 1).also { var b = 1; for (k in 0..topTier) { it[k] = b; if (k < topTier) b *= ar[k] } }
            val markOrdinals = marks.map { nearestDownbeatOrdinal(downbeats, it) }.distinct().sorted()
            val tiers = IntArray(n); val barIndexes = IntArray(n)
            val parentheticals = BooleanArray(n); val counts = IntArray(n)
            val topBars = IntArray(n) { tierBars[topTier] }
            val hasAnchor = markOrdinals.isNotEmpty()
            val anchor = if (hasAnchor) markOrdinals[0] else 0
            if (hasAnchor) {
                val preBars = barsOffset + anchor
                data class Group(val start: Int, val end: Int, val tier: Int, val bars: Int)
                val groups = ArrayList<Group>()
                var lead = preBars
                while (true) {
                    val tier = largestTierThatFits(lead, tierBars)
                    if (tier == 0) break
                    val bars = tierBars[tier]
                    groups += Group(lead - bars, lead, tier, bars)
                    lead -= bars
                }
                for (i in 0 until anchor) {
                    val pos = barsOffset + i
                    if (pos < lead) { parentheticals[i] = true; counts[i] = pos + 1; barIndexes[i] = pos; tiers[i] = 0 }
                }
                for (g in groups) {
                    for (pos in max(g.start, barsOffset) until min(g.end, preBars)) {
                        val i = pos - barsOffset
                        if (i < 0 || i >= anchor) continue
                        val local = pos - g.start
                        barIndexes[i] = local; topBars[i] = g.bars
                        var tier = 0
                        for (k in 1..g.tier) { if (local % tierBars[k] != 0) break; tier = k }
                        tiers[i] = tier
                    }
                }
            }
            val starts = listOf(anchor) + markOrdinals.filter { it > anchor }
            for ((s, start) in starts.withIndex()) {
                val end = starts.getOrNull(s + 1) ?: n
                val base = if (s == 0 && !hasAnchor) barsOffset else 0
                val bounded = s + 1 < starts.size
                val cutoff = if (bounded) parentheticalCutoff(base + (end - start), tierBars) else Int.MAX_VALUE
                for (i in start until end) {
                    val local = base + (i - start)
                    barIndexes[i] = local
                    parentheticals[i] = local >= cutoff
                    if (parentheticals[i]) counts[i] = local - cutoff + 1
                    var tier = 0
                    for (k in 1..topTier) { if (local % tierBars[k] != 0) break; tier = k }
                    tiers[i] = tier
                }
            }
            return LadderProjection(tiers, barIndexes, parentheticals, counts, tierBars, topBars, topTier)
        }
    }
}
