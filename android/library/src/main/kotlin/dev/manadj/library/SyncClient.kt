package dev.manadj.library

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** HTTP client for the desktop's /api/device-sync endpoints. Blocking; call off the main thread. */
class SyncClient(baseUrl: String, private val timeoutMs: Int = 15_000) {
    val baseUrl: String = baseUrl.trimEnd('/')

    private fun open(path: String, method: String = "GET"): HttpURLConnection =
        (URL("$baseUrl/api/device-sync$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = timeoutMs
            readTimeout = timeoutMs * 4
        }

    private fun HttpURLConnection.checked(): HttpURLConnection {
        val code = responseCode
        if (code !in 200..299) {
            val detail = errorStream?.use { it.readBytes().decodeToString().take(200) }.orEmpty()
            disconnect()
            throw SyncException("HTTP $code from ${url.path}${if (detail.isNotEmpty()) ": $detail" else ""}")
        }
        return this
    }

    fun snapshotText(): String = io { open("/snapshot").checked().run { inputStream.use { it.readBytes().decodeToString() }.also { disconnect() } } }

    fun previews(trackIds: Collection<Int>): Map<Int, ByteArray> = io {
        val conn = open("/previews", "POST")
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        val body = JSONObject().put("track_ids", JSONArray(trackIds.toList())).toString()
        conn.outputStream.use { it.write(body.toByteArray()) }
        conn.checked()
        val bytes = conn.inputStream.use { it.readBytes() }
        conn.disconnect()
        PreviewPack.parse(bytes)
    }

    /** Download a Track's audio to [target] (atomically), reporting (bytes, total?). */
    fun downloadAudio(trackId: Int, target: File, onProgress: (Long, Long?) -> Unit = { _, _ -> }) = io {
        val conn = open("/tracks/$trackId/audio").checked()
        val total = conn.contentLengthLong.takeIf { it >= 0 }
        target.parentFile?.mkdirs()
        val tmp = File(target.parentFile, ".${target.name}.part")
        try {
            conn.inputStream.use { input ->
                tmp.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var done = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        done += n
                        onProgress(done, total)
                    }
                    if (total != null && done != total) throw SyncException("audio truncated ($done of $total bytes)")
                }
            }
            if (!tmp.renameTo(target)) throw SyncException("could not store $target")
        } finally {
            tmp.delete()
            conn.disconnect()
        }
    }

    private inline fun <T> io(block: () -> T): T = try { block() } catch (e: IOException) {
        throw SyncException("Desktop unreachable at $baseUrl (${e.message ?: e.javaClass.simpleName})", e)
    }
}

class SyncException(message: String, cause: Throwable? = null) : Exception(message, cause)
