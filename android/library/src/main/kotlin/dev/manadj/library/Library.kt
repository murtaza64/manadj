package dev.manadj.library

/**
 * The synced Library, read-only and in memory: what the track list, filter
 * bar and Follow suggestions read. Built from a [Snapshot] plus the cached
 * preview waveforms ([previews] loads lazily from the store).
 */
class Library(
    val snapshot: Snapshot,
    private val previews: (LibraryTrack) -> PreviewWaveform? = { null },
) {
    val tracks: List<LibraryTrack> = snapshot.tracks
    val tags: List<LibraryTag> = snapshot.tags.sortedWith(compareBy({ categoryOrder[it.categoryId] ?: Int.MAX_VALUE }, { it.displayOrder }, { it.id }))
    val categories: List<TagCategory> get() = snapshot.categories
    val playlists: List<Playlist> = snapshot.playlists.sortedWith(compareBy({ it.displayOrder }, { it.id }))

    private val categoryOrder get() = snapshot.categories.associate { it.id to it.displayOrder }
    private val byId = tracks.associateBy { it.id }
    private val tagsById = snapshot.tags.associateBy { it.id }
    private val playlistsById = snapshot.playlists.associateBy { it.id }
    private val follow = FollowIndex(snapshot)

    fun track(id: Int): LibraryTrack? = byId[id]
    fun tag(id: Int): LibraryTag? = tagsById[id]
    fun playlist(id: Int): Playlist? = playlistsById[id]

    /** A Playlist's Tracks in Play order (members missing from the snapshot dropped). */
    fun playlistTracks(id: Int): List<LibraryTrack> = playlistsById[id]?.trackIds?.mapNotNull(byId::get).orEmpty()
    fun tagsOf(track: LibraryTrack): List<LibraryTag> = track.tagIds.mapNotNull(tagsById::get)

    /** The desktop's Waveform styles: draw detail waveforms with [WaveformStyles.full], previews/overviews with [WaveformStyles.minimap]. */
    val waveformStyles: WaveformStyles get() = snapshot.performance.waveformStyles

    /** The desktop's DJ filter tuning (apply to the engine's filter). */
    val filterSettings: FilterSettings get() = snapshot.performance.filter

    /** The 256-bin desktop preview waveform, or null when not synced. */
    fun preview(track: LibraryTrack): PreviewWaveform? = previews(track)

    /** The browse list: the whole collection or one Playlist, filtered and sorted. */
    fun query(query: LibraryQuery = LibraryQuery()): List<LibraryTrack> =
        query.playlistId?.let { LibraryFilter.applyInPlaylist(playlistTracks(it), query) } ?: LibraryFilter.apply(tracks, query)

    /** ◆/★/Linked marks of [candidateId] relative to a deck's loaded Track. */
    fun marks(deckTrackId: Int?, candidateId: Int): RowMarks = follow.marks(deckTrackId, candidateId)

    /**
     * Follow suggestions for the followed (loaded) Tracks, optionally within
     * the manual filters ([within]; Follow composes beside them, never
     * replacing them — desktop Follow mode).
     */
    fun follow(referenceIds: List<Int>, params: FollowParams = FollowParams(), within: LibraryQuery? = null): List<FollowRow> {
        val references = referenceIds.distinct().mapNotNull(byId::get)
        val scope = within?.playlistId?.let(::playlistTracks) ?: tracks
        val pool = if (within == null) scope else scope.filter { LibraryFilter.matches(it, within) }
        return FollowRanker.rank(pool, follow, references, params)
    }
}
