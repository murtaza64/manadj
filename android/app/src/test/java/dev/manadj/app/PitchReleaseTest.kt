package dev.manadj.app

import org.junit.Assert.*
import org.junit.Test

/** VH12 release rule: direction of the last movement decides; position only breaks a dead tie. */
class PitchReleaseTest {
    @Test fun flickDirectionWins() {
        assertTrue(releaseOpens(v = 3f, lastUp = -1f, at = .1f))
        assertFalse(releaseOpens(v = -3f, lastUp = 1f, at = .9f))
    }
    @Test fun slowReleaseFollowsLastMove() {
        for (at in listOf(.3f, .5f, .7f)) {
            assertTrue("up at $at", releaseOpens(v = 0f, lastUp = 2f, at = at))
            assertFalse("down at $at", releaseOpens(v = 0f, lastUp = -2f, at = at))
        }
    }
    @Test fun deadTieUsesPosition() {
        assertTrue(releaseOpens(0f, 0f, .7f)); assertFalse(releaseOpens(0f, 0f, .3f))
    }
}
