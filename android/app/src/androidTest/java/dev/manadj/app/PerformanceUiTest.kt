package dev.manadj.app

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
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

    @Test fun twoHeldKnobsKeepTheirOwnPopups() {
        rule.waitUntil(20_000) { model.supports("eq") && model.supports("filter") }
        rule.waitForIdle()
        val low = box("A LOW control").center; val filter = box("B FILTER control").center
        rule.onRoot().performTouchInput { down(0, low); down(1, filter) }
        rule.waitForIdle()
        assertEquals(setOf("A LOW", "B FILTER"), rule.runOnIdle { ux.knobs.keys.toSet() })
        rule.onRoot().performTouchInput { up(1) }
        rule.waitForIdle()
        assertEquals("lifting B keeps A's popup", setOf("A LOW"), rule.runOnIdle { ux.knobs.keys.toSet() })
        rule.onRoot().performTouchInput { up(0) }
        rule.waitForIdle()
        assertTrue(rule.runOnIdle { ux.knobs.isEmpty() })
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

    /** VH11: tap always toggles the pitch sheet — open, close via the risen header, and a tap mid-spring reverses it. */
    @Test fun pitchTabTapTogglesAlongsideSwipe() {
        // The app never idles (live meters/viz), so drive the clock by hand instead of waitForIdle.
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(3000)
        val A = dev.manadj.audio.DeckId.A
        val sheet = PitchSheets.of(A)
        fun settle() = rule.mainClock.advanceTimeBy(1500)
        rule.onNodeWithContentDescription("A pitch panel").performTouchInput { click(center) }
        settle()
        assertEquals(A, model.pitchDrawer); assertEquals(1f, sheet.progress.value, .01f)
        rule.onNodeWithContentDescription("A lower pitch panel").performTouchInput { click(center) }
        settle()
        assertNull(model.pitchDrawer); assertEquals(0f, sheet.progress.value, .01f)
        // Mid-animation: open, stop part-way, tap the (moving) header — the sheet reverses and settles closed.
        rule.onNodeWithContentDescription("A pitch panel").performTouchInput { click(center) }
        rule.mainClock.advanceTimeBy(100)
        val mid = sheet.progress.value
        assertTrue("mid-spring: $mid", mid > .05f && mid < .95f)
        rule.onNodeWithContentDescription("A lower pitch panel").performTouchInput { click(center) }
        settle()
        assertNull(model.pitchDrawer); assertEquals(0f, sheet.progress.value, .01f)
        assertFalse("never left held", sheet.dragging)
    }

    /** VH12: drags released slowly at 30/50/70 %, a cancelled drag and tap spam always end fully open or closed. */
    @Test fun pitchSheetNeverSticksHalfway() {
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(3000)
        val A = dev.manadj.audio.DeckId.A
        val sheet = PitchSheets.of(A)
        fun settle() = rule.mainClock.advanceTimeBy(2000)
        fun anchored(label: String): Boolean {
            settle()
            val p = sheet.progress.value; val open = model.pitchDrawer == A
            assertEquals("$label: progress $p vs open=$open", if (open) 1f else 0f, p, .001f)
            assertFalse("$label: held", sheet.dragging)
            return open
        }
        // The sheet's travel is known once it has been built (first open).
        rule.onNodeWithContentDescription("A pitch panel").performTouchInput { click(center) }
        assertTrue(anchored("first open"))
        rule.onNodeWithContentDescription("A lower pitch panel").performTouchInput { click(center) }
        assertFalse(anchored("first close"))
        val travel = sheet.travel
        // Drag from the closed tab by [fractions] of the travel (each step slow), pause, release.
        fun dragTab(vararg fractions: Float, cancel: Boolean = false) =
            rule.onNodeWithContentDescription("A pitch panel").performTouchInput {
                down(center)
                for (f in fractions) { val steps = 12; repeat(steps) { advanceEventTime(30); moveBy(Offset(0f, -f * travel / steps)) } }
                advanceEventTime(600) // slow release: no fling velocity left
                if (cancel) cancel() else up()
            }
        for (f in listOf(.3f, .5f, .7f)) {
            dragTab(f + .03f)
            assertTrue("up to $f, last move up -> open", anchored("up $f"))
            rule.onNodeWithContentDescription("A lower pitch panel").performTouchInput {
                down(center); repeat(12) { advanceEventTime(30); moveBy(Offset(0f, (1 - f) * travel / 12)) }; advanceEventTime(600); up()
            }
            assertFalse("down to $f, last move down -> closed", anchored("down $f"))
        }
        dragTab(.6f, -.1f)
        assertFalse("up then back down: last direction decides", anchored("up-down"))
        dragTab(.5f, cancel = true)
        anchored("cancelled mid-drag")
        rule.onNodeWithContentDescription("A pitch panel").performTouchInput {
            repeat(9) { click(center); advanceEventTime(40) }
        }
        anchored("tap spam")
        // Taps spread over the slide: each must reverse it; nothing sticks.
        repeat(6) { k ->
            val node = if (model.pitchDrawer == A) "A lower pitch panel" else "A pitch panel"
            rule.onNodeWithContentDescription(node).performTouchInput { click(center) }
            rule.mainClock.advanceTimeBy(40L + 25 * k)
        }
        anchored("taps mid-slide")
    }

    /** VH13: every readout element sits at the same place on the card collapsed and expanded (only the card moves). */
    @Test fun pitchReadoutIsPrintedOnTheCard() {
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(3000)
        val all = listOf("pitch", "bpm", "sync", "key", "lock")
        fun present(d: String, part: String) = all.filter { rule.onAllNodesWithContentDescription("$d $it $part").fetchSemanticsNodes().isNotEmpty() }
        for (d in listOf("A", "B")) {
            rule.onNodeWithContentDescription("$d pitch panel").performTouchInput { click(center) }
            rule.mainClock.advanceTimeBy(2000)
            // The closed tab stays laid out under the risen card: compare both copies at the same data.
            val tab = box("$d pitch panel")
            val card = rule.onNodeWithContentDescription("$d lower pitch panel").fetchSemanticsNode().boundsInRoot
            assertTrue("$d card risen", card.top < tab.top - 100f)
            val parts = present(d, "tab")
            assertEquals("$d same items", parts, present(d, "card"))
            for (p in parts) {
                val c = box("$d $p tab").translate(-tab.left, -tab.top)
                val b = box("$d $p card").translate(-card.left, -card.top)
                assertEquals("$d $p left", c.left, b.left, .5f); assertEquals("$d $p top", c.top, b.top, .5f)
                assertEquals("$d $p width", c.width, b.width, .5f); assertEquals("$d $p height", c.height, b.height, .5f)
            }
            // One centre line (VH13).
            val ys = parts.map { box("$d $it card").center.y }
            assertTrue("$d centres $ys", ys.max() - ys.min() < 1.5f)
            rule.onNodeWithContentDescription("$d lower pitch panel").performTouchInput { click(center) }
            rule.mainClock.advanceTimeBy(2000)
        }
    }

    /** VH15: the browser push (portrait) moves the tab, never the readout on it. */
    @Test fun pitchReadoutHoldsStillWhileTheBrowserMoves() {
        rule.mainClock.autoAdvance = false
        // Capabilities (and with them the lock glyph) arrive late: let the readout content settle first.
        var n = 0; var last = ""; var same = 0
        while (n++ < 40 && same < 3) { rule.mainClock.advanceTimeBy(1000); val k = "${model.supports("varispeed")}${model.supports("key-lock")}${rule.onAllNodesWithContentDescription("A lock tab").fetchSemanticsNodes().size}"; if (k == last) same++ else { same = 0; last = k } }
        val all = listOf("pitch", "bpm", "sync", "key", "lock")
        fun rel(d: String): Map<String, androidx.compose.ui.geometry.Rect> {
            val tab = box("$d pitch panel")
            return all.filter { rule.onAllNodesWithContentDescription("$d $it tab").fetchSemanticsNodes().isNotEmpty() }
                .associateWith { box("$d $it tab").translate(-tab.left, -tab.top) }
        }
        val rest = listOf("A", "B").associateWith(::rel)
        val restTop = box("A pitch panel").top
        rule.runOnUiThread { model.browser = dev.manadj.audio.DeckId.A }
        for (step in 1..4) {
            rule.mainClock.advanceTimeBy(30)
            val moved = restTop - box("A pitch panel").top
            for (d in listOf("A", "B")) {
                val now = rel(d)
                assertEquals("$d items (step $step)", rest.getValue(d).keys, now.keys)
                for ((p, r) in rest.getValue(d)) { val n = now.getValue(p); assertEquals("$d $p left step $step (tab moved $moved)", r.left, n.left, .5f); assertEquals("$d $p width", r.width, n.width, .5f) }
            }
        }
        rule.runOnUiThread { model.browser = null }
        rule.mainClock.advanceTimeBy(2000)
        for (d in listOf("A", "B")) for ((p, r) in rest.getValue(d)) assertEquals("$d $p left after close", r.left, rel(d).getValue(p).left, .5f)
    }

    /** VH14: the closed tab shows no open/pressed fill after a tap cycle, a drag or a cancelled drag. */
    @Test fun pitchTabFillIsTransient() {
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(3000)
        val A = dev.manadj.audio.DeckId.A
        fun sample(): Int { val img = rule.onNodeWithContentDescription("A pitch panel").captureToImage().asAndroidBitmap(); return img.getPixel(img.width / 2, img.height * 7 / 8) }
        fun closeIfOpen() { if (model.pitchDrawer == A) { rule.onNodeWithContentDescription("A lower pitch panel").performTouchInput { click(center) } }; rule.mainClock.advanceTimeBy(2000) }
        val rest = sample()
        rule.onNodeWithContentDescription("A pitch panel").performTouchInput { click(center) }
        rule.mainClock.advanceTimeBy(2000)
        closeIfOpen()
        assertEquals("after tap cycle", rest, sample())
        rule.onNodeWithContentDescription("A pitch panel").performTouchInput { down(center); repeat(10) { advanceEventTime(30); moveBy(Offset(0f, -40f)) }; up() }
        rule.mainClock.advanceTimeBy(2000)
        closeIfOpen()
        assertEquals("after drag", rest, sample())
        rule.onNodeWithContentDescription("A pitch panel").performTouchInput { down(center); repeat(10) { advanceEventTime(30); moveBy(Offset(0f, -40f)) }; cancel() }
        rule.mainClock.advanceTimeBy(2000)
        closeIfOpen()
        assertEquals("after cancel", rest, sample())
    }
}
