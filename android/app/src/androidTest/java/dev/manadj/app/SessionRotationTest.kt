package dev.manadj.app

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import dev.manadj.app.session.SessionModel
import dev.manadj.library.session.SessionHeader
import dev.manadj.library.session.SessionLog
import dev.manadj.library.session.SyntheticSession
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #378 human bug: rotating the phone paused Session replay. Replay lives in [SessionModel] (survives the
 * Activity); rotating twice must leave it playing with a continuous clock. No compose idling (the timeline
 * animates every frame while playing): ActivityScenario + polling only.
 */
class SessionRotationTest {
    private lateinit var scenario: ActivityScenario<MainActivity>

    @After fun cleanup() { scenario.onActivity { ViewModelProvider(it)[SessionModel::class.java].close(); it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }; scenario.close() }

    private fun <T> onMain(f: (MainActivity) -> T): T { var out: T? = null; scenario.onActivity { out = f(it) }; @Suppress("UNCHECKED_CAST") return out as T }
    private fun session() = onMain { ViewModelProvider(it)[SessionModel::class.java] }
    private fun waitFor(ms: Long, what: String, ok: () -> Boolean) {
        val until = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < until) { if (ok()) return; Thread.sleep(50) }
        throw AssertionError("timed out: $what")
    }
    private fun rotate(orientation: Int, want: Int) {
        scenario.onActivity { it.requestedOrientation = orientation }
        waitFor(15_000, "orientation $want") { onMain { it.resources.configuration.orientation == want && !it.isChangingConfigurations } }
        Thread.sleep(1500) // recreated Activity composes the Session screen again
    }

    @Test fun replayKeepsPlayingThroughTwoRotations() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
        waitFor(20_000, "engine output") { onMain { ViewModelProvider(it)[PlayerModel::class.java].output?.outputSampleRate?.let { r -> r > 0 } == true } }
        // Track ids of the synthetic Session are not in this Library: loads fail, the clock still runs (that is what this test watches).
        val log = SessionLog.parse(SyntheticSession.json(seed = 3, seconds = 7200.0, tracks = 4))
        val model = session()
        runBlocking { withContext(kotlinx.coroutines.Dispatchers.Main) { model.show(SessionHeader(log.uuid, null, "2026-01-01T00:00:00", 0), log) } }
        scenario.onActivity { ViewModelProvider(it)[UiModel::class.java].sessions = true; model.play(ViewModelProvider(it)[PlayerModel::class.java]) }
        waitFor(10_000, "replay playing") { onMain { model.playing } }
        Thread.sleep(1000)
        for ((orientation, want) in listOf(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE to Configuration.ORIENTATION_LANDSCAPE, ActivityInfo.SCREEN_ORIENTATION_PORTRAIT to Configuration.ORIENTATION_PORTRAIT)) {
            val t0 = onMain { model.time }; val epoch = onMain { model.replayEpoch }
            assertTrue("epoch before rotation to $want (playing=${onMain { model.playing }} time=$t0 start=${log.activeStart} end=${log.end})", epoch != null)
            rotate(orientation, want)
            assertTrue("same SessionModel after rotation", session() === model)
            assertTrue("still playing after rotation to $want (preparing=${onMain { model.preparing }})", onMain { model.playing })
            // Continuous: the same replay epoch (no re-prepare, no restart), so Session time is still
            // epoch + audio frames; and the clock moved on. (Wall-time deltas are useless on a starved emulator.)
            assertTrue("same replay epoch through rotation to $want", onMain { model.replayEpoch } === epoch)
            waitFor(5_000, "clock advances after rotation to $want") { onMain { model.time } > t0 + .5 }
        }
    }
}
