package dev.manadj.app.session

import dev.manadj.audio.AudioCommand
import dev.manadj.audio.BeatFx
import dev.manadj.audio.BeatFxEffect
import dev.manadj.audio.BeatFxState
import dev.manadj.audio.BeatFxTarget
import dev.manadj.audio.DeckId
import dev.manadj.library.session.BeatFxSection
import dev.manadj.library.session.ReplayEpoch
import dev.manadj.library.session.ReplayOp
import dev.manadj.library.session.ReplayScript
import dev.manadj.library.session.SessionLog
import dev.manadj.library.session.SessionTimeline
import dev.manadj.library.session.TimedOp

/**
 * Executes a [ReplayScript] on the engine from one [ReplayEpoch]: keeps [LOOKAHEAD] seconds of ops
 * frame-stamped ahead of the output clock and places a deck once the part of its track it is about to play
 * is decoded. Never measures-and-corrects, never starts a deck at an unstamped frame: a deck that is not
 * ready joins later at a stamped frame with the reference position for that frame.
 * Decode time is hidden: PLAY waits only for decks that sound within [START_HORIZON]; a Session Load is
 * issued as soon as its deck goes silent before it ([SessionTimeline.earlyLoads]), not when the Load happens.
 * The host calls [tick] periodically (and renders, offline). Loads run in [tick] (host thread); [pumpAhead] only
 * frame-stamps ops and may run on a background thread, so a busy UI thread never starves the op stream.
 * Public entry points are synchronized.
 */
class ReplayDriver(val log: SessionLog, private val engine: Engine, private val onNotice: (String) -> Unit = {}, val timeline: SessionTimeline = SessionTimeline(log), private val trace: (String) -> Unit = {}) {
    interface Engine {
        /** Engine output frame counter now (null = output not running). */
        fun outputFrames(): Long?
        val sampleRate: Int
        fun schedule(frame: Long, commands: List<AudioCommand>, tag: Long): Boolean
        fun cancel(tag: Long)
        fun submit(command: AudioCommand)
        /** Library track [deck] holds and is ready with (null = other/none). */
        fun holds(deck: Int): Int?
        /** Start loading [trackId] onto [deck] (async); [load] then reports progress. */
        fun startLoad(deck: Int, trackId: Int)
        fun load(deck: Int, trackId: Int): Load
    }
    sealed interface Load {
        data object Pending : Load
        /** Playable, decoded from the start up to [decodedSeconds] (relocations past it are not exact). */
        data class Partial(val decodedSeconds: Double) : Load
        data object Ready : Load
        data class Failed(val reason: String) : Load
    }
    enum class Deck { EMPTY, LIVE, LOADING, FAILED }

    val decks = Array(4) { Deck.EMPTY }
    val errors = arrayOfNulls<String>(4)
    var preparing = false
        private set
    var playing = false
        private set
    var epoch: ReplayEpoch? = null
        private set
    /** Session time PLAY/seek started from (also the clock while preparing). */
    var startTime = log.activeStart
        private set

    private val script = ReplayScript(log)
    private val track = arrayOfNulls<Int>(4)
    private val loadDueAt = DoubleArray(4)
    private val partialSince = DoubleArray(4) { Double.NaN }
    private val dueLoads = ArrayList<Triple<Double, Int, Int?>>()
    /** Engine frame from which a LIVE deck follows the reference (its placement frame). */
    private val liveFrom = LongArray(4)
    /** A deck loaded early is placed no earlier than its Session Load time. */
    private val notBefore = DoubleArray(4) { Double.NEGATIVE_INFINITY }
    /** Session Loads still ahead of the clock, and those already issued early (by Load time + deck). */
    private val pendingEarly = ArrayList<SessionTimeline.EarlyLoad>()
    private val earlyIssued = HashSet<Pair<Double, Int>>()
    private var tag = 0L
    private var scheduledUntil = 0.0

    /** Every deck gets the track it holds at [t]; [tick] starts the clock once all are fully decoded. */
    @Synchronized fun prepare(t: Double) {
        if (playing || preparing) engine.cancel(tag)
        playing = false; epoch = null
        startTime = t.coerceIn(log.start, log.end)
        dueLoads.clear()
        val want = log.replayAt(startTime)
        for (d in 0..3) {
            val id = want.decks[d].trackId
            errors[d] = null
            track[d] = id
            loadDueAt[d] = startTime
            partialSince[d] = Double.NaN; decodeStart[d] = null
            notBefore[d] = Double.NEGATIVE_INFINITY
            decks[d] = when {
                id == null -> Deck.EMPTY
                engine.holds(d) == id -> Deck.LOADING
                else -> { engine.submit(AudioCommand.Pause(DeckId.entries[d])); engine.startLoad(d, id); Deck.LOADING }
            }
        }
        pendingEarly.clear(); earlyIssued.clear()
        pendingEarly += timeline.earlyLoads.filter { it.t > startTime }
        preparing = true
    }

