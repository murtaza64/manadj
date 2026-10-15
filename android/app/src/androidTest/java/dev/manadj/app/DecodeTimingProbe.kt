package dev.manadj.app

import android.os.ParcelFileDescriptor
import dev.manadj.audio.AudioEngine
import dev.manadj.audio.DeckId
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * SH8 diagnostic: wall time until the engine's whole-track decode reaches 30/60/120/240 s, for 1 deck alone,
 * 4 decks at once, and 4 decks plus 4 competing full decodes (what DecodeProbe adds). Real files pushed to
 * /data/local/tmp/s5 (skipped when absent). Logcat tag DecodeTiming.
 */
class DecodeTimingProbe {
    private val files = File("/data/local/tmp/s5").listFiles()?.filter { it.extension in setOf("mp3", "m4a") }?.sortedBy { it.name }.orEmpty()

    private fun run(label: String, decks: Int, competing: Int) {
        val engine = AudioEngine(offline = true)
        val rival = if (competing > 0) AudioEngine(offline = true) else null
        try {
            val t0 = System.nanoTime()
            for (d in 0 until decks) ParcelFileDescriptor.open(files[d % files.size], ParcelFileDescriptor.MODE_READ_ONLY).use { engine.load(DeckId.entries[d], "t$d", it) }
            for (d in 0 until competing) ParcelFileDescriptor.open(files[(d + 1) % files.size], ParcelFileDescriptor.MODE_READ_ONLY).use { rival!!.load(DeckId.entries[d], "r$d", it) }
            val marks = listOf(30.0, 60.0, 120.0, 240.0)
            val reached = Array(decks) { DoubleArray(marks.size) { Double.NaN } }
            while ((System.nanoTime() - t0) < 120e9) {
                engine.renderOfflineForTest(256); rival?.renderOfflineForTest(256)
                val s = engine.snapshot()
                val now = (System.nanoTime() - t0) / 1e9
                for (d in 0 until decks) {
                    val x = s.decks.getValue(DeckId.entries[d])
                    for ((i, m) in marks.withIndex()) if (reached[d][i].isNaN() && (x.decodedSeconds >= m || x.fullyDecoded)) reached[d][i] = now
                }
                if (reached.all { r -> r.none { it.isNaN() } }) break
                Thread.sleep(20)
            }
            for (d in 0 until decks) android.util.Log.i("DecodeTiming", "$label deck ${"ABCD"[d]} ${files[d % files.size].name}: " +
                marks.indices.joinToString("  ") { "%3.0fs@%.1fs".format(marks[it], reached[d][it]) })
        } finally { engine.close(); rival?.close() }
    }

    @Test fun timings() {
        assumeTrue(files.size >= 4)
        run("alone", 1, 0)
        run("4 decks", 4, 0)
        run("4 decks + 4 probe decodes", 4, 4)
    }
}
