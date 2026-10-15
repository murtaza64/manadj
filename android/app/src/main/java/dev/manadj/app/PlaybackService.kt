package dev.manadj.app

import android.app.*
import android.content.*
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
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

    /**
     * EH3: media session + media-style notification (lock screen / headset / notification shade). Pause stops every
     * playing deck and remembers them; Play resumes those (else the last audible deck). The notification shows the
     * audible deck's track; it stays (dismissable) while paused so playback can resume from the background.
     */
    private lateinit var session: MediaSession
    private var resumeDecks: List<DeckId> = emptyList()
    private var audible: DeckId? = null
    private var shown: Triple<Boolean, String?, Boolean>? = null // (playing, sourceId, notification visible)
    private val sessionCallback = object : MediaSession.Callback() {
        override fun onPlay() = resumeFromMedia()
        override fun onPause() = pauseFromMedia()
        override fun onStop() = pauseFromMedia()
    }

    private fun pauseFromMedia() {
        val decks = snapshot()?.decks ?: return
        val playing = decks.filterValues { it.playing || it.previewing }.keys.toList()
        if (playing.isEmpty()) return
        resumeDecks = playing
        playing.forEach { submit(AudioCommand.Pause(it)) }
        updateMedia(force = true)
    }

    private fun resumeFromMedia() {
        val decks = snapshot()?.decks ?: return
        val targets = resumeDecks.ifEmpty { listOfNotNull(audible) }.filter { decks[it]?.loadState == LoadState.READY && decks[it]?.playing == false }
        resumeDecks = emptyList()
        targets.forEach { submit(AudioCommand.Play(it)) }
        updateMedia(force = true)
    }

    /** The deck the audience hears: playing with the highest fader x trim (last one when nothing plays). */
    private fun audibleDeck(state: EngineSnapshot): DeckId? =
        state.decks.filterValues { it.playing || it.previewing }.maxByOrNull { (_, d) -> d.fader * d.trim }?.key ?: audible?.takeIf { state.decks[it]?.sourceId != null }

    private fun updateMedia(force: Boolean = false) {
        val state = snapshot() ?: return
        audible = audibleDeck(state)
        val playing = state.decks.values.any { it.playing || it.previewing }
        val source = audible?.let { state.decks[it]?.sourceId }
        val visible = playing || (source != null && (foreground || shown?.third == true))
        val now = Triple(playing, source, visible)
        if (!force && now == shown) return
        shown = now
        val meta = source?.let { sourceMetadata[it] }
        session.setMetadata(MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, meta?.title ?: "manadj")
            .putString(MediaMetadata.METADATA_KEY_ARTIST, meta?.artist ?: "")
            .apply { meta?.durationSeconds?.let { putLong(MediaMetadata.METADATA_KEY_DURATION, (it * 1000).toLong()) } }
            .build())
        session.setPlaybackState(PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP)
            .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 0f)
            .build())
        session.isActive = visible
        val notifications = getSystemService(NotificationManager::class.java)
        if (!visible) { notifications.cancel(1); return }
        notifications.notify(1, notification()) // while foreground this updates the service notification (same id)
    }

    override fun onCreate() {
        super.onCreate()
        audioManager = getSystemService(AudioManager::class.java)
        session = MediaSession(this, "manadj").apply { setCallback(sessionCallback, main) }
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
        when (intent?.action) {
            ACTION_PAUSE -> pauseFromMedia()
            ACTION_PLAY -> resumeFromMedia()
            ACTION_DISMISS -> { resumeDecks = emptyList(); shown = shown?.copy(third = false); if (!foreground) { session.isActive = false; getSystemService(NotificationManager::class.java).cancel(1) } }
            else -> if (!foreground) { startForeground(1, notification()); foreground = true }
        }
        // A media action must not keep an idle service started (it lives on only while the app binds it).
        if (intent?.action in listOf(ACTION_PAUSE, ACTION_PLAY, ACTION_DISMISS) && !foreground) stopSelf()
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
    /** Closes and reopens the output (same routing/device), off the main thread; result via [onDone] on main. */
    fun restartOutput(onDone: (Int) -> Unit) {
        lifetime.execute {
            val result = if (destroyed) -1 else try { engine?.restartOutput() ?: -1 } catch (_: IllegalStateException) { -1 }
            main.post { onDone(result) }
        }
    }

    /** Calibration clicks (#382): [count] (null = until [stopClicks]) every [interval] s, accented every 4th if [accent]. */
    fun startClicks(count: Int?, interval: Double, accent: Boolean): Boolean = !destroyed && try { engine?.startCalibrationClicks(count, interval, accent)?.accepted == true } catch (_: IllegalStateException) { false }
    fun stopClicks() { if (!destroyed) try { engine?.stopCalibrationClicks() } catch (_: IllegalStateException) {} }
    fun clickNanos(): LongArray = if (destroyed) LongArray(0) else try { engine?.clickNanos() ?: LongArray(0) } catch (_: IllegalStateException) { LongArray(0) }

    /** Mic-loopback output latency (#382) off the main thread; result via [onDone] on main. */
    fun calibrateLatency(onDone: (LatencyCalibrator.Result) -> Unit) {
        Thread({
            val audio = engine
            val result = if (destroyed || audio == null) LatencyCalibrator.Result(null, emptyList(), 0.0, "Audio engine not running")
                else try { LatencyCalibrator(this).measure(audio) } catch (e: Exception) { LatencyCalibrator.Result(null, emptyList(), 0.0, e.message ?: "Calibration failed") }
                    // Opening the mic can re-route/suspend a Bluetooth A2DP (MMAP) output without a disconnect
                    // callback (human: silence after calibrating on BT headphones): always reopen the output.
                    .also { if (!destroyed) runCatching { audio?.restartOutput() } }
                    .also { r -> android.util.Log.i("manadj-calib", "mic: L=%s spread=%.1f ms samples=%s snr=%s reason=%s".format(
                        r.seconds?.let { "%.1f ms".format(it * 1000) }, r.spreadMillis, r.samples.map { "%.1f".format(it * 1000) }, r.snr.map { "%.1f".format(it) }, r.reason)) }
            main.post { onDone(result) }
        }, "manadj-latency-calibration").start()
    }
    fun outputInfo(): OutputInfo? = if (destroyed) null else try { engine?.outputInfo() } catch (_: IllegalStateException) { null }

    fun source(id: String?): LocalSource? = sourceMetadata[id]

    fun load(deck: DeckId, source: LocalSource, descriptor: ParcelFileDescriptor, stems: List<ParcelFileDescriptor>? = null): CommandReceipt {
        if (snapshot()?.outputOpen != true) return CommandReceipt(0, false, failure ?: "Audio output unavailable")
        val receipt = engine?.load(deck, source.id, descriptor, stems) ?: CommandReceipt(0, false, failure ?: "Audio output is starting")
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
        val state = snapshot()
        val playing = state?.decks?.values?.any { it.playing || it.previewing } == true
        val meta = audible?.let { state?.decks?.get(it)?.sourceId }?.let { sourceMetadata[it] }
        fun service(action: String, code: Int) = PendingIntent.getService(this, code, Intent(this, PlaybackService::class.java).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val toggle = if (playing) Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_media_pause), "Pause", service(ACTION_PAUSE, 1)).build()
            else Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_media_play), "Play", service(ACTION_PLAY, 2)).build()
        val others = state?.decks?.count { (id, d) -> id != audible && (d.playing || d.previewing) } ?: 0
        return Notification.Builder(this, "playback").setSmallIcon(if (playing) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause)
            .setContentTitle(meta?.title ?: "manadj")
            .setContentText(listOfNotNull(meta?.artist?.takeIf { it.isNotBlank() }, audible?.let { "Deck $it" + if (others > 0) " +$others" else "" }).joinToString(" · ").ifBlank { "manadj" })
            .setContentIntent(open).setOngoing(playing).setDeleteIntent(service(ACTION_DISMISS, 3)).setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(toggle)
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0))
            .build()
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
                // Paused: the notification stays (dismissable, Play resumes) while the app keeps the service bound.
                stopForeground(STOP_FOREGROUND_DETACH); foreground = false; stopSelf()
                shown = shown?.copy(third = true); updateMedia(force = true)
                audioManager.abandonAudioFocusRequest(focusRequest); hasFocus = false
            }
            if (state != null) updateMedia()
            // Every 10 s while playing: callback cost + deck modes, readable via `adb logcat -s manadj-bench`.
            if (state != null && ++ticks % 20 == 0 && state.decks.values.any { it.playing || it.previewing }) {
                val cost = try { engine?.renderCost() } catch (_: IllegalStateException) { null }
                val decks = state.decks.filterValues { it.playing || it.previewing }.entries.joinToString(" ") { (id, d) ->
                    "$id:${if (d.keyLockActive) "KL" else if (d.keyLock) "kl(wait)" else "rs"}${if (d.fromMemory) "/mem" else ""}"
                }
                if (cost != null) android.util.Log.i("manadj-bench", "callback max %.0f us mean %.0f us n=%d nearMiss=%d xruns=%d [%s]".format(cost.maxMicros, cost.meanMicros, cost.callbacks, cost.nearMisses, state.outputXruns, decks))
            }
            // Each quantized launch (adb logcat -s manadj-launch): Heard sign/latency verification on the phone.
            val launch = try { engine?.lastLaunch() } catch (_: IllegalStateException) { null }
            if (launch != null && launch[0] != lastLaunchLogged) {
                lastLaunchLogged = launch[0]
                android.util.Log.i("manadj-launch", "deck %d ref %d mode %s L %.0f ms refRender %.4f heard %.4f targetBeat %.4f delta %+.1f ms entry %.4f".format(
                    launch[1].toInt(), launch[2].toInt(), state?.quantizeMode, launch[3] * 1000, launch[4], launch[5], launch[6], launch[7] * 1000, launch[8]))
            }
            main.postDelayed(this, 500)
        }
    }
    private var lastLaunchLogged = 0.0

    companion object {
        const val ACTION_PLAY = "dev.manadj.PLAY"
        const val ACTION_PAUSE = "dev.manadj.PAUSE"
        const val ACTION_DISMISS = "dev.manadj.DISMISS"
    }

    override fun onDestroy() {
        destroyed = true
        main.removeCallbacks(monitor)
        unregisterReceiver(noisy)
        session.release()
        getSystemService(NotificationManager::class.java).cancel(1)
        audioManager.abandonAudioFocusRequest(focusRequest)
        lifetime.execute { val old = engine; engine = null; old?.close() }
        lifetime.shutdown()
        super.onDestroy()
    }
}
