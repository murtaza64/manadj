package dev.manadj.app

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import dev.manadj.app.onehand.OneHand
import dev.manadj.app.onehand.OneHandLayout
import dev.manadj.audio.DeckId
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.util.UUID
import kotlin.math.cos
import kotlin.math.sin

/**
 * #386 human bug: with a one-hand layout active, CUE hold-to-preview failed on an MP3 whose main cue sits on a
 * hot cue (hot-cue stabs worked). Each layout's CUE must take the standard path: hold = preview from the cue
 * (position advances, previewing), release = back at the cue, cue untouched. The track is an MP3 loaded like a
 * library track (cues applied right after Prepare, while the decode is still running = the ring path).
 */
class OneHandCueTest {
    @get:Rule val rule = createEmptyComposeRule()
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var model: PlayerModel
    private var file: File? = null
    private val cue = 66.21

    private fun onMain(action: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(action)
    private fun await(description: String, timeoutMs: Long = 30_000, condition: () -> Boolean) {
        val deadline = System.nanoTime() + timeoutMs * 1_000_000
        while (System.nanoTime() < deadline) { var ok = false; onMain { ok = condition() }; if (ok) return; Thread.sleep(25) }
        fail("Timed out: $description; A=${model.decks.getValue(DeckId.A).snapshot} failure=${model.failure}")
    }

    private fun open(layout: OneHandLayout) {
        val ctx = InstrumentationRegistry.getInstrumentation()
        OneHand.init(ctx.targetContext); OneHand.layout = layout; OneHand.focus = DeckId.A
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { model = ViewModelProvider(it)[PlayerModel::class.java] }
        await("native output opens") { model.output?.outputSampleRate?.let { it > 0 } == true }
        val f = File(ctx.targetContext.cacheDir, "onehand-cue-${UUID.randomUUID()}.mp3").also { file = it; it.writeBytes(ctx.context.assets.open("cue-at-hotcue.mp3").readBytes()) }
        onMain { model.updateFader(DeckId.A, 0.0); model.load(DeckId.A, f, "library:9001:1", "Cue at hot cue", "Decoy", 72.0, bpm = 170.0, firstBeatSeconds = .35, mainCueSeconds = cue, hotCues = mapOf(3 to cue)) }
        await("A ready, parked at the main cue") { model.decks.getValue(DeckId.A).let { it.ready && it.snapshot?.cueSeconds == cue && it.snapshot?.hotCues?.get(3) == cue } }
    }

    @After fun close() {
        if (::scenario.isInitialized) { onMain { OneHand.layout = OneHandLayout.STANDARD }; scenario.close() }
        file?.delete()
    }

    /** Hold CUE (press on [node] at [at]), check the preview runs, release, check the deck is back at the untouched cue. */
    private fun holdCue(node: SemanticsNodeInteraction, at: (TouchInjectionScope.() -> Offset)? = null) {
        val a = model.decks.getValue(DeckId.A)
        val cueBefore = a.snapshot!!.cueSeconds
        node.performTouchInput { down(at?.invoke(this) ?: center) }
        await("preview running from the cue", 5_000) { a.snapshot?.let { it.previewing && it.sourceSeconds > cue + .2 } == true }
        Thread.sleep(600)
        onMain { assertTrue("still previewing", a.snapshot!!.previewing); assertEquals("cue untouched while previewing", cueBefore!!, a.snapshot!!.cueSeconds!!, 1e-9) }
        node.performTouchInput { up() }
        await("released: parked back at the cue", 5_000) { a.snapshot?.let { !it.previewing && !it.playing && kotlin.math.abs(it.sourceSeconds - cue) < .01 } == true }
        assertEquals("cue untouched", cueBefore!!, a.snapshot!!.cueSeconds!!, 1e-9)
        assertEquals("hot cue 4 untouched", cue, a.snapshot!!.hotCues[3]!!, 1e-9)
    }

    @Test fun standardLayoutCueHoldPreviews() { open(OneHandLayout.STANDARD); holdCue(rule.onAllNodesWithContentDescription("A CUE").onFirst()) }

    @Test fun focusLayoutCueHoldPreviews() { open(OneHandLayout.FOCUS); holdCue(rule.onAllNodesWithContentDescription("A CUE").onFirst()) }

    @Test fun chordsLayoutCueHoldPreviews() { open(OneHandLayout.CHORDS); holdCue(rule.onAllNodesWithContentDescription("A CUE").onFirst()) }

    @Test fun ringsLayoutCueHoldPreviews() {
        open(OneHandLayout.RINGS)
        // CUE sector: ring 126–190 dp from the pivot (bottom-right corner + 10 dp), sweep t = .74 (0 = along the bottom edge, 1 = up).
        holdCue(rule.onNodeWithContentDescription("Ring zone")) {
            val d = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.density
            val r = 158 * d; val a = .74 * Math.PI / 2
            Offset(width + 10 * d - (r * cos(a)).toFloat(), height + 10 * d - (r * sin(a)).toFloat())
        }
    }

    /** After a hot-cue stab on the same position (the human's sequence), CUE still previews. */
    @Test fun focusLayoutCueAfterHotCueStab() {
        open(OneHandLayout.FOCUS)
        val pad = rule.onAllNodesWithContentDescription("A hotcue 4").onFirst()
        pad.performTouchInput { down(center) }; Thread.sleep(400); pad.performTouchInput { up() }
        await("back at hot cue 4") { model.decks.getValue(DeckId.A).snapshot?.let { !it.previewing && kotlin.math.abs(it.sourceSeconds - cue) < .01 } == true }
        holdCue(rule.onAllNodesWithContentDescription("A CUE").onFirst())
    }
}
