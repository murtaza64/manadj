package dev.manadj.library.session

import kotlin.math.abs
import kotlin.math.sqrt

/** Desktop ReplayCue (replayPlanner.ts) without scratch scheduling; [offset] is seconds after the start moment. */
sealed interface ReplayCue {
    val offset: Double
    data class Control(override val offset: Double, val control: String, val deck: Int?, val value: Double) : ReplayCue
    data class Play(override val offset: Double, val deck: Int, val playhead: Double) : ReplayCue
    data class Pause(override val offset: Double, val deck: Int, val playhead: Double) : ReplayCue
    data class Seek(override val offset: Double, val deck: Int, val playhead: Double) : ReplayCue
    /** scratchBegin/scratchEnd: the recorded position only (no scratch engine). */
    data class Scratch(override val offset: Double, val deck: Int, val action: String, val playhead: Double) : ReplayCue
    data class PreviewStart(override val offset: Double, val deck: Int, val playhead: Double) : ReplayCue
    data class PreviewEnd(override val offset: Double, val deck: Int, val playhead: Double) : ReplayCue
    data class Pitch(override val offset: Double, val deck: Int, val value: Double) : ReplayCue
    data class Load(override val offset: Double, val deck: Int, val trackId: Int?) : ReplayCue
    data class Loop(override val offset: Double, val deck: Int, val playhead: Double, val region: LoopSpan?) : ReplayCue
    data class Sync(override val offset: Double, val playheads: Map<Int, Double>) : ReplayCue
    data class BeatFx(override val offset: Double, val section: BeatFxSection) : ReplayCue
}

/** Desktop planReplay cue mapping for one event (null = evidence only: bend, tenure, settings, unknown). */
fun cueFor(e: CaptureEvent, offset: Double): ReplayCue? = when (e) {
    is CaptureEvent.Control -> ReplayCue.Control(offset, e.control, e.deck, e.value)
    is CaptureEvent.Transport -> when (e.action) {
        "play" -> ReplayCue.Play(offset, e.deck, e.playhead)
        "pause", "cue" -> ReplayCue.Pause(offset, e.deck, e.playhead)
        "previewStart" -> ReplayCue.PreviewStart(offset, e.deck, e.playhead)
        "previewEnd" -> ReplayCue.PreviewEnd(offset, e.deck, e.playhead)
        "scratchBegin", "scratchEnd" -> ReplayCue.Scratch(offset, e.deck, e.action, e.playhead)
        "scratchMove" -> null
        else -> ReplayCue.Seek(offset, e.deck, e.playhead)
    }
    is CaptureEvent.Pitch -> ReplayCue.Pitch(offset, e.deck, e.value)
    is CaptureEvent.Load -> ReplayCue.Load(offset, e.deck, e.trackId)
    is CaptureEvent.Tick -> ReplayCue.Sync(offset, e.playheads)
    is CaptureEvent.Loop -> ReplayCue.Loop(offset, e.deck, e.playhead, e.region)
    is CaptureEvent.BeatFx -> ReplayCue.BeatFx(offset, e.section)
    is CaptureEvent.Bend, is CaptureEvent.Tenure, is CaptureEvent.Other -> null
}

/** Every cue after [startT] (desktop planReplay `cues`). */
fun SessionLog.cuesAfter(startT: Double): List<ReplayCue> =
    events.subList(indexAfter(startT), events.size).mapNotNull { cueFor(it, it.t - startT) }

/** What the shared engine is asked to do. Decks are 0..3; values are desktop control units. */
sealed interface ReplayOp {
    val deck: Int?
    /** Put [trackId] on the deck (null = empty it). The host reports readiness via [SessionReplayer.deckReady]. */
    data class Load(override val deck: Int, val trackId: Int?) : ReplayOp
    data class Seek(override val deck: Int, val seconds: Double) : ReplayOp
    data class Play(override val deck: Int) : ReplayOp
    data class Pause(override val deck: Int) : ReplayOp
    data class Pitch(override val deck: Int, val percent: Double) : ReplayOp
    /** Phase servo: a small temporary rate offset that drains residual position error without a jump. */
    data class Bend(override val deck: Int, val percent: Double) : ReplayOp
    /** Engine fader with the recorded crossfader folded in (fader·√xf; the engine crossfader stays centred). */
    data class Fader(override val deck: Int, val value: Double) : ReplayOp
    data class Eq(override val deck: Int, val band: Int, val value: Double) : ReplayOp
    data class Filter(override val deck: Int, val position: Double) : ReplayOp
    /** Explicit loop region (null clears); [playhead] relocates in the same step when given. */
    data class Loop(override val deck: Int, val region: LoopSpan?, val playhead: Double?) : ReplayOp
    data class BeatFx(val section: BeatFxSection?) : ReplayOp { override val deck: Int? get() = null }
}

