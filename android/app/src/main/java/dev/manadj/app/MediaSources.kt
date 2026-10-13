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
            return LocalSource("local:$digest", uri, title, artist, duration, persistent)
        } finally { metadata.release() }
    }

    fun remembered(): List<LocalSource> {
        val array = try { JSONArray(preferences.getString("sources", "[]")) } catch (_: Exception) { JSONArray() }
        return (0 until array.length()).mapNotNull { index ->
            try {
                val item = array.getJSONObject(index)
                LocalSource(item.getString("id"), Uri.parse(item.getString("uri")), item.getString("title"), item.optString("artist"), item.optDouble("duration").takeIf { it.isFinite() }, true)
            } catch (_: Exception) { null }
        }
    }

    fun remember(sources: List<LocalSource>) {
        val array = JSONArray()
        sources.filter { it.persistentGrant }.forEach { source ->
            array.put(JSONObject().put("id", source.id).put("uri", source.uri.toString()).put("title", source.title).put("artist", source.artist).put("duration", source.durationSeconds ?: JSONObject.NULL))
        }
        preferences.edit().putString("sources", array.toString()).apply()
    }
}
