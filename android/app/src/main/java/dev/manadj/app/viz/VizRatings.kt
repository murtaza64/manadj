package dev.manadj.app.viz

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject

/**
 * Phone preset ratings (#401): thumbs on the preset currently on screen, queued offline (SharedPreferences) and
 * drained to the desktop rating store on sync ([drain]/[ack]). [latest] = this phone's last verdict per preset.
 * Wire (viz-ratings #401, POST /api/device-sync/viz-ratings): {uuid, preset, outcome: "like"|"dislike",
 * rated_at_ms, context: {track_id?}}; one uuid per tap, pushed on every library SYNC, dropped on 2xx.
 */
object VizRatings {
    const val UP = "up"
    const val DOWN = "down"
    private const val QUEUE = "rating-queue"
    private const val LATEST = "rating-latest"
    private var prefs: android.content.SharedPreferences? = null
    val latest = mutableStateMapOf<String, String>()
    var pending by mutableIntStateOf(0); private set
    /** Track the dominant deck holds, attached as context (set by the backdrop host each frame). */
    @Volatile var contextTrackId: Int? = null

    fun init(context: Context) {
        if (prefs != null) return
        val p = context.getSharedPreferences("viz-ratings", Context.MODE_PRIVATE)
        prefs = p
        runCatching { JSONObject(p.getString(LATEST, "{}")!!).let { o -> o.keys().forEach { latest[it] = o.getString(it) } } }
        pending = queue().length()
        // Ride the library SYNC: push the queue after the edit journal.
        dev.manadj.app.library.LibraryHolder.repository(context).extraPushes += { client -> push(client) }
    }

    private fun push(client: dev.manadj.library.SyncClient) {
        val batch = drain()
        if (batch.length() == 0) return
        try {
            client.post("/viz-ratings", JSONObject().put("ratings", batch))
            ack(batch.length())
        } catch (e: dev.manadj.library.SyncException) {
            if (e.status != 404 && e.status != 405) throw e // desktop without the rating store yet: keep the queue
        }
    }

    private fun queue(): JSONArray = runCatching { JSONArray(prefs?.getString(QUEUE, "[]") ?: "[]") }.getOrDefault(JSONArray())

    @Synchronized fun rate(presetId: String, verdict: String) {
        val p = prefs ?: return
        val q = queue().put(JSONObject().put("uuid", java.util.UUID.randomUUID().toString()).put("preset", presetId)
            .put("outcome", if (verdict == UP) "like" else "dislike").put("rated_at_ms", System.currentTimeMillis())
            .put("context", JSONObject().apply { contextTrackId?.let { put("track_id", it) } }))
        latest[presetId] = verdict
        p.edit().putString(QUEUE, q.toString()).putString(LATEST, JSONObject(latest.toMap()).toString()).apply()
        pending = q.length()
    }

    /** Snapshot of the queued events (oldest first) for a sync push. */
    @Synchronized fun drain(): JSONArray = queue()

    /** After a successful push of [count] events (from [drain]): drop them from the queue head. */
    @Synchronized fun ack(count: Int) {
        val q = queue()
        val rest = JSONArray()
        for (i in count until q.length()) rest.put(q.get(i))
        prefs?.edit()?.putString(QUEUE, rest.toString())?.apply()
        pending = rest.length()
    }
}
