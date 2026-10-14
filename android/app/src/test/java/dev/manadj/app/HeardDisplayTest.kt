package dev.manadj.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.max

/** #137/#138: both decks paused, QH on, CUE stabs — hold at X until heard, then ≤1 step per stab (the return to X). */
class HeardDisplayTest {
    private val frame = 8_333_333L // 120 Hz
    private val x = 42.0

    /** Engine model: render position starts at X on press; audibleSeconds clamps at the launch until the reported latency passes. */
    private fun stabs(reported: Double, heard: Double, rate: Double, durations: List<Double>) {
        val d = HeardDisplay()
        val extra = heard - reported
        var t = 1_000_000_000L
        val shown = ArrayList<Pair<Long, Double>>()
        fun step(moving: Boolean, raw: () -> Double, engine: Double) { shown += t to d.at(t, moving, raw, engine, rate, heard); t += frame }
        repeat(30) { step(false, { x }, x) }
        for (dur in durations) {
            shown.clear()
            val t0 = t
            val pressN = (dur * 1e9 / frame).toInt().coerceAtLeast(1)
            repeat(pressN) {
                val el = (t - t0) / 1e9
                step(true, { x + max(0.0, el - reported) * rate - extra * rate }, x + el * rate)
            }
            val tRel = t
            val gapN = ((heard + .4) * 1e9 / frame).toInt()
            repeat(gapN) { step(false, { x }, x) }
            assertTrue(!d.inTail(t))
            // Never before X; hold at X for ≈L after launch.
            assertTrue(shown.all { it.second >= x - 1e-9 })
            val firstMove = shown.firstOrNull { it.second > x + 1e-6 }
            if (firstMove != null) assertEquals(heard, (firstMove.first - t0) / 1e9, .02)
            // Discontinuities: any backward move, or a forward move > 5 ms of track time beyond one frame of motion.
            val steps = shown.zipWithNext().filter { (a, b) ->
                val dv = b.second - a.second
                dv < -1e-6 || dv > (b.first - a.first) / 1e9 * rate + .005
            }
            assertTrue("stab $dur: ${steps.size} steps", steps.size <= 1)
            steps.firstOrNull()?.let { (_, b) ->
                assertEquals(x, b.second, 1e-9) // the return to X
                assertEquals(heard, (b.first - tRel) / 1e9, .02) // after the heard tail
            }
            assertEquals(x, shown.last().second, 1e-9)
        }
    }

    private val twenty = List(20) { listOf(.03, .08, .15, .25, .4, .6, 1.0, 2.0)[it % 8] }

    @Test fun bluetoothLatency() = stabs(reported = .12, heard = .28, rate = 1.0, durations = twenty)
    @Test fun wiredLatency() = stabs(reported = .02, heard = .03, rate = 1.0, durations = twenty)
    @Test fun pitchedUp() = stabs(reported = .1, heard = .35, rate = 1.08, durations = twenty)

    @Test fun pauseLandsWhereTheTailEnds() {
        val d = HeardDisplay(); val l = .2; var t = 0L; val t0 = t
        var last = 0.0
        repeat(240) { val el = (t - t0) / 1e9; last = d.at(t, true, { 10 + max(0.0, el - l) }, 10 + el, 1.0, l); t += frame }
        val engine = 10 + (t - t0) / 1e9 // paused here
        var prev = last; var maxJump = 0.0
        repeat(60) { val v = d.at(t, false, { engine }, engine, 1.0, l); maxJump = max(maxJump, abs(v - prev) - frame / 1e9); prev = v; t += frame }
        assertEquals(engine, prev, 1e-9)
        assertTrue("jump $maxJump", maxJump < .01)
    }
}
