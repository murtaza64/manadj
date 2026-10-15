package dev.manadj.app

import org.junit.Assert.assertEquals
import org.junit.Test

/** UH30: settle rule — fling sign when fast, else last movement direction, else nearer anchor. */
class SheetSettleTest {
    private val h = 1000f
    @Test fun lastMovementDecidesAtAnyDistance() {
        for (offset in listOf(300f, 500f, 700f)) {
            assertEquals(true, settleOpen(0f, -1, offset, h))
            assertEquals(false, settleOpen(0f, 1, offset, h))
        }
    }
    @Test fun flingSignWins() {
        assertEquals(true, settleOpen(-2000f, 1, 900f, h))
        assertEquals(false, settleOpen(2000f, -1, 100f, h))
    }
    @Test fun noMovementTakesNearer() {
        assertEquals(true, settleOpen(0f, 0, 400f, h))
        assertEquals(false, settleOpen(0f, 0, 600f, h))
    }
}
