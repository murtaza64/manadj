package dev.manadj.library.session

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset

/** Session list model (desktop sessionsListModel.ts): local-day groups, newest day first, longest Session first. */
data class SessionDay(val day: LocalDate, val sessions: List<SessionHeader>)

/** Desktop ISO time; naive strings are UTC (desktop sessionDate). */
fun sessionInstant(iso: String?): Instant? = iso?.let {
    runCatching { OffsetDateTime.parse(it).toInstant() }.getOrNull()
        ?: runCatching { LocalDateTime.parse(it).toInstant(ZoneOffset.UTC) }.getOrNull()
}

/** Wall-clock length; an open Session runs to [now]. */
fun sessionSeconds(h: SessionHeader, now: Instant = Instant.now()): Long {
    val a = sessionInstant(h.startedAt) ?: return 0
    val b = if (h.endedAt == null) now else sessionInstant(h.endedAt) ?: return 0
    return maxOf(0L, b.epochSecond - a.epochSecond)
}

fun groupSessionsByDay(headers: List<SessionHeader>, zone: ZoneId = ZoneId.systemDefault(), now: Instant = Instant.now()): List<SessionDay> =
    headers.groupBy { sessionInstant(it.startedAt)?.atZone(zone)?.toLocalDate() ?: LocalDate.MIN }
        .map { (day, list) ->
            SessionDay(day, list.sortedWith(compareByDescending<SessionHeader> { sessionSeconds(it, now) }
                .thenByDescending { sessionInstant(it.startedAt) ?: Instant.MIN }.thenBy { it.uuid }))
        }
        .sortedByDescending { it.day }

/** Distinct tracks that became Master-audible, in order of first sound (desktop deriveTimeline.audibleTrackIds). */
val SessionLog.audibleTrackIds: List<Int>
    get() = appearances.filter { it.firstSound != null }.sortedBy { it.firstSound }.map { it.trackId }.distinct()

/** Desktop list duration label: 45s, 12m, 2h 05m. */
fun sessionLengthLabel(seconds: Long): String = when {
    seconds < 60 -> "${seconds}s"
    seconds < 3600 -> "${seconds / 60}m"
    else -> "%dh %02dm".format(seconds / 3600, seconds % 3600 / 60)
}
