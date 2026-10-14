package dev.manadj.app.session

import android.app.Application
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.manadj.app.PlayerModel
import dev.manadj.app.library.LibraryHolder
import dev.manadj.audio.*
import dev.manadj.library.LibraryTrack
import dev.manadj.library.SyncClient
import dev.manadj.library.session.*
import kotlinx.coroutines.*
import java.io.File
import kotlin.math.abs

/**
 * Session replay (#378): desktop Sessions (device sync) replayed through the shared engine on all four decks.
 * Sample-exact: [ReplayScript] turns the log into ops stamped with Session time; one [ReplayEpoch] maps them
 * to engine output frames and the callback applies each at its frame. Nothing here chases positions.
 */
class SessionModel(application: Application) : AndroidViewModel(application) {
    private val repo = LibraryHolder.repository(application)
    private val store = SessionStore(File(application.filesDir, "sessions-cache"), {
        SyncClient(repo.baseUrl, repo.pairCode, deviceToken = repo.deviceToken, deviceId = repo.deviceId, deviceName = repo.deviceName)
    })

    var headers by mutableStateOf(store.cached())
        private set
    var listError by mutableStateOf<String?>(null)
        private set
    var refreshing by mutableStateOf(false)
        private set
    var opening by mutableStateOf<String?>(null)
        private set
    var header by mutableStateOf<SessionHeader?>(null)
        private set
    var log by mutableStateOf<SessionLog?>(null)
        private set
    private var driver: ReplayDriver? = null
    /** Recorded ticks the replay reference disagrees with by > 5 ms: bad recording data, shown, never corrected. */
    var recordingDrift by mutableStateOf<List<SessionLog.Divergence>>(emptyList())
        private set
    /** Session clock (capture seconds). */
    var time by mutableDoubleStateOf(0.0)
        private set
    var playing by mutableStateOf(false)
        private set
    /** Tracks loading/decoding before the clock may start. */
    var preparing by mutableStateOf(false)
        private set
    var notice by mutableStateOf<String?>(null)
    /** Per-deck load failure (track missing from the Library, download failed). */
    val deckErrors = mutableStateListOf<String?>(null, null, null, null)
    /** Last measured engine − reference offset per deck (ms; null = not sounding), and late frame-stamped ops. */
    val engineOffsetMs = mutableStateListOf<Double?>(null, null, null, null)
    var lateOps by mutableLongStateOf(0L)
        private set
    /** Timeline view window (capture seconds). */
    var viewStart by mutableDoubleStateOf(0.0)
    var viewWidth by mutableDoubleStateOf(1.0)
    var follow by mutableStateOf(true)
    /** Narrowest window the timeline allows (its max zoom, set from its width). */
    var minViewWidth = 8.0
    /** A manual pan holds follow-scroll off until this nanoTime (desktop: 20 s). */
    var followHeldUntil by mutableLongStateOf(0L)
    /** Timeline model (waveform runs, mix, marks) of the open Session. */
    var timeline by mutableStateOf<SessionTimeline?>(null)
        private set
    /** Timeline waveforms per library track (desktop detail waveform + display fill gain). */
    val waves = mutableStateMapOf<Int, TimelineWave>()
    /** Session clock extrapolated to the display frame (smooth playhead + follow at the display rate). */
    var displayTime by mutableDoubleStateOf(0.0)
        private set
    private var timeNanos = 0L
    /** Track occurrence spotlighted by a label tap, until [focusUntil] (nanoTime). */
    var focus by mutableStateOf<Appearance?>(null)
        private set
    var focusUntil = 0L
        private set

    private var player: PlayerModel? = null
    private var loop: Job? = null
    private var userCrossfade: Double? = null
    /** Load failures reported by the library path (download/missing), per deck. */
    private val loadFailure = arrayOfNulls<String>(4)

    fun track(id: Int?): LibraryTrack? = id?.let { repo.library.value?.track(it) }

    fun refresh() {
        if (refreshing) return
        refreshing = true
        viewModelScope.launch {
            try { headers = store.refresh(); listError = null }
            catch (e: CancellationException) { throw e }
            catch (e: dev.manadj.library.SyncException) {
                listError = if (e.status == 404) "this desktop has no Session sync yet — update the desktop app" else e.message
            }
            catch (e: Exception) { listError = e.message ?: e.toString() }
            finally { refreshing = false }
        }
    }

