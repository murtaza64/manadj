package dev.manadj.app.session

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import dev.manadj.app.*
import dev.manadj.library.session.SessionLog
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Actual ReplayDeckStrip composition seam, real reducer/painter; no native audio/device claim. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ReplayWaveformIntegrationTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private fun pixels(): androidx.compose.ui.graphics.PixelMap {
        val bounds = compose.onNodeWithTag("replay-wave").fetchSemanticsNode().boundsInWindow
        lateinit var image: android.graphics.Bitmap
        compose.runOnUiThread {
            val view = compose.activity.window.decorView
            val all = android.graphics.Bitmap.createBitmap(view.width, view.height, android.graphics.Bitmap.Config.ARGB_8888)
            view.draw(android.graphics.Canvas(all))
            image = android.graphics.Bitmap.createBitmap(all, bounds.left.toInt(), bounds.top.toInt(), bounds.width.toInt(), bounds.height.toInt())
        }
        return image.asImageBitmap().toPixelMap()
    }

    @Test fun recordedEqStepPreservesHeardPixelsThroughActualReplayEntry() = boundary(
        """{"t":5,"kind":"control","channel":"A","control":"eqLow","value":0}""", 4.99, 5.01)

    @Test fun recordedCrossfaderStepPreservesHeardPixels() = boundary(
        """{"t":5,"kind":"control","control":"crossfader","value":0.8}""", 4.99, 5.01)

    @Test fun pausedMixerChangeDoesNotRepaintEarlierAudio() = boundary(
        """{"t":5,"kind":"transport","channel":"A","action":"pause","playhead":5},
            {"t":10,"kind":"control","channel":"A","control":"eqLow","value":0}""", 9.99, 10.01)

    private fun boundary(change: String, beforeTime: Double, afterTime: Double) {
        val log = SessionLog.parse("""{"uuid":"replay-wave-decoy","events":[
            {"t":0,"kind":"load","channel":"A","trackId":1},
            {"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},
            $change,
            {"t":12,"kind":"tick","playheads":{}}
        ]}""")
        val time = mutableStateOf(beforeTime)
        val wave = WaveformData(48000, 20.0, 480, 480, 480,
            ByteArray(2000) { 100 }, ByteArray(2000 * 8) { if (it % 8 < 3) 170.toByte() else 40 }, 2000)
        compose.setContent {
            ReplayWaveform(log, 0, log.replayAt(time.value), wave, { 5.0 }, { time.value }, wave.duration,
                WaveMarks(null, emptyList()), Modifier.size(600.dp, 200.dp).testTag("replay-wave"), Ink.accent)
        }
        compose.waitForIdle()
        val before = pixels()
        assertTrue("unchanged redraw", before.buffer.contentEquals(pixels().buffer))
        compose.runOnIdle { time.value = afterTime }
        val after = pixels()
        fun changes(from: Double, to: Double): Int {
            var n = 0
            for (x in (before.width * from).toInt() until (before.width * to).toInt())
                for (y in 10 until before.height / 2 - 5) if (before[x, y] != after[x, y]) n++
            return n
        }
        val past = changes(.05, .30)
        val future = changes(.40, .90)
        println("REPLAY-WAVE pastChanged=$past futureChanged=$future")
        assertTrue("future reflects EQ change", future > 0)
        assertEquals("heard pixels must retain their recorded strip", 0, past)
        compose.runOnIdle { time.value = beforeTime }
        assertTrue("seeking backward restores reference image", before.buffer.contentEquals(pixels().buffer))
        compose.runOnIdle { time.value = afterTime }
        assertTrue("seeking forward is deterministic", after.buffer.contentEquals(pixels().buffer))
    }
}
