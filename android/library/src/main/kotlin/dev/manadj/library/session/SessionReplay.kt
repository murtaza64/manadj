package dev.manadj.library.session

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
    /** Put [trackId] on the deck (null = empty it). Not frame-schedulable: the host issues it when due. */
    data class Load(override val deck: Int, val trackId: Int?) : ReplayOp
    data class Play(override val deck: Int) : ReplayOp
    data class Pause(override val deck: Int) : ReplayOp
    data class Pitch(override val deck: Int, val percent: Double) : ReplayOp
    data class Bend(override val deck: Int, val percent: Double) : ReplayOp
    /** Engine fader with the recorded crossfader folded in (fader·√xf; the engine crossfader stays centred). */
    data class Fader(override val deck: Int, val value: Double) : ReplayOp
    data class Eq(override val deck: Int, val band: Int, val value: Double) : ReplayOp
    data class Filter(override val deck: Int, val position: Double) : ReplayOp
    /** Loop region (null clears) and the exact playhead (>= 0) set in the same step: every replay relocation. */
    data class Locate(override val deck: Int, val region: LoopSpan?, val playhead: Double) : ReplayOp
    /** Platter: begin, move by [delta] track seconds, end (engine scratch; the landing is a [Locate] after). */
    data class Scratch(override val deck: Int, val phase: Phase, val delta: Double = 0.0) : ReplayOp { enum class Phase { BEGIN, MOVE, END } }
    data class BeatFx(val section: BeatFxSection?) : ReplayOp { override val deck: Int? get() = null }
}

/** [op] due at Session time [t]; the host maps it to one engine output frame from a single epoch. */
data class TimedOp(val t: Double, val op: ReplayOp)

/**
 * Session replay as an engine op stream (#378 decision b): the engine reproduces [SessionLog.replayAt]
 * sample-exactly when every op lands on its frame. Recorded positions are applied only where the log
 * re-anchors them (transport, loop); pitch and bend are rate changes; ticks are evidence only (never seeks).
 * Pure: the host owns the epoch, the engine, loads and readiness.
 *
 * Pre-roll: the engine has no negative source time, so a sounding deck before its track start parks at 0 and
 * a synthetic Play lands at the exact instant the reference playhead crosses 0.
 * Trim stays the listener's (desktop Conductor parity).
 */
class ReplayScript(val log: SessionLog) {
    /** Deck [d]'s reference state at [t] as ops (mixer, rate, loop, position, transport); no load. */
    fun place(t: Double, d: Int): List<ReplayOp> {
        val s = log.replayAt(t)
        return mixerOps(s, d) + listOf(ReplayOp.Pitch(d, s.decks[d].pitch), ReplayOp.Bend(d, s.decks[d].bend)) +
            if (s.decks[d].trackId == null) listOf(ReplayOp.Pause(d)) else settle(d, s.decks[d])
    }

    fun beatFx(t: Double) = ReplayOp.BeatFx(log.replayAt(t).beatFx)

    /** Ops for events in (from, to], in capture order, stamped with their Session time; plus pre-roll starts. */
    fun between(from: Double, to: Double): List<TimedOp> {
        val s = log.replayAt(from)
        val out = ArrayList<TimedOp>()
        fun starts(until: Double) {
            for (d in 0..3) {
                val c = crossing(s.decks[d]) ?: continue
                if (c > until || c <= from) continue
                s.decks[d].apply { playhead = 0.0; playheadAt = c }
                out += TimedOp(c, ReplayOp.Locate(d, s.decks[d].loop?.takeIf { it.start <= 0 && it.end > 0 }, 0.0))
                out += TimedOp(c, ReplayOp.Play(d))
            }
        }
        val end = log.indexAfter(to)
        for (i in log.indexAfter(from) until end) {
            val e = log.replayEvents[i]
            starts(e.t)
            val before = (e as? CaptureEvent.Transport)?.let { s.decks[it.deck].playhead }
            SessionLog.reduce(s, e, replay = true)
            for (op in opsFor(e, s, before)) out += TimedOp(e.t, op)
        }
        starts(to)
        return out
    }

