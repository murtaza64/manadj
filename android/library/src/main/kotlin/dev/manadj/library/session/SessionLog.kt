package dev.manadj.library.session

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.pow

/** Physical decks A–D (desktop CaptureDeck), indexed 0..3. */
val DECKS = listOf("A", "B", "C", "D")

/** Beat FX section snapshot (desktop BeatFxSectionState); effect/target are desktop ids. */
data class BeatFxSection(val selected: String?, val target: String, val on: Boolean, val depth: Double, val beats: Double, val held: Set<Int>)

/** Desktop capture-event vocabulary (frontend/src/capture/events.ts), typed. [deck] is 0..3. */
sealed interface CaptureEvent {
    val t: Double
    data class Load(override val t: Double, val deck: Int, val trackId: Int?, val bpm: Double?) : CaptureEvent
    data class Transport(override val t: Double, val deck: Int, val action: String, val playhead: Double) : CaptureEvent
    data class Pitch(override val t: Double, val deck: Int, val value: Double) : CaptureEvent
    data class Bend(override val t: Double, val deck: Int, val value: Double) : CaptureEvent
    data class Loop(override val t: Double, val deck: Int, val playhead: Double, val region: LoopSpan?) : CaptureEvent
    data class Tick(override val t: Double, val playheads: Map<Int, Double>) : CaptureEvent
    data class Control(override val t: Double, val deck: Int?, val control: String, val value: Double) : CaptureEvent
    data class Tenure(override val t: Double, val start: Boolean, val holder: String) : CaptureEvent
    data class BeatFx(override val t: Double, val section: BeatFxSection) : CaptureEvent
    /** Evidence replay does not act on (beatFxSettings, init, unknown kinds). */
    data class Other(override val t: Double, val kind: String) : CaptureEvent
}

data class LoopSpan(val start: Double, val end: Double)

/** One deck in a reconstructed instant (desktop StateAtT deck). */
data class DeckState(
    var trackId: Int? = null, var bpm: Double? = null,
    var playing: Boolean = false, var previewing: Boolean = false, var scratching: Boolean = false,
    var playhead: Double = 0.0, var playheadAt: Double = 0.0, var pitch: Double = 0.0,
    var loop: LoopSpan? = null,
    var fader: Double = 1.0, var trim: Double = .5, var low: Double = .5, var mid: Double = .5, var high: Double = .5,
    var filter: Double = 0.0,
    /** Crossfader side: -1 left, 0 thru, +1 right (desktop default A/C left, B/D right). */
    var assignment: Int = 0,
    var stems: Int = 0b1111,
) {
    val sounding get() = playing || previewing
    /** Desktop deckPlayheadAt: pitch-aware extrapolation, folded into an entered loop. Scratch is held. */
    fun playheadAt(t: Double): Double {
        val dt = max(0.0, t - playheadAt)
        val p = playhead + if (sounding && !scratching) dt * (1 + pitch / 100) else 0.0
        val l = loop
        return if (l != null && playhead >= l.start && playhead < l.end && p >= l.end) l.start + (p - l.start) % (l.end - l.start) else p
    }
}

/** Reconstructed Session state at one instant (desktop stateAt). Mutable only while reducing. */
class SessionState(
    val decks: List<DeckState> = List(4) { DeckState(assignment = if (it % 2 == 0) -1 else 1) },
    var crossfader: Double = 0.0, var crossfaderEnabled: Boolean = true, var tenure: String? = null,
    var beatFx: BeatFxSection? = null,
) {
    fun copy() = SessionState(decks.map { it.copy() }, crossfader, crossfaderEnabled, tenure, beatFx)

    /** Desktop channelCrossfaderGain (left: 1-x, right: 1+x, thru: 1, clamped). */
    fun crossfaderGain(deck: Int): Double {
        val x = if (crossfaderEnabled) crossfader.coerceIn(-1.0, 1.0) else 0.0
        return when (decks[deck].assignment) { 0 -> 1.0; -1 -> (1 - x).coerceIn(0.0, 1.0); else -> (1 + x).coerceIn(0.0, 1.0) }
    }

    /** Desktop sessionDeckAudible (FX tails not modelled): tenure, transport/preview, EQ/filter kills, Master gain. */
    fun audible(deck: Int): Boolean {
        if (tenure != null && tenure != "shared") return false
        val d = decks[deck]
        if (d.trackId == null || !d.sounding) return false
        if (d.low <= EQ_KILL && d.mid <= EQ_KILL && d.high <= EQ_KILL) return false
        if (abs(d.filter) >= FILTER_KILL) return false
        val trim = 10.0.pow((-6 + (d.trim.coerceIn(0.0, 1.0) - .5) * 24) / 20)
        return trim * d.fader.coerceIn(0.0, 1.0).pow(2) * crossfaderGain(deck) >= AUDIBLE_GAIN
    }

    companion object {
        const val AUDIBLE_GAIN = .05
        const val EQ_KILL = .05
        const val FILTER_KILL = .97
    }
}

