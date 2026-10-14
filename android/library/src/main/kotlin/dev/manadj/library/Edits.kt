package dev.manadj.library

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * Phone-side track edits for two-way Device sync (ADR 0045, #375). Edits are
 * journaled (field, old → new, wall-clock time), applied locally at once as
 * an overlay on the cached snapshot, and pushed to the desktop on the next
 * sync, where the newest edit wins and every change is logged.
 */
sealed interface TrackEdit {
    /** Slot 1..8; time null clears the slot. */
    data class HotCueSet(val slot: Int, val time: Double?, val label: String? = null, val color: String? = null) : TrackEdit
    data class MainCue(val time: Double?) : TrackEdit
    data class TagSet(val tagId: Int, val on: Boolean) : TrackEdit
    data class Title(val value: String?) : TrackEdit
    data class Artist(val value: String?) : TrackEdit
    data class Energy(val value: Int?) : TrackEdit
    /** Engine DJ key id 0..23 (null clears). */
    data class Key(val engineId: Int?) : TrackEdit
}

/**
 * One journaled edit, in the desktop's field vocabulary (backend/device_edits.py).
 * Synced performance settings are `setting:<key>` with [trackId] null and the
 * whole setting JSON object as old/new.
 */
data class JournaledEdit(val uuid: String, val trackId: Int?, val field: String, val old: Any?, val new: Any?, val editedAtMs: Long) {
    val settingKey: String? get() = this.field.takeIf { it.startsWith(SETTING_PREFIX) }?.removePrefix(SETTING_PREFIX)

    fun toJson(): JSONObject = JSONObject()
        .put("uuid", uuid).put("track_id", trackId ?: JSONObject.NULL).put("field", field)
        .put("old", old ?: JSONObject.NULL).put("new", new ?: JSONObject.NULL).put("edited_at_ms", editedAtMs)

    companion object {
        fun fromJson(o: JSONObject) = JournaledEdit(
            o.getString("uuid"), if (o.isNull("track_id")) null else o.getInt("track_id"), o.getString("field"),
            o.opt("old").takeUnless { it == JSONObject.NULL }, o.opt("new").takeUnless { it == JSONObject.NULL },
            o.getLong("edited_at_ms"),
        )
    }
}

const val SETTING_PREFIX = "setting:"

/** Engine DJ key id → (OpenKey, Camelot); mirrors backend/key.py. */
internal val KEY_TABLE: Map<Int, Pair<String, String>> = listOf(
    "1d" to "8B", "1m" to "8A", "2d" to "9B", "2m" to "9A", "3d" to "10B", "3m" to "10A", "4d" to "11B", "4m" to "11A",
    "5d" to "12B", "5m" to "12A", "6d" to "1B", "6m" to "1A", "7d" to "2B", "7m" to "2A", "8d" to "3B", "8m" to "3A",
    "9d" to "4B", "9m" to "4A", "10d" to "5B", "10m" to "5A", "11d" to "6B", "11m" to "6A", "12d" to "7B", "12m" to "7A",
).withIndex().associate { (i, v) -> i to v }

object TrackFields {
    private fun cueJson(c: HotCue?): JSONObject? = c?.let {
        JSONObject().put("time", it.time).put("label", it.label ?: JSONObject.NULL).put("color", it.color ?: JSONObject.NULL)
    }

    /** (field, value now) for an edit against [track]. */
    fun current(track: LibraryTrack, edit: TrackEdit): Pair<String, Any?> = when (edit) {
        is TrackEdit.HotCueSet -> "hot_cue:${edit.slot}" to cueJson(track.hotCues.firstOrNull { it.slot == edit.slot })
        is TrackEdit.MainCue -> "main_cue" to track.mainCue
        is TrackEdit.TagSet -> "tag:${edit.tagId}" to (edit.tagId in track.tagIds)
        is TrackEdit.Title -> "title" to track.title
        is TrackEdit.Artist -> "artist" to track.artist
        is TrackEdit.Energy -> "energy" to track.energy
        is TrackEdit.Key -> "key" to track.key
    }

    fun newValue(edit: TrackEdit): Any? = when (edit) {
        is TrackEdit.HotCueSet -> edit.time?.let { cueJson(HotCue(edit.slot, it, edit.label, edit.color)) }
        is TrackEdit.MainCue -> edit.time
        is TrackEdit.TagSet -> edit.on
        is TrackEdit.Title -> edit.value
        is TrackEdit.Artist -> edit.value
        is TrackEdit.Energy -> edit.value
        is TrackEdit.Key -> edit.engineId
    }

    /** Read a field off a track in wire form (for diffs). */
    fun read(track: LibraryTrack, field: String): Any? = when {
        field.startsWith("hot_cue:") -> cueJson(track.hotCues.firstOrNull { it.slot == field.substringAfter(':').toInt() })
        field.startsWith("tag:") -> field.substringAfter(':').toInt() in track.tagIds
        field == "main_cue" -> track.mainCue
        field == "title" -> track.title
        field == "artist" -> track.artist
        field == "energy" -> track.energy
        field == "key" -> track.key
        else -> null
    }

    /** Fields Device sync carries both ways, for diffing two snapshots of a track. */
    fun syncedFields(a: LibraryTrack, b: LibraryTrack): List<String> =
        (1..8).map { "hot_cue:$it" } + listOf("main_cue", "title", "artist", "energy", "key") +
            (a.tagIds + b.tagIds).toSortedSet().map { "tag:$it" }

    /** Value equality in wire form (JSON objects deep, numbers by value). */
    fun same(x: Any?, y: Any?): Boolean = when {
        x is JSONObject && y is JSONObject -> x.length() == y.length() && x.keys().asSequence().all { y.has(it) && same(x.opt(it), y.opt(it)) }
        x is JSONArray && y is JSONArray -> x.length() == y.length() && (0 until x.length()).all { same(x.opt(it), y.opt(it)) }
        x is Number && y is Number -> x.toDouble() == y.toDouble()
        x == JSONObject.NULL || y == JSONObject.NULL -> (x ?: JSONObject.NULL) == (y ?: JSONObject.NULL)
        else -> x == y
    }

    /** Apply a journaled edit to a track (the local overlay). */
    fun apply(track: LibraryTrack, e: JournaledEdit): LibraryTrack {
        val v = e.new
        return when {
            e.field.startsWith("hot_cue:") -> {
                val slot = e.field.substringAfter(':').toInt()
                val rest = track.hotCues.filter { it.slot != slot }
                val cue = (v as? JSONObject)?.let { HotCue(slot, it.getDouble("time"), it.optString("label").takeIf { s -> !it.isNull("label") && s.isNotEmpty() }, it.optString("color").takeIf { s -> !it.isNull("color") && s.isNotEmpty() }) }
                track.copy(hotCues = (rest + listOfNotNull(cue)).sortedBy { it.slot })
            }
            e.field.startsWith("tag:") -> {
                val id = e.field.substringAfter(':').toInt()
                track.copy(tagIds = if (v == true) (track.tagIds + id).distinct().sorted() else track.tagIds - id)
            }
            e.field == "main_cue" -> track.copy(mainCue = (v as? Number)?.toDouble())
            e.field == "title" -> track.copy(title = (v as? String) ?: track.fileName.substringBeforeLast('.'))
            e.field == "artist" -> track.copy(artist = v as? String)
            e.field == "energy" -> track.copy(energy = (v as? Number)?.toInt())
            e.field == "key" -> {
                val id = (v as? Number)?.toInt()
                val names = id?.let(KEY_TABLE::get)
                track.copy(key = id, keyOpenKey = names?.first, keyCamelot = names?.second)
            }
            else -> track
        }
    }

    fun overlay(snapshot: Snapshot, edits: List<JournaledEdit>): Snapshot {
        if (edits.isEmpty()) return snapshot
        val byTrack = edits.filter { it.trackId != null }.groupBy { it.trackId }
        val settings = edits.mapNotNull { e -> e.settingKey?.let { it to e } }
        return snapshot.copy(
            tracks = snapshot.tracks.map { t -> byTrack[t.id]?.fold(t, ::apply) ?: t },
            settings = if (settings.isEmpty()) snapshot.settings else snapshot.settings + settings.map { (key, e) ->
                key to SyncedSetting((e.new as? JSONObject)?.toString(), java.time.Instant.ofEpochMilli(e.editedAtMs))
            },
        )
    }
}

/** Append-only journal file of unsynced edits (edits.jsonl in the store root). */
class EditJournal(private val file: File) {
    @Synchronized fun all(): List<JournaledEdit> =
        if (!file.isFile) emptyList()
        else file.readLines().filter { it.isNotBlank() }.mapNotNull { runCatching { JournaledEdit.fromJson(JSONObject(it)) }.getOrNull() }

    @Synchronized fun append(edit: JournaledEdit) {
        file.parentFile?.mkdirs()
        file.appendText(edit.toJson().toString() + "\n")
    }

    /** Drop edits the desktop has answered for. */
    @Synchronized fun remove(uuids: Set<String>) {
        val kept = all().filter { it.uuid !in uuids }
        LibraryStore.atomicWrite(file, kept.joinToString("") { it.toJson().toString() + "\n" }.toByteArray())
    }

    companion object {
        fun newEdit(trackId: Int?, field: String, old: Any?, new: Any?, now: Long = System.currentTimeMillis()) =
            JournaledEdit(UUID.randomUUID().toString(), trackId, field, old, new, now)
    }
}

internal fun editsBody(edits: List<JournaledEdit>) = JSONObject().put("edits", JSONArray(edits.map { it.toJson() }))

internal object FieldsOverlay {
    fun of(snapshot: Snapshot, edits: List<JournaledEdit>) = TrackFields.overlay(snapshot, edits)
}

/** Desktop → phone changes a pull brings, per synced field (#375). */
object SnapshotDiff {
    fun received(before: Snapshot, after: Snapshot, exclude: Set<Pair<Int?, String>> = emptySet()): List<JSONObject> {
        val old = before.tracks.associateBy { it.id }
        val out = ArrayList<JSONObject>()
        for (t in after.tracks) {
            val o = old[t.id] ?: continue // new tracks are not field changes
            for (field in TrackFields.syncedFields(o, t)) {
                if ((t.id to field) in exclude) continue
                val a = TrackFields.read(o, field)
                val b = TrackFields.read(t, field)
                if (!TrackFields.same(a, b)) {
                    out += JSONObject().put("track_id", t.id).put("field", field).put("old", a ?: JSONObject.NULL).put("new", b ?: JSONObject.NULL)
                }
            }
        }
        for (key in (before.settings.keys + after.settings.keys).toSortedSet()) {
            val field = SETTING_PREFIX + key
            if ((null to field) in exclude) continue
            val a = before.settings[key]?.json?.let(::JSONObject)
            val b = after.settings[key]?.json?.let(::JSONObject)
            if (!TrackFields.same(a, b)) {
                out += JSONObject().put("track_id", JSONObject.NULL).put("field", field).put("old", a ?: JSONObject.NULL).put("new", b ?: JSONObject.NULL)
            }
        }
        return out
    }
}
