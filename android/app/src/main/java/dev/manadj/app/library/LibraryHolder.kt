package dev.manadj.app.library

import android.content.Context
import dev.manadj.app.PlayerModel
import dev.manadj.audio.DeckId
import dev.manadj.library.FoundDesktop
import dev.manadj.library.LibraryRepository
import dev.manadj.library.PairingClient
import dev.manadj.library.PairingState
import dev.manadj.library.LibraryTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** App-scoped Library (#372): the synced desktop Library cache and load-to-deck. */
object LibraryHolder {
    /** Desktop backend reached over adb reverse (tcp:8127 → desktop backend port). */
    const val DEFAULT_URL = "http://127.0.0.1:8127"
    private const val SOURCE_PREFIX = "library:"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    @Volatile private var instance: LibraryRepository? = null

    fun repository(context: Context): LibraryRepository = instance ?: synchronized(this) {
        instance ?: run {
            val app = context.applicationContext
            val prefs = app.getSharedPreferences("library", Context.MODE_PRIVATE)
            LibraryRepository(
                File(app.filesDir, "library"), prefs.getString("url", DEFAULT_URL)!!, prefs.getString("pair", null),
                deviceToken = prefs.getString("token", null),
            ).also { repo ->
                instance = repo
                repo.deviceId = deviceId(app)
                repo.deviceName = deviceName()
                scope.launch { repo.open() }
            }
        }
    }

    fun setUrl(context: Context, url: String) {
        repository(context).baseUrl = url.trim()
        context.applicationContext.getSharedPreferences("library", Context.MODE_PRIVATE).edit().putString("url", url.trim()).apply()
    }

    fun sourceId(track: LibraryTrack) = "$SOURCE_PREFIX${track.id}:${track.audioRev}"

    /** Pairing code shown in desktop Settings › Library › Phone sync (LAN listener, #373). */
    fun setPairCode(context: Context, code: String) {
        repository(context).pairCode = code.trim().ifEmpty { null }
        context.applicationContext.getSharedPreferences("library", Context.MODE_PRIVATE).edit().putString("pair", code.trim()).apply()
    }

    fun pairCode(context: Context): String = repository(context).pairCode.orEmpty()

    // ── Zero-typing pairing (#374) ──

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences("library", Context.MODE_PRIVATE)

    /** Stable random id for this install; the desktop lists and revokes by it. */
    fun deviceId(context: Context): String = prefs(context).getString("device_id", null)
        ?: java.util.UUID.randomUUID().toString().also { prefs(context).edit().putString("device_id", it).apply() }

    /** Name the desktop shows in its approve prompt and paired-phones list. */
    fun deviceName(): String = listOf(android.os.Build.MANUFACTURER, android.os.Build.MODEL)
        .filter { it.isNotBlank() }.distinct().joinToString(" ").ifBlank { "Android phone" }

    /** Paired with a device token (vs. the typed-code fallback / loopback). */
    fun isPaired(context: Context) = !repository(context).deviceToken.isNullOrBlank()

    /** Forget the device token (e.g. after the desktop unpaired this phone). */
    fun unpair(context: Context) {
        repository(context).deviceToken = null
        prefs(context).edit().remove("token").apply()
    }

    /**
     * Pair with [desktop] (found by [DesktopDiscovery] or typed): requests
     * pairing, reports [onState] (show AwaitingApproval.matchCode big), and on
     * approval stores the URL + device token and runs a first sync.
     */
    fun pair(context: Context, desktop: FoundDesktop, onState: (PairingState) -> Unit) {
        val repo = repository(context)
        scope.launch {
            val token = withContext(Dispatchers.IO) {
                PairingClient(desktop.url).pair(deviceId(context), deviceName(), desktop.name) { state ->
                    scope.launch { onState(state) }
                }
            } ?: return@launch
            setUrl(context, desktop.url)
            repo.deviceToken = token
            prefs(context).edit().putString("token", token).apply()
            repo.sync()
        }
    }

    /**
     * Edit a library track on the phone (#375): applies now, syncs back to the
     * desktop on the next sync. Hot cue slots here are 1..8.
     */
    fun edit(context: Context, trackId: Int, edit: dev.manadj.library.TrackEdit) {
        val repo = repository(context)
        scope.launch { repo.edit(trackId, edit) }
    }

    /**
     * Change a synced setting on the phone (#375), e.g. the DJ filter:
     * `editSetting(ctx, PerformanceSettings.FILTER, audioFilterSettings.toJson())`.
     * Applies now (`library.settingJson`), syncs back to the desktop.
     */
    fun editSetting(context: Context, key: String, json: org.json.JSONObject) {
        val repo = repository(context)
        scope.launch { repo.editSetting(key, json) }
    }

    /** Change the Waveform style slots on the phone (#375): applies now, syncs back to the desktop. */
    fun editWaveformStyles(context: Context, styles: dev.manadj.library.WaveformStyles) {
        val repo = repository(context)
        scope.launch { repo.editWaveformStyles(styles) }
    }

    // ── Offline (bulk) download ──

    /**
     * Download audio + detail waveforms for every uncached track of
     * [playlistId] (null = whole Library) in a foreground service. Progress:
     * `repository(context).bulk`; size/space preview: `bulkPlan(playlistId)`.
     * Android 13+: request POST_NOTIFICATIONS first or the progress notification is hidden.
     */
    fun downloadAll(context: Context, playlistId: Int? = null) = LibraryDownloadService.start(context, playlistId)

    fun cancelDownloadAll(context: Context) = repository(context).cancelBulk()

    /** The desktop's detail waveform for a library track (offline cache, else fetched); null if none. */
    suspend fun detailWaveform(context: Context, trackId: Int): dev.manadj.library.DetailWaveform? =
        repository(context).detailWaveform(trackId)

    /** The library Track id a deck holds, when it was loaded from the Library. */
    fun trackOn(model: PlayerModel, deck: DeckId): Int? =
        model.decks.getValue(deck).source?.id?.takeIf { it.startsWith(SOURCE_PREFIX) }
            ?.removePrefix(SOURCE_PREFIX)?.substringBefore(':')?.toIntOrNull()

    /**
     * Download (if needed) and load a library Track onto [deck] with its
     * snapshot metadata, grid (constant tempo: first segment) and cues.
     */
    fun load(context: Context, model: PlayerModel, deck: DeckId, track: LibraryTrack, onError: (String) -> Unit) {
        val repo = repository(context)
        scope.launch {
            try {
                val file = repo.audioFile(track.id)
                val segment = track.grid?.tempoChanges?.firstOrNull()
                model.load(
                    deck, file, sourceId(track), track.title, track.artist.orEmpty(), track.durationSecs,
                    bpm = segment?.bpm ?: track.bpm,
                    firstBeatSeconds = segment?.startTime ?: 0.0,
                    mainCueSeconds = track.mainCue,
                    hotCues = track.hotCues.filter { it.slot in 1..8 }.associate { it.slot - 1 to it.time },
                )
            } catch (e: Exception) {
                onError(e.message ?: e.toString())
            }
        }
    }
}
