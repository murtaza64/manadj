package dev.manadj.app.browse

import dev.manadj.app.toOpenKey

import dev.manadj.library.AudioState
import dev.manadj.library.Library
import dev.manadj.library.LibraryRepository
import java.time.ZoneId

/** The synced desktop Library (#372) seen through the track-list model. */
class SyncedLibrary(val lib: Library, private val repo: LibraryRepository) : LibrarySource {
    override val label = "SYNCED · ${lib.tracks.size}"
    private val rows by lazy {
        lib.tracks.map { t ->
            LibraryTrack(
                t.id.toLong(), t.title, t.artist.orEmpty(), t.bpm, t.keyOpenKey ?: toOpenKey(t.keyCamelot),
                lib.tagsOf(t).map { TrackTag(it.name, it.categoryName, it.argb ?: 0xff7f849c.toInt()) },
                t.dateAdded?.atZone(ZoneId.systemDefault())?.toLocalDate(), t.durationSecs, t.energy, null, null,
            )
        }
    }
    private val previews = java.util.concurrent.ConcurrentHashMap<Long, java.util.Optional<WaveformPreview>>()
    /** Desktop preview bins grouped low/mid/high, decimated for a row-sized strip. */
    /** Reads the store and maps bins: call off the main thread (PreviewWave does). */
    /** Already-built preview without touching the store: null = not loaded yet. */
    fun loadedPreview(id: Long): java.util.Optional<WaveformPreview>? = previews[id]
    fun preview(id: Long): WaveformPreview? = previews.getOrPut(id) { java.util.Optional.ofNullable(buildPreview(id)) }.orElse(null)
    private fun buildPreview(id: Long): WaveformPreview? {
        val wf = lib.track(id.toInt())?.let(lib::preview) ?: return null
        // Desktop preview path: per-frame groupAmps of the 'minimap' style (gains, soft limit, master), max-decimated.
        val style = lib.waveformStyles.minimap
        val frames = wf.bandFrames
        if (frames == 0) return null
        val g = Array(3) { FloatArray(frames) }
        for (f in 0 until frames) style.groupHeights(wf.bandsAt(f)).forEachIndexed { k, v -> g[k][f] = v }
        // Full resolution (the preview blob is ~256 frames): no max-decimation, which inflated peaks.
        return WaveformPreview(frames, g[0], g[1], g[2])
    }
    override fun tracks() = rows
    override fun allTags() = lib.tags.map { TrackTag(it.name, it.categoryName, it.argb ?: 0xff7f849c.toInt()) }
    override fun playlists() = lib.playlists.map { LibraryPlaylist(it.id.toLong(), it.name, null, false, it.trackIds.map(Int::toLong)) }
    /** Desktop Follow (library lystp, golden-tested): synced params + session seed (repo.followSeed). */
    override fun follow(references: Set<Long>): List<FollowCandidate> {
        val tagName = lib.tags.associate { it.id to it.name }
        return repo.follow(references.map(Long::toInt)).map { r ->
            FollowCandidate(
                r.track.id.toLong(), if (r.tier == dev.manadj.library.EvidenceTier.KNOWN) EvidenceTier.KNOWN else EvidenceTier.COMPATIBLE,
                r.label, r.displayScore, r.keyMatched, r.matchedTagIds.mapNotNullTo(HashSet()) { tagName[it] },
                r.breakdown?.let { b -> FollowBreakdown(b.keyRelation.name, b.key, b.sharedTags, b.tags, b.artist, b.energy, b.bpm, b.total) },
            )
        }
    }
    override val followSettings get() = lib.followParams.let { FollowSettings(it.knownOnly, it.temperature) }
    override fun downloaded(id: Long): Boolean = lib.track(id.toInt())?.let(lib.isDownloaded) == true
    /** Only asked for rows not known to be on the phone (DownloadMark), so no file stat: in-flight state or rev. */
    override fun audioLabel(id: Long): String? = lib.track(id.toInt())?.let { t ->
        when (val a = repo.downloads.value[t.id] ?: if (t.audioRev == null) AudioState.Unavailable else AudioState.Remote) {
            AudioState.Cached -> "ON PHONE"; AudioState.Remote -> "DOWNLOAD"; AudioState.Unavailable -> "NO FILE"
            is AudioState.Downloading -> "↓ ${a.fraction?.let { "${(it * 100).toInt()}%" } ?: "…"}"
        }
    }
}
