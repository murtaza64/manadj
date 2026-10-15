package dev.manadj.library.session

import org.json.JSONArray
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SessionTimelineTest {
    private fun log(vararg events: JSONObject) = SessionLog.parse(JSONObject().put("uuid", "t").put("events", JSONArray(events.toList())).toString())
    private fun ev(t: Double, kind: String, deck: String? = null) = JSONObject().put("t", t).put("kind", kind).apply { if (deck != null) put("channel", deck) }

    @Test fun runsReproduceTheReplayReferenceEverywhere() {
        val log = SessionLog.parse(SyntheticSession.json(seed = 11, seconds = 600.0))
        val tl = SessionTimeline(log)
        var t = log.start + .013
        var checked = 0
        while (t < log.end) {
            val ref = log.replayAt(t)
            for (d in 0..3) {
                val want = ref.decks[d]
                val run = tl.runAt(d, t)
                if (want.trackId == null || !want.sounding || want.scratching) { assertNull(run, "t=$t deck $d"); continue }
                assertNotNull(run, "t=$t deck $d")
                assertEquals(want.trackId, run.trackId)
                assertEquals(want.playhead, run.at(t), 1e-6, "t=$t deck $d")
                checked++
            }
            t += .37
        }
        assertTrue(checked > 2000)
        for (d in 0..3) tl.runs[d].zipWithNext { a, b -> assertTrue(a.t1 <= b.t0 + 1e-9) }
    }

    @Test fun loopsSplitIntoWrappingRunsAndContinuousPlayMerges() {
        val tl = SessionTimeline(log(
            ev(0.0, "load", "A").put("trackId", 1),
            ev(0.0, "transport", "A").put("action", "play").put("playhead", 10.0),
            ev(1.0, "tick").put("playheads", JSONObject().put("A", 11.0)),
            ev(2.0, "loop", "A").put("playhead", 12.0).put("region", JSONObject().put("start", 12.0).put("end", 13.0)),
            ev(4.5, "loop", "A").put("playhead", 12.5).put("region", JSONObject.NULL),
            ev(5.0, "transport", "A").put("action", "pause").put("playhead", 13.0),
        ))
        val runs = tl.runs[0]
        assertEquals(listOf(0.0, 3.0, 4.0), runs.take(3).map { it.t0 })
        assertEquals(10.0, runs[0].p0); assertEquals(13.0, runs[0].p1, 1e-9) // play + loop entry merge: one segment 10 → 13
        assertEquals(12.0, runs[1].p0)
        assertEquals(5.0, runs.last().t1)
        assertEquals(1, tl.loops.size); assertEquals(2.0, tl.loops[0].t0); assertEquals(4.5, tl.loops[0].t1)
    }

    @Test fun playedSpanAndActiveEndStopWhereTheAudioStops() {
        val log = log(
            ev(0.0, "load", "A").put("trackId", 1),
            ev(10.0, "transport", "A").put("action", "play").put("playhead", 0.0),
            ev(70.0, "transport", "A").put("action", "pause").put("playhead", 60.0),
            ev(500.0, "tick").put("playheads", JSONObject()),
        )
        val tl = SessionTimeline(log)
        assertEquals(10.0 to 70.0, tl.playedSpan(log.appearances.single()))
        assertEquals(70.0, tl.activeEnd)
    }

    @Test fun reachNextSoundAndEarlyLoadsForReplayScheduling() {
        val log = log(
            ev(0.0, "load", "A").put("trackId", 1),
            ev(0.0, "transport", "A").put("action", "play").put("playhead", 10.0),
            ev(30.0, "transport", "A").put("action", "pause").put("playhead", 40.0),
            ev(31.0, "transport", "A").put("action", "seek").put("playhead", 0.0),
            ev(100.0, "load", "A").put("trackId", 2),
            ev(101.0, "transport", "A").put("action", "play").put("playhead", 5.0),
            ev(120.0, "load", "B").put("trackId", 3),
            ev(200.0, "tick").put("playheads", JSONObject()),
        )
        val tl = SessionTimeline(log)
        assertEquals(25.0, tl.reach(0, 5.0, 15.0)!!, 1e-9)
        assertNull(tl.reach(0, 40.0, 90.0))
        assertEquals(101.0, tl.nextSound(0, 35.0))
        assertNull(tl.nextSound(1, 0.0))
        assertEquals(listOf(SessionTimeline.EarlyLoad(0.0, 0, 1, 0.0), SessionTimeline.EarlyLoad(100.0, 0, 2, 30.0), SessionTimeline.EarlyLoad(120.0, 1, 3, 0.0)), tl.earlyLoads)
    }

    @Test fun gesturesSkipJogsAndLabelLikeDesktop() {
        val tl = SessionTimeline(log(
            ev(0.0, "load", "B").put("trackId", 2),
            ev(0.0, "transport", "B").put("action", "play").put("playhead", 0.0),
            ev(10.0, "transport", "B").put("action", "seek").put("playhead", 11.0),
            ev(20.0, "transport", "B").put("action", "seek").put("playhead", 100.0),
            ev(30.0, "transport", "B").put("action", "hotCue").put("playhead", 32.0).put("detail", 3),
            ev(40.0, "transport", "B").put("action", "jumpBeats").put("playhead", 30.0).put("detail", -16),
        ))
        assertEquals(listOf("↕", "◆3", "↶16"), tl.gestures.map { it.label })
        assertTrue(tl.gestures.all { it.deck == 1 })
    }

    @Test fun mixStepsCarryAudibleGainAndModulation() {
        val tl = SessionTimeline(log(
            ev(0.0, "load", "A").put("trackId", 1),
            ev(0.0, "transport", "A").put("action", "play").put("playhead", 0.0),
            ev(5.0, "control", "A").put("control", "fader").put("value", .5),
            ev(6.0, "control", "A").put("control", "eqLow").put("value", 0.0),
            ev(7.0, "control", null).put("control", "crossfader").put("value", 1.0),
        ))
        assertEquals(SessionTimeline.trimGain(.5), tl.mixAt(0, 1.0).gain, 1e-9)
        assertEquals(.25, tl.mixAt(0, 5.5).level, 1e-9)
        assertEquals(0.0, tl.mixAt(0, 6.5).low)
        val cut = tl.mixAt(0, 8.0)
        assertEquals(false, cut.audible); assertEquals(0.0, cut.gain); assertEquals(.25, cut.level, 1e-9)
    }

    @Test fun beatFxSpansFollowTargetDepthAndHeldPaddles() {
        fun fx(t: Double, on: Boolean, depth: Double, target: String = "A", held: List<String> = emptyList()) =
            ev(t, "beatFx").put("selected", "echo").put("target", target).put("on", on).put("depth", depth).put("beats", .5).put("held", JSONArray(held))
        val tl = SessionTimeline(log(fx(0.0, false, 0.0), fx(1.0, true, 0.0), fx(2.0, true, .5), fx(3.0, false, .5, held = listOf("C")), fx(4.0, false, .5), ev(5.0, "tick")))
        assertEquals(listOf(Triple(0, 1.0, 2.0), Triple(0, 2.0, 3.0), Triple(2, 3.0, 4.0)), tl.fx.map { Triple(it.deck, it.t0, it.t1) })
        assertEquals(.5, tl.fx[1].depth)
    }

    /** Real Sessions (MANADJ_SESSION_DIR, gitignored dumps): runs match the replay reference; derivation time logged. */
    @Test fun realSessionsDeriveConsistentTimelines() {
        val dir = System.getenv("MANADJ_SESSION_DIR")?.let { java.io.File(it) }?.takeIf { it.isDirectory } ?: return
        for (f in dir.listFiles { x -> x.name.endsWith(".json") }!!.sortedBy { it.length() }.takeLast(12)) {
            val log = f.bufferedReader().use { SessionLog.parse(it) }
            val t0 = System.nanoTime()
            val tl = SessionTimeline(log)
            val ms = (System.nanoTime() - t0) / 1e6
            var t = log.activeStart; var n = 0
            val step = maxOf(.5, (log.end - log.activeStart) / 3000)
            while (t < log.end) {
                val ref = log.replayAt(t)
                for (d in 0..3) {
                    val want = ref.decks[d]; val run = tl.runAt(d, t)
                    if (want.trackId == null || !want.sounding || want.scratching) assertNull(run, "${f.name} t=$t deck $d")
                    else { assertNotNull(run, "${f.name} t=$t deck $d"); assertEquals(want.playhead, run.at(t), 1e-6); n++ }
                }
                t += step
            }
            println("${f.name}: ${log.events.size} events, ${tl.runs.sumOf { it.size }} runs, ${tl.gestures.size} gestures, ${tl.fx.size} fx, derive %.0f ms, $n checks".format(ms))
        }
    }

    @Test fun staggerFollowAndRulerMatchDesktop() {
        assertContentEquals(intArrayOf(0, 1, 0, 2, 1), TimelineLayout.staggerRows(listOf(0f to 10f, 5f to 20f, 10f to 30f, 15f to 18f, 21f to 22f), 3))
        assertContentEquals(intArrayOf(0, 1, 0), TimelineLayout.staggerRows(listOf(0f to 10f, 5f to 20f, 6f to 8f), 2)) // full: earliest-free row
        assertEquals(0.0, TimelineLayout.follow(0.0, 100.0, 80.0, 1000.0))
        assertEquals(10.0, TimelineLayout.follow(0.0, 100.0, 90.0, 1000.0))
        assertEquals(50.0, TimelineLayout.follow(50.0, 100.0, 20.0, 1000.0)) // never backwards
        assertEquals(1000.0, TimelineLayout.follow(990.0, 100.0, 1095.0, 1000.0))
        assertEquals(300.0, TimelineLayout.rulerStep(1800.0, 1100f))
        assertEquals(5.0, TimelineLayout.rulerStep(30.0, 880f))
    }
}
