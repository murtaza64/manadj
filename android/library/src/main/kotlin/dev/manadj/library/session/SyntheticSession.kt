package dev.manadj.library.session

import org.json.JSONArray
import org.json.JSONObject
import kotlin.random.Random

/**
 * Deterministic synthetic SessionDetail JSON for replay exactness tests (host and on-device): four decks over
 * [seconds] with plays, pauses, seeks, beat jumps (some before the track start), hot cues, pitch moves, bend
 * nudges, loops, mid-session loads, mixer moves, and ~1 Hz ticks carrying [tickNoise] seconds of recording jitter.
 * Recorded transport playheads are the replay reference's own positions (as a desktop records them).
 * Track ids are 1..[tracks]; every track is [trackSeconds] long at [bpm].
 */
object SyntheticSession {
    fun json(seed: Int = 7, seconds: Double = 600.0, tracks: Int = 8, trackSeconds: Double = 240.0, tickNoise: Double = .002,
             bpm: List<Double> = listOf(120.0, 125.0, 128.0, 122.0)): String {
        val rnd = Random(seed)
        val s = SessionState()
        val events = JSONArray()
        fun emit(e: JSONObject) {
            events.put(e)
            SessionLog.reduce(s, SessionLog.parse(JSONObject().put("uuid", "x").put("events", JSONArray().put(e)).toString()).events.single(), replay = true)
        }
        fun ev(t: Double, kind: String, deck: Int? = null) = JSONObject().put("t", t).put("kind", kind).apply { if (deck != null) put("channel", DECKS[deck]) }
        val trackBpm = HashMap<Int, Double>()
        fun load(t: Double, d: Int, track: Int) { trackBpm[track] = bpm[d]; emit(ev(t, "load", d).put("trackId", track).put("bpm", bpm[d])) }
        fun pos(d: Int, t: Double) = s.decks[d].playheadAt(t)
        fun transport(t: Double, d: Int, action: String, playhead: Double) = emit(ev(t, "transport", d).put("action", action).put("playhead", playhead))
        var nextTrack = 1
        for (d in 0..3) load(0.0, d, nextTrack++)
        for (d in 0..3) transport(0.0, d, "play", 0.0)
        var t = 0.0
        var nextTick = 1.0
        // Releases (bend back to 0, stab end) due later, emitted in time order with the ticks.
        val later = ArrayList<Pair<Double, (Double) -> Unit>>()
        val busy = BooleanArray(4)
        while (t < seconds) {
            val dt = .2 + rnd.nextDouble() * 3.0
            while (true) {
                val due = later.minByOrNull { it.first }
                if (nextTick <= t + dt && nextTick <= (due?.first ?: Double.POSITIVE_INFINITY)) {
                    val heads = JSONObject()
                    for (d in 0..3) if (s.decks[d].trackId != null && !s.decks[d].scratching) heads.put(DECKS[d], pos(d, nextTick) + (rnd.nextDouble() * 2 - 1) * tickNoise)
                    emit(ev(nextTick, "tick").put("playheads", heads))
                    nextTick += 1.0
                } else if (due != null && due.first <= t + dt) {
                    later.remove(due); due.second(due.first)
                } else break
            }
            t += dt
            if (t >= seconds) break
            // Keep every playing deck inside its track (the engine stops at the end; the reference does not).
            for (k in 0..3) if (!busy[k] && s.decks[k].sounding && s.decks[k].loop == null && pos(k, t) > trackSeconds - 15)
                transport(t, k, "seek", rnd.nextDouble() * (trackSeconds / 2))
            val d = rnd.nextInt(4)
            if (busy[d]) continue
            val deck = s.decks[d]
            val beat = 60.0 / (deck.bpm ?: 120.0)
            val p = pos(d, t)
            when (rnd.nextInt(14)) {
                0 -> transport(t, d, if (deck.playing) "pause" else "play", p)
                1 -> transport(t, d, "seek", rnd.nextDouble() * (trackSeconds - 30))
                2, 3 -> {
                    val n = listOf(-16, -4, -1, 1, 4, 16, 32)[rnd.nextInt(7)]
                    transport(t, d, "jumpBeats", if (p + n * beat > trackSeconds - 20) p - 16 * beat else p + n * beat)
                }
                4 -> transport(t, d, "hotCue", minOf(trackSeconds - 30, 8 * beat * (1 + rnd.nextInt(8))))
                5 -> emit(ev(t, "pitch", d).put("value", listOf(0.0, 1.5, -2.25, 3.7, -4.0, 6.25)[rnd.nextInt(6)]))
                6 -> {
                    emit(ev(t, "bend", d).put("value", listOf(-4.0, -1.0, 1.0, 4.0)[rnd.nextInt(4)])); busy[d] = true
                    later += t + .1 + rnd.nextDouble() * 1.5 to { at -> emit(ev(at, "bend", d).put("value", 0.0)); busy[d] = false }
                }
                7 -> if (deck.loop == null) {
                    val len = beat * listOf(1, 2, 4, 8)[rnd.nextInt(4)]
                    emit(ev(t, "loop", d).put("playhead", p).put("region", JSONObject().put("start", p).put("end", p + len)))
                } else emit(ev(t, "loop", d).put("playhead", p).put("region", JSONObject.NULL))
                8 -> if (!deck.playing && nextTrack <= tracks) load(t, d, nextTrack++) else transport(t, d, "cue", 0.0)
                9 -> emit(ev(t, "control", d).put("control", "fader").put("value", rnd.nextDouble()))
                10 -> emit(ev(t, "control", null).put("control", "crossfader").put("value", rnd.nextDouble() * 2 - 1))
                11 -> emit(ev(t, "control", d).put("control", "eqLow").put("value", rnd.nextDouble()))
                12 -> if (!deck.playing) {
                    transport(t, d, "previewStart", p); busy[d] = true
                    later += t + .1 + rnd.nextDouble() * .5 to { at -> transport(at, d, "previewEnd", pos(d, at)); busy[d] = false }
                }
                else -> if (!deck.playing) transport(t, d, "play", p)
            }
        }
        return JSONObject().put("uuid", "synthetic-$seed").put("started_at", "2026-01-01T00:00:00Z").put("events", events).toString()
    }

