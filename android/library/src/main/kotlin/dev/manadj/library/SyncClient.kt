package dev.manadj.library

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * HTTP client for the desktop's /api/device-sync endpoints. Blocking; call off the main thread.
 * [pairCode] is required by the desktop's LAN listener (#373); loopback (adb reverse) ignores it.
 */
class SyncClient(
    baseUrl: String,
    private val pairCode: String? = null,
    private val timeoutMs: Int = 15_000,
    /** Per-device token from approve-on-desktop pairing (#374); preferred over [pairCode]. */
    private val deviceToken: String? = null,
    /** Names this phone in the desktop's Device change log over loopback (#375). */
    private val deviceId: String? = null,
    private val deviceName: String? = null,
) {
    val baseUrl: String = baseUrl.trimEnd('/')

    private fun open(path: String, method: String = "GET"): HttpURLConnection =
        (URL("$baseUrl/api/device-sync$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = timeoutMs
            readTimeout = timeoutMs * 4
            deviceId?.let { setRequestProperty("X-Manadj-Device-Id", it) }
            deviceName?.let { setRequestProperty("X-Manadj-Device-Name", it) }
            val token = deviceToken?.takeIf { it.isNotBlank() }
            if (token != null) setRequestProperty(DEVICE_TOKEN_HEADER, token)
            else pairCode?.takeIf { it.isNotBlank() }?.let { setRequestProperty(PAIR_HEADER, it.trim()) }
        }

    private fun HttpURLConnection.checked(): HttpURLConnection {
        val code = responseCode
        if (code == 401) {
            disconnect()
            throw SyncException(
                if (deviceToken.isNullOrBlank()) "Not paired — pair with the desktop (or enter the code from desktop Settings › Library › Phone sync)"
                else "This phone was unpaired on the desktop — pair again",
                unpaired = !deviceToken.isNullOrBlank(),
            )
        }
        if (code !in 200..299) {
            val detail = errorStream?.use { it.readBytes().decodeToString().take(200) }.orEmpty()
            disconnect()
            throw SyncException("HTTP $code from ${url.path}${if (detail.isNotEmpty()) ": $detail" else ""}", status = code)
        }
        return this
    }

    fun snapshotText(): String = io { open("/snapshot").checked().run { inputStream.use { it.readBytes().decodeToString() }.also { disconnect() } } }

    /** Session headers, newest first (#378). */
    fun sessionsText(): String = io { open("/sessions").checked().run { inputStream.use { it.readBytes().decodeToString() }.also { disconnect() } } }

    /** One Session with its capture-event log (SessionDetail, #378), streamed to [target]. */
    fun downloadSession(uuid: String, target: File): Unit = io {
        val conn = open("/sessions/${java.net.URLEncoder.encode(uuid, "UTF-8")}").checked()
        target.parentFile?.mkdirs()
        val tmp = File(target.parentFile, ".${target.name}.part")
        conn.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it, 1 shl 16) } }
        conn.disconnect()
        if (!tmp.renameTo(target)) { target.delete(); check(tmp.renameTo(target)) { "Cannot store ${target.name}" } }
    }

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

    private fun postJson(path: String, body: JSONObject): JSONObject = io {
        val conn = open(path, "POST")
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
        conn.checked()
        val text = conn.inputStream.use { it.readBytes().decodeToString() }
        conn.disconnect()
        JSONObject(text)
    }

    /** Push journaled edits (#375); returns uuid → applied | superseded | rejected. */
    fun pushEdits(edits: List<JournaledEdit>): Map<String, String> {
        val outcomes = postJson("/edits", editsBody(edits)).getJSONObject("outcomes")
        return outcomes.keys().asSequence().associateWith { outcomes.getString(it) }
    }

    /**
     * Push a phone-recorded Session (#395): idempotent upsert — the desktop stores chunks whose seq is new and
     * ends the Session when [endedAt] is set. Returns the seqs the desktop now holds and whether a silent
     * Session was dropped on end.
     */
    fun pushSession(uuid: String, body: JSONObject): Pair<Set<Int>, Boolean> {
        val r = postJson("/sessions/${java.net.URLEncoder.encode(uuid, "UTF-8")}", body)
        val seqs = r.getJSONArray("stored_seqs")
        return (0 until seqs.length()).map { seqs.getInt(it) }.toSet() to r.optBoolean("deleted")
    }

    /** Report what a pull changed on this phone (desktop logs it as to_phone). */
    fun reportReceived(changes: List<JSONObject>) {
        postJson("/received", JSONObject().put("changes", JSONArray(changes)))
    }

    /** The full detail waveform (MWF1) the desktop renders, with its rev; null when not generated there (404). */
    fun downloadWaveform(trackId: Int): WaveformBlob? = io {
        val conn = open("/tracks/$trackId/waveform")
        if (conn.responseCode == 404) {
            conn.disconnect()
            return@io null
        }
        conn.checked()
        val rev = conn.getHeaderField("X-Waveform-Rev")
        WaveformBlob(conn.inputStream.use { it.readBytes() }, rev).also { conn.disconnect() }
    }

    /**
     * Download a Track's audio to [target] (atomically), reporting (bytes, total?).
     * Resumable: a failed download leaves `.<name>.part`; the next call asks for
     * the rest with `Range` and appends on 206 (restarts on a full 200).
     * [cancelled] is polled per chunk; cancelling keeps the partial file.
     */
    fun downloadAudio(
        trackId: Int,
        target: File,
        cancelled: () -> Boolean = { false },
        onProgress: (Long, Long?) -> Unit = { _, _ -> },
    ): Unit = download("/tracks/$trackId/audio", target, cancelled, onProgress)

    /** One current stem (vocals/drums/bass/other, AAC m4a) to [target]; resumable like [downloadAudio]. */
    fun downloadStem(
        trackId: Int,
        stem: String,
        target: File,
        cancelled: () -> Boolean = { false },
        onProgress: (Long, Long?) -> Unit = { _, _ -> },
    ): Unit = download("/tracks/$trackId/stems/$stem", target, cancelled, onProgress)

    /** A stem's MWF1 waveform; null when the desktop has no current stems (404). */
    fun downloadStemWaveform(trackId: Int, stem: String): ByteArray? = io {
        val conn = open("/tracks/$trackId/stems/$stem/waveform")
        if (conn.responseCode == 404) {
            conn.disconnect()
            return@io null
        }
        conn.checked()
        conn.inputStream.use { it.readBytes() }.also { conn.disconnect() }
    }

    private fun download(
        path: String,
        target: File,
        cancelled: () -> Boolean,
        onProgress: (Long, Long?) -> Unit,
    ): Unit = io {
        target.parentFile?.mkdirs()
        val tmp = partFile(target)
        val have = if (tmp.isFile) tmp.length() else 0L
        val conn = open(path)
        if (have > 0) conn.setRequestProperty("Range", "bytes=$have-")
        if (conn.responseCode == 416) {
            // Partial is already complete (or stale beyond the file): start over.
            conn.disconnect()
            tmp.delete()
            return@io download(path, target, cancelled, onProgress)
        }
        conn.checked()
        val resumed = conn.responseCode == 206
        val start = if (resumed) have else 0L
        val total = conn.contentLengthLong.takeIf { it >= 0 }?.let { it + start }
        try {
            conn.inputStream.use { input ->
                java.io.FileOutputStream(tmp, resumed).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var done = start
                    onProgress(done, total)
                    while (true) {
                        if (cancelled()) throw DownloadCancelled()
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
            conn.disconnect()
        }
    }

    private inline fun <T> io(block: () -> T): T = try { block() } catch (e: IOException) {
        throw SyncException("Desktop unreachable at $baseUrl (${e.message ?: e.javaClass.simpleName})", e)
    }
}

const val PAIR_HEADER = "X-Manadj-Pair"
const val DEVICE_TOKEN_HEADER = "X-Manadj-Device-Token"

class SyncException(
    message: String,
    cause: Throwable? = null,
    val unpaired: Boolean = false,
    /** HTTP status when the desktop answered with an error (null: unreachable / local failure). */
    val status: Int? = null,
) : Exception(message, cause) {
    /** The desktop couldn't be reached at all (offline / not on its network). */
    val unreachable: Boolean get() = cause is IOException
}

class WaveformBlob(val bytes: ByteArray, val rev: String?)

/** A download stopped by its cancel flag; the `.part` file stays for resume. */
class DownloadCancelled : Exception("cancelled")

/** Where an in-progress (resumable) audio download accumulates. */
fun partFile(target: File) = File(target.parentFile, ".${target.name}.part")
