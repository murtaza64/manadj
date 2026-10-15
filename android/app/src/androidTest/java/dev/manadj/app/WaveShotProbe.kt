package dev.manadj.app

import android.graphics.Bitmap
import android.os.ParcelFileDescriptor
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/**
 * #397 probe (lane-only): renders the detail WaveView body for an MWF1 blob pushed to /data/local/tmp/wave.mwf at
 * a fixed playhead/zoom/pixel size and writes PNGs to the app's external files dir, for side-by-side with desktop.
 * Args: -e waveT <s> -e waveSeconds <s> -e waveW <px> -e waveH <px> -e waveName <stem>
 */
class WaveShotProbe {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>().also { it.mainClock.autoAdvance = true }

    @Test fun shot() {
        val args = InstrumentationRegistry.getArguments()
        val ui = InstrumentationRegistry.getInstrumentation().uiAutomation
        val pfd = ui.executeShellCommand("cat /data/local/tmp/wave.mwf")
        val blob = ParcelFileDescriptor.AutoCloseInputStream(pfd).use { it.readBytes() }
        assumeTrue("push a blob to /data/local/tmp/wave.mwf", blob.size > 100)
        val data = WaveformData.parseMwf1(blob)
        val t = args.getString("waveT", "60").toDouble(); val secs = args.getString("waveSeconds", "12").toDouble()
        val w = args.getString("waveW", "1260").toInt(); val h = args.getString("waveH", "180").toInt()
        val name = args.getString("waveName", "android")
        val mode = args.getString("waveMode", "detail")
        rule.activity.runOnUiThread {
            rule.activity.setContent {
                val d = LocalDensity.current
                if (mode != "detail") Box(Modifier.size(with(d) { w.toDp() }, with(d) { h.toDp() }).testTag("wave")) {
                    WaveView(data, { t }, data.duration, WaveMarks(null, emptyList()), Modifier.size(with(d) { w.toDp() }, with(d) { h.toDp() }), windowSeconds = secs,
                        overview = mode == "overview", vertical = mode == "vertical")
                } else Box(Modifier.size(with(d) { w.toDp() }, with(d) { h.toDp() }).testTag("wave")) {
                    WaveView(data, { t }, data.duration, WaveMarks(null, emptyList()), Modifier.size(with(d) { w.toDp() }, with(d) { h.toDp() }), windowSeconds = secs, playheadAt = .3f)
                }
            }
        }
        rule.waitForIdle()
        Thread.sleep(500)
        val bmp = rule.onNodeWithTag("wave").captureToImage().asAndroidBitmap()
        // The app is uninstalled after the run: stream the PNG out through a shell-owned file.
        val fds = ui.executeShellCommandRw("tee /data/local/tmp/$name.png")
        val drain = Thread { ParcelFileDescriptor.AutoCloseInputStream(fds[0]).use { it.readBytes() } }.also { it.start() }
        ParcelFileDescriptor.AutoCloseOutputStream(fds[1]).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        drain.join(5000)
    }

    /** Two scrolling detail waves (a portrait deck pair) for 8 s; writes gfxinfo framestats summary to /data/local/tmp/<waveName>-gfx.txt. */
    @Test fun animate() {
        val args = InstrumentationRegistry.getArguments()
        val ui = InstrumentationRegistry.getInstrumentation().uiAutomation
        val blob = ParcelFileDescriptor.AutoCloseInputStream(ui.executeShellCommand("cat /data/local/tmp/wave.mwf")).use { it.readBytes() }
        assumeTrue(blob.size > 100)
        val data = WaveformData.parseMwf1(blob)
        val w = args.getString("waveW", "1260").toInt(); val h = args.getString("waveH", "180").toInt()
        val name = args.getString("waveName", "android")
        rule.activity.runOnUiThread {
            rule.activity.setContent {
                val d = LocalDensity.current
                val frame = frameNanos(true)
                val t0 = remember { System.nanoTime() }
                androidx.compose.foundation.layout.Column {
                    for (k in 0..1) WaveView(data, { frame.value; 30.0 + k * 40 + (System.nanoTime() - t0) / 1e9 }, data.duration, WaveMarks(null, emptyList()),
                        Modifier.size(with(d) { w.toDp() }, with(d) { h.toDp() }), windowSeconds = 12.0, playheadAt = .3f)
                }
            }
        }
                fun sh(cmd: String) = ParcelFileDescriptor.AutoCloseInputStream(ui.executeShellCommand(cmd)).use { String(it.readBytes()) }
        Thread.sleep(1000)
        sh("dumpsys gfxinfo ${rule.activity.packageName} reset")
        Thread.sleep(8000)
        val gfx = sh("dumpsys gfxinfo ${rule.activity.packageName}")
        val fds = ui.executeShellCommandRw("tee /data/local/tmp/$name-gfx.txt")
        val drain = Thread { ParcelFileDescriptor.AutoCloseInputStream(fds[0]).use { it.readBytes() } }.also { it.start() }
        ParcelFileDescriptor.AutoCloseOutputStream(fds[1]).use { it.write(gfx.lines().filter { l -> l.contains("frames") || l.contains("percentile") || l.contains("Janky") || l.contains("Slow") || l.contains("GPU") }.take(30).joinToString("\n").toByteArray()) }
        drain.join(5000)
    }
}
