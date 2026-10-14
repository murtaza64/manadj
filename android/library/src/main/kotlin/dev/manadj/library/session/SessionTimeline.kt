package dev.manadj.library.session

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * What the Session timeline draws (desktop deriveTimeline, sessions/timelineModel.ts), derived from the
 * replay reference so the picture is exactly what replay sounds: per deck the constant-rate [runs] mapping
 * Session time to track time (the waveform segments), [mix] steps (audibility fill + waveform modulation),
 * gesture marks, loops, Beat FX spans and machine holds.
 */
class SessionTimeline(log: SessionLog) {
    /** Track [trackId] playing from [p0] at [rate] over Session time [t0, t1). */
    data class Run(val t0: Double, val t1: Double, val p0: Double, val rate: Double, val trackId: Int) {
        fun at(t: Double) = p0 + (t - t0) * rate
        val p1 get() = at(t1)
    }

    /**
     * Mixer state from [t]: [gain] = Master gain when audible, else 0 (desktop gainSteps: fill height gain/0.5);
     * [level] fader²·trim relative to unity trim, capped at 2, and the EQ band gains: the waveform modulation.
     */
    data class Mix(val t: Double, val audible: Boolean, val gain: Double, val level: Double, val low: Double, val mid: Double, val high: Double)

    /** A transport gesture mark (desktop labels: ◆slot hot cue, ↷N/↶N beat jump, ▲ cue, ↕ seek). */
    data class Gesture(val t: Double, val deck: Int, val action: String, val label: String)
    data class LoopMark(val deck: Int, val t0: Double, val t1: Double, val start: Double, val end: Double)
    /** One Beat FX envelope step on [deck] (null = master), desktop effect id. */
    data class Fx(val deck: Int?, val effect: String, val t0: Double, val t1: Double, val depth: Double, val beats: Double)
    /** A machine held the shared surface (tenure). */
    data class Hold(val holder: String, val t0: Double, val t1: Double)

    val start = log.start
    val end = log.end
    val runs: List<List<Run>>
    val mix: List<List<Mix>>
    val gestures: List<Gesture>
    val loops: List<LoopMark>
    val fx: List<Fx>
    val holds: List<Hold>

