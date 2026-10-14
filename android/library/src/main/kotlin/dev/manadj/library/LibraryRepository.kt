package dev.manadj.library

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

/** What the sync/status UI shows. */
data class SyncState(
    val running: Boolean = false,
    /** Human-readable phase while running ("Snapshot", "Waveforms 120/1232", "Audio 3/40"). */
    val phase: String? = null,
    val progress: Float? = null,
    val lastSynced: Instant? = null,
    val trackCount: Int = 0,
    val previewCount: Int = 0,
    val audioCount: Int = 0,
    val error: String? = null,
)

/** Per-track audio availability for the list / load buttons. */
sealed interface AudioState {
    data object Unavailable : AudioState // desktop has no file for it
    data object Remote : AudioState // not cached; loading will download
    data class Downloading(val fraction: Float?) : AudioState
    data object Cached : AudioState
}

/**
 * The device's Library: offline cache + pull sync from the desktop.
 * Construct once (app scope); call [open] at start to load the cached
 * snapshot, then [sync] when the desktop is reachable.
 */
class LibraryRepository(
    root: File,
    @Volatile var baseUrl: String,
    /** Desktop LAN listener pairing code (#373); unused over loopback. */
    @Volatile var pairCode: String? = null,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    val store = LibraryStore(root)
    private val _library = MutableStateFlow<Library?>(null)
    val library: StateFlow<Library?> = _library.asStateFlow()
    private val _state = MutableStateFlow(SyncState())
    val state: StateFlow<SyncState> = _state.asStateFlow()
    private val _audio = MutableStateFlow<Map<Int, AudioState>>(emptyMap())
    /** Only tracks with a download in flight; others: [audioState]. */
    val downloads: StateFlow<Map<Int, AudioState>> = _audio.asStateFlow()

    private val syncLock = Mutex()
    private val audioLocks = ConcurrentHashMap<Int, Mutex>()
    private val previewCache = ConcurrentHashMap<String, PreviewWaveform>()

    private fun client() = SyncClient(baseUrl, pairCode)

    private fun build(snapshot: Snapshot) = Library(snapshot) { track ->
        val key = "${track.id}-${track.previewRev ?: return@Library null}"
        previewCache[key] ?: store.readPreview(track)?.also { previewCache[key] = it }
    }

    private fun counts(snapshot: Snapshot) = _state.update {
        it.copy(
            trackCount = snapshot.tracks.size,
            previewCount = snapshot.tracks.count(store::hasPreview),
            audioCount = snapshot.tracks.count(store::hasAudio),
            lastSynced = snapshot.generatedAt,
        )
    }

    /** Load the cached snapshot (offline start). */
    suspend fun open(): Library? = withContext(io) {
        val text = store.readSnapshotText() ?: return@withContext null
        val snapshot = try { SnapshotJson.parse(text) } catch (e: Exception) {
            _state.update { it.copy(error = "Cached library unreadable: ${e.message}") }
            return@withContext null
        }
        counts(snapshot)
        build(snapshot).also { _library.value = it }
    }

    /**
     * Pull the snapshot and missing preview waveforms. The cached library
     * stays usable on failure. With [audio] = true, also pre-syncs audio for
     * every track (otherwise audio downloads on first load).
     */
    suspend fun sync(audio: Boolean = false): Result<Library> = syncLock.withLock {
        withContext(io) {
            val client = client()
            try {
                running("Snapshot", null)
                val text = client.snapshotText()
                val snapshot = SnapshotJson.parse(text)
                val missing = snapshot.tracks.filter { it.previewRev != null && !store.hasPreview(it) }
                var done = 0
                for (batch in missing.chunked(PREVIEW_BATCH)) {
                    running("Waveforms $done/${missing.size}", done.toFloat() / missing.size)
                    val byId = batch.associateBy { it.id }
                    for ((id, blob) in client.previews(batch.map { it.id })) byId[id]?.let { store.writePreview(it, blob) }
                    done += batch.size
                }
                store.writeSnapshotText(text)
                store.prune(snapshot)
                previewCache.keys.retainAll(snapshot.tracks.mapNotNullTo(HashSet()) { t -> t.previewRev?.let { "${t.id}-$it" } })
                val library = build(snapshot)
                _library.value = library
                counts(snapshot)
                if (audio) {
                    val wanted = snapshot.tracks.filter { it.audioRev != null && !store.hasAudio(it) }
                    wanted.forEachIndexed { i, track ->
                        running("Audio ${i + 1}/${wanted.size}", i.toFloat() / wanted.size)
                        fetchAudio(client, track)
                    }
                    counts(snapshot)
                }
                _state.update { it.copy(running = false, phase = null, progress = null, error = null) }
                Result.success(library)
            } catch (e: Exception) {
                _state.update { it.copy(running = false, phase = null, progress = null, error = e.message ?: e.toString()) }
                Result.failure(e)
            }
        }
    }

    private fun running(phase: String, progress: Float?) =
        _state.update { it.copy(running = true, phase = phase, progress = progress, error = null) }

    fun audioState(track: LibraryTrack): AudioState = _audio.value[track.id] ?: when {
        track.audioRev == null -> AudioState.Unavailable
        store.hasAudio(track) -> AudioState.Cached
        else -> AudioState.Remote
    }

    /**
     * The playable local file for [trackId] — cached, or downloaded now.
     * This is what load-to-deck hands the engine (as a file:// Uri).
     */
    suspend fun audioFile(trackId: Int): File = withContext(io) {
        val library = _library.value ?: throw SyncException("Library not synced")
        val track = library.track(trackId) ?: throw SyncException("Track $trackId not in library")
        val target = store.audioFile(track) ?: throw SyncException("Desktop has no audio file for “${track.title}”")
        if (target.isFile) return@withContext target
        fetchAudio(client(), track)
        library.snapshot.let(::counts)
        target
    }

    private suspend fun fetchAudio(client: SyncClient, track: LibraryTrack) {
        val target = store.audioFile(track) ?: return
        audioLocks.getOrPut(track.id) { Mutex() }.withLock {
            if (target.isFile) return
            setAudio(track.id, AudioState.Downloading(null))
            try {
                client.downloadAudio(track.id, target) { done, total ->
                    setAudio(track.id, AudioState.Downloading(total?.let { done.toFloat() / it }))
                }
            } finally {
                _audio.update { it - track.id }
            }
        }
    }

    private fun setAudio(id: Int, state: AudioState) = _audio.update { it + (id to state) }

    /** Remove all cached audio (snapshot and waveforms stay). */
    suspend fun clearAudio() = withContext(io) {
        store.audioDir.listFiles()?.forEach { it.deleteRecursively() }
        _library.value?.snapshot?.let(::counts)
    }

    companion object {
        const val PREVIEW_BATCH = 500
    }
}
