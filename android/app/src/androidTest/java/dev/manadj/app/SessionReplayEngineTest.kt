package dev.manadj.app

import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.manadj.app.session.ReplayDriver
import dev.manadj.audio.AudioCommand
import dev.manadj.audio.AudioEngine
import dev.manadj.audio.DeckId
import dev.manadj.audio.LoadState
import dev.manadj.library.session.DECKS
import dev.manadj.library.session.SessionLog
import dev.manadj.library.session.SyntheticSession
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * #378 sample-exact Session replay through the real engine (offline render) and the real [ReplayDriver]:
 * every deck's playhead equals the replay reference (SessionLog.replayAt) within one sample, including decks
 * loaded mid-Session. Generated decoy WAVs only (deleted after).
 */
@RunWith(AndroidJUnit4::class)
class SessionReplayEngineTest {
    private val files = mutableListOf<File>()
    private val cache get() = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir

    @After fun removeDecoys() { files.forEach { it.delete() } }

    /** Mono 16-bit WAV at [rate] (the engine resamples to the output rate; positions are in seconds). */
    private fun wav(name: String, seconds: Double, rate: Int = 22050): File {
        val file = File(cache, name).also { files.add(it) }
        val frames = (rate * seconds).toInt()
        val b = ByteBuffer.allocate(44 + frames * 2).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()).putInt(36 + frames * 2).put("WAVEfmt ".toByteArray()).putInt(16)
        b.putShort(1).putShort(1).putInt(rate).putInt(rate * 2).putShort(2).putShort(16)
        b.put("data".toByteArray()).putInt(frames * 2)
        repeat(frames) { b.putShort(6000) }
        file.writeBytes(b.array())
        return file
    }

    private class Offline(val engine: AudioEngine, val tracks: Map<Int, File>) : ReplayDriver.Engine {
        val held = arrayOfNulls<Int>(4)
        override val sampleRate get() = engine.snapshot().outputSampleRate
        override fun outputFrames() = engine.snapshot().outputFrames
        override fun schedule(frame: Long, commands: List<AudioCommand>, tag: Long) = engine.schedule(frame, commands, tag).all { it.accepted }
        override fun cancel(tag: Long) { engine.cancelScheduled(tag) }
        override fun submit(command: AudioCommand) { engine.submit(command) }
        override fun holds(deck: Int): Int? = held[deck]?.takeIf { engine.snapshot().decks.getValue(DeckId.entries[deck]).loadState == LoadState.READY }
        override fun startLoad(deck: Int, trackId: Int) {
            ParcelFileDescriptor.open(tracks.getValue(trackId), ParcelFileDescriptor.MODE_READ_ONLY).use { engine.load(DeckId.entries[deck], "t$trackId", it) }
            held[deck] = trackId
        }
        override fun load(deck: Int, trackId: Int): ReplayDriver.Load {
            val d = engine.snapshot().decks.getValue(DeckId.entries[deck])
            return when {
                d.sourceId != "t$trackId" || d.loadState == LoadState.LOADING -> ReplayDriver.Load.Pending
                d.loadState == LoadState.ERROR -> ReplayDriver.Load.Failed(d.error ?: "error")
                d.fullyDecoded -> ReplayDriver.Load.Ready
                else -> ReplayDriver.Load.Partial
            }
        }
    }

    private fun replay(log: SessionLog, trackSeconds: Double, tracks: Int, check: (Double, Int, Double, Double, String) -> Unit): Int {
        val engine = AudioEngine(offline = true)
        try {
            val offline = Offline(engine, (1..tracks).associateWith { wav("replay-decoy-$it.wav", trackSeconds) })
            val driver = ReplayDriver(log, offline)
            driver.prepare(log.start)
            var checks = 0
            var guard = 0
            while (true) {
                val now = driver.tick(System.nanoTime() / 1e9)
                if (!driver.playing && !driver.preparing) break
                // Offline: render in uneven chunks (callback sizes vary) and pause for the decoders now and then.
                engine.renderOfflineForTest(97 + (guard * 61) % 900)
                if (guard++ % 16 == 0) Thread.sleep(1)
                if (now == null) continue
                val snap = engine.snapshot()
                val e = driver.epoch ?: continue
                val at = e.timeAt(snap.clockFrame)
                if (at < log.start + .5 || guard % 7 != 0) continue
                val ref = log.replayAt(at)
                for (d in 0..3) {
                    val want = ref.decks[d]
                    if (!driver.exact(d, snap.clockFrame) || want.trackId == null || want.playhead < 0 || want.scratching) continue
                    check(at, d, want.playhead, snap.decks.getValue(DeckId.entries[d]).sourceSeconds, "${snap.decks.getValue(DeckId.entries[d])} ref=$want")
                    checks++
                }
            }
            assertEquals("late frame-stamped ops", 0L, engine.snapshot().lateOps)
            return checks
        } finally { engine.close() }
    }

    @Test fun fourDeckSyntheticSessionIsSampleExact() {
        val trackSeconds = 90.0
        val log = SessionLog.parse(SyntheticSession.json(seed = 5, seconds = 180.0, tracks = 6, trackSeconds = trackSeconds))
        var worst = 0.0
        val checks = replay(log, trackSeconds, 6) { at, d, want, got, info ->
            val err = kotlin.math.abs(got - want) * 48000
            worst = maxOf(worst, err)
            assertTrue("t=%.4f deck %s want %.6f got %.6f (%.2f samples) %s".format(at, DECKS[d], want, got, err, info), err <= 1.0)
        }
        android.util.Log.i("SessionReplayEngineTest", "checks=$checks worst=%.3f samples".format(worst))
        assertTrue("checks $checks", checks >= 400)
    }
}
