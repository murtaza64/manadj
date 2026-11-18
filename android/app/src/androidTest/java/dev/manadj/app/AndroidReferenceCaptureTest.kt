package dev.manadj.app

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
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
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val model get() = ViewModelProvider(rule.activity)[PlayerModel::class.java]
    private val ux get() = ViewModelProvider(rule.activity)[UiModel::class.java]
    private val files = mutableListOf<File>()
    private fun capture(name: String) {
        rule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
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
        return File(rule.activity.cacheDir, "synthetic-reference-${deck.name}.wav").also { it.writeBytes(b.array()); files.add(it) }
    }
    private fun orient(value: Int, expected: Int) {
        rule.activityRule.scenario.onActivity { it.requestedOrientation = value }
        rule.waitUntil(20_000) { rule.activity.resources.configuration.orientation == expected }
        rule.waitForIdle()
    }
    @After fun cleanup() {
        rule.runOnIdle { OneHand.layout = OneHandLayout.STANDARD }
        files.forEach { it.delete() }
    }
    @Test fun captureCurrentAndroidReference() {
        rule.runOnIdle { OneHand.init(rule.activity); OneHand.layout = OneHandLayout.STANDARD }
        rule.waitUntil(30_000) { model.output?.outputSampleRate?.let { it > 0 } == true }
        val a = tone(DeckId.A, 220.0); val b = tone(DeckId.B, 261.63)
        rule.runOnIdle {
            model.updateFader(DeckId.A, .75); model.updateFader(DeckId.B, .55)
            model.load(DeckId.A, a, "synthetic-reference:A", "Synthetic pulse A", "Generated PCM, no music source", 24.0, 128.0, 0.0, 0.0, mapOf(0 to 0.0, 1 to 3.75, 2 to 7.5, 3 to 11.25))
            model.load(DeckId.B, b, "synthetic-reference:B", "Synthetic pulse B", "Generated PCM, no music source", 24.0, 128.0, 0.0, 0.0, mapOf(0 to 0.0, 1 to 3.75))
        }
        rule.waitUntil(45_000) { model.decks.getValue(DeckId.A).ready && model.decks.getValue(DeckId.B).ready }
        rule.waitUntil(45_000) { listOf(DeckId.A, DeckId.B).all { d -> model.decks.getValue(d).source?.id?.let { ux.waves[it]?.complete } == true } }
        capture("01-standard-portrait-loaded")
        rule.onNodeWithText("BROWSE").performClick()
        rule.onNodeWithContentDescription("Search library").assertExists()
        capture("02-portrait-library-root")
        rule.onNodeWithContentDescription("Browse Collection").performClick()
        capture("03-portrait-library-collection")
        rule.runOnIdle { model.browser = null; model.pitchDrawer = DeckId.A }
        capture("04-portrait-pitch-panel")
        rule.runOnIdle { model.pitchDrawer = null; ux.settings = true }
        capture("05-portrait-settings")
        rule.runOnIdle { ux.settings = false }
        orient(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE, Configuration.ORIENTATION_LANDSCAPE)
        capture("06-standard-landscape-loaded")
        rule.onNodeWithText("BROWSE").performClick()
        capture("07-landscape-library")
        rule.runOnIdle { model.browser = null }
        orient(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, Configuration.ORIENTATION_PORTRAIT)
        for (layout in listOf(OneHandLayout.FOCUS, OneHandLayout.RINGS, OneHandLayout.CHORDS)) {
            rule.runOnIdle { OneHand.layout = layout }
            capture("08-optional-${layout.name.lowercase()}")
        }
    }
}
