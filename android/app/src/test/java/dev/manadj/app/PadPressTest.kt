package dev.manadj.app

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * #408: the pad's press feedback through the real momentaryPresses gesture — after tap, fast double tap, two-finger
 * and cancelled touches the pad settles idle (not held, ring finished, so no border is left drawn).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PadPressTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var press: PadPress
    private var releases = 0

    @Before fun start() {
        compose.setContent {
            press = rememberPadPress("A", 0)
            Box(Modifier.size(80.dp).testTag("pad").pointerInput(Unit) {
                momentaryPresses({ true }) { press.down(); { releases++; press.up() } }
            })
        }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false // real time: frames only as the clock is advanced between touches
    }

    private val pad get() = compose.onNodeWithTag("pad")
    private fun assertSettled(presses: Int) {
        compose.mainClock.advanceTimeBy(1000)
        compose.runOnUiThread {
            assertFalse("still held", press.held)
            assertEquals("ring left mid-animation (stuck border)", 1f, press.ring.value)
            assertEquals(presses, press.presses)
            assertEquals(presses, releases)
        }
    }

    /** Touch events with display frames between them (a real phone composes while the finger is down). */
    private fun touch(vararg steps: Pair<Long, androidx.compose.ui.test.TouchInjectionScope.() -> Unit>) {
        for ((wait, step) in steps) { compose.mainClock.advanceTimeBy(wait); pad.performTouchInput(step) }
    }

    @Test fun tap() { touch(0L to { down(center) }, 80L to { up() }); assertSettled(1) }

    @Test fun fastDoubleTap() {
        touch(0L to { down(center) }, 40L to { up() }, 40L to { down(center) }, 40L to { up() })
        assertSettled(2)
    }

    @Test fun twoFingers() {
        touch(0L to { down(0, center) }, 30L to { down(1, center + Offset(10f, 0f)) }, 30L to { up(0) }, 30L to { up(1) })
        assertSettled(2)
    }

    @Test fun cancelled() { touch(0L to { down(center) }, 60L to { cancel() }); assertSettled(1) }

    @Test fun longHold() { touch(0L to { down(center) }, 800L to { up() }); assertSettled(1) }
}