/** A deck occupancy in the Session (one per Load; not unique tracks, not a Set). */
data class Appearance(val deck: Int, val trackId: Int, val start: Double, val end: Double, val firstSound: Double?)

/** Something in the log replay cannot reproduce; shown, never silently dropped. */
data class ReplayIssue(val t: Double, val deck: Int?, val what: String)

/**
 * A desktop Session's capture-event log (SessionDetail) with the desktop reducer ported:
 * [at] reconstructs every deck and the mixer at any instant (parity with `stateAt`).
 */
class SessionLog(
    val uuid: String, val startedAt: String?, val endedAt: String?, val events: List<CaptureEvent>, val issues: List<ReplayIssue>,
) {
    val start: Double = events.firstOrNull()?.t ?: 0.0
    val end: Double = events.lastOrNull()?.t ?: 0.0
    val duration get() = end - start
    private val times = DoubleArray(events.size) { events[it].t }
    /** State after events[0 until k * STRIDE]. */
    private val checkpoints: List<SessionState>
    val appearances: List<Appearance>
    /** Where the performance starts: the first recorded sound (minus a lead-in). Logs can carry hours of idle ticks before it. */
    val activeStart: Double

    init {
        val s = SessionState()
        val cps = ArrayList<SessionState>(events.size / STRIDE + 1)
        val out = ArrayList<Appearance>()
        val open = arrayOfNulls<IntArray>(4) // index into out, per deck
        val firstSound = HashMap<Int, Double>()
        events.forEachIndexed { i, e ->
            if (i % STRIDE == 0) cps.add(s.copy())
            reduce(s, e)
            if (e is CaptureEvent.Load) {
                open[e.deck]?.let { (k) -> out[k] = out[k].copy(end = e.t) }
                open[e.deck] = null
                if (e.trackId != null) { open[e.deck] = intArrayOf(out.size); out.add(Appearance(e.deck, e.trackId, e.t, end, null)) }
            }
            for (d in 0..3) open[d]?.let { (k) -> if (k !in firstSound && s.audible(d)) firstSound[k] = e.t }
        }
        checkpoints = cps
        appearances = out.mapIndexed { k, a -> a.copy(firstSound = firstSound[k]) }
        activeStart = appearances.mapNotNull { it.firstSound }.minOrNull()?.let { max(start, it - LEAD_IN) } ?: start
    }

    /** Index of the first event after [t] (events at exactly [t] count as before, like stateAt). */
    fun indexAfter(t: Double): Int {
        var lo = 0; var hi = times.size
        while (lo < hi) { val mid = (lo + hi) ushr 1; if (times[mid] <= t) lo = mid + 1 else hi = mid }
        return lo
    }

    /** Desktop stateAt: every event at or before [t] applied, playheads extrapolated to [t]. */
    fun at(t: Double): SessionState {
        val n = indexAfter(t)
        val k = n / STRIDE
        val s = if (checkpoints.isEmpty()) SessionState() else checkpoints[minOf(k, checkpoints.size - 1)].copy()
        for (i in minOf(k, checkpoints.size - 1).coerceAtLeast(0) * STRIDE until n) reduce(s, events[i])
        for (d in s.decks) { d.playhead = max(0.0, d.playheadAt(t)); d.playheadAt = t }
        return s
    }

    companion object {
        private const val STRIDE = 32
        const val LEAD_IN = 2.0

        private val CONTROLS = setOf("trim", "eqLow", "eqMid", "eqHigh", "filter", "fader", "pfl", "slipMode", "vinylMode",
            "crossfaderAssignment", "crossfader", "crossfaderEnabled", "master", "stemVocals", "stemDrums", "stemBass", "stemOther")
        private val TRANSPORT = setOf("play", "pause", "seek", "jumpBeats", "hotCue", "cue", "previewStart", "previewEnd",
            "scratchBegin", "scratchMove", "scratchEnd")
        private val STEMS = listOf("stemVocals", "stemDrums", "stemBass", "stemOther")

        /** Desktop applyEvent (audibilityReducer.ts) minus scratch motion and FX tails. */
        fun reduce(s: SessionState, e: CaptureEvent) {
            when (e) {
                is CaptureEvent.Load -> s.decks[e.deck].apply {
                    trackId = e.trackId; bpm = e.bpm; previewing = false; scratching = false; loop = null; playhead = 0.0; playheadAt = e.t
                }
                is CaptureEvent.Transport -> s.decks[e.deck].apply {
                    when (e.action) {
                        "play" -> playing = true
                        "pause", "cue" -> playing = false
                        "previewStart" -> previewing = true
                        "previewEnd" -> previewing = false
                        "scratchBegin" -> scratching = true
                        "scratchEnd" -> scratching = false
                    }
                    playhead = e.playhead; playheadAt = e.t
                }
                is CaptureEvent.Pitch -> s.decks[e.deck].apply { playhead = playheadAt(e.t); playheadAt = e.t; pitch = e.value }
                is CaptureEvent.Loop -> s.decks[e.deck].apply { loop = e.region; playhead = e.playhead; playheadAt = e.t }
                is CaptureEvent.Tick -> e.playheads.forEach { (d, p) -> s.decks[d].apply { if (!scratching) { playhead = p; playheadAt = e.t } } }
                is CaptureEvent.Tenure -> s.tenure = if (e.start) e.holder else null
                is CaptureEvent.BeatFx -> s.beatFx = e.section
                is CaptureEvent.Control -> {
                    val d = e.deck?.let(s.decks::get)
                    val v = e.value
                    when (e.control) {
                        "crossfader" -> s.crossfader = v
                        "crossfaderEnabled" -> s.crossfaderEnabled = v != 0.0
                        "fader" -> d?.fader = v
                        "trim" -> d?.trim = v
                        "eqLow" -> d?.low = v
                        "eqMid" -> d?.mid = v
                        "eqHigh" -> d?.high = v
                        "filter" -> d?.filter = v
                        "crossfaderAssignment" -> d?.assignment = v.compareTo(0.0)
                        in STEMS -> d?.let { val bit = 1 shl STEMS.indexOf(e.control); it.stems = if (v != 0.0) it.stems or bit else it.stems and bit.inv() }
                    }
                }
                is CaptureEvent.Bend, is CaptureEvent.Other -> {}
            }
        }

        /**
         * Parse a desktop SessionDetail (`GET /api/device-sync/sessions/{uuid}`), streaming: Sessions run to
         * 100k+ events. Malformed structure throws; vocabulary replay cannot reproduce (scratch, Take init,
         * unknown kinds/controls, stems) is kept as [issues] rather than refusing the whole Session.
         */
        fun parse(text: String): SessionLog = parse(text.reader())

        fun parse(reader: java.io.Reader): SessionLog {
            val json = JsonStream(reader)
            var uuid: String? = null; var startedAt: String? = null; var endedAt: String? = null
            val issues = ArrayList<ReplayIssue>()
            val unknown = HashSet<String>()
            val events = ArrayList<CaptureEvent>()
            var last = Double.NEGATIVE_INFINITY
            json.obj { key ->
                when (key) {
                    "uuid" -> uuid = json.value() as? String
                    "started_at" -> startedAt = json.value() as? String
                    "ended_at" -> endedAt = json.value() as? String
                    "events" -> json.array {
                        @Suppress("UNCHECKED_CAST") val e = json.value() as? Map<String, Any?> ?: error("Event ${events.size}: not an object")
                        val event = event(e, events.size, issues, unknown)
                        require(event.t >= last) { "Event ${events.size}: capture time goes backwards" }
                        last = event.t
                        events.add(event)
                    }
                    else -> json.skip()
                }
            }
            return SessionLog(requireNotNull(uuid) { "Missing Session uuid" }, startedAt, endedAt, events, issues)
        }

        private fun event(e: Map<String, Any?>, i: Int, issues: MutableList<ReplayIssue>, unknown: MutableSet<String>): CaptureEvent {
            fun num(key: String): Double = (e[key] as? Number)?.toDouble()?.takeIf { it.isFinite() } ?: error("Event $i: missing/nonfinite $key")
            fun optNum(key: String): Double? = (e[key] as? Number)?.toDouble()?.takeIf { it.isFinite() }
            fun str(key: String): String = e[key] as? String ?: error("Event $i: missing $key")
            fun deck(): Int = DECKS.indexOf(e["channel"] as? String).also { require(it >= 0) { "Event $i: invalid deck ${e["channel"]}" } }
            val t = num("t")
            return when (val kind = str("kind")) {
                "load" -> CaptureEvent.Load(t, deck(), optNum("trackId")?.toInt(), optNum("bpm"))
                "transport" -> {
                    val action = str("action")
                    val d = deck()
                    if (action !in TRANSPORT) { issues.add(ReplayIssue(t, d, "transport $action")); CaptureEvent.Other(t, "transport:$action") }
                    else {
                        if (action == "scratchBegin") issues.add(ReplayIssue(t, d, "scratch (replayed as its landing position)"))
                        CaptureEvent.Transport(t, d, action, num("playhead"))
                    }
                }
                "pitch" -> CaptureEvent.Pitch(t, deck(), num("value"))
                "bend" -> CaptureEvent.Bend(t, deck(), num("value"))
                "loop" -> CaptureEvent.Loop(t, deck(), num("playhead"), (e["region"] as? Map<*, *>)?.let { r ->
                    val a = (r["start"] as? Number)?.toDouble(); val b = (r["end"] as? Number)?.toDouble()
                    if (a != null && b != null && a.isFinite() && b.isFinite() && b > a) LoopSpan(a, b) else null
                })
                "tick" -> CaptureEvent.Tick(t, (e["playheads"] as? Map<*, *>).orEmpty().entries.mapNotNull { (k, v) ->
                    val d = DECKS.indexOf(k as? String); val p = (v as? Number)?.toDouble()
                    if (d >= 0 && p != null && p.isFinite()) d to p else null
                }.toMap())
                "control" -> {
                    val control = str("control")
                    val d = if (e["channel"] == null) null else deck()
                    if (control !in CONTROLS) { issues.add(ReplayIssue(t, d, "control $control")); CaptureEvent.Other(t, "control:$control") }
                    else {
                        val v = num("value")
                        if (control in STEMS && v == 0.0) issues.add(ReplayIssue(t, d, "stem mute (no stems engine; played full)"))
                        CaptureEvent.Control(t, d, control, v)
                    }
                }
                "tenure" -> CaptureEvent.Tenure(t, e["edge"] == "start", e["holder"] as? String ?: "")
                "beatFx" -> CaptureEvent.BeatFx(t, BeatFxSection(
                    e["selected"] as? String, e["target"] as? String ?: "master", e["on"] == true,
                    optNum("depth") ?: -1.0, optNum("beats")?.takeIf { it > 0 } ?: 1.0,
                    (e["held"] as? List<*>).orEmpty().mapNotNull { h -> DECKS.indexOf(h as? String).takeIf { it >= 0 } }.toSet(),
                ))
                "beatFxSettings" -> CaptureEvent.Other(t, kind)
                else -> { if (unknown.add(kind)) issues.add(ReplayIssue(t, null, "unknown event kind $kind")); CaptureEvent.Other(t, kind) }
            }
        }
    }
}
