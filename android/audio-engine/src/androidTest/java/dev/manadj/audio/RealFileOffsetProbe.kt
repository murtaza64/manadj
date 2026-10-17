package dev.manadj.audio

import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Manual probe (#410): renders real library files through the offline engine and dumps the output so the host can
 * cross-correlate it against an ffmpeg (desktop) decode. Inputs: /data/local/tmp/offset/<name>; skipped without them.
 * Output: externalFilesDir/offset/<name>.<scenario>.f32 (mono float, 48 kHz) + .txt (source seconds at frame 0).
 */
@RunWith(AndroidJUnit4::class)
class RealFileOffsetProbe {
    @Test fun dumpEngineOutput() {
        val inputs = File("/data/local/tmp/offset").listFiles()?.filter { it.isFile && it.canRead() }.orEmpty()
            .filter { f -> InstrumentationRegistry.getArguments().getString("only")?.let { f.name.startsWith(it) } ?: true }
        assumeTrue("no inputs in /data/local/tmp/offset", inputs.isNotEmpty())
        val out = File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null), "offset").apply { mkdirs() }
        for (file in inputs) for (scenario in listOf("memory5", "memory30", "memory100", "memory180", "ring")) {
            AudioEngine(offline = true).use { engine ->
                ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { engine.load(DeckId.A, file.name, it) }
                engine.drive { deck().loadState == LoadState.READY && !deck().filling }
                engine.submit(AudioCommand.SetKeyLock(DeckId.A, false))
                engine.submit(AudioCommand.SetCrossfade(-1.0))
                if (scenario != "ring") engine.drive(20_000) { deck().fullyDecoded }
                engine.submit(AudioCommand.Seek(DeckId.A, if (scenario == "ring") 60.0 else scenario.removePrefix("memory").toDouble()))
                engine.renderOfflineForTest(16)
                engine.drive { !deck().filling }
                engine.submit(AudioCommand.Play(DeckId.A))
                engine.renderOfflineForTest(1)
                val d0 = engine.deck()
                val frames = 48000 * 2
                val pcm = FloatArray(frames)
                var at = 0
                while (at < frames) {
                    val block = engine.renderOfflineForTest(256)
                    for (i in 0 until 256) if (at + i < frames) pcm[at + i] = (block[i * 2] + block[i * 2 + 1]) / 2
                    at += 256
                    Thread.sleep(1)
                }
                val d1 = engine.deck()
                val bytes = ByteBuffer.allocate(frames * 4).order(ByteOrder.LITTLE_ENDIAN)
                pcm.forEach { bytes.putFloat(it) }
                File(out, "${file.name}.$scenario.f32").writeBytes(bytes.array())
                File(out, "${file.name}.$scenario.txt").writeText(
                    "start=${d0.sourceSeconds}\nfromMemoryStart=${d0.fromMemory}\nfromMemoryEnd=${d1.fromMemory}\nend=${d1.sourceSeconds}\n")
            }
        }
    }

    private fun AudioEngine.deck() = snapshot().decks.getValue(DeckId.A)

    private fun AudioEngine.drive(limit: Int = 3000, condition: AudioEngine.() -> Boolean) {
        repeat(limit) {
            if (condition()) return
            renderOfflineForTest(256)
            Thread.sleep(2)
        }
        error("timed out: ${deck()}")
    }
}
