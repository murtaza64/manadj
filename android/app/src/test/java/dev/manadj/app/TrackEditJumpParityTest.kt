package dev.manadj.app

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * #449: the Track edit transport reuses the performance deck's JumpStrip (same shared size wheel, NO BPM label and
 * `live && ready && gridded` enabled rule) instead of its own jump keys. Source-level guard: a separate edit jump
 * vocabulary would reintroduce a grid/no-grid mismatch.
 */
class TrackEditJumpParityTest {
    private fun src(path: String) = File("src/main/java/dev/manadj/app/$path").readText()

    @Test fun editTransportUsesTheDeckJumpStrip() {
        val edit = src("edit/TrackEditScreen.kt")
        val transport = edit.substringAfter("private fun Transport(").substringBefore("\n}\n")
        assertTrue(transport.contains("JumpStrip(edit.ui, ux, model"))
        assertTrue("no bespoke BeatJump keys", !transport.contains("BeatJump") && !transport.contains("jumpBeats("))
        val strip = src("Deck.kt").substringAfter("@Composable fun JumpStrip(").substringBefore("\n}\n")
        assertTrue(strip.contains("val usable = live && ui.ready && gridded"))
    }
}
