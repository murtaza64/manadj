package dev.manadj.library.session

import dev.manadj.library.SyncClient
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.io.File

/** Desktop SessionRow. Times are the desktop's ISO strings (naive = UTC). */
data class SessionHeader(val uuid: String, val startedAt: String?, val endedAt: String?, val takeCount: Int)

/**
 * Sessions pulled from the desktop over device sync (#378), cached for offline replay:
 *
 *   sessions.json         last pulled header list
 *   sessions/<uuid>.json  SessionDetail per opened Session (ended Sessions are immutable)
 */
class SessionStore(private val root: File, private val client: () -> SyncClient, private val io: CoroutineDispatcher = Dispatchers.IO) {
    private val listFile = File(root, "sessions.json")
    private val dir = File(root, "sessions").apply { mkdirs() }

    fun cached(): List<SessionHeader> = runCatching { listFile.takeIf { it.isFile }?.readText()?.let(::parseList) }.getOrNull().orEmpty()

    fun isCached(uuid: String) = file(uuid).isFile

    /** Pull the header list (throws SyncException when the desktop is unreachable). */
    suspend fun refresh(): List<SessionHeader> = withContext(io) {
        val text = client().sessionsText()
        val list = parseList(text)
        atomicWrite(listFile, text)
        list
    }

    /** The Session's log: cached when ended and present, else pulled (falling back to any cached copy). */
    suspend fun log(header: SessionHeader): SessionLog = withContext(io) {
        val f = file(header.uuid)
        if (header.endedAt == null || !f.isFile) {
            try { client().downloadSession(header.uuid, f) } catch (e: Exception) { if (!f.isFile) throw e }
        }
        f.bufferedReader().use { SessionLog.parse(it) }
    }

    private fun file(uuid: String) = File(dir, uuid.replace(Regex("[^A-Za-z0-9._-]"), "_") + ".json")

    private fun atomicWrite(target: File, text: String) {
        val tmp = File(target.parentFile, ".${target.name}.tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(target)) { target.delete(); tmp.renameTo(target) }
    }

    companion object {
        fun parseList(text: String): List<SessionHeader> {
            val a = JSONArray(text)
            return (0 until a.length()).map { i ->
                val o = a.getJSONObject(i)
                fun str(k: String) = if (o.isNull(k)) null else o.optString(k).ifEmpty { null }
                SessionHeader(o.getString("uuid"), str("started_at"), str("ended_at"), o.optInt("take_count"))
            }
        }
    }
}