    /** Two beatmatched decks (A 120 BPM at 0 %, B 125 BPM at -4 %) playing [seconds] with ticks, group tempo moves on both. */
    fun beatmatched(seconds: Double = 600.0): String {
        val events = JSONArray()
        fun ev(t: Double, kind: String, deck: Int?) = JSONObject().put("t", t).put("kind", kind).apply { if (deck != null) put("channel", DECKS[deck]) }
        events.put(ev(0.0, "load", 0).put("trackId", 1).put("bpm", 120.0))
        events.put(ev(0.0, "load", 1).put("trackId", 2).put("bpm", 125.0))
        events.put(ev(0.0, "pitch", 1).put("value", -4.0))
        events.put(ev(0.0, "loop", 0).put("playhead", 1.0).put("region", JSONObject().put("start", 1.0).put("end", 5.0)))
        events.put(ev(0.0, "loop", 1).put("playhead", .96).put("region", JSONObject().put("start", .96).put("end", 4.8)))
        events.put(ev(0.0, "transport", 0).put("action", "play").put("playhead", 1.0))
        events.put(ev(0.0, "transport", 1).put("action", "play").put("playhead", .96))
        val group = listOf(3.3, -2.7, 6.1, .4, -5.9, 1.7)
        var t = 0.0
        for ((k, g) in group.withIndex()) {
            t = (k + 1) * seconds / (group.size + 1)
            events.put(ev(t, "pitch", 0).put("value", g))
            events.put(ev(t, "pitch", 1).put("value", (120 * (1 + g / 100) / 125 - 1) * 100))
        }
        events.put(ev(seconds, "tick", null).put("playheads", JSONObject()))
        return JSONObject().put("uuid", "beatmatched").put("events", events).toString()
    }
}
