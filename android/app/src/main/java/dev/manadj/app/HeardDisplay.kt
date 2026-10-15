package dev.manadj.app

import kotlin.math.max

/**
 * Detail-wave playhead in heard time (#137/#138): "hold still until I hear it".
 *
 * - Launch: the position never shows before the launch point X — it holds at X until the delayed (heard) position
 *   passes it, then moves with the audio. The smoothing clock is frozen during the hold (it would otherwise
 *   extrapolate past X and later step back).
 * - Stop: the heard tail keeps running for the remaining output latency, then the playhead shows the engine
 *   position (a CUE release's return to X is the one discontinuity; a pause lands where the tail ends).
 *
 * Same rule whether or not another deck is audible; display only.
 */
class HeardDisplay {
    private val clock = SmoothClock()
    private var wasMoving = false
    private var floor = Double.NaN
    private var launchNanos = 0L
    private var lastShown = Double.NaN
    private var lastRate = 1.0
    private var tailFrom = 0L
    private var tailHoldUntil = 0L
    private var tailUntil = 0L
    private var tailPos = 0.0

    /** True while a stop's heard tail is still being drawn (keep redrawing). */
    fun inTail(now: Long) = !wasMoving && now < tailUntil

    /**
     * [raw] = heard position (engine minus total output latency, at speed), only evaluated while [moving];
     * [engine] = the engine's own position; [latencySeconds] = total output latency the display backs off.
     */
    fun at(now: Long, moving: Boolean, raw: () -> Double, engine: Double, rate: Double, latencySeconds: Double): Double {
        if (moving) {
            if (!wasMoving) { floor = engine; launchNanos = now; tailUntil = 0L }
            wasMoving = true; lastRate = rate
            val r = raw()
            if (!floor.isNaN()) {
                if (r < floor && rate > 0) return clock.at(now, floor, false, rate).also { lastShown = it }
                floor = Double.NaN
            }
            return clock.at(now, r, true, rate).also { lastShown = it }
        }
        if (wasMoving) {
            wasMoving = false
            tailFrom = now; tailPos = lastShown
            // Still holding at X (stab shorter than the latency): the tail starts moving once the launch is heard.
            tailHoldUntil = if (floor.isNaN()) now else max(now, launchNanos + (max(0.0, latencySeconds) * 1e9).toLong())
            tailUntil = if (lastShown.isNaN()) 0L else now + (max(0.0, latencySeconds) * 1e9).toLong()
        }
        floor = Double.NaN
        if (now < tailUntil) {
            val p = tailPos + max(0L, now - max(tailFrom, tailHoldUntil)) / 1e9 * lastRate
            return clock.at(now, p, false, lastRate).also { lastShown = it }
        }
        return clock.at(now, engine, false, rate).also { lastShown = it }
    }
}
