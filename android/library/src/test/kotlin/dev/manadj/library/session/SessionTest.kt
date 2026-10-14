package dev.manadj.library.session

import org.json.JSONArray
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Fixtures from the #368 prototype: session.json + desktop stateAt/planReplay goldens (expected.json). */
private fun resource(name: String) = SessionTest::class.java.getResource("/session/$name")!!.readText()
private fun fixture() = SessionLog.parse(resource("session.json"))

class SessionTest {
    @Test fun reconstructedFourDeckStatesMatchDesktopStateAt() {
        val log = fixture()
        val expected = JSONArray(resource("expected.json"))
        for (i in 0 until expected.length()) {
            val sample = expected.getJSONObject(i)
            val t = sample.getDouble("t")
            val state = log.at(t)
            val decks = sample.getJSONObject("state").getJSONObject("decks")
            for ((d, ch) in DECKS.withIndex()) {
                val want = decks.getJSONObject(ch)
                val got = state.decks[d]
                val at = "t=$t deck $ch"
                assertEquals(if (want.isNull("trackId")) null else want.getInt("trackId"), got.trackId, "$at track")
                assertEquals(want.getDouble("playhead"), got.playhead, 1e-8, "$at playhead")
                assertEquals(want.getBoolean("playing"), got.playing, "$at playing")
                assertEquals(want.getBoolean("audible"), state.audible(d), "$at audible")
                assertEquals(want.getDouble("pitch"), got.pitch, 1e-8, "$at pitch")
                assertEquals(want.getDouble("fader"), got.fader, 1e-8, "$at fader")
                val loop = want.optJSONObject("loop")
                assertEquals(loop?.let { LoopSpan(it.getDouble("start"), it.getDouble("end")) }, got.loop, "$at loop")
            }
        }
    }

    @Test fun cuesMatchDesktopPlanner() {
        val log = fixture()
        val expected = JSONArray(resource("expected.json"))
        for (i in 0 until expected.length()) {
            val sample = expected.getJSONObject(i)
            val t = sample.getDouble("t")
            val want = sample.getJSONObject("plan").getJSONObject("plan").getJSONArray("cues")
            val got = log.cuesAfter(t)
            assertEquals(want.length(), got.size, "t=$t cue count")
            for (k in 0 until want.length()) {
                val w = want.getJSONObject(k)
                val g = got[k]
                assertEquals(w.getDouble("offsetS"), g.offset, 1e-9, "t=$t cue $k offset")
                val kind = when (g) {
                    is ReplayCue.Control -> "control"; is ReplayCue.Play -> "play"; is ReplayCue.Pause -> "pause"
                    is ReplayCue.Seek -> "seek"; is ReplayCue.Scratch -> g.action; is ReplayCue.PreviewStart -> "previewStart"
                    is ReplayCue.PreviewEnd -> "previewEnd"; is ReplayCue.Pitch -> "pitch"; is ReplayCue.Load -> "load"
                    is ReplayCue.Loop -> "loop"; is ReplayCue.Sync -> "sync"; is ReplayCue.BeatFx -> "beatFx"
                }
                assertEquals(w.getString("kind"), kind, "t=$t cue $k kind")
            }
        }
    }

    @Test fun loopAndPreviewFollowRecordedPositions() {
        val log = fixture()
        assertEquals(25.0, log.at(137.0).decks[2].playhead, 1e-8)
        assertTrue(log.at(155.0).decks[0].previewing)
        assertFalse(log.at(155.0).decks[0].playing)
        assertEquals(20.0, log.at(157.0).decks[0].playhead, 1e-8)
    }

    @Test fun repeatedLoadsAreSeparateAppearances() {
        val log = fixture()
        assertEquals(8, log.appearances.size)
        assertEquals(listOf(101, 105), log.appearances.filter { it.deck == 0 }.map { it.trackId })
        assertNull(log.at(204.0).decks[1].trackId)
        assertEquals(124.0, log.appearances.first { it.deck == 3 }.firstSound)
    }

    @Test fun unsupportedVocabularyIsListedNotFatal() {
        val root = JSONObject(resource("session.json"))
        val events = root.getJSONArray("events")
        events.getJSONObject(1).put("action", "scratchBegin")
        events.put(JSONObject("""{"t":220,"kind":"init","outgoingChannel":"A"}"""))
        events.put(JSONObject("""{"t":220,"kind":"control","channel":"A","control":"stemDrums","value":0}"""))
        val log = SessionLog.parse(root.toString())
        assertEquals(3, log.issues.size)
        assertTrue(log.issues.any { "scratch" in it.what } && log.issues.any { "init" in it.what } && log.issues.any { "stem" in it.what })
    }

