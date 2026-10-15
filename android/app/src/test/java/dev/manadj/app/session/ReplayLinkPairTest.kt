package dev.manadj.app.session

import dev.manadj.audio.DeckId
import dev.manadj.library.session.SessionLog
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** SH7: the link toggle addresses the two most recently audible decks at the Session clock. */
class ReplayLinkPairTest {
    private fun ev(t: Double, kind: String, deck: String? = null) = JSONObject().put("t", t).put("kind", kind).apply { if (deck != null) put("channel", deck) }
    private fun fader(t: Double, d: String, v: Double) = ev(t, "control", d).put("control", "fader").put("value", v)

    @Test fun pairFollowsTheBlend() {
        val l = SessionLog.parse(JSONObject().put("uuid", "x").put("events", JSONArray(listOf(
            fader(0.0, "A", 1.0), fader(0.0, "B", 0.0), fader(0.0, "D", 0.0),
            ev(0.0, "load", "A").put("trackId", 1), ev(0.0, "load", "B").put("trackId", 2), ev(0.0, "load", "D").put("trackId", 3),
            ev(1.0, "transport", "A").put("action", "play").put("playhead", 0.0),
            ev(10.0, "transport", "B").put("action", "play").put("playhead", 0.0), fader(10.0, "B", 1.0),
            fader(20.0, "A", 0.0),
            ev(30.0, "transport", "D").put("action", "play").put("playhead", 0.0), fader(30.0, "D", 1.0),
            ev(60.0, "tick").put("playheads", JSONObject()),
        ))).toString())
        assertNull(replayLinkPair(l, l.at(5.0), 5.0))
        assertEquals(DeckId.A to DeckId.B, replayLinkPair(l, l.at(15.0), 15.0))
        assertEquals(DeckId.A to DeckId.B, replayLinkPair(l, l.at(25.0), 25.0)) // A just went out: still the last blend
        assertEquals(DeckId.B to DeckId.D, replayLinkPair(l, l.at(35.0), 35.0))
    }
}