    init {
        val runs = List(4) { ArrayList<Run>() }
        val mix = List(4) { ArrayList<Mix>() }
        val gestures = ArrayList<Gesture>()
        val loops = ArrayList<LoopMark>()
        val fx = ArrayList<Fx>()
        val holds = ArrayList<Hold>()
        val s = SessionState()
        val loopOpen = arrayOfNulls<Pair<Double, LoopSpan>>(4)
        var fxOpen = emptyMap<Int?, Fx>()
        var holdOpen: Pair<String, Double>? = null

        fun add(d: Int, t0: Double, t1: Double, p0: Double, rate: Double, track: Int) {
            if (t1 <= t0) return
            val list = runs[d]
            val last = list.lastOrNull()
            if (last != null && last.trackId == track && abs(last.rate - rate) < 1e-12 && abs(last.t1 - t0) < 1e-9 && abs(last.at(t0) - p0) < 1e-6) list[list.size - 1] = last.copy(t1 = t1)
            else list += Run(t0, t1, p0, rate, track)
        }
        fun emit(d: Int, a: Double, b: Double) {
            val deck = s.decks[d]
            val track = deck.trackId ?: return
            if (!deck.sounding || deck.scratching) return
            val rate = deck.rate
            var p = deck.playheadAt(a)
            val l = deck.loop
            if (rate <= 0 || l == null || deck.playhead < l.start || deck.playhead >= l.end) return add(d, a, b, p, max(rate, 0.0), track)
            var t = a
            while (t < b) {
                val wrap = t + (l.end - p) / rate
                if (wrap >= b || wrap <= t) { add(d, t, b, p, rate, track); break }
                add(d, t, wrap, p, rate, track)
                t = wrap; p = l.start
            }
        }
        fun mixOf(d: Int): Mix {
            val deck = s.decks[d]
            val audible = s.audible(d)
            val trim = trimGain(deck.trim)
            val fader = deck.fader.coerceIn(0.0, 1.0).pow(2)
            return Mix(0.0, audible, if (audible) trim * fader * s.crossfaderGain(d) else 0.0, min(2.0, fader * trim / trimGain(.5)),
                eqGain(deck.low), eqGain(deck.mid), eqGain(deck.high))
        }
        fun fxState(t: Double): Map<Int?, Fx> {
            val sec = s.beatFx ?: return emptyMap()
            val effect = sec.selected ?: return emptyMap()
            val out = HashMap<Int?, Fx>()
            if (sec.on) DECKS.indexOf(sec.target).let { if (it >= 0) out[it] = Fx(it, effect, t, t, sec.depth, sec.beats) else if (sec.target == "master") out[null] = Fx(null, effect, t, t, sec.depth, sec.beats) }
            for (h in sec.held) out.getOrPut(h) { Fx(h, effect, t, t, sec.depth, sec.beats) }
            return out
        }

        var prev = log.start
        for (d in 0..3) mix[d] += mixOf(d).copy(t = prev)
        for (e in log.replayEvents) {
            if (e.t > prev) { for (d in 0..3) emit(d, prev, e.t); prev = e.t }
            if (e is CaptureEvent.Transport && e.action in GESTURES) {
                val deck = s.decks[e.deck]
                val before = deck.playheadAt(e.t)
                val label = when (e.action) {
                    "hotCue" -> "◆" + (e.detail?.let { "%.0f".format(it) } ?: "")
                    "jumpBeats" -> (e.detail ?: 0.0).let { b -> (if (b < 0) "↶" else "↷") + fmtBeats(abs(b)) }
                    "cue" -> "▲"
                    else -> "↕"
                }
                // A seek landing within 2 s of where the deck already was is a jog, not a gesture (desktop).
                val jog = e.action == "seek" && abs(e.playhead - before) <= JOG_SECONDS
                if (!jog && deck.trackId != null) gestures += Gesture(e.t, e.deck, e.action, label)
            }
            if (e is CaptureEvent.Transport && e.action == "previewStart" && e.detail == null && s.decks[e.deck].trackId != null) gestures += Gesture(e.t, e.deck, "cue", "▲")
            SessionLog.reduce(s, e, replay = true)
            for (d in 0..3) {
                val m = mixOf(d)
                val last = mix[d].last()
                if (m.copy(t = last.t) != last) mix[d] += m.copy(t = e.t)
                val region = s.decks[d].loop
                val open = loopOpen[d]
                if (open?.second != region) {
                    if (open != null) loops += LoopMark(d, open.first, e.t, open.second.start, open.second.end)
                    loopOpen[d] = region?.let { e.t to it }
                }
            }
            if (e is CaptureEvent.BeatFx) {
                val next = fxState(e.t)
                for ((k, f) in fxOpen) {
                    val n = next[k]
                    if (n == null || n.effect != f.effect || n.depth != f.depth || n.beats != f.beats) fx += f.copy(t1 = e.t)
                }
                fxOpen = next.mapValues { (k, n) -> fxOpen[k]?.takeIf { it.effect == n.effect && it.depth == n.depth && it.beats == n.beats } ?: n }
            }
            if (e is CaptureEvent.Tenure) {
                holdOpen?.let { (h, t0) -> holds += Hold(h, t0, e.t) }
                holdOpen = if (e.start) e.holder to e.t else null
            }
        }
        for (d in 0..3) loopOpen[d]?.let { (t0, r) -> loops += LoopMark(d, t0, log.end, r.start, r.end) }
        for (f in fxOpen.values) fx += f.copy(t1 = log.end)
        holdOpen?.let { (h, t0) -> holds += Hold(h, t0, log.end) }
        this.runs = runs; this.mix = mix; this.gestures = gestures; this.loops = loops
        this.fx = fx.filter { it.t1 > it.t0 }.sortedBy { it.t0 }; this.holds = holds
    }

    /** Where the last audio stops (end of the last run on any deck; the log end when nothing played). */
    val activeEnd: Double = runs.mapNotNull { it.lastOrNull()?.t1 }.maxOrNull() ?: end

