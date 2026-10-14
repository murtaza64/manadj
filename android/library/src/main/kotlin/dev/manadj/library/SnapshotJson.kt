package dev.manadj.library

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime

/** Parses GET /api/device-sync/snapshot (backend/routers/device_sync.py). */
object SnapshotJson {
    const val SUPPORTED_VERSION = 1

    fun parse(text: String): Snapshot {
        val root = JSONObject(text)
        val version = root.getInt("version")
        require(version == SUPPORTED_VERSION) { "Unsupported snapshot version $version" }
        val categories = root.getJSONArray("tag_categories").objects().map {
            TagCategory(it.getInt("id"), it.getString("name"), it.str("color"), it.optInt("display_order"))
        }
        val byCategory = categories.associateBy { it.id }
        val tags = root.getJSONArray("tags").objects().map {
            val category = byCategory[it.getInt("category_id")]
            LibraryTag(
                id = it.getInt("id"),
                name = it.getString("name"),
                categoryId = it.getInt("category_id"),
                categoryName = category?.name ?: "",
                color = it.str("color") ?: category?.color,
                displayOrder = it.optInt("display_order"),
            )
        }
        val tracks = root.getJSONArray("tracks").objects().map(::track)
        val playlists = root.optJSONArray("playlists")?.objects().orEmpty().map {
            val ids = it.getJSONArray("track_ids")
            Playlist(it.getInt("id"), it.getString("name"), it.str("color"), it.optInt("display_order"), (0 until ids.length()).map(ids::getInt))
        }
        val links = root.getJSONArray("links").let { array ->
            (0 until array.length()).map { array.getJSONArray(it).let { pair -> pair.getInt(0) to pair.getInt(1) } }
        }
        val transitions = root.getJSONArray("transitions").objects().map {
            TransitionEdge(it.getInt("a"), it.getInt("b"), it.getInt("count"), it.getBoolean("favorite"))
        }
        val cameos = root.getJSONArray("cameos").objects().map {
            CameoEdge(it.getInt("host"), it.getInt("guest"), it.getInt("count"), it.getBoolean("favorite"))
        }
        val takes = root.getJSONArray("takes").objects().map {
            TakeEdge(it.getInt("a"), it.getInt("b"), it.getInt("count"), instant(it.str("last_at")))
        }
        val trackArray = root.getJSONArray("tracks")
        // Older desktop/cached snapshots lack fields this app relies on (waveform_rev, settings): stale, resync.
        val stale = !root.has("settings") || (0 until trackArray.length()).any { !trackArray.getJSONObject(it).has("waveform_rev") }
        return Snapshot(
            version, instant(root.str("generated_at")), categories, tags, tracks, playlists, links, transitions, cameos, takes,
            schemaStale = stale,
            settings = root.optJSONObject("settings")?.let { o ->
                o.keys().asSequence().associateWith { k ->
                    val entry = o.getJSONObject(k)
                    SyncedSetting(entry.optJSONObject("value")?.toString(), instant(entry.str("updated_at")))
                }
            }.orEmpty(),
        )
    }

    private fun track(it: JSONObject): LibraryTrack {
        val fileName = it.getString("file_name")
        val grid = it.optJSONObject("grid")?.let { g ->
            Beatgrid(
                origin = g.getString("origin"),
                anchorTime = g.dbl("anchor_time"),
                tempoChanges = g.getJSONArray("tempo_changes").objects().map { tc ->
                    TempoChange(tc.getDouble("start_time"), tc.getDouble("bpm"), tc.optInt("time_signature_num", 4), tc.optInt("bar_position", 1))
                },
            )
        }
        return LibraryTrack(
            id = it.getInt("id"),
            title = it.str("title")?.takeIf { t -> t.isNotBlank() } ?: fileName.substringBeforeLast('.'),
            artist = it.str("artist")?.takeIf { a -> a.isNotBlank() },
            fileName = fileName,
            bpm = it.dbl("bpm"),
            key = it.int("key"),
            keyOpenKey = it.str("key_openkey"),
            keyCamelot = it.str("key_camelot"),
            energy = it.int("energy"),
            durationSecs = it.dbl("duration_secs"),
            dateAdded = instant(it.str("date_added")),
            mainCue = it.dbl("main_cue"),
            codec = it.str("codec"),
            fileSizeBytes = if (it.isNull("filesize_bytes")) null else it.getLong("filesize_bytes"),
            audioRev = it.str("audio_rev"),
            previewRev = it.str("preview_rev"),
            waveformRev = it.str("waveform_rev"),
            stemsRev = it.str("stems_rev"),
            tagIds = it.getJSONArray("tag_ids").let { a -> (0 until a.length()).map(a::getInt) },
            hotCues = it.getJSONArray("hot_cues").objects().map { c ->
                HotCue(c.getInt("slot"), c.getDouble("time"), c.str("label"), c.str("color"))
            },
            grid = grid,
        )
    }

    private fun instant(text: String?): Instant? = text?.let {
        try { OffsetDateTime.parse(it).toInstant() } catch (_: Exception) { null }
    }

    private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map(::getJSONObject)
    private fun JSONObject.str(name: String): String? = if (!has(name) || isNull(name)) null else getString(name)
    private fun JSONObject.dbl(name: String): Double? = if (!has(name) || isNull(name)) null else getDouble(name)
    private fun JSONObject.int(name: String): Int? = if (!has(name) || isNull(name)) null else getInt(name)
}
