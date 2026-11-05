package dev.manadj.app.session

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.LooperMode

/** #486 distinguishes raw display source, replay reference, and measured actual raster displacement. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w800dp-h600dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
class SessionPausedDeckDiagnosticsTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun pausedDeckWithoutRecordedChangesIsStableWhileOtherDeckAdvances() {
        SessionFrameHarness(compose).use { scene ->
            val result = scene.profile(SessionFrameFixture(2, pausedFirst = true, pastRaster = true, compactEvidence = true))
            result.report("paused-clean-control")
            assertTrue(result.frames.last().otherReplaySource - result.frames.first().otherReplaySource > 1)
            assertTrue(result.frames.all { it.renderedSource == 10.0 && it.replaySource == 10.0 })
            assertEquals(1, result.frames.map { it.rasterHash }.distinct().size)
            assertTrue(result.frames.all { it.rasterShiftPx == 0 })
        }
    }

    @Test fun pausedTickEvidenceMustNotMoveTheWaveformWhenReplaySourceDoesNotMove() {
        SessionFrameHarness(compose).use { scene ->
            val result = scene.profile(SessionFrameFixture(2, pausedFirst = true, pausedTickNoise = .02, pastRaster = true, compactEvidence = true))
            result.report("paused-tick-evidence")
            assertTrue(result.frames.last().otherReplaySource - result.frames.first().otherReplaySource > 1)
            assertTrue("replay never acted on those evidence ticks", result.frames.all { it.replaySource == 10.0 })
            println("PAUSED-DIAG renderedSources=${result.frames.map { it.renderedSource }.distinct()} rasterHashes=${result.frames.map { it.rasterHash }.distinct().size} rasterShifts=${result.frames.map { it.rasterShiftPx }.distinct()}")
            assertTrue("display source must match the paused replay reference without invented motion", result.frames.all { it.renderedSource == it.replaySource })
            assertEquals("paused actual waveform raster must not jitter on evidence-only ticks", 1, result.frames.map { it.rasterHash }.distinct().size)
        }
    }

    @Test fun intentionalRecordedSeekWhilePausedStillMovesTheWaveform() {
        SessionFrameHarness(compose).use { scene ->
            val result = scene.profile(SessionFrameFixture(2, pausedFirst = true,
                pausedSeeks = listOf(600.8 to 12.0, 601.5 to 9.0), pastRaster = true, compactEvidence = true))
            result.report("paused-intentional-seeks")
            assertTrue("intentional moves follow the recorded action at the published frame time", result.frames.all {
                it.renderedSource == when {
                    it.captureTime >= 601.5 -> 9.0
                    it.captureTime >= 600.8 -> 12.0
                    else -> 10.0
                }
            })
            assertTrue(result.frames.any { it.renderedSource == 12.0 })
            assertTrue(result.frames.any { it.renderedSource == 9.0 })
            assertTrue("intentional recorded paused movement must remain visible", result.frames.map { it.rasterHash }.distinct().size > 1)
        }
    }
}
