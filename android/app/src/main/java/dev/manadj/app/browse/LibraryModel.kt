package dev.manadj.app.browse

import android.net.Uri
import java.time.LocalDate

/**
 * Track-list model proposed to the #372 library lane (mail android-library-372#1). The UI renders only this;
 * [FixtureLibrary] implements it until #372 lands its Kotlin source.
 */
data class LibraryTrack(
    val id: Long, val title: String, val artist: String, val bpm: Double?, val key: String?,
    val tags: List<TrackTag>, val dateAdded: LocalDate?, val durationSeconds: Double?, val energy: Int?,
    val preview: WaveformPreview?, val uri: Uri?,
)
data class TrackTag(val name: String, val category: String?, val color: Int)
/** Desktop preview bins: 0..1 per group per bin. */
class WaveformPreview(val bins: Int, val low: FloatArray, val mid: FloatArray, val high: FloatArray)

/** CONTEXT.md discovery tiers: Known > Observed > Compatible. */
enum class EvidenceTier(val label: String) { KNOWN("KNOWN"), OBSERVED("OBSERVED"), COMPATIBLE("COMPAT") }
data class FollowCandidate(
    val trackId: Long, val tier: EvidenceTier, val matchScore: Double?, val linked: Boolean,
    val transitionsFrom: Int, val transitionsTo: Int, val takes: Int,
    /** Known-tier reason (desktop rankLabel), e.g. "★ Favorited transition". */
    val knownLabel: String? = null,
)

/** A Playlist (ordered, Play order is its identity) or a folder of playlists. */
data class LibraryPlaylist(val id: Long, val name: String, val parentId: Long?, val folder: Boolean, val trackIds: List<Long> = emptyList())

/** PLAY_ORDER exists only inside a Playlist; sorting never rewrites Play order (CONTEXT.md). */
enum class LibrarySort(val label: String) { PLAY_ORDER("PLAY ORDER"), DATE_ADDED("ADDED"), TITLE("TITLE"), BPM("BPM"), KEY("KEY"), MATCH("MATCH") }
data class LibraryFilter(
    val text: String = "", val tags: Set<String> = emptySet(), val bpmCenter: Double? = null, val bpmTolerance: Double = 6.0,
    val keys: Set<String> = emptySet(), val sort: LibrarySort = LibrarySort.DATE_ADDED,
    /** null = Collection. */
    val playlist: Long? = null,
)

interface LibrarySource {
    val label: String
    fun tracks(): List<LibraryTrack>
    fun allTags(): List<TrackTag>
    fun playlists(): List<LibraryPlaylist>
    /** Candidates for the loaded reference Tracks (Follow mode); union across references, best tier wins. */
    /** [playlist]: rank only within that playlist (desktop Follow `within=`; rows are filtered after anyway). */
    fun follow(references: Set<Long>, knownOnly: Boolean, playlist: Long? = null): List<FollowCandidate>
    /** Row availability on this phone (null = nothing to say). */
    fun audioLabel(id: Long): String? = null
}

fun LibrarySource.query(filter: LibraryFilter, follow: Map<Long, FollowCandidate>?): List<LibraryTrack> {
    val needle = filter.text.trim().lowercase()
    val order = filter.playlist?.let { id -> playlists().firstOrNull { it.id == id }?.trackIds }
    val rows = tracks().filter { t ->
        (order == null || t.id in order) &&
        (needle.isEmpty() || t.title.lowercase().contains(needle) || t.artist.lowercase().contains(needle) || t.tags.any { it.name.lowercase().contains(needle) }) &&
            (filter.tags.isEmpty() || t.tags.any { it.name in filter.tags }) &&
            (filter.keys.isEmpty() || t.key in filter.keys) &&
            (filter.bpmCenter == null || t.bpm?.let { bpm -> listOf(bpm, bpm * 2, bpm / 2).any { kotlin.math.abs(it - filter.bpmCenter) <= filter.bpmTolerance } } == true) &&
            (follow == null || t.id in follow)
    }
    val sorted = when (filter.sort) {
        LibrarySort.PLAY_ORDER -> if (order != null) rows.sortedBy { order.indexOf(it.id) } else rows.sortedByDescending { it.dateAdded }
        LibrarySort.DATE_ADDED -> rows.sortedByDescending { it.dateAdded }
        LibrarySort.TITLE -> rows.sortedBy { it.title.lowercase() }
        LibrarySort.BPM -> rows.sortedBy { it.bpm ?: Double.MAX_VALUE }
        LibrarySort.KEY -> rows.sortedBy { it.key?.dropLast(1)?.toIntOrNull()?.times(2)?.plus(if (it.key.endsWith("B")) 1 else 0) ?: 99 }
        LibrarySort.MATCH -> rows.sortedByDescending { follow?.get(it.id)?.matchScore ?: -1.0 }
    }
    // Follow mode: Known and Observed strata stay pinned on top whatever the sort (CONTEXT.md Follow mode).
    return if (follow == null) sorted else sorted.sortedBy { follow[it.id]?.tier?.ordinal ?: 9 }
}
