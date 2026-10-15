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

class ReplayScriptTest {
    private fun custom(events: String) = SessionLog.parse(JSONObject(resource("session.json")).put("events", JSONArray(events)).toString())

    @Test fun referenceIgnoresTicksAndIntegratesBend() {
        val log = custom("""[
            {"t":10,"kind":"load","channel":"A","trackId":101,"bpm":128},
            {"t":10,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":12,"kind":"bend","channel":"A","value":4},
            {"t":12.5,"kind":"bend","channel":"A","value":0},
            {"t":13,"kind":"pitch","channel":"A","value":-2},
            {"t":15,"kind":"tick","playheads":{"A":5.0}}
        ]""")
        assertEquals(5.0 + .5 * .98, log.at(15.5).decks[0].playhead, 1e-12)   // desktop: tick re-anchors, no bend
        assertEquals(1.5, log.replayAt(11.5).decks[0].playhead, 1e-12)
        assertEquals(3.0 + .5 * .04, log.replayAt(13.0).decks[0].playhead, 1e-12)
        assertEquals(3.02 + .98, log.replayAt(14.0).decks[0].playhead, 1e-12)
        assertEquals(3.02 + 2.5 * .98, log.replayAt(15.5).decks[0].playhead, 1e-12) // a lone tick (20 ms off) moves nothing...
        assertEquals(listOf(0 to 15.0), log.tickDivergence().map { it.deck to it.t })   // ...it is flagged
    }

    @Test fun anchorsAreRefinedByTheTicksThatAgreeAfterThem() {
        // Desktop recorded the launch at the gesture; the audio landed 40 ms later (quantized launch): ticks agree.
        val log = custom("""[
            {"t":10,"kind":"load","channel":"A","trackId":101,"bpm":128},
            {"t":10,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":11,"kind":"tick","playheads":{"A":0.9601}},
            {"t":12,"kind":"tick","playheads":{"A":1.9599}},
            {"t":13,"kind":"tick","playheads":{"A":2.96}},
            {"t":14,"kind":"transport","channel":"A","action":"pause","playhead":3.96},
            {"t":20,"kind":"transport","channel":"A","action":"play","playhead":3.96},
            {"t":21,"kind":"tick","playheads":{"A":4.9}},
            {"t":22,"kind":"tick","playheads":{"A":5.98}}
        ]""")
        assertEquals(-.04, log.replayAt(10.0).decks[0].playhead, 1e-12)      // anchor shifted, applied at the anchor
        assertEquals(2.96, log.replayAt(13.0).decks[0].playhead, 1e-12)
        assertEquals(3.96, log.replayAt(14.5).decks[0].playhead, 1e-12)      // pause keeps its recorded position
        assertEquals(4.96, log.replayAt(21.0).decks[0].playhead, 1e-12)      // disagreeing ticks: no shift...
        assertEquals(listOf(21.0, 22.0), log.tickDivergence().map { it.t })   // ...flagged instead
        assertTrue(ReplayScript(log).between(10.5, 30.0).none { it.t in setOf(11.0, 12.0, 13.0, 21.0, 22.0) })
    }

    @Test fun ticksNeverBecomeOps() {
        val log = fixture()
        val ops = ReplayScript(log).between(log.start, log.end)
        val tickTimes = log.events.filterIsInstance<CaptureEvent.Tick>().map { it.t }.toSet()
        val atTicks = ops.filter { it.t in tickTimes }.map { it.op }
        assertTrue(atTicks.none { it is ReplayOp.Locate }, "$atTicks")
    }