    @Test fun equalTimeEventsKeepCaptureOrderAndLoadDoesNotPause() {
        val root = JSONObject(resource("session.json")).put("events", JSONArray("""[
            {"t":10,"kind":"load","channel":"A","trackId":101,"bpm":128},
            {"t":10,"kind":"transport","channel":"A","action":"play","playhead":8},
            {"t":11,"kind":"load","channel":"A","trackId":102,"bpm":128},
            {"t":12,"kind":"transport","channel":"A","action":"pause","playhead":1},
            {"t":13,"kind":"tick","playheads":{"A":1}}
        ]"""))
        val log = SessionLog.parse(root.toString())
        assertTrue(log.at(11.5).decks[0].playing)
        assertEquals(.5, log.at(11.5).decks[0].playhead, 0.0)
        assertFalse(log.at(12.0).decks[0].playing)
    }
}

class SessionReplayerTest {
    private fun none() = List<Int?>(4) { null }

    @Test fun seedLoadsEveryOccupiedDeckThenResyncsOnReady() {
        val r = SessionReplayer(fixture())
        val ops = r.seek(130.0, none(), play = true)
        assertEquals(listOf(101, 102, 103, 104), ops.filterIsInstance<ReplayOp.Load>().map { it.trackId })
        assertTrue(ops.none { it is ReplayOp.Play })
        val ready = r.deckReady(0)
        // A at 130: played from 80 at 128 with +4 % pitch.
        assertEquals(80 + 2 * 1.04, ready.filterIsInstance<ReplayOp.Seek>().single().seconds, 1e-9)
        assertTrue(ready.any { it is ReplayOp.Play && it.deck == 0 })
        assertTrue(ready.any { it is ReplayOp.Pitch && it.percent == 4.0 })
    }

    @Test fun heldTracksResyncWithoutReloading() {
        val r = SessionReplayer(fixture())
        val ops = r.seek(130.0, listOf(101, 102, 103, 104), play = true)
        assertTrue(ops.none { it is ReplayOp.Load })
        assertEquals(4, ops.count { it is ReplayOp.Play })
        // C is inside its loop at 130 (24..28 from 132? no: engaged at 132) -> plain seek.
        assertTrue(ops.any { it is ReplayOp.Seek && it.deck == 2 })
    }

    @Test fun cuesFireOnceInOrderAsTheClockPasses() {
        val r = SessionReplayer(fixture())
        r.seek(130.0, listOf(101, 102, 103, 104), play = true)
        val loop = r.advance(132.5)
        assertEquals(ReplayOp.Loop(2, LoopSpan(24.0, 28.0), 24.0), loop.single())
        assertTrue(r.advance(132.6).isEmpty())
        val fader = r.advance(136.0).filterIsInstance<ReplayOp.Fader>().single()
        assertEquals(1, fader.deck); assertEquals(.3, fader.value, 1e-9)
        // Crossfader hard right at 164 folds into the left decks' faders.
        val xf = r.advance(164.0).filterIsInstance<ReplayOp.Fader>()
        assertEquals(0.0, xf.first { it.deck == 0 }.value, 1e-9)
        assertEquals(1.0, xf.first { it.deck == 1 }.value, 1e-9)
    }

    @Test fun loadingDeckSkipsTransportUntilReady() {
        val r = SessionReplayer(fixture())
        r.seek(183.0, listOf(101, 102, 103, 104), play = true)
        val ops = r.advance(184.5)
        assertTrue(ops.any { it is ReplayOp.Load && it.deck == 0 && it.trackId == 105 })
        assertTrue(ops.none { it is ReplayOp.Play && it.deck == 0 })
        assertTrue(r.isLoading(0))
        val ready = r.deckReady(0)
        assertEquals(.52, ready.filterIsInstance<ReplayOp.Seek>().single().seconds, 1e-9)
        assertTrue(ready.any { it is ReplayOp.Play && it.deck == 0 })
    }

    @Test fun syncCorrectsPersistentDriftOnly() {
        val r = SessionReplayer(fixture())
        r.seek(184.5, listOf(105, 106, 107, 108), play = true)
        // Tick at 200 records A at 16.64. Engine 50 ms off: no correction.
        assertTrue(r.advance(200.0, listOf(16.66, null, null, null)).none { it is ReplayOp.Seek })
        // Gross one-off (a late landing) with only one sample: still waits for the window.
        val events = r.advance(220.0, listOf(37.44 + 1.0, null, null, null))
        assertTrue(events.none { it is ReplayOp.Seek && it.deck == 0 })
    }

