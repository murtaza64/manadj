package dev.manadj.library.group

import org.json.JSONArray
import org.json.JSONObject

/** Replica-local #456 contract; a candidate never attests actual engine decode. */
object GroupReplayContract {
    const val GRAMMAR = "capture-group-basic-replay/v1"
    private val fields = mapOf(
        "load" to setOf("t", "kind", "channel", "trackId", "bpm"),
        "tick" to setOf("t", "kind", "playheads"),
        "transport" to setOf("t", "kind", "channel", "action", "playhead"),
        "control" to setOf("t", "kind", "channel", "control", "value"))
    fun supports(events: JSONArray): Boolean = try {
        var previous=-1.0
        events.length() > 0 && (0 until events.length()).all { i ->
            val e = events.getJSONObject(i)
            GroupBundle.event(e)
            val kind = e.getString("kind")
            val raw=e.get("t");require(raw is Number)
            val t=raw.toDouble();require(t.isFinite() && t in previous.coerceAtLeast(0.0)..1e9);previous=t
            fields[kind]?.containsAll(e.keys().asSequence().toSet()) == true &&
                (kind != "transport" || e.getString("action") in setOf("play", "pause", "seek", "cue")) &&
                (kind != "control" || e.getString("control") in setOf("fader", "crossfader", "crossfaderEnabled"))
        }
    } catch (_: Exception) { false }
    fun generation(identity: JSONObject, bindings: JSONArray): String = GroupWire.sha256(GroupWire.canonical(
        JSONObject().put("format", "manadj-group-replay-generation/v1").put("identity", identity)
            .put("grammar", GRAMMAR).put("bindings", JSONArray((0 until bindings.length())
                .map(bindings::getJSONObject).sortedBy { it.getString("logical_track_id") }))))
}
