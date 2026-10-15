package dev.manadj.library.session

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Sessions recorded on this phone (#395), stored as the desktop stores them: a header plus append-only
 * chunks of capture events (ADR 0033), so a push is a straight upload and replay reads them like a pulled log.
 *
 *   <root>/<uuid>/meta.json     {uuid, started_at, ended_at, pushed: [seq…], end_pushed, dropped}
 *   <root>/<uuid>/<seq>.json    JSON array of capture events
 *
 * Single writer (the recorder thread) + readers (list, replay, push); writes are atomic renames.
 */
class RecordedSessions(private val root: File) {
    init { root.mkdirs() }

    data class Meta(val uuid: String, val startedAt: String, val endedAt: String?, val pushed: Set<Int>, val endPushed: Boolean, val dropped: Boolean)

    private fun dir(uuid: String) = File(root, uuid.replace(Regex("[^A-Za-z0-9._-]"), "_"))

    fun meta(uuid: String): Meta? = runCatching {
        val o = JSONObject(File(dir(uuid), "meta.json").readText())
        val p = o.optJSONArray("pushed") ?: JSONArray()
        Meta(o.getString("uuid"), o.getString("started_at"), o.optString("ended_at").ifEmpty { null }.takeUnless { o.isNull("ended_at") },
            (0 until p.length()).map(p::getInt).toSet(), o.optBoolean("end_pushed"), o.optBoolean("dropped"))
    }.getOrNull()

    private fun write(m: Meta) {
        val o = JSONObject().put("uuid", m.uuid).put("started_at", m.startedAt).put("ended_at", m.endedAt ?: JSONObject.NULL)
            .put("pushed", JSONArray(m.pushed.sorted())).put("end_pushed", m.endPushed).put("dropped", m.dropped)
        atomic(File(dir(m.uuid), "meta.json"), o.toString())
    }

    fun open(uuid: String, startedAt: String) { dir(uuid).mkdirs(); write(Meta(uuid, startedAt, null, emptySet(), false, false)) }

    fun append(uuid: String, seq: Int, events: JSONArray) = atomic(File(dir(uuid), "$seq.json"), events.toString())

    fun end(uuid: String, endedAt: String) = update(uuid) { it.copy(endedAt = endedAt) }

    /** Read-modify-write of a header (the recorder ends while a push records progress). */
    @Synchronized private fun update(uuid: String, change: (Meta) -> Meta) { meta(uuid)?.let { write(change(it)) } }

    fun seqs(uuid: String): List<Int> = dir(uuid).listFiles().orEmpty().mapNotNull { it.nameWithoutExtension.toIntOrNull() }.sorted()

    fun chunk(uuid: String, seq: Int): JSONArray = JSONArray(File(dir(uuid), "$seq.json").readText())

    /** Every recorded Session, newest first (dropped = silent, deleted by the desktop on end: hidden). */
    fun all(): List<Meta> = root.listFiles().orEmpty().filter { it.isDirectory }.mapNotNull { meta(it.name) }
        .filter { !it.dropped }.sortedByDescending { it.startedAt }

    /** Sessions left open by a crash: end them at their last written chunk (desktop recover_open_sessions). */
    fun recover(now: () -> String, isoOf: (Long) -> String) {
        for (m in root.listFiles().orEmpty().filter { it.isDirectory }.mapNotNull { meta(it.name) }) if (m.endedAt == null) {
            val last = dir(m.uuid).listFiles().orEmpty().filter { it.name != "meta.json" }.maxOfOrNull { it.lastModified() }
            end(m.uuid, last?.let(isoOf) ?: now())
        }
    }

    /** The desktop SessionDetail shape (replay reads it with [SessionLog.parse]). */
    fun detail(uuid: String): String {
        val m = meta(uuid) ?: error("No recorded Session $uuid")
        val events = JSONArray()
        for (s in seqs(uuid)) { val c = chunk(uuid, s); for (i in 0 until c.length()) events.put(c.get(i)) }
        return JSONObject().put("uuid", m.uuid).put("started_at", m.startedAt).put("ended_at", m.endedAt ?: JSONObject.NULL)
            .put("take_count", 0).put("events", events).toString()
    }

    /**
     * Upload what the desktop lacks (unpushed chunks, then the end). [send] = SyncClient.pushSession; returns
     * true when nothing is left to push. Resumable: progress is recorded after each accepted request.
     */
    fun push(uuid: String, send: (JSONObject) -> Pair<Set<Int>, Boolean>, batch: Int = 20): Boolean {
        val m = meta(uuid) ?: return true
        if (m.dropped || m.endPushed) return true
        val parts = seqs(uuid).filter { it !in m.pushed }.chunked(batch).ifEmpty { listOf(emptyList()) }
        var ended = false
        for ((i, part) in parts.withIndex()) {
            // The end goes with the last batch, and only once every chunk written before the end is included.
            val end = if (i == parts.lastIndex) m.endedAt else null
            val body = JSONObject().put("started_at", m.startedAt)
            if (end != null) body.put("ended_at", end)
            body.put("chunks", JSONArray(part.map { JSONObject().put("seq", it).put("events", chunk(uuid, it)) }))
            val (stored, deleted) = send(body)
            ended = end != null
            update(uuid) { it.copy(pushed = it.pushed + stored, endPushed = it.endPushed || ended, dropped = deleted) }
            if (deleted) return true
        }
        return ended
    }

    private fun atomic(target: File, text: String) {
        target.parentFile?.mkdirs()
        val tmp = File(target.parentFile, ".${target.name}.tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(target)) { target.delete(); tmp.renameTo(target) }
    }
}
