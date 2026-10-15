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
import org.json.JSONObject
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
    /** Local edits not yet pushed to the desktop (#375). */
    val pendingEdits: Int = 0,
    /** The cached snapshot predates fields this app needs (e.g. detail waveform revs); a sync fixes it. */
    val cacheStale: Boolean = false,
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
    /** Per-device token from approve-on-desktop pairing (#374). */
    @Volatile var deviceToken: String? = null,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    /** Names this phone in the desktop's Device change log (#375). */
    @Volatile var deviceId: String? = null,
    @Volatile var deviceName: String? = null,
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

    /** Extra pushes run on every [sync] after the edit journal (blocking, on the IO thread). */
    val extraPushes = java.util.concurrent.CopyOnWriteArrayList<(SyncClient) -> Unit>()

    private fun client() = SyncClient(baseUrl, pairCode, deviceToken = deviceToken, deviceId = deviceId, deviceName = deviceName)

    val journal = EditJournal(File(root, "edits.jsonl"))
    /** The last pulled snapshot, without local edits (the diff base for /received). */
    @Volatile private var pulled: Snapshot? = null

    /** Library view = pulled snapshot + unsynced local edits. */
    private fun build(pulled: Snapshot) = buildView(FieldsOverlay.of(pulled, journal.all()))

    private fun buildView(snapshot: Snapshot) = Library(snapshot, previews = { track ->
        val key = "${track.id}-${track.previewRev ?: return@Library null}"
        previewCache[key] ?: store.readPreview(track)?.also { previewCache[key] = it }
    }, isDownloaded = store::hasAudio)

    private fun counts(snapshot: Snapshot) = _state.update {
        it.copy(
            trackCount = snapshot.tracks.size,
            previewCount = snapshot.tracks.count(store::hasPreview),
            audioCount = snapshot.tracks.count(store::hasAudio),
            lastSynced = snapshot.generatedAt,
            cacheStale = snapshot.schemaStale,
        )
    }

    /** Load the cached snapshot (offline start). */
    suspend fun open(): Library? = withContext(io) {
        val text = store.readSnapshotText() ?: return@withContext null
        val snapshot = try { SnapshotJson.parse(text) } catch (e: Exception) {
            _state.update { it.copy(error = "Cached library unreadable: ${e.message}") }
            return@withContext null
        }
        pulled = snapshot
        counts(snapshot)
        build(snapshot).also { _library.value = it }
    }

    /** Unsynced local edits (pushed on the next [sync]). */
    val pendingEdits: Int get() = journal.all().size

    /**
     * Edit a track on the phone (#375): journaled, applied to [library] now,
     * pushed to the desktop on the next sync (newest edit wins there).
     * Returns false when the track is unknown or the edit changes nothing.
     */
    suspend fun edit(trackId: Int, edit: TrackEdit): Boolean = withContext(io) {
        val base = pulled ?: return@withContext false
        val track = _library.value?.track(trackId) ?: return@withContext false
        val (field, old) = TrackFields.current(track, edit)
        val new = TrackFields.newValue(edit)
        if (TrackFields.same(old, new)) return@withContext false
        journal.append(EditJournal.newEdit(trackId, field, old, new))
        _library.value = build(base)
        _state.update { it.copy(pendingEdits = journal.all().size) }
        true
    }

    /**
     * Change a synced performance setting on the phone (#375): the whole JSON
     * value for [key] (PerformanceSettings.WAVEFORM_STYLES / FILTER), journaled
     * and applied now, pushed on the next sync (newest wins on the desktop).
     * Filter: `editSetting(PerformanceSettings.FILTER, audioFilterSettings.toJson())`.
     */
    suspend fun editSetting(key: String, value: JSONObject): Boolean = withContext(io) {
        val base = pulled ?: return@withContext false
        val view = _library.value?.snapshot ?: return@withContext false
        val old = view.settings[key]?.json?.let(::JSONObject)
        if (TrackFields.same(old, value)) return@withContext false
        journal.append(EditJournal.newEdit(null, SETTING_PREFIX + key, old, value))
        _library.value = build(base)
        _state.update { it.copy(pendingEdits = journal.all().size) }
        true
    }

    /** Change the Waveform style slots (synced back to the desktop). */
    suspend fun editWaveformStyles(styles: WaveformStyles): Boolean =
        editSetting(PerformanceSettings.WAVEFORM_STYLES, styles.toJson(currentSetting(PerformanceSettings.WAVEFORM_STYLES)))

    /** Change the Follow parameters (synced back to the desktop's manadj-follow-params). */
    suspend fun editFollowParams(params: FollowParams): Boolean =
        editSetting(PerformanceSettings.FOLLOW, PerformanceSettings.followJson(params, currentSetting(PerformanceSettings.FOLLOW)))

    private val _followSeed = MutableStateFlow((Math.random() * 4294967296.0).toLong())
    /** Session-only Temperature draw seed (desktop paramsStore): random at start, +1 per [rerollFollow]. */
    val followSeed: StateFlow<Long> = _followSeed.asStateFlow()

    /** Reroll: a new Temperature draw over the Compatible rows (Known stays pinned). */
    fun rerollFollow() = _followSeed.update { (it + 1) and 0xffffffffL }

    /** Desktop Follow for the followed [referenceIds] with the synced params and current seed, within the manual filters. */
    fun follow(referenceIds: List<Int>, within: LibraryQuery? = null, params: FollowParams? = null): List<FollowRow> {
        val library = _library.value ?: return emptyList()
        val p = (params ?: library.followParams).copy(seed = _followSeed.value)
        return library.follow(referenceIds, p, within)
    }

    private fun currentSetting(key: String): JSONObject? = _library.value?.snapshot?.settings?.get(key)?.json?.let(::JSONObject)

    /**
     * Pull the snapshot and missing preview waveforms. The cached library
     * stays usable on failure. With [audio] = true, also pre-syncs audio for
     * every track (otherwise audio downloads on first load).
     */
    suspend fun sync(audio: Boolean = false): Result<Library> = syncLock.withLock {
        withContext(io) {
            val client = client()
            try {
                // Push first: the desktop applies newest-wins and logs; answered edits leave the journal.
                val pending = journal.all()
                val pushedFields = HashSet<Pair<Int?, String>>()
                if (pending.isNotEmpty()) {
                    running("Edits ${pending.size}", null)
                    try {
                        val outcomes = client.pushEdits(pending)
                        journal.remove(outcomes.keys)
                        pending.filter { outcomes[it.uuid] == "applied" }.forEach { pushedFields += it.trackId to it.field }
                    } catch (e: SyncException) {
                        // A desktop without two-way sync (#375) yet: keep the journal, still pull.
                        if (e.status != 404 && e.status != 405) throw e
                    }
                }
                // App-side pushes riding the sync (#401 viz ratings); best-effort, never fail the pull.
                for (push in extraPushes) try { push(client) } catch (e: SyncException) { if (e.unpaired) throw e }
                running("Snapshot", null)
                val text = client.snapshotText()
                val snapshot = SnapshotJson.parse(text)
                // Report what this pull changes on the phone (minus our own pushed edits).
                pulled?.let { before ->
                    val received = SnapshotDiff.received(before, snapshot, pushedFields)
                    // Best-effort log entry on the desktop; never fails the pull (older desktops lack /received).
                    if (received.isNotEmpty()) try { client.reportReceived(received) } catch (e: SyncException) { if (e.unpaired) throw e }
                }
                val missing = snapshot.tracks.filter { it.previewRev != null && !store.hasPreview(it) }
                var done = 0
                for (batch in missing.chunked(PREVIEW_BATCH)) {
                    running("Waveforms $done/${missing.size}", done.toFloat() / missing.size)
                    val byId = batch.associateBy { it.id }
                    for ((id, blob) in client.previews(batch.map { it.id })) byId[id]?.let { store.writePreview(it, blob) }
                    done += batch.size
                }
                store.writeSnapshotText(text)
                pulled = snapshot
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
                _state.update { it.copy(running = false, phase = null, progress = null, error = null, pendingEdits = journal.all().size) }
                lastSuccessMs = System.currentTimeMillis()
                Result.success(library)
            } catch (e: Exception) {
                _state.update { it.copy(running = false, phase = null, progress = null, error = e.message ?: e.toString()) }
                Result.failure(e)
            }
        }
    }

    @Volatile private var lastSuccessMs = 0L

    /**
     * Background sync for app start / return to foreground: no-op while a
     * sync runs or within [minIntervalMs] of the last success (a stale or
     * missing cache always syncs). An unreachable desktop is not an error
     * here (the cached library stays, the header keeps its last-synced time).
     */
    suspend fun autoSync(minIntervalMs: Long = AUTO_SYNC_INTERVAL_MS): Boolean {
        if (syncLock.isLocked || bulkLock.isLocked || !autoRunning.compareAndSet(false, true)) return false
        try {
            return autoSyncOnce(minIntervalMs)
        } finally {
            autoRunning.set(false)
        }
    }

    private val autoRunning = java.util.concurrent.atomic.AtomicBoolean(false)

    private suspend fun autoSyncOnce(minIntervalMs: Long): Boolean {
        val cached = pulled
        val fresh = cached != null && !cached.schemaStale && lastSuccessMs != 0L &&
            System.currentTimeMillis() - lastSuccessMs < minIntervalMs
        if (fresh) return false
        val before = _state.value.error
        val result = sync()
        val e = result.exceptionOrNull()
        if (e is SyncException && e.unreachable) _state.update { it.copy(error = before) }
        return result.isSuccess
    }

    /** Start fetching [trackId]'s detail waveform now (track picked in the browser, before load). */
    suspend fun prefetchWaveform(trackId: Int) {
        detailWaveform(trackId)
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

    /** Download a track's audio plus its detail waveform (best-effort) — the offline unit. */
    private suspend fun fetchAudio(
        client: SyncClient,
        track: LibraryTrack,
        cancelled: () -> Boolean = { false },
        onBytes: (Long) -> Unit = {},
    ) {
        fetchWaveform(client, track)
        val target = store.audioFile(track) ?: return
        audioLocks.getOrPut(track.id) { Mutex() }.withLock {
            if (target.isFile) return
            setAudio(track.id, AudioState.Downloading(null))
            try {
                client.downloadAudio(track.id, target, cancelled) { done, total ->
                    setAudio(track.id, AudioState.Downloading(total?.let { done.toFloat() / it }))
                    onBytes(done)
                }
            } finally {
                _audio.update { it - track.id }
            }
        }
    }

    private fun setAudio(id: Int, state: AudioState) = _audio.update { it + (id to state) }

    // --- Detail waveforms (the desktop's full MWF1; the phone never re-analyzes synced tracks) ---

    private val waveformCache = object : LinkedHashMap<String, DetailWaveform>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, DetailWaveform>) = size > WAVEFORM_CACHE
    }

    /**
     * Fetch + store the detail waveform when missing; failures are swallowed
     * (the deck can draw without it). Also tried when the snapshot has no
     * waveform_rev (stale cache, or generated since): the response names the rev.
     * Returns the parsed waveform when it fetched one.
     */
    private fun fetchWaveform(client: SyncClient, track: LibraryTrack): DetailWaveform? {
        if (store.hasWaveform(track)) return null
        return try {
            val blob = client.downloadWaveform(track.id) ?: return null
            val rev = track.waveformRev ?: blob.rev
            store.writeWaveform(track, blob.bytes, rev)
            PreviewWaveform.parse(blob.bytes).also { wf -> rev?.let { r -> synchronized(waveformCache) { waveformCache["${track.id}-$r"] = wf; revFetched[track.id] = r } } }
        } catch (_: SyncException) {
            null
        } catch (_: RuntimeException) {
            null // unparseable blob
        }
    }

    /** Revs learned from the endpoint for tracks whose snapshot lacks waveform_rev. */
    private val revFetched = HashMap<Int, String>()

    /**
     * The full-resolution detail waveform the desktop renders for [trackId]
     * (44.1 kHz / 128-sample peaks, 512-sample 8-band frames): from the
     * offline cache, else fetched now. Null when the desktop hasn't
     * generated one or it's unreachable and not cached.
     */
    suspend fun detailWaveform(trackId: Int): DetailWaveform? = withContext(io) {
        val track = _library.value?.track(trackId) ?: return@withContext null
        val rev = track.waveformRev ?: synchronized(waveformCache) { revFetched[track.id] }
        if (rev != null) synchronized(waveformCache) { waveformCache["${track.id}-$rev"] }?.let { return@withContext it }
        if (track.waveformRev == null) return@withContext fetchWaveform(client(), track) // desktop may have it anyway
        val key = "${track.id}-${track.waveformRev}"
        val waveform = store.readWaveform(track) ?: fetchWaveform(client(), track) ?: store.readWaveform(track) ?: return@withContext null
        synchronized(waveformCache) { waveformCache[key] = waveform }
        waveform
    }

    // --- Bulk offline download ---

    private val _bulk = MutableStateFlow(BulkState())
    /** Progress of [downloadAll] (drives the foreground-service notification and Settings). */
    val bulk: StateFlow<BulkState> = _bulk.asStateFlow()
    private val bulkLock = Mutex()
    @Volatile private var bulkCancel = false

    /** What [downloadAll] would fetch for [playlistId] (null = whole Library) and whether it fits. */
    /** [stems]: also count tracks whose current stems aren't cached (stem sizes aren't in the snapshot; not in [BulkPlan.bytes]). */
    fun bulkPlan(playlistId: Int? = null, stems: Boolean = false): BulkPlan {
        val library = _library.value ?: return BulkPlan(emptyList(), 0, 0, store.root.usableSpace)
        val scope = playlistId?.let(library::playlistTracks) ?: library.tracks
        val missingAudio = { t: LibraryTrack -> t.audioRev != null && !store.hasAudio(t) }
        val wanted = scope.filter {
            missingAudio(it) || (it.waveformRev != null && !store.hasWaveform(it)) || (stems && it.stemsRev != null && !store.hasStems(it))
        }
        val audio = wanted.filter(missingAudio)
        val total = audio.sumOf { it.fileSizeBytes ?: 0L }
        val partial = audio.sumOf { t -> store.audioFile(t)?.let(::partFile)?.takeIf { it.isFile }?.length() ?: 0L }
        return BulkPlan(wanted, total, (total - partial).coerceAtLeast(0), store.root.usableSpace)
    }

    /** Ask a running [downloadAll] to stop after the current chunk (the partial file is kept for resume). */
    fun cancelBulk() {
        bulkCancel = true
    }

    /**
     * Download audio + detail waveforms for every uncached track of
     * [playlistId] (null = the whole Library), resumably, skipping cached ones.
     * Refuses up front when the device lacks space. A track the desktop can't
     * serve (4xx) is counted in [BulkState.failed] and skipped; losing the
     * desktop stops the run with [BulkState.error]. Cached tracks from a
     * stopped run stay; re-running continues where it left off.
     */
    suspend fun downloadAll(playlistId: Int? = null, stems: Boolean = false): Result<BulkState> {
        if (!bulkLock.tryLock()) return Result.failure(SyncException("A download is already running"))
        try {
            return withContext(io) {
                bulkCancel = false
                val name = playlistId?.let { _library.value?.playlist(it)?.name }
                val plan = bulkPlan(playlistId, stems)
                var state = BulkState(running = true, playlistId = playlistId, scopeName = name, tracksTotal = plan.tracks.size, bytesTotal = plan.bytes)
                _bulk.value = state
                if (!plan.fits) {
                    state = state.copy(running = false, error = "Not enough space: needs ${formatBytes(plan.remainingBytes)}, ${formatBytes(plan.freeBytes)} free")
                    _bulk.value = state
                    return@withContext Result.failure(SyncException(state.error!!))
                }
                val client = client()
                var bytesBefore = 0L
                for (track in plan.tracks) {
                    if (bulkCancel) break
                    val needsAudio = track.audioRev != null && !store.hasAudio(track)
                    state = state.copy(current = track.title)
                    _bulk.value = state
                    try {
                        fetchAudio(client, track, { bulkCancel }) { done ->
                            _bulk.value = state.copy(bytesDone = bytesBefore + done)
                        }
                        if (stems) fetchStems(client, track, { bulkCancel })
                        state = state.copy(tracksDone = state.tracksDone + 1)
                    } catch (_: DownloadCancelled) {
                        break
                    } catch (e: SyncException) {
                        if (e.status == null || e.status !in 400..499 || e.unpaired) {
                            state = state.copy(running = false, current = null, error = e.message, bytesDone = _bulk.value.bytesDone)
                            _bulk.value = state
                            _library.value?.snapshot?.let(::counts)
                            return@withContext Result.failure(e)
                        }
                        state = state.copy(failed = state.failed + 1)
                    }
                    if (needsAudio) bytesBefore += track.fileSizeBytes ?: 0L
                    state = state.copy(bytesDone = bytesBefore)
                    _bulk.value = state
                }
                state = state.copy(running = false, current = null, cancelled = bulkCancel, finished = !bulkCancel)
                _bulk.value = state
                _library.value?.snapshot?.let(::counts)
                Result.success(state)
            }
        } finally {
            bulkLock.unlock()
        }
    }

    // --- Stems (the desktop's current 4-stem split; for stem playback) ---

    private val stemLocks = ConcurrentHashMap<Int, Mutex>()
    private val _stems = MutableStateFlow<Map<Int, Float?>>(emptyMap())
    /** Tracks with a stems download in flight → fraction (null = unknown). */
    val stemDownloads: StateFlow<Map<Int, Float?>> = _stems.asStateFlow()

    /** All four stems cached on the phone (track.stemsRev != null = the desktop has them). */
    fun hasLocalStems(track: LibraryTrack) = store.hasStems(track)

    /**
     * The playable stem files for [trackId] (vocals/drums/bass/other → m4a,
     * sample-aligned with the track audio): cached, else downloaded now
     * (resumable). Null when the desktop has no current stems.
     */
    suspend fun stemFiles(trackId: Int): Map<String, File>? = withContext(io) {
        val track = _library.value?.track(trackId) ?: throw SyncException("Track $trackId not in library")
        if (track.stemsRev == null) return@withContext null
        fetchStems(client(), track)
        STEM_NAMES.associateWith { store.stemFile(track, it)!! }
    }

    /** A stem's MWF1 waveform (cached beside the stem, else fetched); null without stems. */
    suspend fun stemWaveform(trackId: Int, stem: String): DetailWaveform? = withContext(io) {
        val track = _library.value?.track(trackId) ?: return@withContext null
        val file = store.stemWaveformFile(track, stem) ?: return@withContext null
        if (!file.isFile) {
            val blob = try { client().downloadStemWaveform(track.id, stem) } catch (_: SyncException) { null } ?: return@withContext null
            file.parentFile?.mkdirs()
            LibraryStore.atomicWrite(file, blob)
        }
        try { PreviewWaveform.parse(file.readBytes()) } catch (_: RuntimeException) { file.delete(); null }
    }

    private suspend fun fetchStems(
        client: SyncClient,
        track: LibraryTrack,
        cancelled: () -> Boolean = { false },
    ) {
        if (track.stemsRev == null) return
        stemLocks.getOrPut(track.id) { Mutex() }.withLock {
            if (store.hasStems(track)) return
            _stems.update { it + (track.id to null) }
            try {
                STEM_NAMES.forEachIndexed { i, stem ->
                    val target = store.stemFile(track, stem)!!
                    if (!target.isFile) client.downloadStem(track.id, stem, target, cancelled) { done, total ->
                        val part = total?.let { t -> done.toFloat() / t } ?: 0f
                        _stems.update { it + (track.id to (i + part) / STEM_NAMES.size) }
                    }
                }
            } finally {
                _stems.update { it - track.id }
            }
        }
    }

    /** Remove all cached stems. */
    suspend fun clearStems() = withContext(io) {
        store.stemsDir.listFiles()?.forEach { it.deleteRecursively() }
    }


    /** Remove all cached audio (snapshot and waveforms stay). */
    suspend fun clearAudio() = withContext(io) {
        store.audioDir.listFiles()?.forEach { it.deleteRecursively() }
        _library.value?.snapshot?.let(::counts)
    }

    companion object {
        const val PREVIEW_BATCH = 500
        const val WAVEFORM_CACHE = 6
        const val AUTO_SYNC_INTERVAL_MS = 60_000L
        /** Kept free on the device after a bulk download. */
        const val SPACE_MARGIN_BYTES = 256L * 1024 * 1024
    }
}

