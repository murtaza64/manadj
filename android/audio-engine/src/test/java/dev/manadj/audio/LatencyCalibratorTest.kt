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

    @Test fun tapAlongRecoversLatencyWithoutBeatAmbiguity() {
        val clicks = LongArray(LatencyCalibrator.TAP_CLICKS) { 1_000_000_000L + (it * LatencyCalibrator.TAP_INTERVAL * 1e9).toLong() }
        val random = Random(3)
        for (latency in listOf(.2, .4, .7, 1.0, 1.2)) {
            val taps = clicks.drop(1).take(10).map { it + ((latency + (random.nextDouble() - .5) * .03) * 1e9).toLong() }
            // Oboe under-reports Bluetooth; only used to pick among candidates 1.5 s apart.
            val r = LatencyCalibrator.fromTaps(taps, clicks, reportedSeconds = latency * .6)
            assertNull(r.toString(), r.reason)
            assertEquals("latency $latency", latency, r.seconds!!, .01)
        }
        assertNotNull(LatencyCalibrator.fromTaps(clicks.take(5).map { it + 300_000_000L }, clicks, .3).reason)       // too few
        val sloppy = clicks.take(10).mapIndexed { i, c -> c + ((.3 + (i % 3) * .2) * 1e9).toLong() }
        assertNotNull(LatencyCalibrator.fromTaps(sloppy, clicks, .3).reason)                                          // inconsistent
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
