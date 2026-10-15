package dev.manadj.app.session

import android.content.Context
import android.util.Log
import dev.manadj.app.PlayerModel
import dev.manadj.app.library.LibraryHolder
import dev.manadj.library.SyncClient
import dev.manadj.library.session.RecordedSessions
import kotlinx.coroutines.*
import org.json.JSONArray
import java.io.File
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
 * Always-on Session recording (#395): one [SessionRecorder] per process, sampling the shared engine at 20 Hz.
 * Chunks land in [RecordedSessions] every ~5 s; ended Sessions (and, every minute, open ones) push to the paired
 * desktop, which stores them as ordinary Sessions marked with this phone's name. Session replay and the track
 * editor hold the decks as machines (tenure). Process death leaves the open Session to [RecordedSessions.recover].
 */
object SessionRecording {
    private const val TAG = "ManadjRecord"
    private const val POLL_MS = 50L
    private const val FLUSH_SECONDS = 5.0
    private const val PUSH_SECONDS = 60.0

    @Volatile private var player: PlayerModel? = null
    private var app: Context? = null
    private var job: Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    /** Holder of the decks when a machine plays them (Session replay sets "session-replay"). */
    @Volatile var machine: String? = null
    /** Bumped when the recorded list changes (UI refresh). */
    @Volatile var revision = 0L
        private set

    lateinit var store: RecordedSessions
        private set

    fun iso(at: Instant = Instant.now()): String = LocalDateTime.ofInstant(at, ZoneOffset.UTC).toString()

    @Synchronized fun init(context: Context): RecordedSessions {
        if (!::store.isInitialized) {
            app = context.applicationContext
            store = RecordedSessions(File(context.applicationContext.filesDir, "sessions-cache/recorded"))
            store.recover({ iso() }, { iso(Instant.ofEpochMilli(it)) })
        }
        return store
    }

    /** Start (or re-point after an Activity recreation) the recorder at [model]'s engine. Idempotent. */
    @Synchronized fun attach(model: PlayerModel, context: Context) {
        init(context)
        player = model
        if (job != null) return
        job = scope.launch { run() }
    }

    private suspend fun run() {
        var pending = JSONArray()
        var seq = 0
        var lastFlush = 0.0
        var lastPush = 0.0
        val sink = object : SessionRecorder.Sink {
            var uuid: String? = null
            override fun open(uuid: String, startedAt: String, context: JSONArray) {
                this.uuid = uuid; seq = 0
                store.open(uuid, startedAt)
                store.append(uuid, seq++, context)
                revision++
                Log.i(TAG, "session $uuid opened (${context.length()} context events)")
            }
            override fun events(events: JSONArray) { for (i in 0 until events.length()) pending.put(events.get(i)) }
            override fun close(endedAt: String) {
                val u = uuid ?: return
                flush(u)
                store.end(u, endedAt)
                uuid = null; revision++
                Log.i(TAG, "session $u ended")
                scope.launch(Dispatchers.IO) { pushAll() }
            }
            fun flush(u: String) { if (pending.length() > 0) { store.append(u, seq++, pending); pending = JSONArray() } }
        }
        val recorder = SessionRecorder({ trackOf(it) }, sink, { iso() })
        while (currentCoroutineContext().isActive) {
            val snap = runCatching { player?.engineSnapshot() }.getOrNull()
            val held = machine ?: if (dev.manadj.app.edit.TrackEditNav.request != null) "track-edit" else null
            if (snap != null) runCatching { recorder.observe(snap, held) }.onFailure { Log.w(TAG, "recorder: $it") }
            val now = System.nanoTime() / 1e9
            sink.uuid?.let { if (now - lastFlush >= FLUSH_SECONDS) { lastFlush = now; runCatching { sink.flush(it) } } }
            if (now - lastPush >= PUSH_SECONDS) { lastPush = now; scope.launch(Dispatchers.IO) { pushAll() } }
            delay(POLL_MS)
        }
    }

    private fun trackOf(sourceId: String?): Int? =
        sourceId?.takeIf { it.startsWith("library:") }?.removePrefix("library:")?.substringBefore(':')?.toIntOrNull()

    private val pushLock = Any()

    /** Upload every recorded Session the desktop lacks; quiet when unpaired/unreachable (retried later). */
    fun pushAll(): Int = synchronized(pushLock) {
        val context = app ?: return 0
        val repo = LibraryHolder.repository(context)
        if (repo.baseUrl.isBlank()) return 0
        val client = SyncClient(repo.baseUrl, repo.pairCode, deviceToken = repo.deviceToken, deviceId = repo.deviceId, deviceName = repo.deviceName)
        var pushed = 0
        for (m in store.all()) {
            if (m.endPushed) continue
            try { if (store.push(m.uuid, { client.pushSession(m.uuid, it) })) pushed++ }
            catch (e: Exception) { Log.i(TAG, "push ${m.uuid}: ${e.message}"); break }
        }
        if (pushed > 0) revision++
        pushed
    }
}