/**
 * Session replay director (desktop SessionReplayDriver, minus takeover/automation overlay): turns the log into
 * engine ops on the host's clock. Pure: the host owns time (the engine's output clock) and the engine.
 *
 * - [seek] seeds every deck from the reconstructed state (loads where the deck holds another track).
 * - [advance] fires each event's cue once, in capture order, as the clock passes it.
 * - A deck whose load is in flight skips transport cues; [deckReady] then brings it to the state at that moment.
 * - Sync (tick) cues correct gross drift only: a seek when the median of the last [DRIFT_WINDOW] innovations
 *   exceeds [DRIFT_SECONDS] (desktop's coordinated-seek tier), at most once per [COOLDOWN_SECONDS].
 * - Trim stays the listener's (desktop Conductor parity); bend is momentary; tenure gaps replay as recorded.
 */
class SessionReplayer(val log: SessionLog) {
    /** Session clock of the last [advance]/[seek]. */
    var time = log.start
        private set
    var playing = false
        private set
    private var cursor = log.indexAfter(log.start)
    /** Track each deck holds (or is loading) per the replay; ready = loaded and applied. */
    private val track = arrayOfNulls<Int>(4)
    private val ready = BooleanArray(4)
    private val loading = BooleanArray(4)
    private val innovations = List(4) { ArrayDeque<Double>() }
    private val lastCorrection = DoubleArray(4) { Double.NEGATIVE_INFINITY }
    /** Session time a sounding deck parked before its track start (negative playhead) begins playing; NaN = none. */
    private val preroll = DoubleArray(4) { Double.NaN }
    /** Deck (re)started since its last measured tick: the first measurement snaps start stagger away. */
    private val fresh = BooleanArray(4)
    /** Live model of the replayed mix (mixer values for crossfader folding). */
    private var mix = log.at(log.start)

    fun isLoading(deck: Int) = loading[deck]
    fun trackOn(deck: Int) = track[deck]

    /**
     * Start/relocate at [t]. [held] = track id the engine deck currently holds and is ready with (null = other/none).
     * [play] false parks every deck at its position (scrubbing while paused).
     */
    fun seek(t: Double, held: List<Int?>, play: Boolean): List<ReplayOp> {
        time = t.coerceIn(log.start, log.end)
        playing = play
        cursor = log.indexAfter(time)
        mix = log.at(time)
        val ops = ArrayList<ReplayOp>()
        ops += ReplayOp.BeatFx(mix.beatFx?.takeIf { play })
        for (d in 0..3) {
            innovations[d].clear()
            preroll[d] = Double.NaN
            val want = mix.decks[d].trackId
            ops += mixerOps(d)
            if (want == null) {
                track[d] = null; ready[d] = false; loading[d] = false
                ops += ReplayOp.Pause(d)
            } else if (held[d] == want) {
                track[d] = want; ready[d] = true; loading[d] = false
                ops += resync(d)
            } else {
                track[d] = want; ready[d] = false; loading[d] = true
                ops += ReplayOp.Pause(d)
                ops += ReplayOp.Load(d, want)
            }
        }
        return ops
    }

    /** Pause replay: every deck stops where it is; the clock holds. */
    fun pause(): List<ReplayOp> {
        playing = false
        return (0..3).map { ReplayOp.Pause(it) } + ReplayOp.BeatFx(null)
    }

    /** The host finished loading [deck] with the requested track; bring it to the state at the current [time]. */
    fun deckReady(deck: Int): List<ReplayOp> {
        if (!loading[deck]) return emptyList()
        loading[deck] = false; ready[deck] = true
        return mixerOps(deck) + resync(deck)
    }

    /** The host could not load [deck]'s track (missing file, no library): the deck sits out until its next load. */
    fun deckFailed(deck: Int) { loading[deck] = false; ready[deck] = false; preroll[deck] = Double.NaN }

    /**
     * Advance the clock to [t], firing cues passed since the last call. [enginePositions] (engine source seconds
     * at [t], null = unknown) feed the sync corrector.
     */
    fun advance(t: Double, enginePositions: List<Double?> = List(4) { null }): List<ReplayOp> {
        if (!playing) return emptyList()
        val ops = ArrayList<ReplayOp>()
        val until = log.indexAfter(t)
        while (cursor < until) {
            val e = log.events[cursor++]
            SessionLog.reduce(mix, e)
            cueFor(e, e.t - log.start)?.let { ops += apply(it, e.t, enginePositions, t) }
        }
        for (d in 0..3) if (preroll[d] <= t) {
            preroll[d] = Double.NaN
            fresh[d] = true
            if (live(d) && mix.decks[d].sounding) { ops += ReplayOp.Seek(d, 0.0); ops += ReplayOp.Play(d) }
        }
        time = t
        if (t >= log.end) { ops += pause() }
        return ops
    }