    @Test fun jumpBeforeTrackStartPrerollsSilenceThenPlaysFromZero() {
        val root = JSONObject(resource("session.json")).put("events", JSONArray("""[
            {"t":10,"kind":"load","channel":"A","trackId":101,"bpm":128},
            {"t":10,"kind":"transport","channel":"A","action":"play","playhead":8},
            {"t":11,"kind":"transport","channel":"A","action":"jumpBeats","playhead":-2},
            {"t":20,"kind":"tick","playheads":{"A":7}}
        ]"""))
        val r = SessionReplayer(SessionLog.parse(root.toString()))
        r.seek(10.5, listOf(101, null, null, null), play = true)
        val jump = r.advance(11.5)
        assertTrue(jump.contains(ReplayOp.Seek(0, 0.0)) && jump.none { it is ReplayOp.Play })
        assertTrue(r.advance(12.9).none { it is ReplayOp.Play })
        assertEquals(listOf(ReplayOp.Seek(0, 0.0), ReplayOp.Play(0)), r.advance(13.1))
    }

    @Test fun residualOffsetIsServoedWithBendNotSeeks() {
        val root = JSONObject(resource("session.json")).put("events", JSONArray("""[
            {"t":10,"kind":"load","channel":"A","trackId":101,"bpm":128},
            {"t":10,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":11,"kind":"tick","playheads":{"A":1}}, {"t":12,"kind":"tick","playheads":{"A":2}},
            {"t":13,"kind":"tick","playheads":{"A":3}}, {"t":14,"kind":"tick","playheads":{"A":4}}
        ]"""))
        val r = SessionReplayer(SessionLog.parse(root.toString()))
        r.seek(10.5, listOf(101, null, null, null), play = true)
        assertTrue(r.advance(11.0, listOf(1.03, null, null, null)).isEmpty())
        val ops = r.advance(12.0, listOf(2.03, null, null, null))
        assertEquals(1, ops.size); assertEquals(-.3, (ops.single() as ReplayOp.Bend).percent, 1e-9)
        r.advance(13.0, listOf(3.002, null, null, null))
        assertEquals(ReplayOp.Bend(0, 0.0), r.advance(14.0, listOf(4.001, null, null, null)).first())
    }

    @Test fun firstMeasurementAfterStartSnapsStagger() {
        val root = JSONObject(resource("session.json")).put("events", JSONArray("""[
            {"t":10,"kind":"load","channel":"A","trackId":101,"bpm":128},
            {"t":10,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":11,"kind":"tick","playheads":{"A":1}}, {"t":12,"kind":"tick","playheads":{"A":2}}
        ]"""))
        val r = SessionReplayer(SessionLog.parse(root.toString()))
        r.seek(10.5, listOf(101, null, null, null), play = true)
        val ops = r.advance(11.0, listOf(.9, null, null, null))
        assertEquals(1.0, ops.filterIsInstance<ReplayOp.Seek>().single().seconds, 1e-9)
        assertTrue(ops.any { it is ReplayOp.Play })
    }

    @Test fun pauseStopsEveryDeckAndEndPauses() {
        val r = SessionReplayer(fixture())
        r.seek(219.0, listOf(105, null, 107, 108), play = true)
        val end = r.advance(221.0)
        assertFalse(r.playing)
        assertEquals(4, end.count { it is ReplayOp.Pause })
    }
}

/** Robustness over a directory of real SessionDetail dumps (not committed): MANADJ_SESSION_DIR=… ./gradlew :library:test */
class RealSessionsTest {
    @Test fun everyDumpParsesAndReplaysToTheEnd() {
        val dir = System.getenv("MANADJ_SESSION_DIR")?.let { java.io.File(it) }?.takeIf { it.isDirectory } ?: return
        val report = StringBuilder()
        for (f in dir.listFiles()!!.filter { it.name.endsWith(".json") }.sortedByDescending { it.length() }) {
            val t0 = System.nanoTime()
            val log = f.bufferedReader().use { SessionLog.parse(it) }
            val parsed = (System.nanoTime() - t0) / 1e6
            val r = SessionReplayer(log)
            val held = MutableList<Int?>(4) { null }
            r.seek(log.start, held, play = true)
            var t = log.start
            var ops = 0
            while (r.playing) {
                t += .02
                ops += r.advance(t).size
                for (d in 0..3) if (r.isLoading(d)) ops += r.deckReady(d).size
            }
            report.appendLine("${f.name.take(8)} ${f.length() / 1000} kB ${log.events.size} ev parse ${"%.0f".format(parsed)} ms, replay ops $ops, issues ${log.issues.size}")
        }
        println(report)
    }
}
