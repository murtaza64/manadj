package dev.manadj.app.session

import dev.manadj.audio.AudioEngine
import dev.manadj.audio.BeatFxEffect
import dev.manadj.audio.BeatFxState
import dev.manadj.audio.BeatFxTarget
import dev.manadj.audio.DeckId
import dev.manadj.audio.DeckSnapshot
import dev.manadj.audio.EngineSnapshot
import dev.manadj.library.session.CaptureEvent
import dev.manadj.library.session.DECKS
import dev.manadj.library.session.LoopSpan
import dev.manadj.library.session.SessionLog
import dev.manadj.library.session.SessionState
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.math.abs

/**
 * Phone Session recorder (#395): the desktop capture recorder (frontend/src/capture/recorder.ts) on Android.
 * Diffs consecutive [EngineSnapshot]s — the engine's *applied* state, i.e. what was heard — into the desktop
 * capture-event vocabulary (ADR 0033): loads, transport (play/pause/seek, preview stabs, scratch landings),
 * pitch/bend, loops, mixer controls, crossfader, stems, Beat FX, ~1 Hz ticks. All four decks, events only.
 *
 * Capture time comes from the engine output clock (positions and `t` share the sampling frame, so replay
 * reproduces positions exactly), continued across output reopens. Session lifecycle = desktop (ADR 0033,
 * sessions 11): context buffers until the first Master-audible instant opens a Session with it; ten minutes
 * without audibility end it (then a fresh seed buffers for the next). A machine holding the decks (Session
 * replay, track-edit audition) is tenure: only the markers are logged, and it counts as silence.
 */
class SessionRecorder(private val trackOf: (sourceId: String?) -> Int?, private val sink: Sink, private val wallIso: () -> String) {
    interface Sink {
        fun open(uuid: String, startedAt: String, context: JSONArray)
        fun events(events: JSONArray)
        fun close(endedAt: String)
    }

    var uuid: String? = null
        private set
    private var state = SessionState()
    private var buffer = JSONArray()
    private var last: EngineSnapshot? = null
    private var lastT = 0.0
    private var tick = Double.NEGATIVE_INFINITY
    private var lastAudible = 0.0
    private var tenure: String? = null
    private var clock: Triple<Long, Int, Long>? = null // (epoch, reopenCount, frame) the base refers to
    private var base = 1.0
    private val out = JSONArray()

    /** Capture seconds at the snapshot's sampling frame (monotonic across output reopens). */
    private fun timeOf(s: EngineSnapshot): Double {
        val key = Triple(s.epoch, s.reopenCount, 0L)
        val c = clock
        if (c == null || c.first != key.first || c.second != key.second || s.clockFrame < c.third) {
            base = if (c == null) 1.0 else lastT + .001
            clock = Triple(s.epoch, s.reopenCount, s.clockFrame)
        }
        return maxOf(lastT, base + (s.clockFrame - clock!!.third).toDouble() / s.outputSampleRate)
    }

    /** One engine state sample; [machine] = the holder of the decks when not the performer (null = performer). */
    fun observe(s: EngineSnapshot, machine: String?) {
        if (s.outputSampleRate <= 0) return
        val before = lastT
        val t = timeOf(s)
        lastT = t
        val prev = last
        if (machine != tenure) {
            if (tenure != null) emit(CaptureEvent.Tenure(t, false, tenure!!))
            if (machine != null) emit(CaptureEvent.Tenure(t, true, machine))
            tenure = machine
            if (machine == null) seed(s, t)
        } else if (prev == null) seed(s, t)
        else if (machine == null) diff(prev, s, t, t - before)
        last = s
        if (machine == null && t - tick >= TICK_SECONDS) {
            tick = t
            val heads = HashMap<Int, Double>()
            for (d in 0..3) s.decks[DeckId.entries[d]]?.let { if (moving(it) || it.scratching) heads[d] = it.sourceSeconds }
            emit(CaptureEvent.Tick(t, heads))
        }
        lifecycle(s, t)
        flushOut()
    }

    /** App exit: end the open Session (its tail is already persisted). */
    fun close() {
        flushOut()
        if (uuid != null) sink.close(wallIso())
        uuid = null
    }

