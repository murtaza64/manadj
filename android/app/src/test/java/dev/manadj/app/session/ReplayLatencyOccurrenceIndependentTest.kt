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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ReplayLatencyOccurrenceIndependentTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private fun log(oldLow: Double) = SessionLog.parse("""{"uuid":"latency-occurrence-decoy","events":[
        {"t":0,"kind":"load","channel":"A","trackId":1},
        {"t":0,"kind":"control","channel":"A","control":"eqLow","value":$oldLow},
        {"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},
        {"t":5,"kind":"load","channel":"A","trackId":2},
        {"t":5,"kind":"control","channel":"A","control":"eqLow","value":0.5},
        {"t":5,"kind":"transport","channel":"A","action":"play","playhead":3},
        {"t":12,"kind":"tick","playheads":{}}
    ]}""")

    private fun pixels(): androidx.compose.ui.graphics.PixelMap {
        val bounds = compose.onNodeWithTag("latency-wave").fetchSemanticsNode().boundsInWindow
        lateinit var image: android.graphics.Bitmap
        compose.runOnUiThread {
            val view = compose.activity.window.decorView
            val all = android.graphics.Bitmap.createBitmap(view.width, view.height, android.graphics.Bitmap.Config.ARGB_8888)
            view.draw(android.graphics.Canvas(all))
            image = android.graphics.Bitmap.createBitmap(all, bounds.left.toInt(), bounds.top.toInt(), bounds.width.toInt(), bounds.height.toInt())
        }
        return image.asImageBitmap().toPixelMap()
    }

    @Test fun latencyBeforeLoadCannotPaintNewTrackWithPreviousTrackEvidence() {
        val selected = mutableStateOf(log(0.0))
        val wave = WaveformData(48000, 20.0, 480, 480, 480,
            ByteArray(2000) { 100 }, ByteArray(2000 * 8) { if (it % 8 < 3) 170.toByte() else 40 }, 2000)
        // Same clocks used by ReplayDeckStrip: new-track frame at displayTime,
        // but position/evidence query latency-compensated into the old Load.
        val display = 5.01
        val heard = display - .1
        compose.setContent {
            val current = selected.value
            val frame = current.replayAt(display)
            val ref = frame.decks[0].copy()
            ReplayWaveform(current, 0, frame, wave, { ref.playheadAt(heard) }, { heard }, wave.duration,
                WaveMarks(null, emptyList()), Modifier.size(600.dp, 200.dp).testTag("latency-wave"), Ink.accent)
        }
        compose.waitForIdle()
        val first = pixels()
        compose.runOnIdle { selected.value = log(0.5) }
        val second = pixels()
        var changedPast = 0
        var changedFuture = 0
        for (x in 0 until first.width) for (y in 10 until first.height / 2 - 5) {
            if (first[x, y] != second[x, y]) {
                if (x < first.width * .35) changedPast++ else changedFuture++
            }
        }
        println("LATENCY-LOAD changedPast=$changedPast changedFuture=$changedFuture")
        assertEquals("new track future/current strip is identical", 0, changedFuture)
        assertEquals("previous track EQ must not color the new Load waveform during output latency", 0, changedPast)
    }
}
