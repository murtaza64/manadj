package dev.manadj.app

import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.manadj.app.session.SessionRecorder
import dev.manadj.audio.AudioCommand
import dev.manadj.audio.AudioEngine
import dev.manadj.audio.DeckId
import dev.manadj.audio.LoadState
import dev.manadj.library.session.SessionLog
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * #395 on the real engine (offline render): what [SessionRecorder] logs from engine snapshots replays (desktop
 * reference, SessionLog.replayAt) to the positions the engine played — through play, pitch, jumps, a cue stab.
 * Generated decoy WAV only (deleted after).
 */
@RunWith(AndroidJUnit4::class)
class SessionRecorderEngineTest {
    private fun wav(seconds: Double, rate: Int = 44100): File {
        val file = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "recorder-decoy.wav")
        val frames = (rate * seconds).toInt()
        val b = ByteBuffer.allocate(44 + frames * 2).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()).putInt(36 + frames * 2).put("WAVEfmt ".toByteArray()).putInt(16)
        b.putShort(1).putShort(1).putInt(rate).putInt(rate * 2).putShort(2).putShort(16)
        b.put("data".toByteArray()).putInt(frames * 2)
        repeat(frames) { b.putShort(6000) }
        file.writeBytes(b.array())
        return file
    }

    @Test fun recordedLogReplaysToTheEnginePositions() {
        val file = wav(120.0)
        val engine = AudioEngine(offline = true)
        try {
            val events = JSONArray()
            val sink = object : SessionRecorder.Sink {
                override fun open(uuid: String, startedAt: String, context: JSONArray) { for (i in 0 until context.length()) events.put(context.get(i)) }
                override fun events(batch: JSONArray) { for (i in 0 until batch.length()) events.put(batch.get(i)) }
                override fun close(endedAt: String) {}
            }
            val recorder = SessionRecorder({ if (it == "library:7:x") 7 else null }, sink, { "2026-10-15T07:00:00" })
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { engine.load(DeckId.A, "library:7:x", it) }
            var guard = 0
            while (engine.snapshot().decks.getValue(DeckId.A).let { it.loadState != LoadState.READY || !it.fullyDecoded } && guard++ < 4000) { engine.renderOfflineForTest(512); Thread.sleep(2) }
            val samples = ArrayList<Pair<Double, Double>>()
            var t0: Double? = null
            fun render(seconds: Double) {
                repeat((seconds * 48000 / 960).toInt()) {
                    engine.renderOfflineForTest(960)
                    val s = engine.snapshot()
                    recorder.observe(s, null)
                    val t = (t0 ?: (1.0 - s.clockFrame / 48000.0).also { t0 = it }) + s.clockFrame / 48000.0
                    samples += t to s.decks.getValue(DeckId.A).sourceSeconds
                }
            }
            engine.submit(AudioCommand.SetFader(DeckId.A, 1.0))
            render(.5)
            engine.submit(AudioCommand.Play(DeckId.A)); render(5.0)
            engine.submit(AudioCommand.SetPitch(DeckId.A, 3.0)); render(3.0)
            engine.submit(AudioCommand.Seek(DeckId.A, 40.0)); render(3.0)
            engine.submit(AudioCommand.SetBend(DeckId.A, -4.0)); render(.5)
            engine.submit(AudioCommand.SetBend(DeckId.A, 0.0)); render(3.0)
            engine.submit(AudioCommand.Pause(DeckId.A)); render(1.0)
            engine.submit(AudioCommand.Seek(DeckId.A, 10.0)); render(1.0)
            engine.submit(AudioCommand.Play(DeckId.A)); render(3.0)
            val log = SessionLog.parse(JSONObject().put("uuid", "x").put("events", events).toString())
            assertEquals(listOf(7), log.appearances.map { it.trackId })
            var worst = 0.0
            for ((t, want) in samples) if (t > log.start + .1) worst = maxOf(worst, kotlin.math.abs(log.replayAt(t).decks[0].playhead - want))
            android.util.Log.i("SessionRecorderEngineTest", "events=${events.length()} worst=%.3f ms".format(worst * 1000))
            assertTrue("worst %.3f ms".format(worst * 1000), worst < .002)
        } finally { engine.close(); file.delete() }
    }
}
