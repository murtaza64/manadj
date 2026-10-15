package dev.manadj.app.browse

import android.net.Uri
import dev.manadj.app.toOpenKey
import java.time.LocalDate

/**
 * Track-list model the browser renders. [SyncedLibrary] adapts the #372 library; [FixtureLibrary] stands in
 * when nothing is synced.
 */
data class LibraryTrack(
    val id: Long, val title: String, val artist: String, val bpm: Double?, val key: String?,
    val tags: List<TrackTag>, val dateAdded: LocalDate?, val durationSeconds: Double?, val energy: Int?,
    val preview: WaveformPreview?, val uri: Uri?,
)
data class TrackTag(val name: String, val category: String?, val color: Int)
/** Desktop preview bins: 0..1 per group per bin. */
class WaveformPreview(val bins: Int, val low: FloatArray, val mid: FloatArray, val high: FloatArray)

/** Desktop Follow strata: Known, then Compatible. */
enum class EvidenceTier { KNOWN, COMPATIBLE }

/** Per-signal Match-score contributions (desktop breakdown, best reference). */
data class FollowBreakdown(val keyRelation: String, val key: Double, val sharedTags: Int, val tags: Double, val artist: Double, val energy: Double, val bpm: Double, val total: Double)

/** One Follow row, in desktop rank order. */
data class FollowCandidate(
    val trackId: Long, val tier: EvidenceTier,
    /** Section header (desktop rankLabel): "★ Favorited transition" / "🔗 Linked" / "◆ Saved transition" / "Compatible". */
    val label: String,
    /** Desktop shows no score for Known rows. */
    val displayScore: Double?,
    val keyMatched: Boolean = false, val matchedTags: Set<String> = emptySet(),
    val breakdown: FollowBreakdown? = null,
)

/** Which deck(s) Follow follows (#133). */
enum class FollowPin { AUTO, A, B, BOTH }

/** Desktop Follow parameters the browser exposes. */
data class FollowSettings(val knownOnly: Boolean = false, val temperature: Double = 0.0)

/** A Playlist (ordered, Play order is its identity) or a folder of playlists. */
data class LibraryPlaylist(val id: Long, val name: String, val parentId: Long?, val folder: Boolean, val trackIds: List<Long> = emptyList())

/**
 * Display-only sorts (#128; desktop trackSort.ts). PLAY_ORDER = a Playlist's order (or This session's play order);
 * RANK = Follow's desktop order. New sort starts descending for value columns, ascending for orders.
 */
enum class LibrarySort(val label: String, val defaultDescending: Boolean) {
    PLAY_ORDER("PLAY ORDER", false), RANK("RANK", false), DATE_ADDED("ADDED", true), BPM("BPM", true), KEY("KEY", true),
    TITLE("TITLE", true), ARTIST("ARTIST", true), ENERGY("ENERGY", true), DURATION("TIME", true),
}

data class LibraryFilter(
    val text: String = "", val tags: Set<String> = emptySet(), val bpmCenter: Double? = null, val bpmTolerance: Double = 6.0,
    val keys: Set<String> = emptySet(), val sort: LibrarySort = LibrarySort.DATE_ADDED, val descending: Boolean = true,
    /** Only tracks whose audio is cached on the phone (#130.2). */
    val downloadedOnly: Boolean = false,
)

interface LibrarySource {
    val label: String
    fun tracks(): List<LibraryTrack>
    fun allTags(): List<TrackTag>
    fun playlists(): List<LibraryPlaylist>
    /** Follow rows for the followed Tracks (union), desktop order. */
    fun follow(references: Set<Long>): List<FollowCandidate>
    val followSettings: FollowSettings get() = FollowSettings()
    /** Row availability on this phone (null = nothing to say). */
    fun audioLabel(id: Long): String? = null
    /** Audio cached on the phone (playable offline). */
    fun downloaded(id: Long): Boolean = false
}

/**
 * Browser tiers (#130): Collection; Playlists (folders → playlist → tracks); Tags (category → tag → tracks);
 * Follow; This session. [key] identifies a node for per-source memory (scroll, sort) and persistence.
 */
sealed class BrowseNode(val key: String) {
    data object Root : BrowseNode("root")
    data object Collection : BrowseNode("collection")
    data class Playlists(val folder: Long?) : BrowseNode("playlists:${folder ?: ""}")
    data class Playlist(val id: Long) : BrowseNode("playlist:$id")
    data object Tags : BrowseNode("tags")
    data class TagCategory(val category: String) : BrowseNode("tagcat:$category")
    data class Tag(val category: String, val name: String) : BrowseNode("tag:$category/$name")
    data object Follow : BrowseNode("follow")
    data object Session : BrowseNode("session")