    /** Whether PLAY must wait for [d]: it sounds within [START_HORIZON] of the start. */
    private fun neededAtStart(d: Int) = timeline.nextSound(d, startTime)?.let { it <= startTime + START_HORIZON } == true

    @Synchronized fun stop() {
        if (playing || preparing) {
            engine.cancel(tag)
            DeckId.entries.forEach { engine.submit(AudioCommand.Pause(it)); engine.submit(AudioCommand.SetBend(it, 0.0)) }
            engine.submit(AudioCommand.SetBeatFx(beatFx(null)))
        }
        playing = false; preparing = false; epoch = null; dueLoads.clear()
    }

    /** Session time now (null = not running). [wallSeconds] times the decode grace. */
    @Synchronized fun tick(wallSeconds: Double): Double? {
        pollLoads(wallSeconds)
        if (preparing) {
            if ((0..3).none { decks[it] == Deck.LOADING && neededAtStart(it) }) start()
            return null
        }
        if (!playing) return null
        val e = epoch ?: return null
        val now = e.timeAt(engine.outputFrames() ?: return null)
        issueEarlyLoads(now)
        issueDueLoads(now)
        pump(now)
        if (now >= log.end) stop()
        return now.coerceAtMost(log.end)
    }

    /** Keep [LOOKAHEAD] stamped from the engine clock (no loads); safe from any thread. */
    @Synchronized fun pumpAhead() {
        if (!playing) return
        val e = epoch ?: return
        pump(e.timeAt(engine.outputFrames() ?: return))
    }

    private fun start() {
        val frames = engine.outputFrames() ?: return
        trace("clock starts (waited for: ${(0..3).filter { neededAtStart(it) }.joinToString { "ABCD"[it].toString() }})")
        preparing = false
        tag += 1
        val e = ReplayEpoch(startTime, frames + (START_LEAD * engine.sampleRate).toLong(), engine.sampleRate)
        epoch = e
        liveFrom.fill(e.frame0)
        val ops = ArrayList<ReplayOp>()
        ops += script.beatFx(startTime)
        for (d in 0..3) ops += if (decks[d] == Deck.LIVE) script.place(startTime, d) else listOf(ReplayOp.Pause(d))
        submit(e.frameOf(startTime), ops)
        scheduledUntil = startTime
        playing = true
        pump(startTime)
    }

    private fun pump(now: Double) {
        val e = epoch ?: return
        while (scheduledUntil < minOf(log.end, now + LOOKAHEAD)) {
            val next = minOf(log.end, scheduledUntil + WINDOW)
            stamp(e, script.between(scheduledUntil, next))
            scheduledUntil = next
        }
    }

    /** Ops grouped per frame; a deck waiting on its load gets none (it is placed when ready). */
    private fun stamp(e: ReplayEpoch, ops: List<TimedOp>, only: Int? = null) {
        var frame = Long.MIN_VALUE
        val batch = ArrayList<ReplayOp>()
        fun flush() { if (batch.isNotEmpty()) submit(frame, batch.toList()); batch.clear() }
        for ((t, op) in ops) {
            val d = op.deck
            if (only != null && d != only) continue
            if (op is ReplayOp.Load) {
                if (earlyIssued.contains(t to op.deck)) continue
                decks[op.deck] = Deck.LOADING; track[op.deck] = op.trackId; loadDueAt[op.deck] = t; partialSince[op.deck] = Double.NaN; decodeStart[op.deck] = null
                dueLoads += Triple(t, op.deck, op.trackId)
                continue
            }
            if (d != null && decks[d] == Deck.LOADING) continue
            val f = e.frameOf(t)
            if (f != frame) { flush(); frame = f }
            batch += op
        }
        flush()
    }

    private fun submit(frame: Long, ops: List<ReplayOp>) {
        val commands = ops.mapNotNull(::command)
        if (commands.isNotEmpty() && !engine.schedule(frame, commands, tag)) onNotice("Replay: engine refused frame-stamped ops")
    }

    /** Loads are not frame-schedulable (Prepare): issued when the clock reaches them. */
    private fun issueDueLoads(now: Double) {
        val due = dueLoads.filter { it.first <= now }
        if (due.isEmpty()) return
        dueLoads.removeAll(due.toSet())
        for ((_, d, id) in due) {
            if (id == null) { decks[d] = Deck.EMPTY; engine.submit(AudioCommand.Pause(DeckId.entries[d])) }
            else if (engine.holds(d) != id) engine.startLoad(d, id)
        }
    }