    fun isCached(h: SessionHeader) = store.isCached(h.uuid)

    fun open(h: SessionHeader) {
        if (opening != null) return
        opening = h.uuid
        viewModelScope.launch {
            try {
                val parsed = store.log(h)
                require(parsed.events.isNotEmpty() && parsed.duration > 0) { "Session has no recorded duration" }
                stop()
                val drift = withContext(Dispatchers.Default) { parsed.tickDivergence() }
                val tl = withContext(Dispatchers.Default) { SessionTimeline(parsed) }
                header = h; log = parsed; driver = null; recordingDrift = drift; timeline = tl; focus = null
                loadWaves(parsed)
                if (drift.isNotEmpty()) android.util.Log.w(TAG, "recording drift: ${drift.size} ticks > 5 ms, worst %.1f ms".format(drift.maxOf { abs(it.seconds) } * 1000))
                moveClock(parsed.activeStart); fit()
                deckErrors.indices.forEach { deckErrors[it] = null }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { notice = "Open failed: ${e.message ?: e}" }
            finally { opening = null }
        }
    }

    fun close() { stop(); log = null; header = null; driver = null; recordingDrift = emptyList(); timeline = null; focus = null; wavesJob?.cancel() }

    private var wavesJob: Job? = null
    /** Fetch every Session track's detail waveform (cache first), two at a time. */
    private fun loadWaves(l: SessionLog) {
        wavesJob?.cancel()
        val ids = l.appearances.sortedBy { it.firstSound ?: Double.MAX_VALUE }.map { it.trackId }.distinct().filter { it !in waves }
        wavesJob = viewModelScope.launch {
            val gate = kotlinx.coroutines.sync.Semaphore(2)
            ids.map { id -> launch(Dispatchers.Default) { gate.acquire(); try {
                val w = runCatching { LibraryHolder.detailWaveform(getApplication(), id) }.onFailure { android.util.Log.w(TAG, "timeline waveform $id: $it") }.getOrNull()
                if (w == null) android.util.Log.w(TAG, "timeline waveform $id: none")
                if (w != null && w.sampleRate > 0 && w.bandHop > 0 && w.nBands == 8 && w.bands.isNotEmpty()) {
                    val data = dev.manadj.app.WaveformData(w.sampleRate, w.durationSecs, w.peakHop, w.bandHop, w.stftWindow, w.peaks, w.bands, w.bands.size / 8)
                    val wave = TimelineWave(data, dev.manadj.app.ColumnCache().fillGain(data))
                    withContext(Dispatchers.Main) { waves[id] = wave }
                }
            } finally { gate.release() } } }
        }
    }

    private fun moveClock(t: Double) { time = t; timeNanos = System.nanoTime(); displayTime = t }

    /** Per display frame (timeline): extrapolate the clock, advance follow-scroll, expire the spotlight. */
    fun frame(nanos: Long) {
        val l = log ?: return
        displayTime = if (playing) (time + (nanos - timeNanos) / 1e9).coerceIn(time, minOf(l.end, time + .1)) else time
        if (focus != null && nanos > focusUntil) focus = null
        if (follow && playing && System.nanoTime() > followHeldUntil) {
            val maxStart = maxOf(l.activeStart, l.end - viewWidth)
            viewStart = if (displayTime < viewStart) (displayTime - viewWidth * .1).coerceIn(l.activeStart, maxStart)
                else TimelineLayout.follow(viewStart, viewWidth, displayTime, maxStart)
        }
    }

    /** Tap on a track label: zoom to that occurrence and spotlight it. */
    fun focusOn(a: Appearance) {
        val l = log ?: return
        val (heardFrom, heardTo) = timeline?.playedSpan(a) ?: ((a.firstSound ?: a.start) to a.end)
        val from = maxOf(heardFrom, l.activeStart); val to = minOf(heardTo, l.end)
        val w = ((to - from) * 1.1).coerceIn(minViewWidth, (l.end - l.activeStart).coerceAtLeast(minViewWidth))
        setView(from - (w - (to - from)) / 2, w)
        holdFollow()
        focus = a; focusUntil = System.nanoTime() + 2_600_000_000L
    }

    /** Leaving the Session screen: replay stops, decks keep what they hold. */
    fun leave() = stop()

    fun toggle(player: PlayerModel) { if (playing || preparing) stop() else play(player) }

    private fun driver(player: PlayerModel): ReplayDriver? {
        val l = log ?: return null
        this.player = player
        return driver ?: ReplayDriver(l, engine(player)) { notice = it }.also { driver = it }
    }

    fun play(player: PlayerModel) {
        val l = log ?: return
        val r = driver(player) ?: return
        if (time >= l.end) moveClock(l.activeStart)
        if (userCrossfade == null) userCrossfade = player.crossfade
        // Recorded crossfader folds into the faders; the engine crossfader stays centred while replaying.
        player.submit(AudioCommand.SetCrossfade(0.0))
        prefetch(l)
        loadFailure.fill(null)
        lateBase = player.engineSnapshot()?.lateOps ?: 0L; lateOps = 0
        r.prepare(time)
        sync(r)
        loop?.cancel()
        loop = viewModelScope.launch { run(player, r) }
    }

    fun stop() {
        loop?.cancel(); loop = null
        driver?.stop()
        playing = false; preparing = false; displayTime = time
        engineOffsetMs.indices.forEach { engineOffsetMs[it] = null }
        userCrossfade?.let { player?.updateCrossfade(it) }
        userCrossfade = null
    }

    /** Relocate the Session clock; decks follow (parked while paused). */
    fun seek(t: Double, player: PlayerModel) {
        val l = log ?: return
        val r = driver(player) ?: return
        moveClock(t.coerceIn(l.start, l.end))
        reveal()
        if (playing || preparing) { r.prepare(time); sync(r) } else r.park(time)
    }

    private suspend fun run(player: PlayerModel, r: ReplayDriver) {
        while (currentCoroutineContext().isActive) {
            val now = r.tick(System.nanoTime() / 1e9)
            sync(r)
            if (now != null) {
                moveClock(now)
                if (now - lastMeasure >= MEASURE_SECONDS || now < lastMeasure) { lastMeasure = now; measure(player, r) }
            }
            if (!r.playing && !r.preparing) { stop(); return }
            delay(16)
        }
    }

    private fun sync(r: ReplayDriver) {
        playing = r.playing; preparing = r.preparing
        for (d in 0..3) { val e = r.errors[d] ?: loadFailure[d]; if (deckErrors[d] != e) deckErrors[d] = e }
    }

    private var lastMeasure = Double.NEGATIVE_INFINITY

    /**
     * Engine vs reference at the snapshot's sampling frame, per sounding deck (logcat ManadjSession): the
     * on-device check that replay is sample-exact (expected |offset| < 0.03 ms, i.e. under one sample).
     */
    private fun measure(player: PlayerModel, r: ReplayDriver) {
        val l = log ?: return
        val e = r.epoch ?: return
        val snap = player.engineSnapshot() ?: return
        val at = e.timeAt(snap.clockFrame)
        val ref = l.replayAt(at)
        val parts = ArrayList<String>()
        for (d in 0..3) {
            val want = ref.decks[d]
            val got = snap.decks[DeckId.entries[d]]
            val offset = if (!r.exact(d, snap.clockFrame) || want.trackId == null || !want.sounding || want.scratching || want.playhead < 0 || got == null) null
                else (got.sourceSeconds - want.playhead) * 1000
            engineOffsetMs[d] = offset
            if (offset != null) parts += "${DECKS[d]} %+.3fms".format(offset)
        }
        lateOps = snap.lateOps - lateBase
        val sounding = engineOffsetMs.filterNotNull()
        val spread = if (sounding.size >= 2) " inter-deck %.3fms".format(sounding.max() - sounding.min()) else ""
        if (parts.isNotEmpty()) android.util.Log.i(TAG, "t=%.1f ".format(at - l.activeStart) + parts.joinToString(" ") + spread + " late=$lateOps")
    }
    private var lateBase = 0L

    private fun engine(player: PlayerModel) = object : ReplayDriver.Engine {
        private var rate = 48000
        override val sampleRate get() = rate
        override fun outputFrames(): Long? = player.engineSnapshot()?.takeIf { it.outputOpen && it.outputSampleRate > 0 }?.also { rate = it.outputSampleRate }?.outputFrames
        override fun schedule(frame: Long, commands: List<AudioCommand>, tag: Long) = player.schedule(frame, commands, tag)
        override fun cancel(tag: Long) = player.cancelScheduled(tag)
        override fun submit(command: AudioCommand) { player.submit(command) }
        override fun holds(deck: Int): Int? = held(player, deck)
        override fun startLoad(deck: Int, trackId: Int) = issueLoad(player, deck, trackId)
        override fun load(deck: Int, trackId: Int): ReplayDriver.Load {
            loadFailure[deck]?.let { return ReplayDriver.Load.Failed(it) }
            val t = track(trackId) ?: return ReplayDriver.Load.Failed("Track #$trackId not in the synced Library")
            val want = LibraryHolder.sourceId(t)
            val ui = player.decks.getValue(DeckId.entries[deck])
            val snap = ui.snapshot
            if (snap?.loadState == LoadState.ERROR && snap.sourceId == want) return ReplayDriver.Load.Failed(snap.error ?: "decode failed")
            if (!(ui.ready && ui.source?.id == want)) return ReplayDriver.Load.Pending
            return if (snap?.fullyDecoded == true) ReplayDriver.Load.Ready else ReplayDriver.Load.Partial
        }
    }

    private fun issueLoad(player: PlayerModel, deck: Int, trackId: Int) {
        loadFailure[deck] = null
        val track = track(trackId)
        if (track == null || track.audioRev == null) {
            loadFailure[deck] = if (track == null) "Track #$trackId not in the synced Library" else "No audio file on the desktop"
            return
        }
        LibraryHolder.load(getApplication(), player, DeckId.entries[deck], track) { error -> loadFailure[deck] = error }
    }

    /** Download every track the Session loads, ahead of its load (mid-session loads then only decode). */
    private fun prefetch(l: SessionLog) {
        val ids = l.appearances.filter { it.end > time }.map { it.trackId }.distinct()
        viewModelScope.launch(Dispatchers.IO) { for (id in ids) runCatching { repo.audioFile(id) } }
    }

    /** Library track the engine deck holds and is ready with (null = other/none). */
    private fun held(player: PlayerModel, d: Int): Int? {
        val ui = player.decks.getValue(DeckId.entries[d])
        return if (ui.ready) LibraryHolder.trackOn(player, DeckId.entries[d]) else null
    }

    /** Whether replay is waiting on [deck]'s track (UI). */
    fun isLoading(deck: Int) = driver?.decks?.get(deck) == ReplayDriver.Deck.LOADING

    companion object {
        private const val TAG = "ManadjSession"
        const val MEASURE_SECONDS = 2.0
        const val FOLLOW_HOLD_NANOS = 20_000_000_000L
    }

    // ── Timeline view (window over activeStart..end: max zoom [minViewWidth], min zoom = fit) ──
    private val span get() = log?.let { (it.end - it.activeStart).coerceAtLeast(1.0) } ?: 1.0
    /** Fit spans the performance: first sound to the last audio (logs can idle for long after it). */
    fun fit() {
        val l = log ?: return
        val last = timeline?.activeEnd?.let { minOf(l.end, it + SessionLog.LEAD_IN) } ?: l.end
        viewStart = l.activeStart; viewWidth = (last - l.activeStart).coerceIn(minOf(minViewWidth, span), span); follow = true; followHeldUntil = 0L
    }
    fun setView(start: Double, width: Double) {
        val l = log ?: return
        viewWidth = width.coerceIn(minOf(minViewWidth, span), span)
        viewStart = start.coerceIn(l.activeStart, maxOf(l.activeStart, l.end - viewWidth))
    }
    /** Zoom by [factor] keeping the time under [anchor] (fraction of the width) fixed. */
    fun zoom(factor: Double, anchor: Double = .5) {
        val at = viewStart + anchor * viewWidth
        val next = (viewWidth / factor).coerceIn(minOf(minViewWidth, span), span)
        setView(at - anchor * next, next)
    }
    fun pan(fraction: Double) { setView(viewStart + fraction * viewWidth, viewWidth); holdFollow() }
    fun holdFollow() { followHeldUntil = System.nanoTime() + FOLLOW_HOLD_NANOS }
    private fun reveal() {
        if (time < viewStart || time > viewStart + viewWidth) setView(time - viewWidth * .25, viewWidth)
    }

    override fun onCleared() { stop(); super.onCleared() }
}

/** A Session track's detail waveform for the timeline, with its display fill gain (loud passages reach the lane edge). */
class TimelineWave(val data: dev.manadj.app.WaveformData, val fill: Float)
