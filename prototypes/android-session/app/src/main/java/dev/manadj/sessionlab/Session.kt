package dev.manadj.sessionlab

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*

val DECKS = listOf("A", "B", "C", "D")

data class Track(val id: Int, val title: String, val artist: String, val bpm: Double?, val key: Int?, val duration: Double?)
data class Deck(
    var trackId: Int? = null, var bpm: Double? = null, var playing: Boolean = false,
    var preview: Boolean = false, var position: Double = 0.0, var anchor: Double = 0.0,
    var pitch: Double = 0.0, var loop: Pair<Double, Double>? = null,
    var fader: Double = 1.0, var trim: Double = .5, var low: Double = .5,
    var mid: Double = .5, var high: Double = .5, var filter: Double = 0.0,
    var assignment: Int = -1, var slip: Boolean = false, var vinyl: Boolean = true,
    var vocals: Boolean = true, var drums: Boolean = true, var bass: Boolean = true, var other: Boolean = true,
) {
    fun positionAt(t: Double): Double {
        val p = position + if (playing || preview) max(0.0, t - anchor) * (1 + pitch / 100) else 0.0
        val region = loop
        return max(0.0, if (region != null && position >= region.first && position < region.second && p >= region.second)
            region.first + (p - region.first) % (region.second - region.first) else p)
    }
}

data class Frame(
    val decks: Map<String, Deck> = DECKS.associateWith { Deck(assignment = if (it == "A" || it == "C") -1 else 1) },
    var crossfader: Double = 0.0, var crossfaderEnabled: Boolean = true, var holder: String? = null,
) {
    fun copyDeep() = copy(decks = decks.mapValues { it.value.copy() })
    fun audible(deck: String): Boolean {
        val d = decks.getValue(deck)
        val xf = if (!crossfaderEnabled || d.assignment == 0) 1.0 else (1 + crossfader * d.assignment).coerceIn(0.0, 1.0)
        val gain = d.fader.coerceIn(0.0, 1.0).pow(2) * 10.0.pow((-6 + (d.trim.coerceIn(0.0, 1.0) - .5) * 24) / 20) * xf
        return (holder == null || holder == "shared") && d.trackId != null && (d.playing || d.preview) && gain >= .05 &&
            !(d.low <= .05 && d.mid <= .05 && d.high <= .05) && abs(d.filter) < .97 && (d.vocals || d.drums || d.bass || d.other)
    }
}

data class Appearance(val deck: String, val trackId: Int, val start: Double, var end: Double, var firstSound: Double? = null)

/** Read-only port of the non-scratch desktop capture reducer. Unknown semantics fail closed. */
class Session private constructor(val uuid: String, val events: List<JSONObject>, val warnings: List<String>) {
    val start = events.first().getDouble("t")
    val end = events.last().getDouble("t")
    private val checkpoints: List<Frame>
    val appearances: List<Appearance>
    init {
        var frame = Frame()
        val entries = mutableListOf<Appearance>()
        val open = mutableMapOf<String, Appearance>()
        checkpoints = events.map { e ->
            frame = frame.copyDeep()
            apply(frame, e)
            val t = e.getDouble("t")
            if (e.getString("kind") == "load") {
                val ch = e.getString("channel")
                open.remove(ch)?.end = t
                if (!e.isNull("trackId")) {
                    val entry = Appearance(ch, e.getInt("trackId"), t, end)
                    entries.add(entry); open[ch] = entry
                }
            }
            open.forEach { (ch, entry) -> if (entry.firstSound == null && frame.audible(ch)) entry.firstSound = t }
            frame
        }
        appearances = entries
    }

    fun at(t: Double): Frame {
        val bounded = t.coerceIn(start, end)
        var lo = 0; var hi = events.size
        while (lo < hi) {
            val mid = (lo + hi) / 2
            if (events[mid].getDouble("t") <= bounded) lo = mid + 1 else hi = mid
        }
        val s = if (lo == 0) Frame() else checkpoints[lo - 1].copyDeep()
        s.decks.values.forEach { it.position = it.positionAt(bounded); it.anchor = bounded }
        return s
    }

