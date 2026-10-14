package dev.manadj.app

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import org.junit.*
import org.junit.Assert.*

/** #371 layout contract: one-screen portrait order, knob fine popup, crossfader recentre, landscape popups clear of the mixer. */
class PerformanceUiTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val ux get() = ViewModelProvider(rule.activity)[UiModel::class.java]
    private val model get() = ViewModelProvider(rule.activity)[PlayerModel::class.java]
    private fun box(name: String) = rule.onNodeWithContentDescription(name).fetchSemanticsNode().boundsInRoot

    @Test fun portraitIsOneScreenInThumbOrder() {
        rule.waitForIdle()
        val root = rule.onRoot().fetchSemanticsNode().boundsInRoot
        rule.onNodeWithText("PADS").assertDoesNotExist()
        // Bottom → top: pitch, bend, CUE, jump, loop, pads, minimap.
        val order = listOf("A pitch panel", "A momentary bend", "A CUE", "A jump size", "A loop size", "A hotcue 5", "A minimap seek").map(::box)
        for (i in 1 until order.size) assertTrue("order $i: ${order[i]} above ${order[i - 1]}", order[i].bottom <= order[i - 1].top + 1f)
        assertTrue("minimaps A left of B", box("A minimap seek").right <= box("B minimap seek").left)
        assertTrue("loops per side", box("A loop size").right <= box("B loop size").left)
        assertTrue("FX sits between the channel strips", box("FX effect").left >= box("A HI control").right && box("FX effect").right <= box("B HI control").left)
        assertEquals("pitch key at the bottom edge", root.bottom, box("A pitch panel").bottom, 2f)
        for (name in listOf("A TRIM control", "A FILTER control", "A hotcue 8", "A CUE", "A play pause", "FX target", "A momentary bend")) {
            val b = box(name); assertTrue("$name clipped", b.top >= 0f && b.bottom <= root.bottom + 1f)
        }
    }

    @Test fun pinchZoomsBothDetailWavesAndPersists() {
        rule.runOnIdle { ux.chooseWaveSeconds(12.0) }
        rule.onNodeWithContentDescription("A detail wave").performTouchInput {
            pinch(center - Offset(40f, 0f), center - Offset(200f, 0f), center + Offset(40f, 0f), center + Offset(200f, 0f))
        }
        rule.waitForIdle()
        val zoomed = rule.runOnIdle { ux.waveSeconds }
        assertTrue("spread zooms in: $zoomed", zoomed < 6.0)
        assertEquals(zoomed.toFloat(), rule.activity.getSharedPreferences("ui-settings", 0).getFloat("wave-seconds", 0f), .01f)
    }

    @Test fun holdingAKnobShowsTheEnlargedFineCopy() {
        rule.waitUntil(20_000) { model.supports("trim") }
        rule.waitForIdle() // let the knob recompose as engine-backed before freezing the clock
        rule.mainClock.autoAdvance = false
        rule.onNodeWithContentDescription("A TRIM control").performTouchInput { down(center) }
        rule.mainClock.advanceTimeBy(450)
        assertEquals("A TRIM", ux.knob?.label)
        rule.onNodeWithContentDescription("A TRIM control").performTouchInput { up() }
        rule.mainClock.advanceTimeByFrame()
        assertNull(ux.knob)
    }

    @Test fun crossfaderDoubleTapRecentres() {
        rule.waitUntil(20_000) { model.supports("crossfade") }
        rule.runOnIdle { model.updateCrossfade(.9) }
        rule.waitUntil(5_000) { model.crossfade > .85 }
        rule.onNodeWithContentDescription("A XF").performTouchInput { val p = Offset(width * .15f, center.y); down(p); up(); advanceEventTime(90); down(p); up() }
        rule.waitUntil(5_000) { kotlin.math.abs(model.crossfade - .5) < .01 }
    }

    @Test fun landscapeDeckPopupNeverCoversTheMixer() {
        rule.activityRule.scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        rule.waitUntil(10_000) { rule.activity.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE }
        rule.waitForIdle()
        rule.runOnIdle { model.pitchDrawer = dev.manadj.audio.DeckId.A }
        rule.waitForIdle()
        val popup = rule.onNodeWithText("A · PITCH").fetchSemanticsNode().boundsInRoot
        val mixerLeft = box("A TRIM control").left
        assertTrue("popup right ${popup.right} <= mixer left $mixerLeft", popup.right <= mixerLeft)
        rule.activityRule.scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
    }
}