    private fun opsFor(e: CaptureEvent, s: SessionState, before: Double?): List<ReplayOp> = when (e) {
        is CaptureEvent.Load -> listOf(ReplayOp.Load(e.deck, e.trackId))
        is CaptureEvent.Transport -> when (e.action) {
            "scratchBegin" -> listOf(ReplayOp.Scratch(e.deck, ReplayOp.Scratch.Phase.BEGIN))
            "scratchMove" -> listOf(ReplayOp.Scratch(e.deck, ReplayOp.Scratch.Phase.MOVE, e.delta ?: (e.playhead - (before ?: e.playhead))))
            "scratchEnd" -> listOf(ReplayOp.Scratch(e.deck, ReplayOp.Scratch.Phase.END)) + settle(e.deck, s.decks[e.deck])
            else -> settle(e.deck, s.decks[e.deck])
        }
        is CaptureEvent.Loop -> settle(e.deck, s.decks[e.deck])
        is CaptureEvent.Pitch -> listOf(ReplayOp.Pitch(e.deck, e.value))
        is CaptureEvent.Bend -> listOf(ReplayOp.Bend(e.deck, e.value))
        is CaptureEvent.BeatFx -> listOf(ReplayOp.BeatFx(e.section))
        is CaptureEvent.Control -> when (e.control) {
            "fader", "crossfaderAssignment" -> e.deck?.let { listOf(fader(s, it)) } ?: emptyList()
            "crossfader", "crossfaderEnabled" -> (0..3).map { fader(s, it) }
            "eqLow" -> e.deck?.let { listOf(ReplayOp.Eq(it, 0, e.value)) } ?: emptyList()
            "eqMid" -> e.deck?.let { listOf(ReplayOp.Eq(it, 1, e.value)) } ?: emptyList()
            "eqHigh" -> e.deck?.let { listOf(ReplayOp.Eq(it, 2, e.value)) } ?: emptyList()
            "filter" -> e.deck?.let { listOf(ReplayOp.Filter(it, e.value)) } ?: emptyList()
            // trim/pfl/master/slip/vinyl stay the listener's; stems have no engine (listed as issues).
            else -> emptyList()
        }
        is CaptureEvent.Tick, is CaptureEvent.Tenure, is CaptureEvent.Other -> emptyList()
    }

    /** Transport + position for a deck whose reference was just (re)anchored. */
    private fun settle(d: Int, deck: DeckState): List<ReplayOp> {
        if (deck.scratching) return emptyList() // the platter owns the deck until scratchEnd
        val p = deck.playhead
        val l = deck.loop?.takeIf { p >= it.start && p < it.end }
        val locate = ReplayOp.Locate(d, l, p.coerceAtLeast(0.0))
        return if (deck.sounding && p >= 0) listOf(locate, ReplayOp.Play(d)) else listOf(ReplayOp.Pause(d), locate)
    }

    /** Session time a sounding deck parked before its track start reaches 0 (null = not pre-rolling). */
    private fun crossing(deck: DeckState): Double? =
        if (deck.trackId != null && deck.sounding && !deck.scratching && deck.playhead < 0 && deck.rate > 0) deck.playheadAt - deck.playhead / deck.rate else null

    private fun fader(s: SessionState, d: Int) = ReplayOp.Fader(d, s.decks[d].fader.coerceIn(0.0, 1.0) * sqrt(s.crossfaderGain(d)))

    private fun mixerOps(s: SessionState, d: Int): List<ReplayOp> {
        val deck = s.decks[d]
        return listOf(fader(s, d), ReplayOp.Eq(d, 0, deck.low), ReplayOp.Eq(d, 1, deck.mid), ReplayOp.Eq(d, 2, deck.high), ReplayOp.Filter(d, deck.filter))
    }
}

/** One replay epoch: Session time [t0] is engine output frame [frame0]; every op's frame derives from it. */
data class ReplayEpoch(val t0: Double, val frame0: Long, val rate: Int) {
    fun frameOf(t: Double): Long = frame0 + Math.round((t - t0) * rate)
    fun timeAt(frame: Long): Double = t0 + (frame - frame0).toDouble() / rate
}
