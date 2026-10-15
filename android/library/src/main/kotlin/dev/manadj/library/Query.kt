package dev.manadj.library

enum class TagMatch { ANY, ALL }

/** PLAY_ORDER applies inside a Playlist (falls back to DATE_ADDED for the whole collection). */
enum class SortColumn { PLAY_ORDER, DATE_ADDED, TITLE, ARTIST, BPM, KEY, ENERGY, DURATION }

/**
 * The browse filters — desktop FilterState semantics
 * (frontend/src/components/playlistFilter.ts, backend crud.get_tracks).
 * Defaults are neutral; the default sort is newest-added first.
 */
data class LibraryQuery(
    /** Browse one Playlist (null = the whole collection); filters apply within it. */
    val playlistId: Int? = null,
    /** Case-insensitive substring over title, artist and file name. */
    val search: String = "",
    val tagIds: Set<Int> = emptySet(),
    val tagMatch: TagMatch = TagMatch.ANY,
    /** Null or 1..5 = no energy filter (keeps energy-less tracks). */
    val energy: IntRange? = null,
    /** BPM window around the center, folded at ×2 / ÷2; excludes BPM-less tracks. */
    val bpmCenter: Double? = null,
    val bpmPercent: Double = 5.0,
    /** OpenKey ids ("8m"); any match; excludes keyless tracks. */
    val keysOpenKey: Set<String> = emptySet(),
    val sort: SortColumn = SortColumn.DATE_ADDED,
    val descending: Boolean = true,
    /** Only tracks whose audio is cached on the phone (playable offline). */
    val downloadedOnly: Boolean = false,
)

object LibraryFilter {
    /** [downloaded]: is the track's audio cached on the phone (for [LibraryQuery.downloadedOnly]). */
    fun matches(track: LibraryTrack, query: LibraryQuery, downloaded: (LibraryTrack) -> Boolean = { true }): Boolean {
        if (query.downloadedOnly && !downloaded(track)) return false
        val needle = query.search.trim().lowercase()
        if (needle.isNotEmpty()) {
            val hit = listOfNotNull(track.title, track.artist, track.fileName).any { it.lowercase().contains(needle) }
            if (!hit) return false
        }
        val energy = query.energy
        if (energy != null && !(energy.first <= 1 && energy.last >= 5)) {
            val e = track.energy ?: return false
            if (e !in energy) return false
        }
        if (query.tagIds.isNotEmpty()) {
            val present = query.tagIds.count { it in track.tagIds }
            val pass = if (query.tagMatch == TagMatch.ALL) present == query.tagIds.size else present > 0
            if (!pass) return false
        }
        val center = query.bpmCenter
        if (center != null && !inBpmWindow(track.bpm ?: return false, center, query.bpmPercent)) return false
        if (query.keysOpenKey.isNotEmpty() && track.keyOpenKey !in query.keysOpenKey) return false
        return true
    }

    /** Within ±percent of the center or its double/half (each fold scales its own window). */
    fun inBpmWindow(bpm: Double, center: Double, percent: Double): Boolean =
        listOf(center, center * 2, center / 2).any { fold ->
            val threshold = fold * percent / 100
            bpm >= fold - threshold && bpm <= fold + threshold
        }

    fun apply(tracks: List<LibraryTrack>, query: LibraryQuery, downloaded: (LibraryTrack) -> Boolean = { true }): List<LibraryTrack> =
        tracks.filter { matches(it, query, downloaded) }.sortedWith(comparator(query.sort, query.descending))

    /**
     * Filter + sort within a Playlist's members ([members] in Play order).
     * PLAY_ORDER keeps the curated order (descending reverses it); any other
     * sort only changes the view, never the Play order.
     */
    fun applyInPlaylist(members: List<LibraryTrack>, query: LibraryQuery, downloaded: (LibraryTrack) -> Boolean = { true }): List<LibraryTrack> {
        val kept = members.filter { matches(it, query, downloaded) }
        return when (query.sort) {
            SortColumn.PLAY_ORDER -> if (query.descending) kept.asReversed() else kept
            else -> kept.sortedWith(comparator(query.sort, query.descending))
        }
    }

    /** Nulls sort last in both directions; text sorts are case-insensitive. */
    fun comparator(column: SortColumn, descending: Boolean): Comparator<LibraryTrack> {
        fun <T : Comparable<T>> by(key: (LibraryTrack) -> T?): Comparator<LibraryTrack> = Comparator { a, b ->
            val ka = key(a)
            val kb = key(b)
            when {
                ka == null && kb == null -> 0
                ka == null -> 1
                kb == null -> -1
                else -> if (descending) kb.compareTo(ka) else ka.compareTo(kb)
            }
        }
        val primary: Comparator<LibraryTrack> = when (column) {
            SortColumn.DATE_ADDED, SortColumn.PLAY_ORDER -> by { it.dateAdded }
            SortColumn.TITLE -> by { it.title.lowercase() }
            SortColumn.ARTIST -> by { it.artist?.lowercase() }
            SortColumn.BPM -> by { it.bpm }
            SortColumn.KEY -> by { it.key ?: it.keyOpenKey?.let(::openKeyOrder) } // desktop trackSort: engine key id
            SortColumn.ENERGY -> by { it.energy }
            SortColumn.DURATION -> by { it.durationSecs }
        }
        // Stable tiebreak: newest id first, like the desktop's created_at/id order.
        return primary.thenComparator { a, b -> b.id.compareTo(a.id) }
    }

    /** Engine key id order (desktop trackSort): 1d, 1m, 2d, 2m … 12m — fallback when only OpenKey is known. */
    fun openKeyOrder(openKey: String): Int? {
        val match = Regex("^(\\d+)([md])$").matchEntire(openKey) ?: return null
        return (match.groupValues[1].toInt() - 1) * 2 + if (match.groupValues[2] == "m") 1 else 0
    }
}