    /** Nodes that list tracks (the rest list child nodes). */
    val hasTracks get() = this is Collection || this is Playlist || this is Tag || this is Follow || this is Session
    val defaultSort get() = when (this) { is Playlist, is Session -> LibrarySort.PLAY_ORDER; is Follow -> LibrarySort.RANK; else -> LibrarySort.DATE_ADDED }
    fun allows(sort: LibrarySort) = when (sort) { LibrarySort.PLAY_ORDER -> this is Playlist || this is Session; LibrarySort.RANK -> this is Follow; else -> true }

    companion object {
        fun parse(key: String): BrowseNode? {
            val (kind, arg) = key.substringBefore(':') to key.substringAfter(':', "")
            return when (kind) {
                "root" -> Root; "collection" -> Collection; "tags" -> Tags; "follow" -> Follow; "session" -> Session
                "playlists" -> Playlists(arg.toLongOrNull())
                "playlist" -> arg.toLongOrNull()?.let(::Playlist)
                "tagcat" -> TagCategory(arg)
                "tag" -> Tag(arg.substringBefore('/'), arg.substringAfter('/'))
                else -> null
            }
        }
    }
}

/** A child entry of a container node, with its track count (over the current filters) where meaningful. */
data class BrowseEntry(val node: BrowseNode, val title: String, val count: Int?, val color: Int? = null, val container: Boolean = false)

private val KEY_RE = Regex("^(\\d{1,2})([md])$")

/** Desktop key order (engine key id: 1d, 1m, 2d, 2m … 12m; trackSort.ts sorts by it). */
fun keyOrder(key: String?): Int? {
    val ok = toOpenKey(key) ?: return null
    val m = KEY_RE.matchEntire(ok) ?: return null
    return (m.groupValues[1].toInt() - 1) * 2 + if (m.groupValues[2] == "m") 1 else 0
}

/** Manual filters (search, tags, BPM, keys, downloaded) — desktop FilterState semantics. */
fun LibrarySource.matches(t: LibraryTrack, filter: LibraryFilter): Boolean {
    val needle = filter.text.trim().lowercase()
    return (needle.isEmpty() || t.title.lowercase().contains(needle) || t.artist.lowercase().contains(needle) || t.tags.any { it.name.lowercase().contains(needle) }) &&
        (filter.tags.isEmpty() || t.tags.any { it.name in filter.tags }) &&
        (filter.keys.isEmpty() || t.key in filter.keys) &&
        (filter.bpmCenter == null || t.bpm?.let { bpm -> listOf(bpm, bpm * 2, bpm / 2).any { kotlin.math.abs(it - filter.bpmCenter) <= filter.bpmTolerance } } == true) &&
        (!filter.downloadedOnly || downloaded(t.id))
}

/** The node's base track list in its natural order (Play order / session order / Follow rank / newest first). */
fun LibrarySource.base(node: BrowseNode, follow: List<FollowCandidate>?, played: List<Long>): List<LibraryTrack> {
    val all = tracks()
    val byId by lazy { all.associateBy { it.id } }
    return when (node) {
        is BrowseNode.Playlist -> playlists().firstOrNull { it.id == node.id }?.trackIds?.mapNotNull(byId::get).orEmpty()
        is BrowseNode.Tag -> all.filter { t -> t.tags.any { it.name == node.name && (it.category ?: "") == node.category } }
        is BrowseNode.Follow -> follow?.mapNotNull { byId[it.trackId] }.orEmpty()
        is BrowseNode.Session -> played.asReversed().distinct().mapNotNull(byId::get)
        else -> all
    }
}

/** Display rows for a track node: base order, manual filters, then the display sort (never rewrites Play order). */
fun LibrarySource.rows(node: BrowseNode, filter: LibraryFilter, follow: List<FollowCandidate>?, played: List<Long>, ignoreDownloaded: Boolean = false): List<LibraryTrack> {
    val f = if (ignoreDownloaded) filter.copy(downloadedOnly = false) else filter
    val kept = base(node, follow, played).filter { matches(it, f) }
    return sortRows(kept, filter.sort, filter.descending)
}

