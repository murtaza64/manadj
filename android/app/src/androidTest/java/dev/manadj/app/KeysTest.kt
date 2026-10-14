package dev.manadj.app

import org.junit.Assert.assertEquals
import org.junit.Test

class KeysTest {
    @Test fun camelotConvertsToOpenKey() {
        assertEquals("1d", toOpenKey("8B")); assertEquals("1m", toOpenKey("8A"))
        assertEquals("6m", toOpenKey("1A")); assertEquals("5d", toOpenKey("12B")); assertEquals("3m", toOpenKey("3m"))
    }
    @Test fun relationsMatchDesktop() {
        assertEquals(KeyRelation.SAME, keyRelation("5m", "5m")); assertEquals(KeyRelation.RELATIVE, keyRelation("5m", "5d"))
        assertEquals(KeyRelation.UP, keyRelation("12d", "1d")); assertEquals(KeyRelation.DOWN, keyRelation("1d", "12d"))
        assertEquals(KeyRelation.OTHER, keyRelation("1d", "2m")); assertEquals(KeyRelation.OTHER, keyRelation(null, "2m"))
    }
}
