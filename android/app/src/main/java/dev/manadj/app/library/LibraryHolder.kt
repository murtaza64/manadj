package dev.manadj.app.library

import android.content.Context
import dev.manadj.app.PlayerModel
import dev.manadj.audio.DeckId
import dev.manadj.library.LibraryRepository
import dev.manadj.library.LibraryTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
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
            LibraryRepository(File(app.filesDir, "library"), prefs.getString("url", DEFAULT_URL)!!, prefs.getString("pair", null)).also { repo ->
                instance = repo
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