    private fun lifecycle(s: EngineSnapshot, t: Double) {
        val audible = (0..3).any(state::audible)
        if (audible) lastAudible = t
        if (uuid == null) {
            if (audible) {
                uuid = UUID.randomUUID().toString()
                val context = buffer.also { for (i in 0 until out.length()) it.put(out.get(i)) }
                clearOut()
                buffer = JSONArray()
                sink.open(uuid!!, wallIso(), context)
            } else if (buffer.length() + out.length() > MAX_CONTEXT) { buffer = JSONArray(); clearOut(); state = SessionState(); seed(s, t) }
        } else if (t - lastAudible >= SILENCE_SPLIT_SECONDS) {
            flushOut()
            sink.close(wallIso())
            uuid = null
            buffer = JSONArray(); state = SessionState(); tick = Double.NEGATIVE_INFINITY
            if (tenure != null) emit(CaptureEvent.Tenure(t, true, tenure!!)) else seed(s, t)
        }
    }

    private fun flushOut() {
        if (out.length() == 0) return
        if (uuid != null) { sink.events(JSONArray(out.toString())) } else for (i in 0 until out.length()) buffer.put(out.get(i))
        clearOut()
    }

    private fun clearOut() { while (out.length() > 0) out.remove(out.length() - 1) }

    private var lastEmitted = 0.0
    private fun emit(e: CaptureEvent) {
        lastEmitted = e.t
        SessionLog.reduce(state, e)
        out.put(json(e))
    }

    private fun seed(s: EngineSnapshot, t: Double) {
        for (d in 0..3) {
            val x = s.decks[DeckId.entries[d]] ?: continue
            controls(d, null, x, t)
            emit(CaptureEvent.Control(t, d, "crossfaderAssignment", if (d % 2 == 0) -1.0 else 1.0))
        }
        emit(CaptureEvent.Control(t, null, "crossfader", s.crossfade))
        emit(CaptureEvent.Control(t, null, "crossfaderEnabled", 1.0))
        emit(CaptureEvent.BeatFx(t, section(s.beatFx)))
        for (d in 0..3) {
            val x = s.decks[DeckId.entries[d]] ?: continue
            if (x.sourceId != null) emit(CaptureEvent.Load(t, d, trackOf(x.sourceId), x.bpm))
            emit(CaptureEvent.Loop(t, d, x.sourceSeconds, x.loop?.let { LoopSpan(it.start, it.end) }))
            // A re-seed (after a machine tenure) also states what stopped, so the log never carries a stale transport.
            val was = state.decks[d]
            if (x.scratching) emit(CaptureEvent.Transport(t, d, "scratchBegin", x.sourceSeconds))
            else if (was.scratching) emit(CaptureEvent.Transport(t, d, "scratchEnd", x.sourceSeconds))
            if (!x.scratching && playing(x)) emit(CaptureEvent.Transport(t, d, "play", x.sourceSeconds))
            else if (!x.scratching && was.playing) emit(CaptureEvent.Transport(t, d, "pause", x.sourceSeconds))
            if (previewing(x)) emit(CaptureEvent.Transport(t, d, "previewStart", x.sourceSeconds, detail = hotSlot(x)))
            else if (was.previewing) emit(CaptureEvent.Transport(t, d, "previewEnd", x.sourceSeconds))
            emit(CaptureEvent.Pitch(t, d, x.pitchPercent))
            if (x.bendPercent != 0.0) emit(CaptureEvent.Bend(t, d, x.bendPercent))
        }
    }

    private fun controls(d: Int, p: DeckSnapshot?, c: DeckSnapshot, t: Double) {
        fun ctl(name: String, a: Double?, b: Double) { if (a == null || abs(a - b) > 1e-6) emit(CaptureEvent.Control(t, d, name, b)) }
        ctl("fader", p?.fader, c.fader); ctl("trim", p?.trim, c.trim)
        ctl("eqLow", p?.eq?.get(0), c.eq[0]); ctl("eqMid", p?.eq?.get(1), c.eq[1]); ctl("eqHigh", p?.eq?.get(2), c.eq[2])
        ctl("filter", p?.filter, c.filter)
        ctl("pfl", p?.let { if (it.pfl) 1.0 else 0.0 }, if (c.pfl) 1.0 else 0.0)
        for ((i, name) in STEMS.withIndex()) ctl(name, p?.let { stem(it, i) }, stem(c, i))
    }

