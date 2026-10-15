package dev.manadj.audio

import kotlin.math.abs
import kotlin.math.round

/**
 * Tap-along latency (#382 fallback; mic chirps stay primary). The engine plays accented clicks every [period]
 * (≈110 BPM); each tap's offset after the latest click render is folded into one period. Robust: the first
 * [SKIP] taps are ignored, outliers beyond ±[OUTLIER] s of the circular median are rejected (never failing the
 * run), and the run locks in when the last [LOCK_TAPS] accepted taps agree within ±[LOCK_SPREAD] s. The period
 * wrap is resolved toward [coarseSeconds] (mic estimate, else reaction pre-pass, else Android-reported).
 */
class TapCalibrator(private val coarseSeconds: Double, private val period: Double = LatencyCalibrator.TAP_PERIOD) {
    data class State(
        val taps: Int, val accepted: Int,
        /** Current estimate (seconds, wrap resolved toward the coarse estimate), null until [LOCK_TAPS] accepted. */
        val candidateSeconds: Double?,
        /** Max deviation of the last [LOCK_TAPS] accepted taps from their median, ms (the "locking in" meter). */
        val spreadMillis: Double?,
        val locked: Boolean,
    )

    private val offsets = mutableListOf<Double>()
    private var taps = 0

    var state = State(0, 0, null, null, false)
        private set

    /** Adds a tap (System.nanoTime) against the click render instants so far ([AudioEngine.clickNanos]). */
    fun add(tapNanos: Long, clickNanos: LongArray): State {
        taps++
        val click = clickNanos.filter { it in 1..tapNanos }.maxOrNull()
        if (click != null && taps > SKIP) offsets += fold((tapNanos - click) / 1e9)
        state = evaluate()
        return state
    }

    private fun fold(x: Double) = ((x % period) + period) % period

    /** Signed circular difference a − b in (−period/2, period/2]. */
    private fun diff(a: Double, b: Double): Double { val d = a - b; return d - period * round(d / period) }

    private fun circularMedian(values: List<Double>): Double =
        values.minBy { c -> values.sumOf { abs(diff(it, c)) } }

    private fun evaluate(): State {
        if (offsets.isEmpty()) return State(taps, 0, null, null, false)
        val center = circularMedian(offsets)
        val accepted = offsets.filter { abs(diff(it, center)) <= OUTLIER }
        if (accepted.size < LOCK_TAPS) return State(taps, accepted.size, null, null, false)
        val recent = accepted.takeLast(LOCK_TAPS)
        val c = circularMedian(recent)
        val spread = recent.maxOf { abs(diff(it, c)) }
        // Unwrap the accepted offsets around their median, then pick the period wrap nearest the coarse estimate.
        val unwrapped = accepted.map { c + diff(it, c) }.sorted()
        val median = unwrapped[unwrapped.size / 2]
        val k = round((coarseSeconds - median) / period)
        val seconds = (median + k * period).let { if (it < 0) it + period else it }
        return State(taps, accepted.size, seconds, spread * 1000, spread <= LOCK_SPREAD)
    }

    companion object {
        const val SKIP = 2
        const val OUTLIER = .06
        const val LOCK_TAPS = 6
        const val LOCK_SPREAD = .02
        const val MAX_SECONDS = 30.0
    }
}
