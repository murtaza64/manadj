package dev.manadj.app

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import dev.manadj.audio.DeckId
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** #404: the real SHIFT key gesture against the real UiModel shift state. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE) // same mode as the other Compose UI tests sharing this JVM
class ShiftKeyTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var ux: UiModel
    private val a = DeckId.A

    @Before fun start() {
        ux = ViewModelProvider(compose.activity, ViewModelProvider.AndroidViewModelFactory(RuntimeEnvironment.getApplication()))[UiModel::class.java]
        compose.setContent { ShiftKey(a, ux, Modifier.size(80.dp, 40.dp)) }
    }

    private val key get() = compose.onNodeWithContentDescription("A shift")
    private fun tap() = key.performTouchInput { down(center); up() }
    /** What a shifted action does (pad delete, stem solo): consume SHIFT. */
    private fun shiftedAction() = compose.runOnIdle { assertTrue(ux.shifted(a)); ux.consumeShift(a) }

    @Test fun tapShiftsExactlyOneAction() {
        tap()
        shiftedAction()
        compose.runOnIdle { assertFalse(ux.shifted(a)) }
    }

    /** The reported stick: SHIFT tapped and the cue deleted while the finger is still on SHIFT (a fast roll). */
    @Test fun actionDuringAShortShiftPressDoesNotLatchOnRelease() {
        key.performTouchInput { down(center) }
        shiftedAction()
        key.performTouchInput { up() }
        compose.runOnIdle { assertFalse("SHIFT stuck after the delete it shifted", ux.shifted(a)) }
    }

    @Test fun tapAgainCancelsALatch() {
        tap(); tap()
        compose.runOnIdle { assertFalse(ux.shifted(a)) }
    }

    @Test fun slideLocksUntilTapped() {
        key.performTouchInput { down(center); moveBy(androidx.compose.ui.geometry.Offset(width * .9f, 0f)); up() }
        repeat(3) { shiftedAction() }
        compose.runOnIdle { assertTrue("locked SHIFT survives actions", ux.shifted(a)) }
        tap()
        compose.runOnIdle { assertFalse(ux.shifted(a)) }
    }

    @Test fun holdIsMomentary() {
        key.performTouchInput { down(center); advanceEventTime(600); up() }
        compose.runOnIdle { assertFalse(ux.shifted(a)) }
    }
}
