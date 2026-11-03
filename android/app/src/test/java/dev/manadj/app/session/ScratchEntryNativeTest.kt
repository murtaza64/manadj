package dev.manadj.app.session

import dev.manadj.audio.AudioCommand
import dev.manadj.library.session.SessionLog
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.Closeable

/** Real native engine via a generated-PCM child, not Android decode/JNI/Oboe proof.
 * Set -Dmanadj.nativeReplay to the compiled src/test/cpp/SessionReplayBridge binary. */
class ScratchEntryNativeTest {
    private fun ev(t: Double, action: String, head: Double) = JSONObject()
        .put("t", t).put("kind", "transport").put("channel", "A")
        .put("action", action).put("playhead", head)

    private fun fixture(playing: Boolean = true) = SessionLog.parse(JSONObject().put("uuid", "synthetic445")
        .put("events", JSONArray(listOf(
            JSONObject().put("t", 0.0).put("kind", "load").put("channel", "A").put("trackId", 1),
            ev(0.0, if (playing) "play" else "pause", 0.0), ev(2.0, "scratchBegin", 2.0),
            ev(2.1, "scratchMove", 1.9).put("deltaSeconds", -.1),
            ev(3.0, "scratchMove", 2.1).put("deltaSeconds", .2),
            ev(4.0, "scratchEnd", 2.1),
            JSONObject().put("t", 8.0).put("kind", "tick").put("playheads", JSONObject()),
        ))).toString())

    private class Native(binary: String) : ReplayDriver.Engine, Closeable {
        private val process = ProcessBuilder(binary).redirectError(ProcessBuilder.Redirect.INHERIT).start()
        private val output = process.inputStream.bufferedReader()
        private val input = process.outputStream.bufferedWriter()
        private val held = arrayOfNulls<Int>(4)
        var state = DoubleArray(16)
        override val sampleRate = 48000
        fun send(line: String) {
            input.write(line); input.newLine(); input.flush()
            val result = output.readLine() ?: error("Native bridge exited ${process.waitFor()}")
            state = result.split(' ').map(String::toDouble).toDoubleArray()
            check(state[0] == 1.0) { "Native command refused: $line => $result" }
        }
        override fun outputFrames(): Long { send("clock"); return state[1].toLong() }
        fun render(frames: Int) = send("render $frames")
        override fun schedule(frame: Long, commands: List<AudioCommand>, tag: Long): Boolean {
            commands.forEach { op(frame, tag, it) }; return true
        }
        override fun cancel(tag: Long) = send("cancel $tag")
        override fun submit(command: AudioCommand) = op(0, 0, command)
        private fun op(frame: Long, tag: Long, c: AudioCommand) {
            val d = c.deck?.ordinal ?: 0
            val payload = when (c) {
                is AudioCommand.Play -> "play $d 0 0 0"
                is AudioCommand.Pause -> "pause $d 0 0 0"
                is AudioCommand.SetLoopRegion -> "locate $d ${c.start ?: -1.0} ${c.end} ${c.playhead ?: Double.NaN}"
                is AudioCommand.SetPitch -> "pitch $d ${c.percent} 0 0"
                is AudioCommand.SetBend -> "bend $d ${c.percent} 0 0"
                is AudioCommand.SetFader -> "fader $d ${c.value} 0 0"
                is AudioCommand.SetEq -> "eq $d ${c.value} ${c.band} 0"
                is AudioCommand.SetFilter -> "filter $d ${c.position} 0 0"
                is AudioCommand.SetBeatFx -> "fx 0 0 0 0"
                is AudioCommand.ScratchBegin -> "scratchBegin $d 0 0 0"
                is AudioCommand.ScratchMove -> "scratchMove $d ${c.deltaSeconds} 0 0"
                is AudioCommand.ScratchEnd -> "scratchEnd $d 0 0 0"
                else -> error("Unmapped native test op $c")
            }
            send("op $frame $tag $payload")
        }
        override fun holds(deck: Int) = held[deck]
        override fun startLoad(deck: Int, trackId: Int) { send("load $deck $trackId"); held[deck] = trackId }
        override fun load(deck: Int, trackId: Int) = ReplayDriver.Load.Ready
        override fun close() { input.close(); assertEquals(0, process.waitFor()) }
    }