    /** Session Loads whose deck has gone silent: start them now; the deck is placed at the Load time. */
    private fun issueEarlyLoads(now: Double) {
        val due = pendingEarly.filter { it.from <= now }
        if (due.isEmpty()) return
        pendingEarly.removeAll(due.toSet())
        for (l in due) {
            if (l.t <= now) continue // reached by the op stream already
            earlyIssued += l.t to l.deck
            dueLoads.removeAll { it.second == l.deck && it.first <= l.t }
            decks[l.deck] = Deck.LOADING; track[l.deck] = l.trackId; loadDueAt[l.deck] = l.t; partialSince[l.deck] = Double.NaN; decodeStart[l.deck] = null
            notBefore[l.deck] = l.t
            if (engine.holds(l.deck) != l.trackId) engine.startLoad(l.deck, l.trackId)
        }
    }

    private val lastState = arrayOfNulls<String>(4)
    private val lastWaitTrace = DoubleArray(4)
    private fun needed(d: Int, at: Double): Double {
        val id = track[d] ?: return 0.0
        val need = timeline.decodeNeed(d, id, at, log.end, safeRate(d)) ?: log.replayAt(at).decks[d].playhead
        return need.coerceAtLeast(0.0) + READY_MARGIN
    }

    /**
     * [state] covers what deck [d] plays from [at] on: with the decode advancing at the measured rate (halved,
     * floor [MIN_DECODE_RATE]), every position — relocation targets included — is decoded [READY_MARGIN] before it
     * is played (the engine serves in-memory, sample-exact, only that far behind the decode front). Continuous
     * play never catches a faster decode, so this is usually just the playhead, not playhead + a fixed horizon.
     */
    private fun ready(d: Int, state: Load, at: Double): Boolean = when (state) {
        Load.Ready -> true
        is Load.Partial -> state.decodedSeconds >= needed(d, at)
        else -> false
    }

    /** Measured decode progress per deck: first Partial (wall, decoded) and the latest rate (track s per wall s). */
    private val decodeStart = arrayOfNulls<Pair<Double, Double>>(4)
    private val decodeRate = DoubleArray(4)
    private fun noteDecode(d: Int, wall: Double, decoded: Double) {
        val s = decodeStart[d]
        if (s == null || decoded < s.second) { decodeStart[d] = wall to decoded; return }
        if (wall - s.first >= .5) decodeRate[d] = (decoded - s.second) / (wall - s.first)
    }
    private fun safeRate(d: Int) = maxOf(MIN_DECODE_RATE, decodeRate[d] * .5)

    /** LOADING decks become LIVE once fully decoded; mid-replay they are placed at a frame [JOIN_LEAD] ahead. */
    private fun pollLoads(wall: Double) {
        for (d in 0..3) {
            if (decks[d] != Deck.LOADING) continue
            val id = track[d] ?: continue
            if (dueLoads.any { it.second == d }) continue // not issued yet
            val state = engine.load(d, id)
            val kind = state::class.simpleName
            if (kind != lastState[d]) { lastState[d] = kind; trace("deck ${"ABCD"[d]} #$id $kind${(state as? Load.Partial)?.let { " decoded %.0f s".format(it.decodedSeconds) } ?: ""}") }
            when (state) {
                Load.Pending -> continue
                is Load.Failed -> { decks[d] = Deck.FAILED; errors[d] = state.reason; continue }
                is Load.Partial -> {
                    noteDecode(d, wall, state.decodedSeconds)
                    val at = epoch?.let { e -> engine.outputFrames()?.let { e.timeAt(it) + JOIN_LEAD } } ?: startTime
                    if (!ready(d, state, maxOf(at, notBefore[d]))) {
                        val now = wall
                        if (now - lastWaitTrace[d] >= 1.0) { lastWaitTrace[d] = now; trace("deck ${"ABCD"[d]} #$id waiting: decoded %.0f s, needs %.0f s".format(state.decodedSeconds, needed(d, maxOf(at, notBefore[d])))) }
                        if (partialSince[d].isNaN()) partialSince[d] = wall
                        if (wall - partialSince[d] < DECODE_GRACE) continue
                        onNotice("Deck ${"ABCD"[d]}: track not decoded far enough — relocations on it may not be sample-exact")
                    }
                }
                Load.Ready -> {}
            }
            val e = epoch
            if (preparing || e == null) { decks[d] = Deck.LIVE; trace("deck ${"ABCD"[d]} #$id ready for start"); continue }
            val now = e.timeAt(engine.outputFrames() ?: continue)
            if (notBefore[d] > now + LOOKAHEAD) continue // loaded early: placed once its Load is within the lookahead
            val join = maxOf(now + JOIN_LEAD, notBefore[d])
            decks[d] = Deck.LIVE
            liveFrom[d] = e.frameOf(join)
            submit(liveFrom[d], script.place(join, d))
            stamp(e, script.between(join, maxOf(join, scheduledUntil)), only = d)
            trace("deck ${"ABCD"[d]} #$id joins at session %.1f".format(join))
            val late = join - loadDueAt[d]
            if (late > 1 && log.replayAt(join).decks[d].sounding) onNotice("Deck ${"ABCD"[d]} joined %.1f s late (track still loading)".format(late))
        }
    }

