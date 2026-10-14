package dev.manadj.app

import android.content.pm.ActivityInfo
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import dev.manadj.audio.DeckId
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

/** #371 human bug: waveforms stuck on "analysing…" after rotating or toggling the browser. */
class WavePersistTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val model get() = ViewModelProvider(rule.activity)[PlayerModel::class.java]
    private val ux get() = ViewModelProvider(rule.activity)[UiModel::class.java]
    private var file: File? = null

    @After fun cleanup() { file?.delete(); rule.activityRule.scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED } }

    private fun waveReady(): Boolean { val id = model.decks.getValue(DeckId.A).source?.id ?: return false; return ux.waves[id]?.complete == true }

    @Test fun waveSurvivesRotationAndBrowser() {
        rule.waitUntil(20_000) { model.output?.outputSampleRate?.let { it > 0 } == true }
        val f = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "wave-decoy-${UUID.randomUUID()}.wav").also { file = it }
        val frames = 44_100 * 6; val bytes = frames * 2
        val b = ByteBuffer.allocate(44 + bytes).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()).putInt(36 + bytes).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(44_100).putInt(88_200).putShort(2).putShort(16).put("data".toByteArray()).putInt(bytes)
        repeat(frames) { b.putShort(((it % 90) * 50 - 2200).toShort()) }
        f.writeBytes(b.array())
        rule.runOnIdle { model.updateFader(DeckId.A, 0.0); model.requestImport(DeckId.A, Uri.fromFile(f)) }
        rule.waitUntil(30_000) { waveReady() }
        rule.activityRule.scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        rule.waitUntil(15_000) { rule.activity.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE }
        rule.waitForIdle()
        assertTrue("wave after rotation", rule.runOnIdle { waveReady() })
        rule.onAllNodesWithText("analysing", substring = true).assertCountEquals(0)
        rule.runOnIdle { model.browser = DeckId.B }; rule.waitForIdle()
        rule.runOnIdle { model.browser = null }; rule.waitForIdle()
        assertTrue("wave after browser", rule.runOnIdle { waveReady() })
        rule.onAllNodesWithText("analysing", substring = true).assertCountEquals(0)
        rule.activityRule.scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
        rule.waitUntil(15_000) { rule.activity.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_PORTRAIT }
        rule.waitForIdle()
        rule.onAllNodesWithText("analysing", substring = true).assertCountEquals(0)
    }
}
