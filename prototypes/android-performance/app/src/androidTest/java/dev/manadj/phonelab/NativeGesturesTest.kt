package dev.manadj.phonelab

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.lifecycle.ViewModelProvider
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.*
import org.junit.Assert.*

class NativeGesturesTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val model get() = ViewModelProvider(rule.activity)[DjModel::class.java]
    @Before fun freezeVisualClock() { rule.mainClock.autoAdvance = false }
    private fun click(description: String) { rule.onNodeWithContentDescription(description).performClick(); rule.mainClock.advanceTimeBy(160) }

    @Test fun doubleTapResetsEqToUnityWithoutDelayingDrag() {
        click("MIX")
        rule.runOnIdle { model.a.low = .8f }; rule.mainClock.advanceTimeByFrame()
        rule.onNodeWithContentDescription("A LOW control").performTouchInput { down(center); up(); advanceEventTime(100); down(center); up() }
        rule.mainClock.advanceTimeByFrame()
        assertEquals("EQ unity is the .5 UI coordinate", .5f, model.a.low, .0001f)
    }

    @Test fun rotaryTouchDownDoesNotJumpAndCancelRestoresStart() {
        click("MIX")
        rule.onNodeWithContentDescription("A FILTER control").performTouchInput { down(Offset(2f, 2f)) }
        assertEquals(.5f, model.a.filter, 0f)
        rule.onNodeWithContentDescription("A FILTER control").performTouchInput { moveBy(Offset(0f, -90f)); cancel() }
        rule.mainClock.advanceTimeByFrame(); assertEquals(.5f, model.a.filter, 0f)
    }

    @Test fun unityNotchCanBeDeliberatelyEscaped() {
        click("MIX")
        rule.onNodeWithContentDescription("A LOW control").performTouchInput { down(center); moveBy(Offset(0f, -4f)) }
        rule.mainClock.advanceTimeByFrame(); assertEquals(.5f, model.a.low, 0f)
        rule.onNodeWithContentDescription("A LOW control").performTouchInput { moveBy(Offset(0f, -30f)); up() }
        rule.mainClock.advanceTimeByFrame(); assertTrue("Notch must not trap the knob", model.a.low > .6f)
    }

    @Test fun fullFaderUsesRailTravelAndNeverOpensFineMode() {
        click("MIX")
        rule.onNodeWithContentDescription("A VOL control").performTouchInput { down(Offset(center.x, 16f)) }
        rule.mainClock.advanceTimeBy(450)
        assertTrue("Full fader has no precision expansion", model.precision.isEmpty())
        rule.onNodeWithContentDescription("A VOL control").performTouchInput { moveTo(Offset(center.x, height - 16f)); up() }
        rule.mainClock.advanceTimeByFrame(); assertEquals(0f, model.a.gain, .001f)
    }

    @Test fun fullFaderCancelRestoresOriginalGain() {
        click("MIX")
        rule.onNodeWithContentDescription("B VOL control").performTouchInput { down(Offset(center.x, 16f)); moveTo(Offset(center.x, height - 16f)); cancel() }
        rule.mainClock.advanceTimeByFrame(); assertEquals(1f, model.b.gain, 0f)
    }

    @Test fun samePointerHoldDragCommitsJumpValue() {
        rule.onNodeWithContentDescription("A jump size").performTouchInput { down(center) }
        rule.mainClock.advanceTimeBy(400)
        rule.onNodeWithContentDescription("A jump size").performTouchInput { moveBy(Offset(56f, 0f)); up() }
        rule.mainClock.advanceTimeByFrame()
        assertEquals(128, model.a.jumpBeats); assertTrue(model.wheels.isEmpty())
    }

    @Test fun cancelledLoopWheelRestoresValue() {
        rule.onNodeWithContentDescription("A loop size").performTouchInput { down(center) }
        rule.mainClock.advanceTimeBy(400)
        rule.onNodeWithContentDescription("A loop size").performTouchInput { moveBy(Offset(56f, 0f)); cancel() }
        rule.mainClock.advanceTimeByFrame()
        assertEquals(4f, model.a.loopBeats, 0f); assertTrue(model.wheels.isEmpty())
    }

    @Test fun pausedHotcuePreviewsUntilReleaseThenReturnsToCue() {
        val cue = model.a.cues[3]!!.toDouble()
        rule.onNodeWithContentDescription("A hotcue 4").performTouchInput { down(center) }
        rule.mainClock.advanceTimeBy(400)
        assertTrue(model.a.running); assertFalse(model.a.playing); assertTrue(model.a.positionSeconds > cue)
        rule.onNodeWithContentDescription("A hotcue 4").performTouchInput { up() }
        rule.mainClock.advanceTimeByFrame()
        assertFalse(model.a.running); assertEquals(cue, model.a.positionSeconds, .0001)
    }

    @Test fun secondFingerPlayTakesOverHotcuePreview() {
        val pad = rule.onNodeWithContentDescription("A hotcue 4").fetchSemanticsNode().boundsInRoot.center
        val play = rule.onNodeWithText("A ▶").fetchSemanticsNode().boundsInRoot.center
        rule.onRoot().performTouchInput { down(0, pad) }
        rule.mainClock.advanceTimeBy(100)
        rule.onRoot().performTouchInput { down(1, play); up(1) }
        rule.mainClock.advanceTimeByFrame()
        rule.onRoot().performTouchInput { up(0) }
        rule.mainClock.advanceTimeByFrame()
        assertTrue(model.a.playing); assertNull(model.a.hotCuePreviewSlot)
    }

    @Test fun minimapSeeksAbsolutelyAndCancelRestoresPlayhead() {
        rule.onNodeWithContentDescription("A minimap seek").performTouchInput { down(center) }
        assertEquals(model.a.track.duration / 2, model.a.positionSeconds, 1.0)
        rule.onNodeWithContentDescription("A minimap seek").performTouchInput { cancel() }
        rule.mainClock.advanceTimeByFrame(); assertEquals(0.0, model.a.positionSeconds, 0.0); assertFalse(model.a.scratchHeld)
    }

    @Test fun scratchFollowsFingerAndCannotRetargetWhileHeld() {
        rule.onNodeWithContentDescription("A wave scratch").performTouchInput { down(center); moveBy(Offset(-width / 4f, 0f)) }
        rule.mainClock.advanceTimeByFrame()
        assertEquals(5.0, model.a.positionSeconds, .1)
        rule.runOnIdle { model.chooseDeck("B") }
        assertEquals("A", model.active)
        rule.onNodeWithContentDescription("A wave scratch").performTouchInput { up() }
        rule.mainClock.advanceTimeByFrame(); assertEquals("B", model.active); assertFalse(model.a.scratchHeld)
    }

    @Test fun bendReleaseAndCancelAlwaysRestoreOriginalTempo() {
        val original = model.a.tempo
        rule.onNodeWithContentDescription("A momentary bend").performTouchInput { down(Offset(width * .75f, center.y)) }
        assertEquals(.02f, model.a.bend, .001f)
        rule.onNodeWithContentDescription("A momentary bend").performTouchInput { moveBy(Offset(-50f, 0f)); cancel() }
        rule.mainClock.advanceTimeByFrame(); assertEquals(0f, model.a.bend, 0f); assertEquals(original, model.a.tempo, 0f)
    }

    @Test fun twoDeckKnobsRemainIndependent() {
        click("MIX")
        val a = rule.onNodeWithContentDescription("A FILTER control").fetchSemanticsNode().boundsInRoot.center
        val b = rule.onNodeWithContentDescription("B FILTER control").fetchSemanticsNode().boundsInRoot.center
        rule.onRoot().performTouchInput { down(0, a); down(1, b); moveBy(0, Offset(0f, -60f)); moveBy(1, Offset(0f, 60f)); up(0); up(1) }
        rule.mainClock.advanceTimeByFrame(); assertTrue(model.a.filter > .5); assertTrue(model.b.filter < .5)
    }

    @Test fun fxRouteWaitsForDepthRelease() {
        click("FX")
        rule.onNodeWithContentDescription("FX DEPTH control").performTouchInput { down(center) }
        rule.mainClock.advanceTimeBy(400)
        rule.runOnIdle { model.routeFx("B") }
        assertEquals("A", model.fx.target)
        rule.onNodeWithContentDescription("FX DEPTH control").performTouchInput { up() }
        rule.mainClock.advanceTimeByFrame(); assertEquals("B", model.fx.target)
    }

    @Test fun loadingPlayingDeckRequiresConfirmationWithoutStoppingOtherDeck() {
        click("A ▶"); click("B ▶"); click("A browse tracks"); click("Load SUBTERRANEAN")
        rule.onNodeWithText("A IS PLAYING").assertExists(); assertTrue(model.b.playing)
        click("REPLACE A")
        assertEquals("SUBTERRANEAN", model.a.name); assertFalse(model.a.playing); assertTrue(model.b.playing)
    }

    @Test fun selectedCompactControlsHave48DpRegions() {
        click("1/3")
        val density = rule.activity.resources.displayMetrics.density
        val root = rule.onRoot().fetchSemanticsNode().boundsInRoot
        val names = listOf("A HIGH control", "B LOW control", "A VOL control", "B VOL control", "FX DEPTH control", "FX routing", "A hotcue 8", "A loop size", "A momentary bend", "A CUE", "A minimap seek")
        for (name in names) {
            val bounds = rule.onNodeWithContentDescription(name).fetchSemanticsNode().boundsInRoot
            assertTrue("$name width ${bounds.width / density}", bounds.width / density >= 48f)
            assertTrue("$name height ${bounds.height / density}", bounds.height / density >= 48f)
            assertTrue("$name clipped", bounds.top >= 0 && bounds.bottom <= root.bottom)
        }
        val bottom = rule.onNodeWithContentDescription("A CUE").fetchSemanticsNode().boundsInRoot.bottom
        assertEquals("No unexplained bottom reserve", root.bottom, bottom, 1f)
    }
}