    private fun apply(cue: ReplayCue, at: Double, engine: List<Double?>, now: Double): List<ReplayOp> {
        return when (cue) {
            is ReplayCue.Load -> {
                track[cue.deck] = cue.trackId; ready[cue.deck] = false; innovations[cue.deck].clear(); preroll[cue.deck] = Double.NaN
                loading[cue.deck] = cue.trackId != null
                listOf(ReplayOp.Pause(cue.deck), ReplayOp.Loop(cue.deck, null, null)) + (cue.trackId?.let { listOf(ReplayOp.Load(cue.deck, it)) } ?: emptyList())
            }
            is ReplayCue.Play -> if (!live(cue.deck)) emptyList() else place(cue.deck, cue.playhead, at, true)
            is ReplayCue.PreviewStart -> if (!live(cue.deck)) emptyList() else place(cue.deck, cue.playhead, at, true)
            is ReplayCue.Pause -> if (!live(cue.deck)) emptyList() else place(cue.deck, cue.playhead, at, false)
            // A stab ends where it was recorded; a deck that is also playing (stab over play) keeps playing.
            is ReplayCue.PreviewEnd -> if (!live(cue.deck) || mix.decks[cue.deck].playing) emptyList() else place(cue.deck, cue.playhead, at, false)
            is ReplayCue.Seek -> if (!live(cue.deck)) emptyList() else place(cue.deck, cue.playhead, at, mix.decks[cue.deck].sounding)
            is ReplayCue.Scratch -> if (!live(cue.deck)) emptyList() else place(cue.deck, cue.playhead, at, mix.decks[cue.deck].sounding)
            is ReplayCue.Pitch -> listOf(ReplayOp.Pitch(cue.deck, cue.value))
            is ReplayCue.Loop -> if (!live(cue.deck)) emptyList() else listOf(ReplayOp.Loop(cue.deck, cue.region, cue.playhead))
            is ReplayCue.BeatFx -> listOf(ReplayOp.BeatFx(cue.section))
            is ReplayCue.Control -> controlOps(cue)
            is ReplayCue.Sync -> cue.playheads.flatMap { (d, recorded) -> correct(d, recorded, at, engine[d], now).orEmpty() }
        }
    }

    /**
     * Put deck [d] at [playhead] as of session time [at], playing or parked. The engine has no negative source
     * time (desktop jumps can land before the track start: silence), so a sounding deck there parks at 0 and
     * starts when the recorded playhead reaches 0.
     */
    private fun place(d: Int, playhead: Double, at: Double, play: Boolean): List<ReplayOp> {
        preroll[d] = Double.NaN
        if (play) { fresh[d] = true; innovations[d].clear() }
        if (playhead >= 0) return if (play) listOf(relocate(d, playhead), ReplayOp.Play(d)) else listOf(ReplayOp.Pause(d), relocate(d, playhead))
        if (play) preroll[d] = at - playhead / (1 + mix.decks[d].pitch / 100)
        return listOf(ReplayOp.Pause(d), ReplayOp.Seek(d, 0.0))
    }

    /** A seek that keeps an active loop when it lands inside it (engine Seek cancels loops). */
    private fun relocate(d: Int, playhead: Double): ReplayOp {
        val l = mix.decks[d].loop
        return if (l != null && playhead >= l.start && playhead < l.end) ReplayOp.Loop(d, l, playhead) else ReplayOp.Seek(d, playhead)
    }

