package dev.manadj.app

import dev.manadj.app.browse.LibrarySort
import dev.manadj.app.browse.LibraryTrack
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScrubberTest {
    private fun t(i: Int, title: String = "t", bpm: Double? = null) = LibraryTrack(i.toLong(), title, "", bpm, null, emptyList(), null, null, null, null, null)

    @Test fun lettersOnlyWhereRowsExist() {
        val rows = listOf("Alpha", "Apex", "Bravo", "Zulu").mapIndexed { i, s -> t(i, s) }
        assertEquals(listOf("A", "B", "Z"), waypoints(rows, LibrarySort.TITLE, 0f).map { it.label })
        assertEquals(listOf(0, 2, 3), waypoints(rows, LibrarySort.TITLE, 0f).map { it.row })
    }

    @Test fun thinningKeepsBiggerSectionsAndSpacing() {
        // 900 rows at 170s, then 100 split across 10 BPM tens: thinned to >= 5 % apart.
        val rows = List(900) { t(it, bpm = 172.0) } + List(100) { t(900 + it, bpm = 60.0 + (it / 10) * 10) }.sortedByDescending { it.bpm }
        val w = waypoints(rows.sortedBy { it.bpm }, LibrarySort.BPM, .05f)
        assertTrue(w.any { it.label == "170" })
        w.zipWithNext().forEach { (a, b) -> assertTrue((b.row - a.row) / 1000f >= .05f) }
    }

    @Test fun playOrderMilestones() {
        val rows = List(300) { t(it) }
        assertEquals("1", waypoints(rows, LibrarySort.PLAY_ORDER, 0f).first().label)
        assertEquals("#42", preciseOf(rows[41], 41, LibrarySort.PLAY_ORDER))
    }
}
