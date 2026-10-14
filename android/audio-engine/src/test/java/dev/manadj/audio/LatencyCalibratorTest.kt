package dev.manadj.audio

import kotlin.random.Random
import org.junit.Assert.*
import org.junit.Test

class LatencyCalibratorTest {
    private val rate = 48000
    private val stampFrame = 24000L
    private val stampNanos = 5_000_000_000L

    /** Mic capture of clicks rendered at [renders] (ns) arriving [latency] s later, attenuated, in noise (+ an echo). */
    private fun mic(renders: List<Long>, latency: Double, gain: Double = .05, noise: Double = .01, echo: Double = 0.0): FloatArray {
        val x = FloatArray(rate * 7)
        val random = Random(7)
        for (i in x.indices) x[i] = ((random.nextDouble() * 2 - 1) * noise).toFloat()
        val n = (CalibrationClick.SECONDS * rate).toInt()
        for (render in renders) for ((delay, g) in listOf(latency to gain, latency + .013 to gain * echo)) {
            val arrival = render + (delay * 1e9).toLong()
            val start = stampFrame + (arrival - stampNanos) * rate / 1e9
            val i0 = kotlin.math.ceil(start).toInt()
            for (i in 0 until n + 1) {
                val t = (i0 + i - start) / rate
                if (i0 + i in x.indices) x[i0 + i] += (g * CalibrationClick.sample(t)).toFloat()
            }
        }
        return x
    }

    private val renders = List(6) { stampNanos - 400_000_000L + it * 800_000_000L }

    @Test fun findsBluetoothSizedLatencyWithinAMillisecond() {
        val r = LatencyCalibrator.analyze(mic(renders, .287, echo = .6), rate, stampFrame, stampNanos, renders.toLongArray(), .76)
        assertNull(r.reason)
        assertEquals(.287, r.seconds!!, .001)
        assertEquals(6, r.samples.size)
    }

    @Test fun tapAlongLocksInAndResolvesTheWrap() {
        val period = LatencyCalibrator.TAP_PERIOD
        val clicks = LongArray(60) { 1_000_000_000L + (it * period * 1e9).toLong() }
        val random = Random(3)
        for (latency in listOf(.2, .4, .7, 1.0, 1.2)) {
            // Coarse estimates within ±period/2: Oboe under-reporting Bluetooth or a reaction pre-pass.
            val tap = TapCalibrator(coarseSeconds = latency + (random.nextDouble() - .5) * .4)
            var state = tap.state
            for (k in 0 until 40) {
                val jitter = (random.nextDouble() - .5) * .024
                val outlier = if (k == 5 || k == 11) .2 else 0.0   // a few bad taps never fail the run
                state = tap.add(clicks[k] + ((latency + jitter + outlier) * 1e9).toLong(), clicks)
                if (state.locked) break
            }
            assertTrue("latency $latency: $state", state.locked)
            assertEquals("latency $latency", latency, state.candidateSeconds!!, .01)
        }
    }

    @Test fun tapAlongIgnoresTheFirstTwoTapsAndDoesNotLockWhenSloppy() {
        val period = LatencyCalibrator.TAP_PERIOD
        val clicks = LongArray(40) { 1_000_000_000L + (it * period * 1e9).toLong() }
        val tap = TapCalibrator(.3)
        tap.add(clicks[0] + 100_000_000L, clicks); tap.add(clicks[1] + 400_000_000L, clicks)
        assertEquals(0, tap.state.accepted)
        var state = tap.state
        for (k in 2 until 30) state = tap.add(clicks[k] + ((.3 + (k % 3 - 1) * .035) * 1e9).toLong(), clicks)
        assertFalse(state.locked)                              // ±35 ms scatter: meter shows, never locks
        assertNotNull(state.spreadMillis)
    }

    @Test fun reactionPrePassGivesACoarseEstimate() {
        val clicks = LongArray(4) { 1_000_000_000L + (it * LatencyCalibrator.REACTION_PERIOD * 1e9).toLong() }
        val taps = clicks.map { it + ((.45 + .18) * 1e9).toLong() }
        assertEquals(.45, LatencyCalibrator.reactionCoarse(taps, clicks)!!, .001)
        assertNull(LatencyCalibrator.reactionCoarse(taps.take(2), clicks))
    }

    @Test fun quietClicksUnderNoiseStillFound() {
        // Clicks at the noise floor's level (a speaker across a room with fans/music): the 12 ms chirp's gain does it.
        val r = LatencyCalibrator.analyze(mic(renders, .24, gain = .02, noise = .02), rate, stampFrame, stampNanos, renders.toLongArray(), .76)
        assertNull(r.toString(), r.reason)
        assertEquals(.24, r.seconds!!, .001)
        assertTrue(r.snr.all { it > LatencyCalibrator.MIN_SNR })
    }

    @Test fun shortWiredLatency() {
        val r = LatencyCalibrator.analyze(mic(renders, .021), rate, stampFrame, stampNanos, renders.toLongArray(), .76)
        assertNull(r.toString(), r.reason)
        assertEquals(.021, r.seconds!!, .001)
    }

    @Test fun refusesWhenClicksAreInaudible() {
        val r = LatencyCalibrator.analyze(mic(renders, .2, gain = .0005, noise = .05), rate, stampFrame, stampNanos, renders.toLongArray(), .76)
        assertNull(r.seconds)
        assertNotNull(r.reason)
    }

    @Test fun ignoresClicksNotYetRendered() {
        val withMissing = (renders.take(4) + listOf(0L, 0L)).toLongArray()
        val r = LatencyCalibrator.analyze(mic(renders.take(4), .15), rate, stampFrame, stampNanos, withMissing, .76)
        assertEquals(.15, r.seconds!!, .001)
        assertEquals(4, r.samples.size)
    }
}
