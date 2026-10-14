package dev.manadj.app.browse

import dev.manadj.library.AudioState
import dev.manadj.library.FollowParams
import dev.manadj.library.Library
import dev.manadj.library.LibraryRepository
import java.time.ZoneId

/** The synced desktop Library (#372) seen through the track-list model. */
class SyncedLibrary(val lib: Library, private val repo: LibraryRepository) : LibrarySource {
    override val label = "SYNCED · ${lib.tracks.size}"
    private val rows by lazy {
        lib.tracks.map { t ->
            LibraryTrack(
                t.id.toLong(), t.title, t.artist.orEmpty(), t.bpm, t.keyCamelot,
                lib.tagsOf(t).map { TrackTag(it.name, it.categoryName, it.argb ?: 0xff7f849c.toInt()) },
                t.dateAdded?.atZone(ZoneId.systemDefault())?.toLocalDate(), t.durationSecs, t.energy, null, null,
            )
        }
    }
    private val previews = mutableMapOf<Long, WaveformPreview?>()
    /** Desktop preview bins grouped low/mid/high, decimated for a row-sized strip. */
    fun preview(id: Long): WaveformPreview? = previews.getOrPut(id) {
        val wf = lib.track(id.toInt())?.let(lib::preview) ?: return@getOrPut null
        // Desktop preview path: per-frame groupAmps of the 'minimap' style (gains, soft limit, master), max-decimated.
        val style = lib.waveformStyles.minimap
        val frames = wf.bandFrames
        if (frames == 0) return@getOrPut null
        val g = Array(3) { FloatArray(frames) }
        for (f in 0 until frames) style.groupHeights(wf.bandsAt(f)).forEachIndexed { k, v -> g[k][f] = v }
        val n = minOf(110, frames).coerceAtLeast(1)
        fun dec(a: FloatArray) = FloatArray(n) { i -> val from = i * a.size / n; val to = maxOf(from + 1, (i + 1) * a.size / n); (from until to).maxOf { a[it] } }
        WaveformPreview(n, dec(g[0]), dec(g[1]), dec(g[2]))
    }
    override fun tracks() = rows
    override fun allTags() = lib.tags.map { TrackTag(it.name, it.categoryName, it.argb ?: 0xff7f849c.toInt()) }
    override fun playlists() = lib.playlists.map { LibraryPlaylist(it.id.toLong(), it.name, null, false, it.trackIds.map(Int::toLong)) }
    override fun follow(references: Set<Long>, knownOnly: Boolean) =
        lib.follow(references.map(Long::toInt), FollowParams(knownOnly = knownOnly)).map { r ->
            val marks = references.map { lib.marks(it.toInt(), r.track.id) }
            FollowCandidate(
                r.track.id.toLong(), EvidenceTier.valueOf(r.tier.name), r.score, linked = marks.any { it.linked },
                transitionsFrom = marks.count { it.transition != dev.manadj.library.TransitionMark.NONE }, transitionsTo = 0,
                takes = r.observedTakes, knownLabel = r.known?.label,
            )
        }
    override fun audioLabel(id: Long): String? = lib.track(id.toInt())?.let { t ->
        when (val a = repo.audioState(t)) {
            AudioState.Cached -> "ON PHONE"; AudioState.Remote -> "DOWNLOAD"; AudioState.Unavailable -> "NO FILE"
            is AudioState.Downloading -> "↓ ${a.fraction?.let { "${(it * 100).toInt()}%" } ?: "…"}"
        }
    }
}
