package dev.manadj.library.session

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals

class SessionListTest {
    private fun h(uuid: String, start: String, end: String?) = SessionHeader(uuid, start, end, 0)
    private val ny = ZoneId.of("America/New_York")
    private val now = Instant.parse("2026-10-15T04:00:00Z")

    @Test fun groupsByLocalDayNewestFirstLongestFirst() {
        val rows = listOf(
            h("short", "2026-10-14T20:00:00", "2026-10-14T20:10:00"),
            h("long", "2026-10-14T21:00:00", "2026-10-14T23:00:00"),
            // 02:00Z on the 15th is still the 14th in New York (naive = UTC).
            h("late", "2026-10-15T02:00:00", "2026-10-15T02:30:00"),
            h("older", "2026-10-12T18:00:00+00:00", "2026-10-12T19:00:00+00:00"),
        )
        val days = groupSessionsByDay(rows, ny, now)
        assertEquals(listOf(LocalDate.of(2026, 10, 14), LocalDate.of(2026, 10, 12)), days.map { it.day })
        assertEquals(listOf("long", "late", "short"), days[0].sessions.map { it.uuid })
    }

    @Test fun openSessionRunsToNowAndTiesBreakNewestFirst() {
        val rows = listOf(h("a", "2026-10-15T03:00:00", "2026-10-15T03:30:00"), h("b", "2026-10-15T03:30:00", null))
        assertEquals(1800, sessionSeconds(rows[1], now))
        assertEquals(listOf("b", "a"), groupSessionsByDay(rows, ZoneId.of("UTC"), now)[0].sessions.map { it.uuid })
    }

    @Test fun lengthLabelsMatchDesktop() {
        assertEquals(listOf("45s", "12m", "2h 05m"), listOf(45L, 750L, 7500L).map(::sessionLengthLabel))
    }
}