    private fun withNative(block: (Native) -> Unit) {
        val binary = System.getProperty("manadj.nativeReplay")
        assumeTrue("Compile SessionReplayBridge and set manadj.nativeReplay for native regression", binary != null)
        Native(requireNotNull(binary)).use(block)
    }

    /** Snapshots describe the next render frame: always probe strictly beyond each target. */
    private fun advance(replay: ReplayDriver, native: Native, target: Double): Double {
        repeat(1600) {
            replay.tick(0.0); native.render(400)
            val at = replay.epoch?.timeAt(native.outputFrames()) ?: return@repeat
            if (at > target + 1.0 / native.sampleRate) return at
        }
        error("replay did not reach $target")
    }

    private fun assertHeld(log: SessionLog, native: Native, at: Double, checkHead: Boolean = true) {
        assertTrue("reference inside platter tenure", log.replayAt(at).decks[0].scratching)
        assertEquals("at=$at reference scratch active, native inactive", 1.0, native.state[8], 0.0)
        // The later +.2 impulse saturates the native scratch rate; the reducer merely
        // retains its recorded head. Do not claim reducer/native motion-filter parity.
        if (checkHead) assertEquals("seeded platter position at=$at", log.replayAt(at).decks[0].playhead, native.state[4], 1.0 / 48000)
        else assertTrue("subsequent positive MOVE drives native platter", native.state[4] > 1.9)
    }

    private fun assertReleased(log: SessionLog, native: Native, at: Double) {
        assertFalse(log.replayAt(at).decks[0].scratching)
        assertEquals("native scratch released", 0.0, native.state[8], 0.0)
        assertEquals("landing position at=$at", log.replayAt(at).decks[0].playhead, native.state[4], 1.0 / 48000)
        assertEquals("transport intent at=$at", if (log.replayAt(at).decks[0].sounding) 1.0 else 0.0, native.state[12], 0.0)
        assertEquals("on-time stamped ops", 0.0, native.state[2], 0.0)
    }

    private fun scratchAt(start: Double, playing: Boolean = true) {
        val log = fixture(playing)
        withNative { native ->
            val replay = ReplayDriver(log, native)
            replay.prepare(start)
            assertHeld(log, native, advance(replay, native, 2.6))
            assertHeld(log, native, advance(replay, native, 3.6), checkHead = false)
            assertReleased(log, native, advance(replay, native, 4.1))
            assertReleased(log, native, advance(replay, native, 5.0))
        }
    }
    @Test fun fromBeginningEntersNativeScratch() = scratchAt(0.0)
    @Test fun startInsideScratchEntersNativeScratch() = scratchAt(2.5)
    @Test fun startExactlyAtScratchBeginDoesNotDropOrDuplicateBegin() = scratchAt(2.0)
    @Test fun startInsideScratchBeforeFirstMove() = scratchAt(2.05)
    @Test fun pausedScratchRetainsPausedReleaseIntent() = scratchAt(2.5, playing = false)

    @Test fun pauseParkAndResumeDoNotLeaveStalePlatterState() {
        val log = fixture()
        withNative { native ->
            val replay = ReplayDriver(log, native)
            replay.prepare(2.5)
            val at = advance(replay, native, 2.6)
            assertHeld(log, native, at)
            replay.stop(); native.render(400)
            assertEquals("stop ends native scratch", 0.0, native.state[8], 0.0)
            assertEquals("stop leaves deck paused", 0.0, native.state[12], 0.0)
            replay.park(at); native.render(400)
            assertEquals("park does not enter a live scratch", 0.0, native.state[8], 0.0)
            assertEquals("park stays paused", 0.0, native.state[12], 0.0)
            assertEquals(log.replayAt(at).decks[0].playhead, native.state[4], 1.0 / 48000)
            replay.prepare(at)
            assertHeld(log, native, advance(replay, native, 3.6), checkHead = false)
            assertReleased(log, native, advance(replay, native, 4.1))
        }
    }

    @Test fun seekFromActiveScratchToOrdinaryPlaybackClearsPlatterTenure() {
        val log = fixture()
        withNative { native ->
            val replay = ReplayDriver(log, native)
            replay.prepare(2.5)
            assertHeld(log, native, advance(replay, native, 2.6))
            replay.prepare(5.0)
            assertReleased(log, native, advance(replay, native, 5.1))
            assertReleased(log, native, advance(replay, native, 6.0))
        }
    }
}