/**
 * A bulk download's scope: [tracks] missing audio and/or their detail waveform,
 * their audio size ([bytes]; [remainingBytes] after resumable partials), and
 * the device's [freeBytes].
 */
data class BulkPlan(val tracks: List<LibraryTrack>, val bytes: Long, val remainingBytes: Long, val freeBytes: Long) {
    val fits: Boolean get() = remainingBytes + LibraryRepository.SPACE_MARGIN_BYTES <= freeBytes
}

/** Progress of [LibraryRepository.downloadAll]. */
data class BulkState(
    val running: Boolean = false,
    /** Null = whole Library. */
    val playlistId: Int? = null,
    val scopeName: String? = null,
    val tracksDone: Int = 0,
    val tracksTotal: Int = 0,
    /** Tracks the desktop couldn't serve (skipped). */
    val failed: Int = 0,
    val bytesDone: Long = 0,
    val bytesTotal: Long = 0,
    /** Title of the track downloading now. */
    val current: String? = null,
    val error: String? = null,
    val cancelled: Boolean = false,
    val finished: Boolean = false,
) {
    val progress: Float? get() = if (bytesTotal > 0) (bytesDone.toFloat() / bytesTotal).coerceIn(0f, 1f) else if (tracksTotal > 0) tracksDone.toFloat() / tracksTotal else null
}

fun formatBytes(bytes: Long): String = when {
    bytes >= 1L shl 30 -> "%.1f GB".format(bytes / (1L shl 30).toDouble())
    bytes >= 1L shl 20 -> "%.0f MB".format(bytes / (1L shl 20).toDouble())
    else -> "${bytes / 1024} KB"
}
