package dev.manadj.app

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.test.core.app.ActivityScenario
import android.os.SystemClock
import android.util.Log
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import dev.manadj.app.onehand.OneHand
import dev.manadj.app.onehand.OneHandLayout
import dev.manadj.audio.DeckId
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

/** Runtime reference only: unchanged production UI, generated PCM, built-in synthetic browser. */
class AndroidReferenceCaptureTest {
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var activity: MainActivity
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun onMain(block: () -> Unit) { instrumentation.runOnMainSync(block) }
    private fun until(timeout: Long, label: String, condition: () -> Boolean) {
        val end = SystemClock.elapsedRealtime() + timeout
        while (SystemClock.elapsedRealtime() < end) {
            var ready = false
            onMain { ready = condition() }
            if (ready) { Log.i("ReferenceCapture", "ready: $label"); return }
            SystemClock.sleep(100)
        }
        error("Timed out: $label")
    }
    @Before fun launch() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity = it }
        SystemClock.sleep(1800)
        capture("00-runtime-launch")
    }
    private val model get() = ViewModelProvider(activity)[PlayerModel::class.java]
    private val ux get() = ViewModelProvider(activity)[UiModel::class.java]
    private val files = mutableListOf<File>()
    private fun capture(name: String) {
        SystemClock.sleep(900)
        Log.i("ReferenceCapture", "capturing: $name")
        val out = File(instrumentation.targetContext.getExternalFilesDir(null), "reference").also { it.mkdirs() }
        val image = instrumentation.uiAutomation.takeScreenshot()
        assertNotNull("Screenshot $name", image)
        File(out, "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
    }
    private fun tone(deck: DeckId, hz: Double): File {
        val rate = 44100; val frames = rate * 24; val bytes = frames * 2
        val b = ByteBuffer.allocate(44 + bytes).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()).putInt(36 + bytes).put("WAVEfmt ".toByteArray()).putInt(16)
            .putShort(1).putShort(1).putInt(rate).putInt(rate * 2).putShort(2).putShort(16).put("data".toByteArray()).putInt(bytes)
        repeat(frames) { i ->
            val t = i.toDouble() / rate
            val beat = exp(-((t * 128 / 60) % 1) * 14)
            val value = (sin(2 * PI * hz * t) * .12 + sin(2 * PI * hz * 1.5 * t) * .04 + sin(2 * PI * 60 * t) * beat * .25)
            b.putShort((value * 24000).toInt().toShort())
        }
        return File(activity.cacheDir, "synthetic-reference-${deck.name}.wav").also { it.writeBytes(b.array()); files.add(it) }
    }
    private fun orient(value: Int, expected: Int) {
        scenario.onActivity { it.requestedOrientation = value }
        until(20_000, "orientation") { activity.resources.configuration.orientation == expected }
        SystemClock.sleep(900)
        scenario.onActivity { activity = it }
    }
    @After fun cleanup() {
        onMain { OneHand.layout = OneHandLayout.STANDARD }
        files.forEach { it.delete() }
        scenario.close()
    }
    @Test fun captureCurrentAndroidReference() {
        onMain { OneHand.init(activity); OneHand.layout = OneHandLayout.STANDARD }
        until(30_000, "audio output") { model.output?.outputSampleRate?.let { it > 0 } == true }
        val a = tone(DeckId.A, 220.0); val b = tone(DeckId.B, 261.63)
        onMain {
            model.updateFader(DeckId.A, .75); model.updateFader(DeckId.B, .55)
            model.load(DeckId.A, a, "synthetic-reference:A", "Synthetic pulse A", "Generated PCM, no music source", 24.0, 128.0, 0.0, 0.0, mapOf(0 to 0.0, 1 to 3.75, 2 to 7.5, 3 to 11.25))
            model.load(DeckId.B, b, "synthetic-reference:B", "Synthetic pulse B", "Generated PCM, no music source", 24.0, 128.0, 0.0, 0.0, mapOf(0 to 0.0, 1 to 3.75))
        }
        until(45_000, "both decks ready") { model.decks.getValue(DeckId.A).ready && model.decks.getValue(DeckId.B).ready }
        until(45_000, "waveforms complete") { listOf(DeckId.A, DeckId.B).all { d -> model.decks.getValue(d).source?.id?.let { ux.waves[it]?.complete } == true } }
        capture("01-standard-portrait-loaded")
        onMain { model.browser = DeckId.A }

        capture("02-portrait-library-root")
        onMain { ux.navigate(dev.manadj.app.browse.BrowseNode.Collection) }
        capture("03-portrait-library-collection")
        onMain { model.browser = null; model.pitchDrawer = DeckId.A }
        capture("04-portrait-pitch-panel")
        onMain { model.pitchDrawer = null; ux.settings = true }
        capture("05-portrait-settings")
        onMain { ux.settings = false }
        orient(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE, Configuration.ORIENTATION_LANDSCAPE)
        capture("06-standard-landscape-loaded")
        onMain { model.browser = DeckId.A }
        capture("07-landscape-library")
        onMain { model.browser = null }
        orient(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, Configuration.ORIENTATION_PORTRAIT)
        for (layout in listOf(OneHandLayout.FOCUS, OneHandLayout.RINGS, OneHandLayout.CHORDS)) {
            onMain { OneHand.layout = layout }
            capture("08-optional-${layout.name.lowercase()}")
        }
    }
}
