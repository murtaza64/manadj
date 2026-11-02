package dev.manadj.library.group

import dev.manadj.library.session.SessionLog
import dev.manadj.library.session.audibleTrackIds
import org.erdtman.jcs.JsonCanonicalizer
import org.json.JSONArray
import org.json.JSONObject
import java.time.OffsetDateTime
import java.time.ZoneOffset

/** Validates immutable evidence only. Foreign integers NEVER become Library/audio bindings. */
internal object GroupBundle {
    private val decks = setOf("A", "B", "C", "D")
    private val fields = mapOf(
        "load" to "t kind channel trackId bpm", "control" to "t kind channel control value",
        "transport" to "t kind channel action playhead detail deltaSeconds durationSeconds filter trackDuration audioTime",
        "pitch" to "t kind channel value", "bend" to "t kind channel value", "loop" to "t kind channel playhead region slip",
        "tick" to "t kind playheads", "tenure" to "t kind edge holder", "beatFx" to "t kind selected target on depth beats held",
        "beatFxSettings" to "t kind settings", "init" to "t kind outgoingChannel decks crossfader crossfaderEnabled physicalDecks beatFx"
    ).mapValues { it.value.split(' ').toSet() }
    private val controls = "trim eqLow eqMid eqHigh filter fader pfl slipMode vinylMode crossfaderAssignment crossfader crossfaderEnabled master stemVocals stemDrums stemBass stemOther".split(' ').toSet()
    private val actions = "play pause seek jumpBeats hotCue cue previewStart previewEnd scratchBegin scratchMove scratchEnd".split(' ').toSet()
    private val fxSettings = "echoFeedback echoSaturation reverbDecay reverbDampingHz reverbStereoWidth flangerDelayMs flangerWidthMs flangerFeedback lowCutEchoHz transDuty transSlopeMs rollFadeMs".split(' ').toSet()
    private fun keys(j: JSONObject) = j.keys().asSequence().toSet()
    private fun number(v: Any?) = v is Number && v.toDouble().isFinite() && kotlin.math.abs(v.toDouble()) <= 1e12
    private fun nullable(v: Any?) = if (v === JSONObject.NULL) null else v
    private fun bool(j: JSONObject, k: String) { require(j.get(k) is Boolean) }
    private fun nums(j: JSONObject, vararg names: String) { names.forEach { require(number(j.opt(it))) { "Invalid numeric event field" } } }
    private fun digest(s: String) { require(s.matches(Regex("[0-9a-f]{64}"))) }
    private fun positiveId(value: Any): Long {
        require(value is Int || value is Long)
        return (value as Number).toLong().also { require(it in 1..9007199254740991L) }
    }
    private fun fx(j: JSONObject) {
        require(fields.getValue("beatFx").containsAll(keys(j)) && keys(j).containsAll(setOf("selected", "target", "on", "depth", "beats")))
        require(nullable(j.get("selected")) in setOf(null, "echo", "lowCutEcho", "reverb", "flanger", "trans", "roll"))
        require(j.getString("target") in decks + setOf("master", "sampler")); bool(j, "on"); nums(j, "depth", "beats")
        if (j.has("held")) j.getJSONArray("held").let { a -> for(i in 0 until a.length()) require(a.get(i) in decks) }
    }
    private fun bounded(v: Any?, depth: Int = 0) {
        require(depth <= 12)
        when(v) {
            is JSONObject -> { require(v.length() <= 64); keys(v).forEach { require(it.length <= 64); bounded(v.get(it), depth+1) } }
            is JSONArray -> { require(v.length() <= 128); for(i in 0 until v.length()) bounded(v.get(i), depth+1) }
            is String -> require(v.length <= 2048)
            is Number -> require(v.toDouble().isFinite() && kotlin.math.abs(v.toDouble()) <= 9007199254740991.0)
            else -> require(v == null || v === JSONObject.NULL || v is Boolean)
        }
    }
    private fun referenceSites(j: JSONObject, kind: String): List<Pair<JSONObject, String>> {
        val sites = when(kind) {
            "load" -> listOf(j to "trackId")
            "init" -> listOf(j.getJSONObject("decks").getJSONObject("A") to "trackId", j.getJSONObject("decks").getJSONObject("B") to "trackId")
            else -> emptyList()
        }
        var found = 0
        fun visit(v: Any) {
            when(v) {
                is JSONObject -> keys(v).forEach { if(it == "trackId") found++; visit(v.get(it)) }
                is JSONArray -> for(i in 0 until v.length()) visit(v.get(i))
            }
        }
        visit(j); require(found == sites.size)
        sites.forEach { (parent, key) -> require(parent.has(key)); if (!parent.isNull(key)) positiveId(parent.get(key)) }
        return sites
    }
    internal fun event(j: JSONObject): List<Pair<JSONObject, String>> {
        bounded(j)
        val kind = j.getString("kind")
        require(fields[kind]?.containsAll(keys(j)) == true) { "Unsupported event grammar" }
        if(kind in setOf("load", "transport", "pitch", "bend", "loop")) require(j.getString("channel") in decks)
        if(kind == "control") require(j.has("channel") && nullable(j.get("channel")) in decks + setOf(null))
        when(kind) {
            "load" -> require(j.has("bpm") && (j.isNull("bpm") || number(j.get("bpm"))))
            "control" -> { require(j.getString("control") in controls); nums(j, "value") }
            "pitch", "bend" -> nums(j, "value")
            "transport" -> {
                require(j.getString("action") in actions); nums(j, "playhead")
                listOf("detail", "deltaSeconds", "durationSeconds", "trackDuration", "audioTime").filter(j::has).forEach { nums(j, it) }
                if(j.has("filter")) j.getJSONObject("filter").let { GroupWire.fields(it, "drive", "rate"); nums(it, "drive", "rate") }
            }
            "loop" -> {
                nums(j, "playhead"); require(j.has("region"))
                if(!j.isNull("region")) j.getJSONObject("region").let { GroupWire.fields(it, "start", "end"); nums(it, "start", "end"); require(it.getDouble("start") < it.getDouble("end")) }
                if(j.has("slip")) bool(j, "slip")
            }
            "tick" -> j.getJSONObject("playheads").let { require(decks.containsAll(keys(it))); keys(it).forEach { k -> nums(it, k) } }
            "tenure" -> { require(j.getString("edge") in setOf("start", "end")); require(j.get("holder") is String) }
            "beatFx" -> fx(j)
            "beatFxSettings" -> j.getJSONObject("settings").let { s ->
                require((fxSettings + "flangerLengthUnit").containsAll(keys(s)))
                keys(s).forEach { if(it == "flangerLengthUnit") require(s.get(it) in setOf("bars", "beats")) else nums(s, it) }
            }
            "init" -> {
                require(j.getString("outgoingChannel") in setOf("A", "B")); nums(j, "crossfader"); bool(j, "crossfaderEnabled")
                val ds = j.getJSONObject("decks"); GroupWire.fields(ds, "A", "B")
                for(d in listOf("A", "B")) ds.getJSONObject(d).let { v ->
                    require("trackId playing scratching slipLoopActive fader trim eq filter pitch assignment stems".split(' ').containsAll(keys(v)))
                    bool(v, "playing"); nums(v, "fader", "trim", "filter", "pitch")
                    v.getJSONObject("eq").let { GroupWire.fields(it, "low", "mid", "high"); nums(it, "low", "mid", "high") }
                    listOf("scratching", "slipLoopActive").filter(v::has).forEach { bool(v, it) }
                    if(v.has("assignment")) require(v.get("assignment") in setOf("left", "thru", "right"))
                    if(v.has("stems")) v.getJSONObject("stems").let { s -> GroupWire.fields(s, "vocals", "drums", "bass", "other"); keys(s).forEach { bool(s, it) } }
                }
                if(j.has("physicalDecks")) j.getJSONObject("physicalDecks").let { GroupWire.fields(it, "outgoing", "incoming"); require(it.get("outgoing") in decks && it.get("incoming") in decks) }
                if(j.has("beatFx")) fx(j.getJSONObject("beatFx"))
            }
        }
        return referenceSites(j, kind)
    }