    @Test fun jumpBeforeTrackStartParksThenPlaysAtTheExactCrossing() {
        val log = custom("""[
            {"t":10,"kind":"load","channel":"A","trackId":101,"bpm":128},
            {"t":10,"kind":"pitch","channel":"A","value":25},
            {"t":10,"kind":"transport","channel":"A","action":"play","playhead":8},
            {"t":11,"kind":"transport","channel":"A","action":"jumpBeats","playhead":-2},
            {"t":20,"kind":"tick","playheads":{"A":7}}
        ]""")
        val ops = ReplayScript(log).between(10.5, 20.0)
        assertEquals(listOf(TimedOp(11.0, ReplayOp.Pause(0)), TimedOp(11.0, ReplayOp.Locate(0, null, 0.0)),
            TimedOp(12.6, ReplayOp.Locate(0, null, 0.0)), TimedOp(12.6, ReplayOp.Play(0))), ops.map { it.copy(t = Math.round(it.t * 1e9) / 1e9) })
        // A window starting inside the pre-roll still starts the deck.
        assertEquals(TimedOp(12.6, ReplayOp.Play(0)), ReplayScript(log).between(12.0, 13.0).last().let { it.copy(t = Math.round(it.t * 1e9) / 1e9) })
    }

    @Test fun placeSeedsLoopPitchAndTransport() {
        val log = fixture()
        val ops = ReplayScript(log).place(136.0, 2)
        assertTrue(ReplayOp.Locate(2, LoopSpan(24.0, 28.0), log.replayAt(136.0).decks[2].playhead) in ops, "$ops")
        assertEquals(ReplayOp.Play(2), ops.last())
    }

    /** Engine semantics the native tests pin down (EngineTest "Replay exactness"), stepped per output frame. */
    private class EngineModel(val rate: Int) {
        class Deck { var track: Int? = null; var playing = false; var pos = 0.0; var pitch = 0.0; var bend = 0.0; var loop: LoopSpan? = null }
        val decks = List(4) { Deck() }
        var frame = 0L
        fun apply(op: ReplayOp) {
            val d = op.deck?.let(decks::get)
            when (op) {
                is ReplayOp.Load -> d!!.apply { track = op.trackId; playing = false; pos = 0.0; loop = null }
                is ReplayOp.Play -> d!!.playing = true
                is ReplayOp.Pause -> d!!.playing = false
                is ReplayOp.Pitch -> d!!.pitch = op.percent.toFloat().toDouble()
                is ReplayOp.Bend -> d!!.bend = op.percent.toFloat().toDouble()
                is ReplayOp.Locate -> d!!.apply { loop = op.region; pos = op.playhead }
                is ReplayOp.Scratch, is ReplayOp.Fader, is ReplayOp.Eq, is ReplayOp.Filter, is ReplayOp.BeatFx -> {}
            }
        }
        fun runTo(target: Long) {
            val n = target - frame
            if (n <= 0) return
            for (d in decks) if (d.playing && d.track != null) {
                val before = d.pos
                d.pos += n * (1 + d.pitch / 100) * (1 + d.bend / 100) / rate
                val l = d.loop
                if (l != null && before < l.end && d.pos >= l.end) d.pos = l.start + (d.pos - l.start) % (l.end - l.start)
            }
            frame = target
        }
    }

    /** Host loop (SessionModel's scheduling): 1 s windows from one epoch, loads ready at once then placed. */
    private fun replay(log: SessionLog, from: Double, probes: List<Double>, check: (Double, EngineModel, SessionState) -> Unit) {
        val rate = 48000
        val script = ReplayScript(log)
        val engine = EngineModel(rate)
        val epoch = ReplayEpoch(from, 1000, rate)
        engine.frame = epoch.frame0
        for (d in 0..3) log.replayAt(from).decks[d].trackId?.let { engine.apply(ReplayOp.Load(d, it)) }
        val pending = java.util.PriorityQueue<Pair<Long, Pair<Int, ReplayOp>>>(compareBy({ it.first }, { it.second.first }))
        var seq = 0
        fun schedule(t: Double, op: ReplayOp) { pending += epoch.frameOf(t) to (seq++ to op) }
        for (d in 0..3) script.place(from, d).forEach { schedule(from, it) }
        var until = from
        val probeQueue = ArrayDeque(probes.sorted())
        while (until < log.end || pending.isNotEmpty()) {
            if (until < log.end) {
                val next = minOf(until + 1.0, log.end)
                for (op in script.between(until, next)) {
                    schedule(op.t, op.op)
                    // Instant load: the host places the deck as of the load (desktop state after it).
                    if (op.op is ReplayOp.Load) script.place(op.t, op.op.deck).forEach { schedule(op.t, it) }
                }
                until = next
            }
            val horizon = epoch.frameOf(until)
            while (pending.isNotEmpty() && pending.peek().first <= horizon) {
                val (f, op) = pending.poll()
                while (probeQueue.isNotEmpty() && epoch.frameOf(probeQueue.first()) < f) {
                    val t = probeQueue.removeFirst(); engine.runTo(epoch.frameOf(t)); check(t, engine, log.replayAt(epoch.timeAt(epoch.frameOf(t))))
                }
                engine.runTo(f); engine.apply(op.second)
            }
            if (until >= log.end) break
        }
        while (probeQueue.isNotEmpty()) { val t = probeQueue.removeFirst(); engine.runTo(epoch.frameOf(t)); check(t, engine, log.replayAt(epoch.timeAt(epoch.frameOf(t)))) }
    }

