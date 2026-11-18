package dev.manadj.app

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.test.core.app.ActivityScenario
import android.os.SystemClock
import android.util.Log
import android.graphics.Rect
import android.view.MotionEvent
import android.view.InputDevice
import android.view.accessibility.AccessibilityNodeInfo
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
    private fun find(label: String): AccessibilityNodeInfo? {
        fun walk(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
            if (node == null) return null
            if (node.text?.toString() == label || node.contentDescription?.toString() == label) return node
            for (i in 0 until node.childCount) walk(node.getChild(i))?.let { return it }
            return null
        }
        return walk(instrumentation.uiAutomation.rootInActiveWindow)
    }
    private fun touch(label: String) {
        val node = find(label) ?: error("Missing runtime control: $label")
        val rect = Rect(); node.getBoundsInScreen(rect)
        val now = SystemClock.uptimeMillis()
        for ((action, time) in listOf(MotionEvent.ACTION_DOWN to now, MotionEvent.ACTION_UP to now + 90)) {
            val event = MotionEvent.obtain(now, time, action, rect.exactCenterX(), rect.exactCenterY(), 0)
            event.source = InputDevice.SOURCE_TOUCHSCREEN
            check(instrumentation.uiAutomation.injectInputEvent(event, true))
            event.recycle()
        }
        SystemClock.sleep(500)
    }
    private fun dismissTutorial() {
        find("Got it")?.let { touch("Got it"); SystemClock.sleep(400) }
    }
    @Before fun launch() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity = it }
        SystemClock.sleep(1800)
        dismissTutorial()
        capture("00-runtime-launch")
    }
    private val model get() = ViewModelProvider(activity)[PlayerModel::class.java]
    private val ux get() = ViewModelProvider(activity)[UiModel::class.java]
    private val files = mutableListOf<File>()
    private fun capture(name: String) {
        SystemClock.sleep(900)
        dismissTutorial()
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
        touch("A play pause")
        until(8000, "A physical play tap") { model.decks.getValue(DeckId.A).snapshot?.playing == true }
        capture("01b-physical-play-A")
        touch("A play pause")
        until(8000, "A physical pause tap") { model.decks.getValue(DeckId.A).snapshot?.playing == false }

        touch("BROWSE")

        capture("02-portrait-library-root")
        touch("Browse Collection")
        capture("03-portrait-library-collection")
        touch("BROWSE")
        touch("A pitch panel")
        capture("04-portrait-pitch-panel")
        onMain { model.pitchDrawer = null }
        touch("Settings")
        capture("05-portrait-settings")
        onMain { ux.settings = false }
        orient(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE, Configuration.ORIENTATION_LANDSCAPE)
        capture("06-standard-landscape-loaded")
        touch("BROWSE")
        capture("07-landscape-library")
        onMain { model.browser = null }
        orient(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, Configuration.ORIENTATION_PORTRAIT)
        for (layout in listOf(OneHandLayout.FOCUS, OneHandLayout.RINGS, OneHandLayout.CHORDS)) {
            onMain { OneHand.layout = layout }
            capture("08-optional-${layout.name.lowercase()}")
        }
    }
}
