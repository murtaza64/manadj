package dev.manadj.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * UH30: the browser sheet never sticks part-way. Drags to 30/50/70 % released slowly, cancelled mid-drag, list
 * overscroll pulls, and tap spam all end fully open or closed. The app never goes compose-idle, so the clock is
 * driven by hand (android-viz learning).
 */
@RunWith(AndroidJUnit4::class)
class BrowserSheetTest {
    @get:Rule val rule = createComposeRule()
    private val open = mutableStateOf(false)
    private lateinit var sheet: BrowserSheetState

    private fun host() {
        rule.mainClock.autoAdvance = false
        rule.setContent {
            sheet = rememberBrowserSheet(open)
            Box(Modifier.size(360.dp, 640.dp)) {
                Box(Modifier.fillMaxSize().testTag("controls").browserSwipeUp(sheet).background(Color.DarkGray))
                BrowserSheet(sheet, Modifier.fillMaxSize()) {
                    Box(Modifier.fillMaxSize().testTag("sheet").background(Color.Black)) {
                        LazyColumn(Modifier.fillMaxSize().testTag("list")) { items(60) { Box(Modifier.fillMaxWidth().height(48.dp)) } }
                    }
                }
                // On top of everything (BROWSE key stand-in).
                Box(Modifier.size(80.dp, 40.dp).testTag("toggle").clickable { sheet.toggle() })
            }
        }
        settle()
    }
    private fun settle() { rule.mainClock.advanceTimeBy(3_000) }
    private fun assertAnchored(expectOpen: Boolean? = null) {
        val h = sheet.height
        assertTrue("height measured", h > 0)
        assertTrue("offset ${sheet.offset} not at an anchor (h=$h)", sheet.offset == 0f || sheet.offset == h)
        assertTrue("offset agrees with truth", (sheet.offset == 0f) == open.value)
        if (expectOpen != null) assertTrue("expected open=$expectOpen", open.value == expectOpen)
    }

    @Test fun slowDragsToFractionsSettleByDirection() {
        host()
        for (f in listOf(.3f, .5f, .7f)) {
            // Up from closed: lands open whatever the distance.
            rule.onNodeWithTag("controls").performTouchInput {
                val y0 = bottom - 10f; down(Offset(centerX, y0))
                val steps = 30; repeat(steps) { moveTo(Offset(centerX, y0 - height * f * (it + 1) / steps), delayMillis = 40) }
                advanceEventTime(400); up()
            }
            settle(); assertAnchored(true)
            // Down from open (list at top → overscroll pulls the sheet): lands closed.
            rule.onNodeWithTag("list").performTouchInput {
                val y0 = top + 10f; down(Offset(centerX, y0))
                val steps = 30; repeat(steps) { moveTo(Offset(centerX, y0 + height * f * (it + 1) / steps), delayMillis = 40) }
                advanceEventTime(400); up()
            }
            settle(); assertAnchored(false)
        }
    }

    @Test fun reversingMidDragFollowsLastDirection() {
        host()
        rule.onNodeWithTag("controls").performTouchInput {
            val y0 = bottom - 10f; down(Offset(centerX, y0))
            repeat(20) { moveTo(Offset(centerX, y0 - height * .6f * (it + 1) / 20), delayMillis = 30) }
            repeat(5) { moveTo(Offset(centerX, y0 - height * .6f + height * .05f * (it + 1) / 5), delayMillis = 30) }
            advanceEventTime(300); up()
        }
        settle(); assertAnchored(false)
    }

    @Test fun cancelMidDragStillSettles() {
        host()
        rule.onNodeWithTag("controls").performTouchInput {
            val y0 = bottom - 10f; down(Offset(centerX, y0))
            repeat(15) { moveTo(Offset(centerX, y0 - height * .5f * (it + 1) / 15), delayMillis = 30) }
            cancel()
        }
        settle(); assertAnchored(true)
    }

    @Test fun tapSpamAlwaysEndsAnchored() {
        host()
        repeat(9) { i ->
            rule.onNodeWithTag("toggle").performClick()
            rule.mainClock.advanceTimeBy((37L * (i + 1)) % 180) // taps land mid-spring
        }
        settle(); assertAnchored(true) // odd number of toggles from closed
        repeat(6) { rule.onNodeWithTag("toggle").performClick(); rule.mainClock.advanceTimeBy(16) }
        settle(); assertAnchored(true)
    }

    /** A drag driven from outside the sheet's own detector (nested scroll) that ends with no fling: the next lift settles it. */
    @Test fun heldDragWithoutFlingSettlesOnLift() {
        host()
        rule.onNodeWithTag("toggle").performClick(); settle(); assertAnchored(true)
        rule.runOnIdle { sheet.dragBy(sheet.height * .4f) } // pulled 40 % down, finger still "down" from the sheet's view
        rule.mainClock.advanceTimeBy(100)
        rule.onNodeWithTag("sheet").performTouchInput { down(center); advanceEventTime(50); up() }
        settle(); assertAnchored(false) // last movement was down
    }
}
