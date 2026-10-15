package dev.manadj.library.session

import org.json.JSONArray
import org.json.JSONObject
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RecordedSessionsTest {
    private fun events(vararg t: Double) = JSONArray(t.map { JSONObject().put("t", it).put("kind", "tick").put("playheads", JSONObject()) })

    @Test fun detailIsTheDesktopShapeAndParses() {
        val store = RecordedSessions(Files.createTempDirectory("rec").toFile())
        store.open("u1", "2026-10-15T07:00:00")
        store.append("u1", 0, JSONArray().put(JSONObject().put("t", 1.0).put("kind", "load").put("channel", "A").put("trackId", 7).put("bpm", 174.0)))
        store.append("u1", 1, events(2.0, 3.0))
        store.end("u1", "2026-10-15T07:10:00")
        val log = SessionLog.parse(store.detail("u1"))
        assertEquals(3, log.events.size)
        assertEquals("2026-10-15T07:10:00", store.all().single().endedAt)
    }

    @Test fun pushResumesAfterAFailureAndSendsTheEndLast() {
        val store = RecordedSessions(Files.createTempDirectory("rec").toFile())
        store.open("u1", "2026-10-15T07:00:00")
        for (s in 0 until 5) store.append("u1", s, events(s.toDouble()))
        store.end("u1", "2026-10-15T07:10:00")
        val desktop = HashSet<Int>()
        val bodies = ArrayList<JSONObject>()
        var fail = true
        val send = { b: JSONObject ->
            bodies += b
            val chunks = b.getJSONArray("chunks")
            for (i in 0 until chunks.length()) desktop += chunks.getJSONObject(i).getInt("seq")
            if (fail && desktop.size >= 2) { fail = false; throw java.io.IOException("dropped") }
            desktop.toSet() to false
        }
        assertFalse(runCatching { store.push("u1", send, batch = 2) }.getOrDefault(false))
        assertTrue(store.push("u1", send, batch = 2))
        assertEquals(setOf(0, 1, 2, 3, 4), desktop)
        assertTrue(bodies.last().has("ended_at") && bodies.dropLast(1).none { it.has("ended_at") })
        assertTrue(store.push("u1", { error("nothing left to send") }))
    }

    @Test fun crashLeftOpenSessionsAreEnded() {
        val store = RecordedSessions(Files.createTempDirectory("rec").toFile())
        store.open("u1", "2026-10-15T07:00:00")
        store.append("u1", 0, events(1.0))
        store.recover({ "now" }, { "at-last-chunk" })
        assertEquals("at-last-chunk", store.meta("u1")!!.endedAt)
    }
}