    private fun correct(d: Int, recorded: Double, at: Double, engineNow: Double?, now: Double): List<ReplayOp>? {
        val s = mix.decks[d]
        if (engineNow == null || !live(d) || !s.sounding || s.scratching || s.loop != null || !preroll[d].isNaN() || recorded < 0) return null
        // Engine position at the tick instant (it has run on since, at the deck rate).
        val rate = 1 + s.pitch / 100
        val engineAt = engineNow - (now - at) * rate
        val window = innovations[d]
        val innovation = engineAt - recorded
        // Start snap (desktop START_SNAP_S): decks start with different latencies; at the first measurement
        // nobody has an established phase yet, so a seek is not a mid-groove jump.
        if (fresh[d]) {
            fresh[d] = false
            if (abs(innovation) > START_SNAP_SECONDS) {
                lastCorrection[d] = now
                return listOf(ReplayOp.Bend(d, 0.0)) + place(d, s.playheadAt(now), now, true).also { fresh[d] = false }
            }
        }
        window.addLast(innovation)
        while (window.size > DRIFT_WINDOW) window.removeFirst()
        if (window.size < SERVO_MIN || now - lastCorrection[d] < COOLDOWN_SECONDS) return null
        val median = window.sorted()[window.size / 2]
        val gross = abs(window.last()) > GROSS_SECONDS && abs(median) > GROSS_SECONDS / 2
        if (window.size >= DRIFT_MIN && (abs(median) >= DRIFT_SECONDS || gross)) {
            lastCorrection[d] = now
            window.clear()
            return listOf(ReplayOp.Bend(d, 0.0)) + place(d, s.playheadAt(now), now, true)
        }
        // Servo the residual: the recent median as a bend draining it over SERVO_SECONDS, capped, with a deadband.
        val recent = window.toList().takeLast(3).sorted().let { it[it.size / 2] }
        val cap = if (abs(recent) > SERVO_HI_ERROR) SERVO_MAX_PERCENT_HI else SERVO_MAX_PERCENT
        val bend = if (abs(recent) < SERVO_DEADBAND) 0.0 else (-recent * SERVO_GAIN * 100).coerceIn(-cap, cap)
        return listOf(ReplayOp.Bend(d, bend))
    }

    private fun live(d: Int) = ready[d] && !loading[d]

    private fun controlOps(c: ReplayCue.Control): List<ReplayOp> = when (c.control) {
        "fader", "crossfaderAssignment" -> c.deck?.let { listOf(fader(it)) } ?: emptyList()
        "crossfader", "crossfaderEnabled" -> (0..3).map(::fader)
        "eqLow" -> c.deck?.let { listOf(ReplayOp.Eq(it, 0, c.value)) } ?: emptyList()
        "eqMid" -> c.deck?.let { listOf(ReplayOp.Eq(it, 1, c.value)) } ?: emptyList()
        "eqHigh" -> c.deck?.let { listOf(ReplayOp.Eq(it, 2, c.value)) } ?: emptyList()
        "filter" -> c.deck?.let { listOf(ReplayOp.Filter(it, c.value)) } ?: emptyList()
        // trim/pfl/master/slip/vinyl stay the listener's; stems have no engine (listed as issues).
        else -> emptyList()
    }

    private fun fader(d: Int) = ReplayOp.Fader(d, mix.decks[d].fader.coerceIn(0.0, 1.0) * sqrt(mix.crossfaderGain(d)))

    private fun mixerOps(d: Int): List<ReplayOp> {
        val s = mix.decks[d]
        return listOf(fader(d), ReplayOp.Eq(d, 0, s.low), ReplayOp.Eq(d, 1, s.mid), ReplayOp.Eq(d, 2, s.high), ReplayOp.Filter(d, s.filter), ReplayOp.Pitch(d, s.pitch))
    }

    private fun resync(d: Int): List<ReplayOp> {
        val deck = mix.decks[d]
        val position = deck.playheadAt(time)
        val inLoop = deck.loop?.let { position >= it.start && position < it.end } == true
        innovations[d].clear()
        return (if (inLoop) emptyList() else listOf(ReplayOp.Loop(d, null, null))) + ReplayOp.Pitch(d, deck.pitch) + ReplayOp.Bend(d, 0.0) +
            place(d, position, time, playing && deck.sounding)
    }

    companion object {
        const val DRIFT_WINDOW = 5
        const val DRIFT_MIN = 3
        /** Persistent drift worth a seek (desktop SEEK_MEDIAN_S). */
        const val DRIFT_SECONDS = .2
        /** One sample this far off with a corroborating median seeks at once (a late load landing). */
        const val GROSS_SECONDS = .5
        const val COOLDOWN_SECONDS = 2.0
        /** Phase servo (desktop sessions 20): rate bias = error x gain (0.1 s -> 1 %), capped, with a deadband. */
        const val SERVO_GAIN = .1
        const val SERVO_MAX_PERCENT = 1.0
        /** Large errors get a firm nudge (desktop SERVO_MAX_BIAS_HI). */
        const val SERVO_MAX_PERCENT_HI = 4.0
        const val SERVO_HI_ERROR = .1
        const val SERVO_DEADBAND = .015
        const val START_SNAP_SECONDS = .04
        const val SERVO_MIN = 2
    }
}