    /** Whether [deck] follows the reference at engine [frame] (LIVE and placed). */
    fun exact(deck: Int, frame: Long) = playing && decks[deck] == Deck.LIVE && frame >= liveFrom[deck]

    /** Scrub while paused: decks holding their track park at [t]. */
    @Synchronized fun park(t: Double) {
        val want = log.replayAt(t)
        for (d in 0..3) if (want.decks[d].trackId != null && engine.holds(d) == want.decks[d].trackId) {
            for (op in script.place(t, d)) if (op !is ReplayOp.Play) command(op)?.let(engine::submit)
            engine.submit(AudioCommand.Pause(DeckId.entries[d]))
        }
    }

    companion object {
        /** Ops kept frame-stamped ahead of the clock, submitted in windows of [WINDOW]. */
        const val LOOKAHEAD = 2.0
        const val WINDOW = .5
        /** First frame after PLAY / a mid-replay deck joining, ahead of now (covers submit latency). */
        const val START_LEAD = .25
        const val JOIN_LEAD = .15
        const val DECODE_GRACE = 20.0
        /** PLAY waits only for decks that sound this soon after the start; the rest join when ready. */
        const val START_HORIZON = 8.0
        /** Decoded audio required ahead of any position when it is played: the engine's in-memory margin (2 s) + 1 s. */
        const val READY_MARGIN = 3.0
        /** Assumed decode speed before one is measured (track s per wall s; the phone does ~20× per deck). */
        const val MIN_DECODE_RATE = 2.0

        fun command(op: ReplayOp): AudioCommand? {
            val deck = op.deck?.let { DeckId.entries[it] }
            return when (op) {
                is ReplayOp.Load -> null
                is ReplayOp.Play -> AudioCommand.Play(deck!!)
                is ReplayOp.Pause -> AudioCommand.Pause(deck!!)
                is ReplayOp.Pitch -> AudioCommand.SetPitch(deck!!, op.percent)
                is ReplayOp.Bend -> AudioCommand.SetBend(deck!!, op.percent)
                is ReplayOp.Fader -> AudioCommand.SetFader(deck!!, op.value)
                is ReplayOp.Eq -> AudioCommand.SetEq(deck!!, op.band, op.value)
                is ReplayOp.Filter -> AudioCommand.SetFilter(deck!!, op.position)
                is ReplayOp.Locate -> AudioCommand.SetLoopRegion(deck!!, op.region?.start, op.region?.end ?: 0.0, op.playhead)
                is ReplayOp.Scratch -> when (op.phase) {
                    ReplayOp.Scratch.Phase.BEGIN -> AudioCommand.ScratchBegin(deck!!)
                    ReplayOp.Scratch.Phase.MOVE -> AudioCommand.ScratchMove(deck!!, op.delta)
                    ReplayOp.Scratch.Phase.END -> AudioCommand.ScratchEnd(deck!!)
                }
                is ReplayOp.BeatFx -> AudioCommand.SetBeatFx(beatFx(op.section))
            }
        }

        fun beatFx(s: BeatFxSection?): BeatFxState {
            if (s == null) return BeatFxState(null, BeatFxTarget.MASTER, false, -1.0, 1.0)
            val effect = when (s.selected) {
                "echo" -> BeatFxEffect.ECHO; "lowCutEcho" -> BeatFxEffect.LOW_CUT_ECHO; "reverb" -> BeatFxEffect.REVERB
                "flanger" -> BeatFxEffect.FLANGER; "trans" -> BeatFxEffect.TRANS; "roll" -> BeatFxEffect.ROLL; else -> null
            }
            val target = when (s.target.uppercase()) { "A" -> BeatFxTarget.A; "B" -> BeatFxTarget.B; "C" -> BeatFxTarget.C; "D" -> BeatFxTarget.D; else -> BeatFxTarget.MASTER }
            return BeatFxState(effect, target, s.on, s.depth, BeatFx.snap(s.beats), s.held.map { DeckId.entries[it] }.toSet())
        }
    }
}