    private fun diff(p: EngineSnapshot, c: EngineSnapshot, t: Double, dt: Double) {
        // Rate changes first, each back-dated to the instant it took effect between the two samples (the
        // positions pin it down): replay then integrates exactly what played, not a poll-late rate step.
        val rates = ArrayList<Pair<Double, CaptureEvent>>()
        for (d in 0..3) {
            val id = DeckId.entries[d]
            val x = c.decks[id] ?: continue
            val o = p.decks[id] ?: continue
            if (o.loadId != x.loadId || o.sourceId != x.sourceId || (o.pitchPercent == x.pitchPercent && o.bendPercent == x.bendPercent)) continue
            val at = rateChangeAt(o, x, t - dt, t)
            if (o.pitchPercent != x.pitchPercent) rates += at to CaptureEvent.Pitch(at, d, x.pitchPercent)
            if (o.bendPercent != x.bendPercent) rates += at to CaptureEvent.Bend(at, d, x.bendPercent)
        }
        for ((_, e) in rates.sortedBy { it.first }) emit(e)
        if (abs(p.crossfade - c.crossfade) > 1e-6) emit(CaptureEvent.Control(t, null, "crossfader", c.crossfade))
        if (p.beatFx != c.beatFx) emit(CaptureEvent.BeatFx(t, section(c.beatFx)))
        for (d in 0..3) {
            val id = DeckId.entries[d]
            val x = c.decks[id] ?: continue
            val o = p.decks[id]
            if (o == null || o.loadId != x.loadId || o.sourceId != x.sourceId) {
                if (x.sourceId != null || o?.sourceId != null) emit(CaptureEvent.Load(t, d, trackOf(x.sourceId), x.bpm))
                controls(d, o, x, t)
                emit(CaptureEvent.Pitch(t, d, x.pitchPercent))
                if (x.bendPercent != (o?.bendPercent ?: 0.0)) emit(CaptureEvent.Bend(t, d, x.bendPercent))
                emit(CaptureEvent.Loop(t, d, x.sourceSeconds, x.loop?.let { LoopSpan(it.start, it.end) }))
                if (playing(x)) emit(CaptureEvent.Transport(t, d, "play", x.sourceSeconds))
                continue
            }
            controls(d, o, x, t)
            if (o.loop?.start != x.loop?.start || o.loop?.end != x.loop?.end) emit(CaptureEvent.Loop(t, d, x.sourceSeconds, x.loop?.let { LoopSpan(it.start, it.end) }))
            // The platter owns the deck until it lets go: begin, then the landing (desktop scratchEnd).
            if (o.scratching != x.scratching) { emit(CaptureEvent.Transport(t, d, if (x.scratching) "scratchBegin" else "scratchEnd", x.sourceSeconds)); continue }
            if (x.scratching) continue
            var settled = false
            if (playing(o) != playing(x)) { emit(CaptureEvent.Transport(t, d, if (playing(x)) "play" else "pause", x.sourceSeconds)); settled = true }
            if (previewing(o) != previewing(x)) {
                emit(CaptureEvent.Transport(t, d, if (previewing(x)) "previewStart" else "previewEnd", x.sourceSeconds, detail = if (previewing(x)) hotSlot(x) else null))
                settled = true
            }
            if (!settled && abs(x.sourceSeconds - expected(o, dt)) > JUMP_SECONDS) emit(CaptureEvent.Transport(t, d, "seek", x.sourceSeconds))
        }
    }

    /**
     * When a rate change between samples [o] (at [t0]) and [x] (at [t1]) took effect, from the positions:
     * o.pos + r0·(t' − t0) + r1·(t1 − t') = x.pos. [t1] when not determinable (not moving, relocated, equal rates).
     */
    private fun rateChangeAt(o: DeckSnapshot, x: DeckSnapshot, t0: Double, t1: Double): Double {
        if (!moving(o) || !moving(x) || o.filling || x.filling || o.scratching || x.scratching) return t1
        val r0 = (1 + o.pitchPercent / 100) * (1 + o.bendPercent / 100)
        val r1 = (1 + x.pitchPercent / 100) * (1 + x.bendPercent / 100)
        if (abs(r0 - r1) < 1e-9) return t1
        val at = (x.sourceSeconds - o.sourceSeconds - r1 * t1 + r0 * t0) / (r0 - r1)
        return if (at.isFinite() && at >= t0 - 1e-9 && at <= t1 + 1e-9) at.coerceIn(maxOf(t0, lastEmitted), t1) else t1
    }

