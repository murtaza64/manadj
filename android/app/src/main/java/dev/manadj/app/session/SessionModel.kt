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
 * The Session clock is the engine's output clock; [SessionReplayer] decides, this model executes.
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
    var replayer: SessionReplayer? = null
        private set
    /** Session clock (capture seconds). */
    var time by mutableDoubleStateOf(0.0)
        private set
    var playing by mutableStateOf(false)
        private set
    /** Seed loads in flight before the clock may start. */
    var preparing by mutableStateOf(false)
        private set
    var notice by mutableStateOf<String?>(null)
    /** Per-deck load failure (track missing from the Library, download failed). */
    val deckErrors = mutableStateListOf<String?>(null, null, null, null)
    /** Timeline view window (capture seconds). */
    var viewStart by mutableDoubleStateOf(0.0)
    var viewWidth by mutableDoubleStateOf(1.0)
    var follow by mutableStateOf(true)

    private var player: PlayerModel? = null
    private var loop: Job? = null
    private var anchorT = 0.0
    private var anchorFrame = 0L
    private val expectedSource = arrayOfNulls<String>(4)
    private var userCrossfade: Double? = null

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
                header = h; log = parsed; replayer = SessionReplayer(parsed)
                time = parsed.activeStart; fit()
                deckErrors.indices.forEach { deckErrors[it] = null }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { notice = "Open failed: ${e.message ?: e}" }
            finally { opening = null }
        }
    }

    fun close() { stop(); log = null; header = null; replayer = null }

    /** Leaving the Session screen: replay stops, decks keep what they hold. */
    fun leave() = stop()

    fun toggle(player: PlayerModel) { if (playing || preparing) stop() else play(player) }

    fun play(player: PlayerModel) {
        val r = replayer ?: return
        val l = log ?: return
        this.player = player
        if (time >= l.end) time = l.activeStart
        if (userCrossfade == null) userCrossfade = player.crossfade
        // Recorded crossfader folds into the faders; the engine crossfader stays centred while replaying.
        player.submit(AudioCommand.SetCrossfade(0.0))
        val held = held(player)
        val needs = (0..3).any { d -> l.at(time).decks[d].trackId.let { it != null && it != held[d] } }
        if (needs) {
            preparing = true
            execute(player, r.seek(time, held, play = false))
        } else start(player)
        loop?.cancel()
        loop = viewModelScope.launch { run(player) }
    }

    private fun start(player: PlayerModel) {
        val r = replayer ?: return
        preparing = false
        execute(player, r.seek(time, held(player), play = true))
        val snap = player.engineSnapshot()
        anchorT = time; anchorFrame = snap?.outputFrames ?: 0L
        playing = true
    }

    fun stop() {
        loop?.cancel(); loop = null
        val p = player
        val r = replayer
        if (p != null && r != null && (playing || preparing)) { execute(p, r.pause()); DeckId.entries.forEach { p.submit(AudioCommand.SetBend(it, 0.0)) } }
        playing = false; preparing = false
        userCrossfade?.let { p?.updateCrossfade(it) }
        userCrossfade = null
    }

    /** Relocate the Session clock; decks follow (parked while paused). */
    fun seek(t: Double, player: PlayerModel) {
        val l = log ?: return
        val r = replayer ?: return
        this.player = player
        time = t.coerceIn(l.start, l.end)
        reveal()
        if (playing) {
            val held = held(player)
            if ((0..3).any { d -> l.at(time).decks[d].trackId.let { it != null && it != held[d] } }) { playing = false; play(player) }
            else { execute(player, r.seek(time, held, play = true)); anchorT = time; anchorFrame = player.engineSnapshot()?.outputFrames ?: anchorFrame }
        } else if (!preparing) execute(player, r.seek(time, held(player), play = false))
    }

    private suspend fun run(player: PlayerModel) {
        val r = replayer ?: return
        while (currentCoroutineContext().isActive) {
            pollLoads(player, r)
            if (preparing) {
                if ((0..3).none(r::isLoading)) start(player)
            } else if (playing) {
                val snap = player.engineSnapshot()
                if (snap != null && snap.outputSampleRate > 0 && snap.outputOpen) {
                    val t = anchorT + (snap.outputFrames - anchorFrame).toDouble() / snap.outputSampleRate
                    val positions = DeckId.entries.map { id -> snap.decks[id]?.takeIf { it.loadState == LoadState.READY && !it.filling }?.sourceSeconds }
                    if (t - lastDriftLog >= 2) { lastDriftLog = t; logDrift(t, positions) }
                    execute(player, r.advance(t, positions))
                    time = t.coerceAtMost(log?.end ?: t)
                    if (follow) reveal()
                    if (!r.playing) { playing = false; stop(); return }
                }
            } else return
            delay(8)
        }
    }

    private var lastDriftLog = Double.NEGATIVE_INFINITY

    /** Engine vs recorded position per sounding deck (logcat ManadjSession): replay sync diagnostics. */
    private fun logDrift(t: Double, positions: List<Double?>) {
        val state = log?.at(t) ?: return
        val parts = (0..3).mapNotNull { d ->
            val s = state.decks[d]; val at = positions[d]
            if (!s.sounding || at == null || replayer?.isLoading(d) != false) null else "${DECKS[d]} %+.0fms".format((at - s.playhead) * 1000)
        }
        if (parts.isNotEmpty()) android.util.Log.i("ManadjSession", "t=%.1f ".format(t - (log?.activeStart ?: 0.0)) + parts.joinToString(" "))
    }

    private fun pollLoads(player: PlayerModel, r: SessionReplayer) {
        for (d in 0..3) {
            if (!r.isLoading(d)) continue
            val ui = player.decks.getValue(DeckId.entries[d])
            val want = expectedSource[d] ?: continue
            if (ui.ready && ui.source?.id == want) execute(player, r.deckReady(d))
            else if (ui.snapshot?.loadState == LoadState.ERROR && ui.snapshot?.sourceId == want) { r.deckFailed(d); deckErrors[d] = ui.snapshot?.error ?: "decode failed" }
        }
    }

    /** Tracks the engine decks hold and are ready with (library source ids). */
    private fun held(player: PlayerModel): List<Int?> = DeckId.entries.map { id ->
        val ui = player.decks.getValue(id)
        if (ui.ready) LibraryHolder.trackOn(player, id) else null
    }

    private fun execute(player: PlayerModel, ops: List<ReplayOp>) {
        if (ops.isEmpty()) return
        val snap = player.engineSnapshot()
        for (op in ops) {
            val deck = op.deck?.let { DeckId.entries[it] }
            when (op) {
                is ReplayOp.Load -> load(player, op.deck, op.trackId)
                is ReplayOp.Seek -> player.submit(AudioCommand.Seek(deck!!, op.seconds.coerceAtLeast(0.0)))
                is ReplayOp.Play -> player.submit(AudioCommand.Play(deck!!))
                is ReplayOp.Pause -> player.submit(AudioCommand.Pause(deck!!))
                is ReplayOp.Pitch -> player.submit(AudioCommand.SetPitch(deck!!, op.percent))
                is ReplayOp.Bend -> player.submit(AudioCommand.SetBend(deck!!, op.percent))
                is ReplayOp.Fader -> player.submit(AudioCommand.SetFader(deck!!, op.value))
                is ReplayOp.Eq -> player.submit(AudioCommand.SetEq(deck!!, op.band, op.value))
                is ReplayOp.Filter -> player.submit(AudioCommand.SetFilter(deck!!, op.position))
                is ReplayOp.Loop -> {
                    val region = op.region
                    // Relocate only when the engine is not already there (a recorded engage lands on the playing deck).
                    val at = snap?.decks?.get(deck!!)?.sourceSeconds
                    val playhead = op.playhead?.takeIf { region == null || at == null || abs(at - it) > .05 || at < region.start || at >= region.end }
                    if (region == null) player.submit(AudioCommand.SetLoopRegion(deck!!, null, 0.0, playhead))
                    else player.submit(AudioCommand.SetLoopRegion(deck!!, region.start, region.end, playhead))
                }
                is ReplayOp.BeatFx -> player.updateBeatFx(beatFx(op.section))
            }
        }
    }

    private fun load(player: PlayerModel, deck: Int, trackId: Int?) {
        val id = DeckId.entries[deck]
        deckErrors[deck] = null
        if (trackId == null) { expectedSource[deck] = null; return }
        val track = track(trackId)
        if (track == null || track.audioRev == null) {
            expectedSource[deck] = null
            replayer?.deckFailed(deck)
            deckErrors[deck] = if (track == null) "Track #$trackId not in the synced Library" else "No audio file on the desktop"
            return
        }
        expectedSource[deck] = LibraryHolder.sourceId(track)
        LibraryHolder.load(getApplication(), player, id, track) { error ->
            replayer?.deckFailed(deck)
            deckErrors[deck] = error
        }
    }

    private fun beatFx(s: BeatFxSection?): BeatFxState {
        if (s == null) return BeatFxState(null, BeatFxTarget.MASTER, false, -1.0, 1.0)
        val effect = when (s.selected) {
            "echo" -> BeatFxEffect.ECHO; "lowCutEcho" -> BeatFxEffect.LOW_CUT_ECHO; "reverb" -> BeatFxEffect.REVERB
            "flanger" -> BeatFxEffect.FLANGER; "trans" -> BeatFxEffect.TRANS; "roll" -> BeatFxEffect.ROLL; else -> null
        }
        val target = when (s.target.uppercase()) { "A" -> BeatFxTarget.A; "B" -> BeatFxTarget.B; "C" -> BeatFxTarget.C; "D" -> BeatFxTarget.D; else -> BeatFxTarget.MASTER }
        return BeatFxState(effect, target, s.on, s.depth, BeatFx.snap(s.beats), s.held.map { DeckId.entries[it] }.toSet())
    }

    // ── Timeline view ──
    fun fit() { val l = log ?: return; viewStart = l.activeStart; viewWidth = (l.end - l.activeStart).coerceAtLeast(1.0); follow = true }
    fun zoom(factor: Double, anchor: Double = .5) {
        val l = log ?: return
        val next = (viewWidth / factor).coerceIn(minOf(8.0, l.duration), l.duration.coerceAtLeast(1.0))
        viewStart = (viewStart + anchor * (viewWidth - next)).coerceIn(l.start, maxOf(l.start, l.end - next)); viewWidth = next
    }
    fun pan(fraction: Double) { val l = log ?: return; follow = false; viewStart = (viewStart + fraction * viewWidth).coerceIn(l.start, maxOf(l.start, l.end - viewWidth)) }
    private fun reveal() {
        val l = log ?: return
        if (time < viewStart || time > viewStart + viewWidth) viewStart = (time - viewWidth * .25).coerceIn(l.start, maxOf(l.start, l.end - viewWidth))
    }

    override fun onCleared() { stop(); super.onCleared() }
}
