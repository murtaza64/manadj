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
                scope.launch { repo.open(); repo.autoSync() }
                watchForeground(app, repo)
            }
        }
    }

    /** Auto-sync whenever the app returns to the foreground (no activity started → one started). */
    private fun watchForeground(app: Context, repo: LibraryRepository) {
        val application = app as? android.app.Application ?: return
        application.registerActivityLifecycleCallbacks(object : android.app.Application.ActivityLifecycleCallbacks {
            private var started = 0
            override fun onActivityStarted(activity: android.app.Activity) {
                if (started++ == 0) scope.launch { repo.autoSync() }
            }
            override fun onActivityStopped(activity: android.app.Activity) { started = maxOf(0, started - 1) }
            override fun onActivityCreated(activity: android.app.Activity, savedInstanceState: android.os.Bundle?) {}
            override fun onActivityResumed(activity: android.app.Activity) {}
            override fun onActivityPaused(activity: android.app.Activity) {}
            override fun onActivitySaveInstanceState(activity: android.app.Activity, outState: android.os.Bundle) {}
            override fun onActivityDestroyed(activity: android.app.Activity) {}
        })
    }

    /** Pull-to-refresh / SYNC: a full sync now (errors surface in `state`). */
    fun refresh(context: Context) {
        val repo = repository(context)
        scope.launch { repo.sync() }
    }

    /** Track picked in the browser: fetch its detail waveform before it's loaded. */
    fun prefetch(context: Context, trackId: Int) {
        val repo = repository(context)
        scope.launch { repo.prefetchWaveform(trackId) }
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

    /** Set/clear the Linked pair for two Tracks (#398): applies now, syncs back to the desktop. */
    fun setLinked(context: Context, a: Int, b: Int, linked: Boolean) {
        val repo = repository(context)
        scope.launch { repo.setLinked(a, b, linked) }
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
    fun downloadAll(context: Context, playlistId: Int? = null, stems: Boolean = false) = LibraryDownloadService.start(context, playlistId, stems)

    fun cancelDownloadAll(context: Context) = repository(context).cancelBulk()

    /**
     * The desktop's current stems for a library track (vocals/drums/bass/other → m4a,
     * aligned with the track audio): cached, else downloaded now. Null when the desktop
     * has none (track.stemsRev == null). Progress: `repository(ctx).stemDownloads`.
     */
    suspend fun stemFiles(context: Context, trackId: Int): Map<String, java.io.File>? =
        repository(context).stemFiles(trackId)

    /** A stem's desktop MWF1 waveform (for the stem lanes of the detail wave). */
    suspend fun stemWaveform(context: Context, trackId: Int, stem: String): dev.manadj.library.DetailWaveform? =
        repository(context).stemWaveform(trackId, stem)

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
        scope.launch { repo.prefetchWaveform(track.id) } // in parallel with the audio
        scope.launch {
            try {
                val file = repo.audioFile(track.id)
                // Stems ride along when already on the phone (never block a load on a 4-file download).
                val stems = if (track.stemsRev != null && repo.hasLocalStems(track))
                    runCatching { repo.stemFiles(track.id) }.getOrNull()?.let { m -> dev.manadj.audio.AudioEngine.STEM_NAMES.map { m.getValue(it) } }
                else null
                val segment = track.grid?.tempoChanges?.firstOrNull()
                model.load(
                    deck, file, sourceId(track), track.title, track.artist.orEmpty(), track.durationSecs,
                    bpm = segment?.bpm ?: track.bpm,
                    firstBeatSeconds = segment?.startTime ?: 0.0,
                    mainCueSeconds = track.mainCue,
                    hotCues = track.hotCues.filter { it.slot in 1..8 }.associate { it.slot - 1 to it.time },
                    stems = stems,
                )
            } catch (e: Exception) {
                onError(e.message ?: e.toString())
            }
        }
    }

    /**
     * Download [trackId]'s stems; when done, reload it onto [deck] with them if the deck still holds it and
     * is not sounding (a playing deck picks them up on its next load).
     */
    fun fetchStems(context: Context, model: PlayerModel, deck: DeckId, trackId: Int, onError: (String) -> Unit) {
        val repo = repository(context)
        scope.launch {
            try {
                repo.stemFiles(trackId) ?: return@launch
                val s = model.decks.getValue(deck).snapshot
                val track = repo.library.value?.track(trackId) ?: return@launch
                if (trackOn(model, deck) == trackId && s?.playing != true && s?.previewing != true) load(context, model, deck, track, onError)
            } catch (e: Exception) {
                onError(e.message ?: e.toString())
            }
        }
    }
}