    /** Where [o] would be after [dt] with nothing pressed (held while filling or paused; folded into an active loop). */
    private fun expected(o: DeckSnapshot, dt: Double): Double {
        if (!moving(o) || o.filling) return o.sourceSeconds
        val p = o.sourceSeconds + dt * (1 + o.pitchPercent / 100) * (1 + o.bendPercent / 100)
        val l = o.loop ?: return p
        return if (o.sourceSeconds >= l.start && o.sourceSeconds < l.end && p >= l.end && l.end > l.start) l.start + (p - l.start) % (l.end - l.start) else p
    }

    companion object {
        const val TICK_SECONDS = 1.0
        const val SILENCE_SPLIT_SECONDS = 600.0
        /** A position change beyond plain playback by more than this is a relocation (seek / jump / cue / hot cue). */
        const val JUMP_SECONDS = .010
        const val MAX_CONTEXT = 20_000
        private val STEMS = listOf("stemVocals", "stemDrums", "stemBass", "stemOther")

        /** Sounding transport (a quantized launch counts from its launch frame, like the audio). */
        private fun playing(x: DeckSnapshot) = x.playing && x.launchFrame == null
        private fun previewing(x: DeckSnapshot) = x.previewing && x.launchFrame == null
        private fun moving(x: DeckSnapshot) = playing(x) || previewing(x)
        private fun hotSlot(x: DeckSnapshot) = x.previewSlot?.takeIf { it in 0 until AudioEngine.HOT_CUES }?.toDouble()
        private fun stem(x: DeckSnapshot, i: Int) = if ((x.stemGains.getOrNull(i) ?: 1.0) > .5) 1.0 else 0.0

        fun section(b: BeatFxState) = dev.manadj.library.session.BeatFxSection(
            when (b.effect) {
                BeatFxEffect.ECHO -> "echo"; BeatFxEffect.LOW_CUT_ECHO -> "lowCutEcho"; BeatFxEffect.REVERB -> "reverb"
                BeatFxEffect.FLANGER -> "flanger"; BeatFxEffect.TRANS -> "trans"; BeatFxEffect.ROLL -> "roll"; null -> null
            },
            if (b.target == BeatFxTarget.MASTER) "master" else b.target.name, b.on, b.depth, b.beats, b.held.map { it.ordinal }.toSet())

        /** Desktop wire shape (frontend/src/capture/events.ts). */
        fun json(e: CaptureEvent): JSONObject {
            val o = JSONObject().put("t", e.t)
            fun ch(d: Int) = DECKS[d]
            when (e) {
                is CaptureEvent.Load -> o.put("kind", "load").put("channel", ch(e.deck)).put("trackId", e.trackId ?: JSONObject.NULL).put("bpm", e.bpm ?: JSONObject.NULL)
                is CaptureEvent.Transport -> o.put("kind", "transport").put("channel", ch(e.deck)).put("action", e.action).put("playhead", e.playhead).apply { e.detail?.let { put("detail", it.toInt()) } }
                is CaptureEvent.Pitch -> o.put("kind", "pitch").put("channel", ch(e.deck)).put("value", e.value)
                is CaptureEvent.Bend -> o.put("kind", "bend").put("channel", ch(e.deck)).put("value", e.value)
                is CaptureEvent.Loop -> o.put("kind", "loop").put("channel", ch(e.deck)).put("playhead", e.playhead)
                    .put("region", e.region?.let { JSONObject().put("start", it.start).put("end", it.end) } ?: JSONObject.NULL)
                is CaptureEvent.Tick -> o.put("kind", "tick").put("playheads", JSONObject().apply { e.playheads.forEach { (d, p) -> put(ch(d), p) } })
                is CaptureEvent.Control -> o.put("kind", "control").put("control", e.control).put("channel", e.deck?.let(::ch) ?: JSONObject.NULL).put("value", e.value)
                is CaptureEvent.Tenure -> o.put("kind", "tenure").put("edge", if (e.start) "start" else "end").put("holder", e.holder)
                is CaptureEvent.BeatFx -> o.put("kind", "beatFx").put("selected", e.section.selected ?: JSONObject.NULL).put("target", e.section.target)
                    .put("on", e.section.on).put("depth", e.section.depth).put("beats", e.section.beats).put("held", JSONArray(e.section.held.sorted().map(::ch)))
                is CaptureEvent.Other -> o.put("kind", e.kind)
            }
            return o
        }
    }
}