    companion object {
        private val controls = setOf("trim", "eqLow", "eqMid", "eqHigh", "filter", "fader", "pfl", "slipMode", "vinylMode", "crossfaderAssignment", "crossfader", "crossfaderEnabled", "master", "stemVocals", "stemDrums", "stemBass", "stemOther")
        private val actions = setOf("play", "pause", "seek", "jumpBeats", "hotCue", "cue", "previewStart", "previewEnd")
        fun parse(text: String): Session {
            val root = JSONObject(text)
            // SessionDetail currently has no version field. Never guess a future version.
            require(!root.has("version") && !root.has("schema_version")) { "Versioned Session not supported; expected current unversioned SessionDetail." }
            val uuid = root.getString("uuid")
            require(uuid.isNotBlank()) { "Missing Session identity" }
            root.getString("started_at")
            require(root.has("ended_at") && root.has("take_count")) { "Expected desktop SessionDetail header" }
            val array = root.getJSONArray("events")
            require(array.length() in 1..50000) { "Expected 1–50,000 events" }
            val warnings = linkedSetOf("Silent model replay • synthetic waveforms", "Unversioned desktop SessionDetail; no audio engine")
            var last = Double.NEGATIVE_INFINITY
            val events = (0 until array.length()).map { i ->
                val e = array.getJSONObject(i)
                val t = e.getDouble("t")
                require(t.isFinite() && t >= last) { "Event $i: unordered/nonfinite capture time" }; last = t
                val kind = e.getString("kind")
                if (kind in setOf("load", "transport", "pitch", "bend", "loop")) require(e.getString("channel") in DECKS) { "Event $i: invalid physical deck" }
                fun finite(field: String) { require(e.getDouble(field).isFinite()) { "Event $i: nonfinite $field" } }
                when (kind) {
                    "load" -> { require(e.has("trackId") && e.has("bpm")); if (!e.isNull("trackId")) require(e.getInt("trackId") > 0); if (!e.isNull("bpm")) finite("bpm") }
                    "transport" -> { require(e.getString("action") in actions) { "Event $i: unsupported transport ${e.optString("action")} (scratch requires native trajectory engine)" }; finite("playhead") }
                    "pitch", "bend" -> { finite("value"); require(e.getDouble("value") > -100); if (kind == "bend") warnings.add("Bend is evidence-only, as in desktop replayPlanner") }
                    "loop" -> { finite("playhead"); require(e.has("region")); if (!e.isNull("region")) { val r = e.getJSONObject("region"); require(r.getDouble("start").isFinite() && r.getDouble("end").isFinite() && r.getDouble("end") > r.getDouble("start")) { "Invalid loop region" } } }
                    "tick" -> { val p = e.getJSONObject("playheads"); p.keys().forEach { require(it in DECKS && p.getDouble(it).isFinite()) { "Invalid tick deck/position" } } }
                    "control" -> { require(e.getString("control") in controls) { "Unknown control ${e.optString("control")}" }; require(e.has("channel") && (e.isNull("channel") || e.getString("channel") in DECKS)); finite("value") }
                    "tenure" -> { require(e.getString("edge") in setOf("start", "end")); e.getString("holder") }
                    "beatFx" -> {
                        require(!e.getBoolean("on")) { "Event $i: active Beat FX requires effect-tail reconstruction; this prototype refuses rather than invents audibility." }
                        warnings.add("Inactive Beat FX section retained as evidence; no native FX engine")
                    }
                    "beatFxSettings" -> { e.getJSONObject("settings"); warnings.add("Beat FX voicing is evidence-only, as in desktop replayPlanner") }
                    // Reject rather than misrepresent effect tails or a role-shaped Take as a Session.
                    else -> error("Event $i: unsupported $kind. FX/tails, scratch and Take init are not implemented.")
                }
                e
            }
            require(events.last().getDouble("t") > events.first().getDouble("t")) { "Session has no duration" }
            return Session(uuid, events, warnings.toList())
        }

        fun tracks(text: String): Map<Int, Track> {
            val rows = if (text.trimStart().startsWith("{")) JSONObject(text).getJSONArray("items") else JSONArray(text)
            require(rows.length() <= 50000) { "Metadata limit exceeded" }
            return (0 until rows.length()).associate { i ->
                val t = rows.getJSONObject(i)
                val id = t.getInt("id")
                id to Track(id, t.optString("title").takeUnless { it.isBlank() || it == "null" } ?: t.getString("filename"),
                    t.optString("artist").takeUnless { it == "null" } ?: "Unknown artist",
                    if (t.isNull("bpm")) null else t.getDouble("bpm"),
                    if (t.isNull("key")) null else t.getInt("key"),
                    if (t.isNull("duration_secs")) null else t.getDouble("duration_secs"))
            }
        }

        private fun apply(s: Frame, e: JSONObject) {
            val t = e.getDouble("t")
            val d = if (!e.isNull("channel")) s.decks[e.optString("channel")] else null
            when (e.getString("kind")) {
                "load" -> d!!.apply { trackId = if (e.isNull("trackId")) null else e.getInt("trackId"); bpm = if (e.isNull("bpm")) null else e.getDouble("bpm"); preview = false; loop = null; position = 0.0; anchor = t }
                "transport" -> d!!.apply {
                    when (e.getString("action")) { "play" -> playing = true; "pause", "cue" -> playing = false; "previewStart" -> preview = true; "previewEnd" -> preview = false }
                    position = e.getDouble("playhead"); anchor = t
                }
                "pitch" -> d!!.apply { position = positionAt(t); anchor = t; pitch = e.getDouble("value") }
                "loop" -> d!!.apply { loop = if (e.isNull("region")) null else e.getJSONObject("region").let { it.getDouble("start") to it.getDouble("end") }; position = e.getDouble("playhead"); anchor = t }
                "tick" -> { val p = e.getJSONObject("playheads"); DECKS.forEach { if (p.has(it)) s.decks.getValue(it).apply { position = p.getDouble(it); anchor = t } } }
                "tenure" -> s.holder = if (e.getString("edge") == "start") e.getString("holder") else null
                "control" -> {
                    val v = e.getDouble("value")
                    when (e.getString("control")) {
                        "crossfader" -> s.crossfader = v
                        "crossfaderEnabled" -> s.crossfaderEnabled = v != 0.0
                        "fader" -> d?.fader = v; "trim" -> d?.trim = v
                        "eqLow" -> d?.low = v; "eqMid" -> d?.mid = v; "eqHigh" -> d?.high = v
                        "filter" -> d?.filter = v; "crossfaderAssignment" -> d?.assignment = v.compareTo(0.0)
                        "slipMode" -> d?.slip = v != 0.0; "vinylMode" -> d?.vinyl = v != 0.0
                        "stemVocals" -> d?.vocals = v != 0.0; "stemDrums" -> d?.drums = v != 0.0
                        "stemBass" -> d?.bass = v != 0.0; "stemOther" -> d?.other = v != 0.0
                    }
                }
            }
        }
    }
}
