package dev.manadj.sessionlab

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.lifecycle.Lifecycle
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ScreenTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @Test fun timelineSeekSynchronizesAllFourStripsAndClock() {
        rule.onNodeWithTag("timeline").performTouchInput { click(center.copy(x = width * .25f)) }
        rule.onNodeWithTag("session-time").assertTextEquals("0:30")
        rule.runOnIdle { assertEquals(130.0, rule.activity.model.time, .5) }
        rule.onNodeWithTag("deck-D").assertIsDisplayed()
    }
    @Test fun listScrollLeavesDecksTimelineAndTransportFixed() {
        val strip = rule.onNodeWithTag("deck-A").fetchSemanticsNode().boundsInRoot
        val timeline = rule.onNodeWithTag("timeline").fetchSemanticsNode().boundsInRoot
        rule.onNodeWithTag("tracklist").performScrollToIndex(7)
        rule.onNodeWithTag("occurrence-7").performClick()
        rule.onNodeWithTag("session-time").assertTextEquals("1:36")
        assertEquals(strip, rule.onNodeWithTag("deck-A").fetchSemanticsNode().boundsInRoot)
        assertEquals(timeline, rule.onNodeWithTag("timeline").fetchSemanticsNode().boundsInRoot)
        rule.onNodeWithTag("play").assertIsDisplayed()
    }
    @Test fun playAdvancesAndPauseFreezesTheSessionClock() {
        rule.mainClock.autoAdvance = false
        rule.onNodeWithTag("play").performClick()
        rule.mainClock.advanceTimeBy(2200)
        rule.runOnIdle { assertTrue(rule.activity.model.time > 101.0) }
        rule.onNodeWithTag("play").performClick()
        var paused = 0.0
        rule.runOnIdle { paused = rule.activity.model.time }
        rule.mainClock.advanceTimeBy(2000)
        rule.runOnIdle { assertEquals(paused, rule.activity.model.time, 0.0) }
    }
    @Test fun zoomAndPanDoNotChangePlaybackPosition() {
        rule.onNodeWithContentDescription("Zoom in").performClick()
        rule.runOnIdle { assertEquals(60.0, rule.activity.model.viewWidth, 0.0) }
        rule.onNodeWithTag("timeline").performTouchInput { swipeLeft() }
        rule.runOnIdle { assertEquals(100.0, rule.activity.model.time, 0.0); assertFalse(rule.activity.model.follow) }
        rule.onNodeWithContentDescription("Fit whole Session").performClick()
        rule.runOnIdle { assertEquals(120.0, rule.activity.model.viewWidth, 0.0) }
    }
    @Test fun backgroundingPausesReplayWithoutMovingItsPosition() {
        rule.mainClock.autoAdvance = false
        rule.onNodeWithTag("play").performClick()
        rule.mainClock.advanceTimeBy(1000)
        rule.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        rule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        rule.runOnIdle { assertFalse(rule.activity.model.playing) }
    }
}