class FakeTrackBehaviorTest {
    @Test fun pitchAndMomentaryBendComposeWithoutChangingPitchSetting() {
        val deck = Deck("C", demoTracks[0]); deck.playToggle(); deck.updateTempo(deck.bpm * 1.05f); deck.bend = .02f
        deck.advance(10.0); assertEquals(10.71, deck.positionSeconds, .0001); assertEquals(deck.bpm * 1.05f, deck.tempo, .0001f)
    }
    @Test fun jumpMovesActiveLoopWithPlayhead() {
        val deck = Deck("D", demoTracks[0]); deck.jump(64); deck.toggleLoop(); deck.jump(32); deck.playToggle(); deck.advance(5 * 60.0 / 124)
        assertEquals(97 * 60.0 / 124, deck.positionSeconds, .0001); assertTrue(deck.loopOn)
    }
    @Test fun mainCueReturnsOrSetsOrPreviewsAccordingToTransport() {
        val deck = Deck("A", demoTracks[0]); deck.seek(30.0); deck.cueDown(); assertEquals(30.0, deck.cuePoint, 0.0); assertFalse(deck.running)
        deck.cueDown(); assertTrue(deck.running); deck.advance(1.0); deck.cueUp(); assertEquals(30.0, deck.positionSeconds, 0.0)
        deck.playToggle(); deck.advance(1.0); deck.cueDown(); assertFalse(deck.running); assertEquals(30.0, deck.positionSeconds, 0.0)
    }
    @Test fun earlierPadReleaseCannotStopLaterPreview() {
        val deck = Deck("A", demoTracks[0]); deck.hotCueDown(1); deck.hotCueDown(2); deck.hotCueUp(1)
        assertEquals(2, deck.hotCuePreviewSlot); assertTrue(deck.running)
        deck.hotCueUp(2); assertFalse(deck.running)
    }
    @Test fun masterFxRetainsLastDeckTempoAddress() {
        val model = DjModel(); model.routeFx("B"); model.routeFx("MASTER")
        assertEquals("MASTER", model.fx.target); assertEquals("B", model.fx.tempoDeck); assertEquals(0f, model.fx.depth, 0f)
    }
}

class DenseGeometryTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    @Test fun denseControlsAndVerticalWavesHave48DpCaptureRegions() {
        rule.mainClock.autoAdvance = false
        rule.onNodeWithText("1/3").performClick(); rule.mainClock.advanceTimeBy(160)
        rule.onNodeWithText("2/3").performClick(); rule.mainClock.advanceTimeBy(160)
        val density = rule.activity.resources.displayMetrics.density
        val root = rule.onRoot().fetchSemanticsNode().boundsInRoot
        for (id in listOf("A", "B")) {
            val names = (1..8).map { "$id hotcue $it" } + listOf("$id TRIM control", "$id HIGH control", "$id MID control", "$id LOW control", "$id FILTER control", "$id VOL control", "$id wave scratch", "$id minimap seek", "$id loop size", "$id momentary bend", "$id CUE", "$id browse tracks", "$id pitch drawer", "$id jump backward", "$id jump size", "$id jump forward")
            for (name in names) {
                val b = rule.onNodeWithContentDescription(name).fetchSemanticsNode().boundsInRoot
                assertTrue("$name ${b.width / density}×${b.height / density}", b.width / density >= 48f && b.height / density >= 48f)
                assertTrue("$name clipped", b.left >= 0 && b.top >= 0 && b.right <= root.right && b.bottom <= root.bottom)
            }
        }
        rule.onNodeWithContentDescription("FX routing").assertIsDisplayed()
        rule.onNodeWithContentDescription("FX DEPTH control").assertIsDisplayed()
    }
}

class NativeRotationTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    @Test fun rotationCancelsHeldCueAndKeepsLoadedTrack() {
        rule.mainClock.autoAdvance = false
        rule.onNodeWithContentDescription("A browse tracks").performClick(); rule.mainClock.advanceTimeBy(160)
        rule.onNodeWithContentDescription("Load SUBTERRANEAN").performClick(); rule.mainClock.advanceTimeBy(160)
        rule.onNodeWithContentDescription("A CUE").performTouchInput { down(center) }; rule.mainClock.advanceTimeByFrame()
        rule.activityRule.scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        rule.waitUntil(10000) { rule.activity.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE }
        rule.mainClock.advanceTimeBy(300)
        rule.onNodeWithText("A SUBTERRANEAN").assertExists(); rule.onNodeWithText("A ▶").assertExists()
    }
}
