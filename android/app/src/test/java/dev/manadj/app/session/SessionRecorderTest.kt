package dev.manadj.app.session

import dev.manadj.audio.BeatFx
import dev.manadj.audio.DeckId
import dev.manadj.audio.DeckSnapshot
import dev.manadj.audio.EngineSnapshot
import dev.manadj.audio.LoadState
import dev.manadj.audio.LoopRegion
import dev.manadj.audio.Routing
import dev.manadj.library.session.SessionLog
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** #395: what the phone records replays to the positions it heard, in the desktop vocabulary and Session lifecycle. */
class SessionRecorderTest {
    /** A deck the fake engine plays: position advances at its rate while playing; relocations are instant. */
    private class Deck(var source: String? = null) {
        var loadId = 0L; var pos = 0.0; var playing = false; var previewing = false; var previewSlot: Int? = null
        var fader = 0.0; var trim = .5; var pitch = 0.0; var bend = 0.0; var loop: LoopRegion? = null; var scratching = false
        val eq = mutableListOf(.5, .5, .5)
        fun snap() = DeckSnapshot(source, loadId, if (source == null) LoadState.EMPTY else LoadState.READY, null, pos, (pos * 48000).toLong(), 48000,
            300.0, fader, trim, pitch, bend, playing, previewing, false, eq.toList(), 0.0, 174.0, 0.0, loop, 4.0, previewSlot, null,
            List(8) { null }, false, false, 0, -1, 0, 0, scratching = scratching)
        fun advance(dt: Double) {
            if (!(playing || previewing) || scratching) return
            pos += dt * (1 + pitch / 100) * (1 + bend / 100)
            loop?.let { l -> if (pos >= l.end) pos = l.start + (pos - l.start) % (l.end - l.start) }
        }
    }

    private class Sink : SessionRecorder.Sink {
        val opened = ArrayList<Pair<String, JSONArray>>(); val events = ArrayList<JSONObject>(); var closed = 0
        override fun open(uuid: String, startedAt: String, context: JSONArray) { opened += uuid to context; for (i in 0 until context.length()) events += context.getJSONObject(i) }
        override fun events(events: JSONArray) { for (i in 0 until events.length()) this.events += events.getJSONObject(i) }
        override fun close(endedAt: String) { closed++ }
        fun log() = SessionLog.parse(JSONObject().put("uuid", "x").put("events", JSONArray(events)).toString())
    }

    private class Rig {
        val decks = List(4) { Deck() }
        val sink = Sink()
        val recorder = SessionRecorder({ it?.removePrefix("library:")?.substringBefore(':')?.toIntOrNull() }, sink, { "2026-10-15T07:00:00" })
        var frame = 0L
        var xf = 0.0
        var machine: String? = null
        /** Capture time of the last sample (the recorder's clock starts at 1.0 on the first frame). */
        val t get() = 1.0 + (frame - 2400) / 48000.0
        fun snap() = EngineSnapshot(frame, 48000, 2, 1, true, 0, xf, Routing.STEREO, .5, false, BeatFx.DEFAULT, emptySet(), 0, 0, 0, 0, 0,
            DeckId.entries.associateWith { decks[it.ordinal].snap() }, emptySet(), clockFrame = frame)
        fun run(seconds: Double, each: (Double) -> Unit = {}) {
            repeat((seconds / .05).toInt()) {
                frame += 2400
                decks.forEach { it.advance(.05) }
                each(t)
                recorder.observe(snap(), machine)
            }
        }
    }

    @Test fun replayOfTheRecordedLogReproducesEveryHeardPosition() {
        val r = Rig()
        val a = r.decks[0]; val b = r.decks[1]
        r.run(.1)
        a.source = "library:7:rev"; a.loadId = 1; a.fader = 1.0; a.pitch = 1.7
        r.run(1.0)
        a.playing = true
        val heard = ArrayList<Triple<Double, Int, Double>>()
        r.run(20.0) { t -> heard += Triple(t, 0, a.pos) }
        a.pos += 3.448 // beat jump
        b.source = "library:9:rev"; b.loadId = 1; b.pos = 32.0; b.fader = .8; b.pitch = 1.7
        r.run(4.0) { t -> heard += Triple(t, 0, a.pos) }
        b.previewing = true; b.previewSlot = 2 // hot cue stab
        r.run(.5) { t -> heard += Triple(t, 1, b.pos) }
        b.previewing = false; b.previewSlot = null; b.pos = 32.0
        b.playing = true; b.bend = 4.0
        r.run(.4) { t -> heard += Triple(t, 1, b.pos) }
        b.bend = 0.0; a.loop = LoopRegion(a.pos - .2, a.pos + 1.179, 4.0) // engaged at the playhead (4 beats)
        r.run(10.0) { t -> heard += Triple(t, 0, a.pos); heard += Triple(t, 1, b.pos) }
        a.scratching = true
        r.run(.6)
        a.scratching = false; a.pos = 12.0; a.loop = null
        r.run(5.0) { t -> heard += Triple(t, 0, a.pos); heard += Triple(t, 1, b.pos) }
        val log = r.sink.log()
        var worst = 0.0
        for ((t, d, want) in heard) {
            val got = log.replayAt(t).decks[d].playhead
            if (kotlin.math.abs(got - want) > 1e-6 && worst < 1e-6) println("first mismatch t=%.3f deck %d want %.4f got %.4f".format(t, d, want, got))
            worst = maxOf(worst, kotlin.math.abs(got - want))
        }
        assertTrue("worst replay error %.4f s".format(worst), worst < 1e-6)
        assertEquals(listOf(7, 9), log.appearances.map { it.trackId })
        val kinds = r.sink.events.map { it.getString("kind") + ":" + it.optString("action") }.toSet()
        assertTrue(kinds.containsAll(listOf("transport:previewStart", "transport:previewEnd", "transport:seek", "transport:scratchBegin", "transport:scratchEnd", "bend:", "loop:")))
    }

    @Test fun sessionOpensOnTheFirstAudibleInstantWithItsContext() {
        val r = Rig()
        val a = r.decks[0]
        a.source = "library:7:rev"; a.loadId = 1
        a.playing = true // playing with the fader down: not audible (PFL / cueing)
        r.run(30.0)
        assertTrue(r.sink.opened.isEmpty())
        a.fader = 1.0
        r.run(1.0)
        val (_, context) = r.sink.opened.single()
        assertTrue("loads before audibility ride the context", (0 until context.length()).any { context.getJSONObject(it).getString("kind") == "load" })
    }

    @Test fun tenMinutesWithoutAudibilitySplitAndMachineTenureCountsAsSilence() {
        val r = Rig()
        val a = r.decks[0]
        a.source = "library:7:rev"; a.loadId = 1; a.fader = 1.0; a.playing = true
        r.run(5.0)
        r.machine = "session-replay" // Session replay holds the decks: only markers are logged
        val before = r.sink.events.size
        r.run(60.0)
        assertEquals(listOf("tenure"), r.sink.events.drop(before).map { it.getString("kind") }.distinct())
        r.machine = null; a.playing = false
        r.run(SessionRecorder.SILENCE_SPLIT_SECONDS)
        assertEquals(1, r.sink.closed)
        assertNull(r.recorder.uuid)
        a.playing = true
        r.run(1.0)
        assertEquals(2, r.sink.opened.size)
    }
}