    @Test fun syntheticFourDeckSessionReplaysWithinOneSample() {
        val log = SessionLog.parse(SyntheticSession.json())
        assertTrue(log.events.size > 500 && log.events.any { it is CaptureEvent.Loop } && log.events.any { it is CaptureEvent.Bend })
        val rnd = kotlin.random.Random(3)
        val probes = List(400) { log.start + rnd.nextDouble() * log.duration }
        var checked = 0
        replay(log, log.start, probes) { t, engine, ref ->
            for (d in 0..3) {
                val want = ref.decks[d]
                if (want.trackId == null || want.playhead < 0) continue
                assertEquals(want.playhead, engine.decks[d].pos, 1.0 / 48000, "t=$t deck ${DECKS[d]}")
                checked++
            }
        }
        assertTrue(checked > 1000, "checked $checked")
    }

    @Test fun replayFromMidSessionSeekMatchesToo() {
        val log = SessionLog.parse(SyntheticSession.json(seed = 11, seconds = 300.0))
        val from = log.start + 137.25
        val probes = List(150) { from + 1 + it * 1.03 }
        replay(log, from, probes) { t, engine, ref ->
            for (d in 0..3) if (ref.decks[d].trackId != null && ref.decks[d].playhead >= 0)
                assertEquals(ref.decks[d].playhead, engine.decks[d].pos, 1.0 / 48000, "t=$t deck ${DECKS[d]}")
        }
    }

    @Test fun beatmatchedDecksStayPhaseLockedForTenMinutes() {
        val log = SessionLog.parse(SyntheticSession.beatmatched())
        var worst = 0.0
        replay(log, log.start, List(600) { it + .5 }) { _, engine, _ ->
            val a = (engine.decks[0].pos * 2) % 8 // beats in A's 8-beat loop (from 1 s = beat 2)
            val b = (engine.decks[1].pos * 125 / 60) % 8
            val diff = kotlin.math.abs(a - b).let { minOf(it, 8 - it) }
            worst = maxOf(worst, diff * .5 * 48000)
        }
        assertTrue(worst <= 1.0, "worst phase error $worst samples")
    }

    @Test fun recordingJitterIsReportedNotCorrected() {
        val log = SessionLog.parse(SyntheticSession.json(tickNoise = .008))
        assertTrue(log.tickDivergence().isNotEmpty())
        assertTrue(SessionLog.parse(SyntheticSession.json(tickNoise = .002)).tickDivergence().isEmpty())
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
            val script = ReplayScript(log)
            var t = log.start
            var ops = 0
            while (t < log.end) { ops += script.between(t, t + 1.0).size; t += 1.0 }
            val drift = log.tickDivergence()
            report.appendLine("${f.name.take(8)} ${f.length() / 1000} kB ${log.events.size} ev parse ${"%.0f".format(parsed)} ms, replay ops $ops, issues ${log.issues.size}, ticks >5 ms ${drift.size} (worst ${"%.1f".format((drift.maxOfOrNull { kotlin.math.abs(it.seconds) } ?: 0.0) * 1000)} ms)")
        }
        println(report)
    }
}