/** Nulls last in both directions; ties keep the base order (stable) — desktop sortPlaylistTracks. */
fun sortRows(rows: List<LibraryTrack>, sort: LibrarySort, descending: Boolean): List<LibraryTrack> {
    fun <T : Comparable<T>> by(key: (LibraryTrack) -> T?): List<LibraryTrack> = rows.withIndex().sortedWith { a, b ->
        val ka = key(a.value); val kb = key(b.value)
        when {
            ka == null && kb == null -> a.index - b.index
            ka == null -> 1
            kb == null -> -1
            else -> (if (descending) kb.compareTo(ka) else ka.compareTo(kb)).takeIf { it != 0 } ?: (a.index - b.index)
        }
    }.map { it.value }
    return when (sort) {
        LibrarySort.PLAY_ORDER, LibrarySort.RANK -> if (descending) rows.asReversed() else rows
        LibrarySort.DATE_ADDED -> by { it.dateAdded }
        LibrarySort.BPM -> by { it.bpm }
        LibrarySort.KEY -> by { keyOrder(it.key) }
        LibrarySort.TITLE -> by { it.title.lowercase() }
        LibrarySort.ARTIST -> by { it.artist.lowercase().ifEmpty { null } }
        LibrarySort.ENERGY -> by { it.energy }
        LibrarySort.DURATION -> by { it.durationSeconds }
    }
}

/** Children of a container node with counts over [filter]. */
fun LibrarySource.children(node: BrowseNode, filter: LibraryFilter, played: List<Long>): List<BrowseEntry> {
    val pool by lazy { tracks().filter { matches(it, filter) } }
    val poolIds by lazy { pool.mapTo(HashSet()) { it.id } }
    return when (node) {
        BrowseNode.Root -> listOf(
            BrowseEntry(BrowseNode.Collection, "Collection", pool.size),
            BrowseEntry(BrowseNode.Playlists(null), "Playlists", null, container = true),
            BrowseEntry(BrowseNode.Tags, "Tags", null, container = true),
            BrowseEntry(BrowseNode.Follow, "Follow", null),
            BrowseEntry(BrowseNode.Session, "This session", played.distinct().count { it in poolIds }),
        )
        is BrowseNode.Playlists -> playlists().filter { it.parentId == node.folder }.map { p ->
            if (p.folder) BrowseEntry(BrowseNode.Playlists(p.id), p.name, null, container = true)
            else BrowseEntry(BrowseNode.Playlist(p.id), p.name, p.trackIds.count { it in poolIds })
        }
        BrowseNode.Tags -> allTags().groupBy { it.category ?: "" }.map { (cat, tags) ->
            val names = tags.mapTo(HashSet()) { it.name }
            BrowseEntry(BrowseNode.TagCategory(cat), cat.ifEmpty { "Uncategorised" }, pool.count { t -> t.tags.any { (it.category ?: "") == cat && it.name in names } }, container = true)
        }
        is BrowseNode.TagCategory -> allTags().filter { (it.category ?: "") == node.category }.map { tag ->
            BrowseEntry(BrowseNode.Tag(node.category, tag.name), tag.name, pool.count { t -> t.tags.any { it.name == tag.name && (it.category ?: "") == node.category } }, tag.color)
        }
        else -> emptyList()
    }
}

/** Display title of a node (breadcrumbs, headers). */
fun LibrarySource.title(node: BrowseNode): String = when (node) {
    BrowseNode.Root -> "BROWSE"
    BrowseNode.Collection -> "Collection"
    is BrowseNode.Playlists -> node.folder?.let { id -> playlists().firstOrNull { it.id == id }?.name } ?: "Playlists"
    is BrowseNode.Playlist -> playlists().firstOrNull { it.id == node.id }?.name ?: "Playlist"
    BrowseNode.Tags -> "Tags"
    is BrowseNode.TagCategory -> node.category.ifEmpty { "Uncategorised" }
    is BrowseNode.Tag -> node.name
    BrowseNode.Follow -> "Follow"
    BrowseNode.Session -> "This session"
}

/** The path from the root to [node] (playlist folders resolved through parents). */
fun LibrarySource.pathTo(node: BrowseNode): List<BrowseNode> = when (node) {
    BrowseNode.Root -> listOf(BrowseNode.Root)
    BrowseNode.Collection, BrowseNode.Tags, BrowseNode.Follow, BrowseNode.Session -> listOf(BrowseNode.Root, node)
    is BrowseNode.Playlists -> {
        val chain = generateSequence(node.folder) { id -> playlists().firstOrNull { it.id == id }?.parentId }.toList().asReversed()
        listOf(BrowseNode.Root, BrowseNode.Playlists(null)) + chain.map { BrowseNode.Playlists(it) }
    }
    is BrowseNode.Playlist -> pathTo(BrowseNode.Playlists(playlists().firstOrNull { it.id == node.id }?.parentId)) + node
    is BrowseNode.TagCategory -> listOf(BrowseNode.Root, BrowseNode.Tags, node)
    is BrowseNode.Tag -> listOf(BrowseNode.Root, BrowseNode.Tags, BrowseNode.TagCategory(node.category), node)
}