    fun validate(input: JSONObject, origin: String): String {
        val bundle = JSONObject(input.toString())
        GroupWire.fields(bundle, "format", "version", "digest_algorithm", "manifest", "chunks")
        require(bundle.get("format") == "manadj-peer-session" && bundle.get("version") == 1 && bundle.get("digest_algorithm") == "sha256-rfc8785-jcs-v1")
        val m = bundle.getJSONObject("manifest")
        GroupWire.fields(m, "session_uuid", "origin_replica_id", "grammar", "reference_basis", "started_at", "ended_at", "recording_origin", "tracks", "chunk_sha256")
        val sid = GroupWire.uuid(m.getString("session_uuid"))
        require(GroupWire.uuid(m.getString("origin_replica_id")) == origin)
        require(m.get("grammar") == "capture-events-v1" && m.get("reference_basis") == "explicit-current-row-bindings")
        val start = OffsetDateTime.parse(m.getString("started_at")); val end = OffsetDateTime.parse(m.getString("ended_at"))
        require(start.offset == ZoneOffset.UTC && end.offset == ZoneOffset.UTC && !end.isBefore(start))
        require(m.isNull("recording_origin") || (m.get("recording_origin") is String && m.getString("recording_origin").length <= 128))
        val refs = m.getJSONArray("tracks"); require(refs.length() <= 128)
        val ids = mutableSetOf<Long>(); val logical = mutableSetOf<String>()
        for(i in 0 until refs.length()) refs.getJSONObject(i).let { ref ->
            GroupWire.fields(ref, "source_local_id", "logical_track_id", "asset")
            require(ids.add(positiveId(ref.get("source_local_id"))))
            require(logical.add(GroupWire.uuid(ref.getString("logical_track_id"))))
            if(!ref.isNull("asset")) ref.getJSONObject("asset").let { asset ->
                GroupWire.fields(asset, "algorithm", "sha256", "byte_length")
                require(asset.get("algorithm") == "sha256-file-bytes-v1"); digest(asset.getString("sha256"))
                require(positiveId(asset.get("byte_length")) <= 512L * 1024 * 1024)
            }
        }
        val hashes = m.getJSONArray("chunk_sha256"); require(hashes.length() in 1..4096)
        for(i in 0 until hashes.length()) digest(hashes.getString(i))
        val chunks = bundle.getJSONArray("chunks"); require(chunks.length() == hashes.length())
        val bySeq = mutableMapOf<Int, JSONArray>()
        for(i in 0 until chunks.length()) chunks.getJSONObject(i).let { chunk ->
            GroupWire.fields(chunk, "seq", "events")
            val seq = GroupWire.counter(chunk, "seq"); require(seq < hashes.length())
            val events = chunk.getJSONArray("events"); require(events.length() in 1..5000)
            require(GroupWire.sha256(JsonCanonicalizer(events.toString()).encodedUTF8) == hashes.getString(seq.toInt()))
            require(bySeq.put(seq.toInt(), events) == null)
        }
        val all = JSONArray(); val references = mutableSetOf<Long>(); var previous = -1.0
        // Temporary dense IDs are used ONLY by the existing audibility reducer. They never escape
        // validation, alter original signed bytes, or refer to receiving Library rows/files.
        val dense = ids.withIndex().associate { it.value to it.index + 1 }
        for(seq in 0 until hashes.length()) {
            val events = bySeq.getValue(seq)
            for(i in 0 until events.length()) {
                val e = events.getJSONObject(i)
                val t = e.get("t"); require(t is Number && t.toDouble().isFinite() && t.toDouble() in 0.0..1e9 && t.toDouble() >= previous)
                previous = t.toDouble()
                val sites = event(e)
                sites.forEach { (obj, key) -> if(!obj.isNull(key)) {
                    val id = positiveId(obj.get(key)); references += id
                    obj.put(key, dense[id] ?: error("Undeclared Track reference"))
                } }
                all.put(e)
            }
        }
        require(references == ids) { "Complete Track reference manifest required" }
        val validationLog = JSONObject().put("uuid", sid).put("events", all)
        require(SessionLog.parse(validationLog.toString().reader()).audibleTrackIds.isNotEmpty()) { "Silent Session not exchangeable" }
        return sid
    }
}
