package dev.manadj.app

import android.content.Context
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.io.File

data class LocalSource(
    val id: String,
    val uri: Uri,
    val title: String,
    val artist: String,
    val durationSeconds: Double?,
    val persistentGrant: Boolean,
    /** Tagged tempo (ID3 TBPM) when present; anchors at 0 s until a real beatgrid exists. */
    val bpm: Double? = null,
)

/** URI grants belong to the app; native decoding receives its own duplicated descriptor. */
class MediaSources(private val context: Context) {
    private val preferences = context.getSharedPreferences("local-sources", Context.MODE_PRIVATE)

    fun readMetadata(uri: Uri): LocalSource {
        val persistent = try {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            true
        } catch (_: SecurityException) { false }
        val name = if (uri.scheme == "file") File(requireNotNull(uri.path)).name else context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        } ?: "Selected audio"
        val metadata = MediaMetadataRetriever()
        try {
            metadata.setDataSource(context, uri)
            val title = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)?.takeIf { it.isNotBlank() } ?: name
            val artist = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST).orEmpty()
            val duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull()?.div(1000)
            val digest = MessageDigest.getInstance("SHA-256").digest(uri.toString().toByteArray()).joinToString("") { "%02x".format(it) }
            val bpm = runCatching { context.contentResolver.openInputStream(uri)?.use(::id3Bpm) }.getOrNull()
            return LocalSource("local:$digest", uri, title, artist, duration, persistent, bpm)
        } finally { metadata.release() }
    }

    fun remembered(): List<LocalSource> {
        val array = try { JSONArray(preferences.getString("sources", "[]")) } catch (_: Exception) { JSONArray() }
        return (0 until array.length()).mapNotNull { index ->
            try {
                val item = array.getJSONObject(index)
                LocalSource(item.getString("id"), Uri.parse(item.getString("uri")), item.getString("title"), item.optString("artist"), item.optDouble("duration").takeIf { it.isFinite() }, true, item.optDouble("bpm").takeIf { it.isFinite() && it > 0 })
            } catch (_: Exception) { null }
        }
    }

    fun remember(sources: List<LocalSource>) {
        val array = JSONArray()
        sources.filter { it.persistentGrant }.forEach { source ->
            array.put(JSONObject().put("id", source.id).put("uri", source.uri.toString()).put("title", source.title).put("artist", source.artist).put("duration", source.durationSeconds ?: JSONObject.NULL).put("bpm", source.bpm ?: JSONObject.NULL))
        }
        preferences.edit().putString("sources", array.toString()).apply()
    }
}

/** TBPM from an ID3v2.3/2.4 tag at the start of the stream (MP3/AIFF/WAV-with-ID3 rips); null if absent. */
internal fun id3Bpm(input: java.io.InputStream): Double? {
    val header = ByteArray(10)
    if (input.readNBytesCompat(header) < 10 || String(header, 0, 3, Charsets.ISO_8859_1) != "ID3") return null
    val version = header[3].toInt()
    if (version !in 3..4) return null
    val size = header.syncsafe(6)
    if (size <= 0 || size > 4 shl 20) return null
    val tag = ByteArray(size)
    val read = input.readNBytesCompat(tag)
    var at = if ((header[5].toInt() and 0x40) != 0) 4 + (if (version == 4) tag.syncsafe(0) - 4 else tag.int(0)) else 0
    while (at + 10 <= read) {
        val id = String(tag, at, 4, Charsets.ISO_8859_1)
        if (id[0] == '\u0000') break
        val length = if (version == 4) tag.syncsafe(at + 4) else tag.int(at + 4)
        if (length <= 0 || at + 10 + length > read) break
        if (id == "TBPM") {
            val encoding = tag[at + 10].toInt()
            val charset = when (encoding) { 1 -> Charsets.UTF_16; 2 -> Charsets.UTF_16BE; 3 -> Charsets.UTF_8; else -> Charsets.ISO_8859_1 }
            val text = String(tag, at + 11, length - 1, charset).trim { it.isWhitespace() || it == '\u0000' }
            return text.replace(',', '.').toDoubleOrNull()?.takeIf { it in 40.0..300.0 }
        }
        at += 10 + length
    }
    return null
}

private fun java.io.InputStream.readNBytesCompat(buffer: ByteArray): Int {
    var total = 0
    while (total < buffer.size) { val n = read(buffer, total, buffer.size - total); if (n < 0) break; total += n }
    return total
}
private fun ByteArray.syncsafe(at: Int) = ((this[at].toInt() and 0x7f) shl 21) or ((this[at + 1].toInt() and 0x7f) shl 14) or ((this[at + 2].toInt() and 0x7f) shl 7) or (this[at + 3].toInt() and 0x7f)
private fun ByteArray.int(at: Int) = ((this[at].toInt() and 0xff) shl 24) or ((this[at + 1].toInt() and 0xff) shl 16) or ((this[at + 2].toInt() and 0xff) shl 8) or (this[at + 3].toInt() and 0xff)
