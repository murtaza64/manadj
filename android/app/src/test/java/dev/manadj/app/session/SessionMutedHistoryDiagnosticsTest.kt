package dev.manadj.app.session

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.PixelMap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import dev.manadj.app.*
import dev.manadj.library.session.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** #485 real events/replay/production composition/pixels; generated bands, no post-FX/device claim. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SessionMutedHistoryDiagnosticsTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val draws = mutableListOf<Double>()

    private fun log(up: Double, later: Double) = SessionLog.parse("""{"uuid":"generated-muted-history","events":[
        {"t":0,"kind":"load","channel":"A","trackId":1},
        {"t":0,"kind":"control","channel":"A","control":"fader","value":0},
        {"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},
        {"t":5,"kind":"control","channel":"A","control":"fader","value":$up},
        {"t":6.5,"kind":"control","channel":"A","control":"fader","value":$later},
        {"t":12,"kind":"tick","playheads":{}}
    ]}""")

    private fun pixels(): PixelMap {
        val bounds = compose.onNodeWithTag("muted-history").fetchSemanticsNode().boundsInWindow
        lateinit var image: android.graphics.Bitmap
        compose.runOnUiThread {
            val view = compose.activity.window.decorView
            val bitmap = android.graphics.Bitmap.createBitmap(view.width, view.height, android.graphics.Bitmap.Config.ARGB_8888)
            val before = System.nanoTime()
            view.draw(android.graphics.Canvas(bitmap))
            draws += (System.nanoTime() - before) / 1e6
            image = android.graphics.Bitmap.createBitmap(bitmap, bounds.left.toInt(), bounds.top.toInt(), bounds.width.toInt(), bounds.height.toInt())
        }
        return image.asImageBitmap().toPixelMap()
    }

    private fun changes(a: PixelMap, b: PixelMap, head: Double, from: Double, until: Double): Int {
        val start = head - 8.0 * .35
        val left = ((from - start) / 8 * a.width).toInt().coerceIn(1, a.width - 1)
        val right = ((until - start) / 8 * a.width).toInt().coerceIn(left, a.width - 1)
        var changed = 0
        for (x in left until right) for (y in 10 until a.height / 2 - 6)
            if (a[x, y] != b[x, y]) changed++
        return changed
    }

    @Test fun faderDownPastMustRemainSilentAfterFaderUpAndSeekReplay() {
        val actual = log(1.0, .4)
        val allSilent = log(0.0, 0.0)
        val noLaterChange = log(1.0, 1.0)
        val indexed = ReplayHeardHistory(actual, 0) { state, d -> Strip(gain = state.decks[d].fader.toFloat()) }
        assertFalse(actual.replayAt(4.0).audible(0))
        assertEquals(0.0, (ReplayScript(actual).place(4.0, 0).first { it is ReplayOp.Fader } as ReplayOp.Fader).value, 0.0)
        assertTrue(actual.replayAt(5.5).audible(0))
        val selected = mutableStateOf(allSilent)
        val time = mutableStateOf(6.0)
        val wave = WaveformData(48000, 20.0, 480, 480, 480,
            ByteArray(2000) { 100 }, ByteArray(2000 * 8) { if (it % 8 < 3) 170.toByte() else 40 }, 2000)
        compose.setContent {
            val frame = selected.value.replayAt(time.value)
            ReplayWaveform(selected.value, 0, frame, wave, { frame.decks[0].playhead }, { time.value }, wave.duration,
                WaveMarks(null, emptyList()), Modifier.size(600.dp, 200.dp).testTag("muted-history"), Ink.accent)
        }
        fun at(log: SessionLog, t: Double): PixelMap {
            compose.runOnIdle { selected.value = log; time.value = t }
            compose.waitForIdle()
            return pixels()
        }
        val silent6 = at(allSilent, 6.0)
        val heard6 = at(actual, 6.0)
        val silentWrong6 = changes(silent6, heard6, 6.0, 4.0, 4.7)
        val audible6 = changes(silent6, heard6, 6.0, 5.2, 5.7)
        val silent66 = at(allSilent, 6.6)
        val heard66 = at(actual, 6.6)
        val silentWrong66 = changes(silent66, heard66, 6.6, 4.0, 4.7)
        val expectedPast66 = at(noLaterChange, 6.6)
        val audibleRewritten = changes(expectedPast66, heard66, 6.6, 5.2, 5.7)
        val futureChanged = changes(expectedPast66, heard66, 6.6, 7.0, 9.0)
        at(actual, 2.0) // actual backwards seek into the same recorded occurrence
        val replay66 = at(actual, 6.6)
        assertTrue("seek/replay reproduces the same current image", heard66.buffer.contentEquals(replay66.buffer))
        repeat(12) { pixels() }
        val warm = draws.takeLast(12).sorted()
        println("MUTED-HISTORY-DIAG silentWrong@6=$silentWrong6 silentWrong@6.6=$silentWrong66 silentHistoryLookup=${indexed.at(6.0, 4.2, 6.0)} audibleHistoryLookup=${indexed.at(6.0, 5.5, 6.0)} audiblePixels=$audible6 audiblePastRewritten=$audibleRewritten futureChanged=$futureChanged drawHostMs.p50=${warm[5]} drawHostMs.p95=${warm[11]} size=${heard6.width}x${heard6.height}")
        assertTrue("a positive audible region must appear after the recorded fader-up boundary", audible6 > 0)
        assertEquals("later fader changes must not rewrite the audible past", 0, audibleRewritten)
        assertTrue("future preview must reflect the later fader", futureChanged > 0)
        assertEquals("recorded fader-down region was silent, not unattenuated source", 0, silentWrong6)
        assertEquals("the same silent past must remain silent after later controls", 0, silentWrong66)
    }
}