    /** Session time the occurrence's audio actually ran (first to last run on its deck within the load), or null if it never played. */
    fun playedSpan(a: Appearance): Pair<Double, Double>? {
        val list = runs[a.deck]
        var i = runIndex(a.deck, a.start)
        var first: Double? = null; var last = a.start
        while (i < list.size && list[i].t0 < a.end) { if (list[i].trackId == a.trackId) { if (first == null) first = maxOf(list[i].t0, a.start); last = minOf(list[i].t1, a.end) }; i++ }
        return first?.let { it to last }
    }

    /** The run covering [t] on [deck] (null = no audio playing there). */
    fun runAt(deck: Int, t: Double): Run? {
        val list = runs[deck]
        var lo = 0; var hi = list.size
        while (lo < hi) { val m = (lo + hi) ushr 1; if (list[m].t1 <= t) lo = m + 1 else hi = m }
        return list.getOrNull(lo)?.takeIf { it.t0 <= t }
    }

    /** Index of the first run on [deck] ending after [t]. */
    fun runIndex(deck: Int, t: Double): Int {
        val list = runs[deck]
        var lo = 0; var hi = list.size
        while (lo < hi) { val m = (lo + hi) ushr 1; if (list[m].t1 <= t) lo = m + 1 else hi = m }
        return lo
    }

    fun mixAt(deck: Int, t: Double): Mix {
        val list = mix[deck]
        var lo = 0; var hi = list.size
        while (lo < hi) { val m = (lo + hi) ushr 1; if (list[m].t <= t) lo = m + 1 else hi = m }
        return list[max(0, lo - 1)]
    }

    companion object {
        private val GESTURES = setOf("seek", "jumpBeats", "hotCue", "cue")
        const val JOG_SECONDS = 2.0
        fun trimGain(v: Double) = 10.0.pow((-6 + (v.coerceIn(0.0, 1.0) - .5) * 24) / 20)
        /** Desktop eqValueToGain: +6 dB at the top, linear to a kill below centre. */
        fun eqGain(v: Double) = if (v >= .5) 10.0.pow((v - .5) * 12 / 20) else (v / .5).coerceAtLeast(0.0)
        private fun fmtBeats(b: Double) = if (b == floor(b)) "%.0f".format(b) else when (b) { .5 -> "½"; .25 -> "¼"; else -> "%.2g".format(b) }
    }
}

/** Timeline layout rules shared with the desktop (labelStagger.ts, followScroll.ts, ruler). */
object TimelineLayout {
    /**
     * Desktop staggerRows: items sorted by x0 take the first row whose last item ended at or before x0;
     * when all [maxRows] are taken, the row that frees up first.
     */
    fun staggerRows(spans: List<Pair<Float, Float>>, maxRows: Int): IntArray {
        val lastEnd = FloatArray(max(1, maxRows)) { Float.NEGATIVE_INFINITY }
        return IntArray(spans.size) { i ->
            val (x0, x1) = spans[i]
            var r = lastEnd.indexOfFirst { it <= x0 }
            if (r < 0) r = lastEnd.indices.minBy { lastEnd[it] }
            lastEnd[r] = x1
            r
        }
    }

    private val STEPS = doubleArrayOf(1.0, 2.0, 5.0, 10.0, 15.0, 30.0, 60.0, 120.0, 300.0, 600.0, 1200.0)
    /** Ruler tick spacing (s) for [visibleSeconds] across [widthPx] at ~[minGapPx] per label. */
    fun rulerStep(visibleSeconds: Double, widthPx: Float, minGapPx: Float = 110f): Double {
        val target = max(2, (widthPx / minGapPx).toInt())
        return STEPS.firstOrNull { it >= visibleSeconds / target } ?: 1800.0
    }

    /**
     * Desktop followScroll in time: once the playhead passes 80 % of the window, the window advances so it
     * stays there; never scrolls backwards. Returns the new view start.
     */
    fun follow(viewStart: Double, viewWidth: Double, head: Double, maxStart: Double, zone: Double = .8): Double {
        if (head <= viewStart + zone * viewWidth || viewStart >= maxStart) return viewStart
        return min(maxStart, head - zone * viewWidth).coerceAtLeast(viewStart)
    }
}
