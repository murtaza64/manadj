package dev.manadj.app

import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import dev.manadj.audio.*
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

/** #371 human bug: CUE / hot-cue stabbing — every DOWN is one engine op, immediately (8 taps in 1 s). */
class StabTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val model get() = ViewModelProvider(rule.activity)[PlayerModel::class.java]
    private var file: File? = null

    @Before fun loadDecoy() {
        rule.waitUntil(20_000) { model.output?.outputSampleRate?.let { it > 0 } == true }
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val f = File(context.cacheDir, "stab-decoy-${UUID.randomUUID()}.wav").also { file = it }
        val frames = 44_100 * 4; val bytes = frames * 2
        val b = ByteBuffer.allocate(44 + bytes).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()).putInt(36 + bytes).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(44_100).putInt(88_200).putShort(2).putShort(16).put("data".toByteArray()).putInt(bytes)
        repeat(frames) { b.putShort(((it % 100) * 40 - 2000).toShort()) }
        f.writeBytes(b.array())
        rule.runOnIdle { model.updateFader(DeckId.A, 0.0); model.requestImport(DeckId.A, Uri.fromFile(f)) }
        rule.waitUntil(30_000) { model.decks.getValue(DeckId.A).ready }
    }

    @After fun cleanup() { file?.delete() }

    private fun receipts() = model.lastReceipt?.id ?: 0L

    @Test fun eightCueStabsInOneSecondSendEightDownsAndUps() {
        val before = rule.runOnIdle { receipts() }
        rule.onNodeWithContentDescription("A CUE").performTouchInput { repeat(8) { down(center); advanceEventTime(40); up(); advanceEventTime(85) } }
        rule.waitForIdle()
        assertEquals("CueDown + CueUp per stab", 16L, rule.runOnIdle { receipts() } - before)
    }

    @Test fun alternatingFingersEachPress() {
        val before = rule.runOnIdle { receipts() }
        rule.onNodeWithContentDescription("A CUE").performTouchInput {
            down(0, center); advanceEventTime(40)
            repeat(7) { i -> val next = (i + 1) % 2; down(next, center + androidx.compose.ui.geometry.Offset(4f * next, 0f)); advanceEventTime(30); up(1 - next); advanceEventTime(60) }
            up((7) % 2)
        }
        rule.waitForIdle()
        assertEquals("8 presses, each released", 16L, rule.runOnIdle { receipts() } - before)
    }

    @Test fun hotCueStabsAfterSetEachPreview() {
        val pad = rule.onNodeWithContentDescription("A hotcue 1")
        pad.performTouchInput { down(center); advanceEventTime(40); up() } // SET (one op, no up)
        rule.waitUntil(5_000) { model.decks.getValue(DeckId.A).hotCues[0] != null }
        val before = rule.runOnIdle { receipts() }
        pad.performTouchInput { repeat(8) { down(center); advanceEventTime(40); up(); advanceEventTime(85) } }
        rule.waitForIdle()
        assertEquals("HotCueDown + HotCueUp per stab", 16L, rule.runOnIdle { receipts() } - before)
    }
}
