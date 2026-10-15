package dev.manadj.app

import androidx.test.platform.app.InstrumentationRegistry
import dev.manadj.app.session.DecodeProbe
import dev.manadj.library.DetailWaveform
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt

/**
 * #378 S5: [DecodeProbe] measures a decode's placement against desktop-style peaks. Reference = the WAV
 * (the exact alignment desktop decodes reach, android-engine codecPrimingMatchesTheWav). Decoy assets only.
 */
class DecodeProbeTest {
    private val files = ArrayList<File>()
    @After fun cleanup() { files.forEach { it.delete() } }

    private fun asset(name: String): File {
        val ctx = InstrumentationRegistry.getInstrumentation()
        return File(ctx.targetContext.cacheDir, "probe-decoy-$name").also { files += it; it.writeBytes(ctx.context.assets.open(name).readBytes()) }
    }

    /** Desktop peaks (max-abs mono per 128 samples at 44.1 kHz, sqrt-gamma u8) of a 16-bit stereo WAV. */
    private fun reference(wav: File): DetailWaveform {
        val b = ByteBuffer.wrap(wav.readBytes()).order(ByteOrder.LITTLE_ENDIAN)
        var at = 12
        while (String(b.array(), at, 4) != "data") at += 8 + b.getInt(at + 4)
        val frames = b.getInt(at + 4) / 4
        val data = at + 8
        val bins = frames / 128
        val peaks = ByteArray(bins) { k ->
            var m = 0f
            for (i in k * 128 until (k + 1) * 128) m = max(m, abs((b.getShort(data + i * 4) + b.getShort(data + i * 4 + 2)) / 2f / 32768f))
            (sqrt(m) * 255).toInt().coerceIn(0, 255).toByte()
        }
        return DetailWaveform(frames / 44100.0, .5f, 8, peaks, ByteArray(0), 44100, 128, 512, 2048)
    }

    @Test fun probeMeasuresCodecPlacementAgainstTheWav() {
        val ref = reference(asset("priming.wav"))
        val results = listOf("priming-aac.m4a", "priming.mp3", "priming-noxing.mp3").associateWith { DecodeProbe.run(asset(it), ref) }
        for ((name, r) in results) android.util.Log.i("ManadjSession", "probe-test $name: raw=%s engine=%s delay=%s pad=%s firstPts=%d score=%.3f".format(r.offsetMs, r.engineOffsetMs, r.encoderDelay, r.encoderPadding, r.firstPtsUs, r.score))
        for ((name, r) in results) {
            assertNotNull("$name correlates", r.engineOffsetMs)
            // After the engine's codec rules every format lands within a peak bin (2.9 ms) of the WAV.
            assertEquals("$name after engine rule", 0.0, r.engineOffsetMs!!, 3.0)
        }
    }
}
