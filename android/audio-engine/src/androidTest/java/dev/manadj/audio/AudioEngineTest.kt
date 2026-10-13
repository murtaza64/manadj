package dev.manadj.audio

import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.RandomAccessFile
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AudioEngineTest {
    private fun wav(name: String, value: Short): File {
        val file = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, name)
        RandomAccessFile(file, "rw").use { out ->
            val frames = 48000 * 5
            val size = frames * 4
            out.setLength(0)
            out.writeBytes("RIFF")
            out.writeInt(Integer.reverseBytes(36 + size))
            out.writeBytes("WAVEfmt ")
            out.writeInt(Integer.reverseBytes(16))
            out.writeShort(java.lang.Short.reverseBytes(1.toShort()).toInt())
            out.writeShort(java.lang.Short.reverseBytes(2.toShort()).toInt())
            out.writeInt(Integer.reverseBytes(48000))
            out.writeInt(Integer.reverseBytes(48000 * 4))
            out.writeShort(java.lang.Short.reverseBytes(4.toShort()).toInt())
            out.writeShort(java.lang.Short.reverseBytes(16.toShort()).toInt())
            out.writeBytes("data")
            out.writeInt(Integer.reverseBytes(size))
            val little = java.lang.Short.reverseBytes(value).toInt()
            repeat(frames) { out.writeShort(little); out.writeShort(little) }
        }
        return file
    }

    private fun awaitReady(engine: AudioEngine, vararg decks: DeckId) {
        repeat(2000) {
            if (engine.snapshot().decks.filterKeys { it in decks }.values.all { it.loadState == LoadState.READY }) return
            engine.renderOfflineForTest(256)
            Thread.sleep(2)
        }
        fail("Decode failed: ${engine.snapshot().decks}")
    }

    @Test fun decodedLocalWavMixSeekGateAndCeiling() {
        val a = wav("engine-a.wav", 8192)
        val b = wav("engine-b.wav", (-8192).toShort())
        try {
            AudioEngine(offline = true).use { engine ->
                ParcelFileDescriptor.open(a, ParcelFileDescriptor.MODE_READ_ONLY).use {
                    assertTrue(engine.load(DeckId.A, "generated-a", it).accepted)
                }
                ParcelFileDescriptor.open(b, ParcelFileDescriptor.MODE_READ_ONLY).use {
                    assertTrue(engine.load(DeckId.B, "generated-b", it).accepted)
                }
                awaitReady(engine, DeckId.A, DeckId.B)
                assertEquals("generated-a", engine.snapshot().decks.getValue(DeckId.A).sourceId)
                assertEquals(48000, engine.snapshot().decks.getValue(DeckId.A).sampleRate)
                assertFalse(engine.snapshot().outputOpen)
                assertTrue(engine.submit(AudioCommand.Play(DeckId.A)).accepted)
                assertTrue(engine.submit(AudioCommand.Play(DeckId.B)).accepted)
                val both = engine.renderOfflineForTest(4096)
                assertEquals(0f, both[8190], .005f)
                assertTrue(engine.snapshot().decks.getValue(DeckId.A).sourceFrame > 3000)

                val fade = engine.submit(AudioCommand.SetCrossfade(-1.0))
                engine.renderOfflineForTest(4096)
                val left = engine.renderOfflineForTest(512)
                assertEquals(.25f * Math.pow(10.0, -6.0 / 20.0).toFloat(), left[1022], .004f)
                assertTrue(engine.snapshot().appliedCommandId >= fade.id)
                assertEquals(-1.0, engine.snapshot().crossfade, 0.0)
                assertTrue(engine.submit(AudioCommand.Seek(DeckId.A, 2.0)).accepted)
                awaitReady(engine, DeckId.A)
                assertEquals(2.0, engine.snapshot().decks.getValue(DeckId.A).sourceSeconds, .02)
                engine.submit(AudioCommand.CueDown(DeckId.A)) // While playing: pause, park at cue if set.
                engine.renderOfflineForTest(128)
                assertFalse(engine.snapshot().decks.getValue(DeckId.A).playing)
                engine.submit(AudioCommand.CueDown(DeckId.A)) // Place main cue at current source position.
                engine.renderOfflineForTest(128)
                engine.submit(AudioCommand.CueDown(DeckId.A)) // Hold preview.
                val preview = engine.renderOfflineForTest(512)
                assertTrue(preview[1022] > 0)
                assertTrue(engine.snapshot().decks.getValue(DeckId.A).previewing)
                engine.submit(AudioCommand.CueUp(DeckId.A))
                awaitReady(engine, DeckId.A)
                assertFalse(engine.snapshot().decks.getValue(DeckId.A).previewing)
            }
        } finally { a.delete(); b.delete() }
    }

    @Test fun oboeOpensAndRendersFramesOnDevice() {
        val media = wav("engine-oboe.wav", 8192)
        try {
        AudioEngine().use { engine ->
            val started = engine.snapshot()
            assertTrue(started.outputOpen)
            assertEquals(2, started.outputChannels)
            assertTrue(started.outputSampleRate > 0)
            ParcelFileDescriptor.open(media, ParcelFileDescriptor.MODE_READ_ONLY).use {
                engine.load(DeckId.A, "sink-fixture", it)
            }
            for (attempt in 0 until 100) {
                if (engine.snapshot().decks.getValue(DeckId.A).loadState == LoadState.READY) break
                Thread.sleep(10)
            }
            assertEquals(LoadState.READY, engine.snapshot().decks.getValue(DeckId.A).loadState)
            assertTrue(engine.submit(AudioCommand.Play(DeckId.A)).accepted)
            val sourceAtStart = engine.snapshot().decks.getValue(DeckId.A).sourceFrame
            Thread.sleep(250)
            val rendered = engine.snapshot()
            assertTrue("No native callbacks: $rendered", rendered.outputFrames > started.outputFrames)
            assertTrue("Decoded source not consumed by stream: $rendered",
                rendered.decks.getValue(DeckId.A).sourceFrame > sourceAtStart)
            assertEquals(0, rendered.outputError)
            assertTrue(rendered.outputXruns >= 0)
        }
        } finally { media.delete() }
    }

    @Test fun replacementRetiresOldDecodeAndReportsUnsupportedAsError() {
        val a = wav("engine-replace-a.wav", 8192)
        val b = wav("engine-replace-b.wav", (-8192).toShort())
        val bad = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "unsupported.bin")
        bad.writeBytes(byteArrayOf(1, 2, 3, 4, 5))
        try {
            AudioEngine(offline = true).use { engine ->
                ParcelFileDescriptor.open(a, ParcelFileDescriptor.MODE_READ_ONLY).use {
                    engine.load(DeckId.A, "old", it)
                }
                ParcelFileDescriptor.open(b, ParcelFileDescriptor.MODE_READ_ONLY).use {
                    engine.load(DeckId.A, "new", it)
                }
                awaitReady(engine, DeckId.A)
                val current = engine.snapshot().decks.getValue(DeckId.A)
                assertEquals("new", current.sourceId)
                assertNull(current.error)
                engine.submit(AudioCommand.Play(DeckId.A))
                val pcm = engine.renderOfflineForTest(4096)
                assertTrue(pcm[8190] < -.1f)
                ParcelFileDescriptor.open(bad, ParcelFileDescriptor.MODE_READ_ONLY).use {
                    engine.load(DeckId.A, "unsupported", it)
                }
                for (attempt in 0 until 1000) {
                    engine.renderOfflineForTest(256)
                    if (engine.snapshot().decks.getValue(DeckId.A).loadState == LoadState.ERROR) break
                    Thread.sleep(2)
                }
                val failed = engine.snapshot().decks.getValue(DeckId.A)
                assertEquals(LoadState.ERROR, failed.loadState)
                assertNotNull(failed.error)
                assertFalse(failed.playing)
            }
        } finally { a.delete(); b.delete(); bad.delete() }
    }
}
