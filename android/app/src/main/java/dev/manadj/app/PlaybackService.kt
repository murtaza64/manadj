package dev.manadj.app

import android.app.*
import android.content.*
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.*
import androidx.core.content.ContextCompat
import dev.manadj.audio.*
import java.util.concurrent.Executors

/** One service-owned engine survives view/layout changes and the Android document picker. */
class PlaybackService : Service() {
    inner class LocalBinder : Binder() { val service get() = this@PlaybackService }
    private val binder = LocalBinder()
    private val lifetime = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var engine: AudioEngine? = null
    @Volatile var failure: String? = null
        private set
    @Volatile private var destroyed = false
    private var foreground = false
    private var closedSince = 0L
    private var hasFocus = false
    private val sourceMetadata = mutableMapOf<String, LocalSource>()
    private lateinit var audioManager: AudioManager
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
    private val focusRequest by lazy {
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener({ change ->
                hasFocus = change == AudioManager.AUDIOFOCUS_GAIN
                if (!hasFocus) pauseAll("Paused: another app took audio focus ($change)")
            }, main).build()
    }
    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) { if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) pauseAll("Paused: audio output became noisy (headphones unplugged)") }
    }

    override fun onCreate() {
        super.onCreate()
        audioManager = getSystemService(AudioManager::class.java)
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("playback", "Playback", NotificationManager.IMPORTANCE_LOW))
        ContextCompat.registerReceiver(this, noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED)
        lifetime.execute {
            try {
                val opened = AudioEngine()
                if (destroyed) opened.close() else engine = opened
            } catch (error: Exception) { failure = "Audio output unavailable: ${error.message}" }
            catch (error: LinkageError) { failure = "Native audio library unavailable: ${error.message}" }
        }
        main.post(monitor)
    }

    override fun onBind(intent: Intent?): IBinder = binder
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") { pauseAll("Stopped from the notification"); stopForeground(STOP_FOREGROUND_REMOVE); foreground = false; stopSelf() }
        else if (!foreground) { startForeground(1, notification()); foreground = true }
        return START_NOT_STICKY
    }

    fun snapshot(): EngineSnapshot? {
        if (destroyed) return null
        return try { engine?.snapshot() } catch (error: IllegalStateException) { failure = error.message; null }
    }

    /** Reopens the stream off the main thread when channels/device change; result via [onDone] on main. */
    fun configureOutput(routing: Routing, deviceId: Int, onDone: (Int) -> Unit) {
        lifetime.execute {
            val result = engine?.configureOutput(routing, deviceId) ?: -1
            main.post { onDone(result) }
        }
    }

    fun filterResponseDb(settings: FilterSettings, position: Double, frequencies: DoubleArray): DoubleArray? =
        if (destroyed) null else try { engine?.filterResponseDb(settings, position, frequencies) } catch (_: IllegalStateException) { null }
    fun outputInfo(): OutputInfo? = if (destroyed) null else try { engine?.outputInfo() } catch (_: IllegalStateException) { null }

    fun source(id: String?): LocalSource? = sourceMetadata[id]

    fun load(deck: DeckId, source: LocalSource, descriptor: ParcelFileDescriptor): CommandReceipt {
        if (snapshot()?.outputOpen != true) return CommandReceipt(0, false, failure ?: "Audio output unavailable")
        val receipt = engine?.load(deck, source.id, descriptor) ?: CommandReceipt(0, false, failure ?: "Audio output is starting")
        if (receipt.accepted) sourceMetadata[source.id] = source
        return receipt
    }

    fun submit(command: AudioCommand): CommandReceipt {
        if (destroyed) return CommandReceipt(0, false, "Audio service closed")
        val audio = engine ?: return CommandReceipt(0, false, failure ?: "Audio output is starting")
        if (command is AudioCommand.Play || command is AudioCommand.CueDown || command is AudioCommand.HotCueDown) {
            startingPlayback()?.let { return CommandReceipt(0, false, it) }
        }
        return audio.submit(command)
    }

    /** Frame-stamped commands (Session replay): see [AudioEngine.schedule]. */
    fun schedule(atFrame: Long, commands: List<AudioCommand>, tag: Long): List<CommandReceipt> {
        val audio = engine.takeIf { !destroyed } ?: return commands.map { CommandReceipt(0, false, failure ?: "Audio output unavailable") }
        if (commands.any { it is AudioCommand.Play }) startingPlayback()?.let { reason -> return commands.map { CommandReceipt(0, false, reason) } }
        return audio.schedule(atFrame, commands, tag)
    }

    fun cancelScheduled(tag: Long) { if (!destroyed) engine?.cancelScheduled(tag) }

    /** Output open, audio focus, foreground service before anything starts sounding; null = ok, else why not. */
    private fun startingPlayback(): String? {
        if (snapshot()?.outputOpen != true) return "Audio output unavailable"
        if (!hasFocus) hasFocus = audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        if (!hasFocus) return "Android denied audio focus"
        try {
            if (!foreground) {
                ContextCompat.startForegroundService(this, Intent(this, PlaybackService::class.java))
                startForeground(1, notification())
                foreground = true
            }
        } catch (error: RuntimeException) { return "Cannot start foreground playback: ${error.message}" }
        return null
    }

    /** Last system-initiated pause, surfaced by the UI so stops are never silent. */
    @Volatile var pauseReason: String? = null

    fun pauseAll(reason: String) {
        val audio = engine ?: return
        if (DeckId.entries.any { snapshot()?.decks?.get(it)?.let { d -> d.playing || d.previewing } == true }) {
            pauseReason = reason
            android.util.Log.i("manadj", reason)
        }
        DeckId.entries.forEach { deck ->
            audio.submit(AudioCommand.SetBend(deck, 0.0))
            audio.submit(AudioCommand.Pause(deck))
        }
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, PlaybackService::class.java).setAction("STOP"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, "playback").setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("manadj playback").setContentText("Native shared audio output")
            .setContentIntent(open).setOngoing(true).addAction(Notification.Action.Builder(null, "Stop", stop).build()).build()
    }

    private var ticks = 0
    private val monitor = object : Runnable {
        override fun run() {
            if (destroyed) return
            val state = snapshot()
            // Oboe reopens after a disconnect on its own; if that failed, retry here off the main thread.
            if (state != null && !state.outputOpen) {
                val now = SystemClock.uptimeMillis()
                if (closedSince == 0L) closedSince = now
                else if (now - closedSince >= 2000) { closedSince = now; lifetime.execute { engine?.reopen() } }
            } else closedSince = 0L
            if (foreground && state != null && state.appliedCommandId >= state.acceptedCommandId && state.decks.values.none { it.playing || it.previewing }) {
                stopForeground(STOP_FOREGROUND_REMOVE); foreground = false; stopSelf()
                audioManager.abandonAudioFocusRequest(focusRequest); hasFocus = false
            }
            // Every 10 s while playing: callback cost + deck modes, readable via `adb logcat -s manadj-bench`.
            if (state != null && ++ticks % 20 == 0 && state.decks.values.any { it.playing || it.previewing }) {
                val cost = try { engine?.renderCost() } catch (_: IllegalStateException) { null }
                val decks = state.decks.filterValues { it.playing || it.previewing }.entries.joinToString(" ") { (id, d) ->
                    "$id:${if (d.keyLockActive) "KL" else if (d.keyLock) "kl(wait)" else "rs"}${if (d.fromMemory) "/mem" else ""}"
                }
                if (cost != null) android.util.Log.i("manadj-bench", "callback max %.0f us mean %.0f us n=%d nearMiss=%d xruns=%d [%s]".format(cost.maxMicros, cost.meanMicros, cost.callbacks, cost.nearMisses, state.outputXruns, decks))
            }
            main.postDelayed(this, 500)
        }
    }

    override fun onDestroy() {
        destroyed = true
        main.removeCallbacks(monitor)
        unregisterReceiver(noisy)
        audioManager.abandonAudioFocusRequest(focusRequest)
        lifetime.execute { val old = engine; engine = null; old?.close() }
        lifetime.shutdown()
        super.onDestroy()
    }
}
