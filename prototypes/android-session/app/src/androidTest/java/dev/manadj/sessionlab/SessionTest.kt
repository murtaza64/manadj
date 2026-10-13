package dev.manadj.sessionlab

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SessionTest {
    private fun asset(name: String) = InstrumentationRegistry.getInstrumentation().targetContext.assets.open(name).bufferedReader().use { it.readText() }
    private fun fixture() = Session.parse(asset("session.json"))

    @Test fun reconstructedFourDeckStatesMatchDesktopAtTwentyBoundaries() {
        val session = fixture()
        val expected = JSONArray(asset("expected.json"))
        for (i in 0 until expected.length()) {
            val sample = expected.getJSONObject(i)
            val t = sample.getDouble("t")
            val frame = session.at(t)
            val expectedState = sample.getJSONObject("state")
            for (ch in DECKS) {
                val actual = frame.decks.getValue(ch)
                val wanted = expectedState.getJSONObject("decks").getJSONObject(ch)
                val message = "Desktop parity at $t deck $ch"
                assertEquals("$message track", if (wanted.isNull("trackId")) null else wanted.getInt("trackId"), actual.trackId)
                assertEquals("$message position", wanted.getDouble("playhead"), actual.position, 1e-8)
                assertEquals("$message playing", wanted.getBoolean("playing"), actual.playing)
                assertEquals("$message audible", wanted.getBoolean("audible"), frame.audible(ch))
                assertEquals("$message pitch", wanted.getDouble("pitch"), actual.pitch, 1e-8)
                assertEquals("$message fader", wanted.getDouble("fader"), actual.fader, 1e-8)
            }
        }
    }
    @Test fun seeksRebuildStateWithoutCarryingFutureControlsBackwards() {
        val session = fixture()
        val model = PlaybackModel(session, Session.tracks(asset("tracks.json")))
        model.seek(208.0)
        assertFalse(session.at(model.time).audible("D"))
        model.seek(130.0)
        assertTrue(DECKS.all { session.at(model.time).audible(it) })
        assertEquals(82.08, session.at(model.time).decks.getValue("A").position, 1e-8)
    }
    @Test fun loopAndPreviewFollowRecordedSourcePositions() {
        val session = fixture()
        assertEquals(25.0, session.at(137.0).decks.getValue("C").position, 1e-8)
        assertTrue(session.at(155.0).decks.getValue("A").preview)
        assertFalse(session.at(155.0).decks.getValue("A").playing)
        assertEquals(20.0, session.at(157.0).decks.getValue("A").position, 1e-8)
    }
    @Test fun fourDeckOverlapAndRepeatedLoadsRemainSeparateOccurrences() {
        val session = fixture()
        assertTrue(DECKS.all { session.at(130.0).audible(it) })
        assertEquals(8, session.appearances.size)
        assertEquals(listOf(101,105), session.appearances.filter { it.deck == "A" }.map { it.trackId })
        assertNull(session.at(204.0).decks.getValue("B").trackId)
    }
    @Test fun pauseSelectionAndEndShareOneClock() {
        val session = fixture()
        val model = PlaybackModel(session, emptyMap())
        model.select(session.appearances[3])
        assertEquals(124.0, model.time, 0.0)
        model.advance(3.0)
        assertEquals(124.0, model.time, 0.0)
        model.toggle(); model.advance(2.0)
        assertEquals(126.0, model.time, 0.0)
        model.seek(219.0); model.advance(3.0)
        assertEquals(220.0, model.time, 0.0); assertFalse(model.playing)
    }
    @Test fun unsupportedEventsAndVersionsAreRefusedWithoutReplacingSession() {
        val original = asset("session.json")
        val versioned = JSONObject(original).put("version", 2)
        assertThrows(IllegalArgumentException::class.java) { Session.parse(versioned.toString()) }
        val scratch = JSONObject(original)
        scratch.getJSONArray("events").getJSONObject(1).put("action", "scratchBegin")
        assertThrows(IllegalArgumentException::class.java) { Session.parse(scratch.toString()) }
        val unordered = JSONObject(original)
        unordered.getJSONArray("events").getJSONObject(2).put("t", 0)
        assertThrows(IllegalArgumentException::class.java) { Session.parse(unordered.toString()) }
    }
    @Test fun importingAnotherSessionDoesNotReuseLibraryScopedTrackMetadata() {
        val model = PlaybackModel(fixture(), Session.tracks(asset("tracks.json")))
        model.toggle()
        model.replace(fixture())
        assertTrue(model.tracks.isEmpty()); assertFalse(model.playing)
        assertEquals(100.0, model.time, 0.0)
    }
    @Test fun activeFxIsRefusedRatherThanLosingItsAudibleTail() {
        val root = JSONObject(asset("session.json"))
        root.getJSONArray("events").put(JSONObject("""{"t":220,"kind":"beatFx","on":true,"selected":"echo","target":"master","depth":0,"beats":1}"""))
        assertThrows(IllegalArgumentException::class.java) { Session.parse(root.toString()) }
    }
    @Test fun loadDoesNotInventPauseAndEqualTimeTransportWinsInCaptureOrder() {
        val root = JSONObject(asset("session.json"))
        root.put("events", JSONArray("""[
            {"t":10,"kind":"load","channel":"A","trackId":101,"bpm":128},
            {"t":10,"kind":"transport","channel":"A","action":"play","playhead":8},
            {"t":11,"kind":"load","channel":"A","trackId":102,"bpm":128},
            {"t":12,"kind":"transport","channel":"A","action":"pause","playhead":1},
            {"t":13,"kind":"tick","playheads":{"A":1}}
        ]"""))
        val s = Session.parse(root.toString())
        assertTrue(s.at(11.5).decks.getValue("A").playing)
        assertEquals(.5, s.at(11.5).decks.getValue("A").position, 0.0)
        assertFalse(s.at(12.0).decks.getValue("A").playing)
    }
}
