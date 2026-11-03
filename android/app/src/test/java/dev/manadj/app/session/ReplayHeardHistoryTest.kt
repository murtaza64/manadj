package dev.manadj.app.session

import dev.manadj.app.Strip
import dev.manadj.library.session.SessionLog
import org.junit.Assert.*
import org.junit.Test

class ReplayHeardHistoryTest {
    private fun history(events: String, deck: Int = 0) = ReplayHeardHistory(
        SessionLog.parse("""{"uuid":"heard-index","events":$events}"""), deck,
    ) { state, d -> state.decks[d].let { Strip(it.fader.toFloat(), it.low.toFloat(), it.mid.toFloat(), it.high.toFloat(), it.stems) } }

    @Test fun pastRemainsRecordedAndUnknownFutureIsNotInvented() {
        val h = history("""[
            {"t":0,"kind":"load","channel":"A","trackId":1},
            {"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":5,"kind":"control","channel":"A","control":"eqLow","value":0},
            {"t":12,"kind":"tick","playheads":{}}
        ]""")
        assertEquals(.5f, h.at(6.0, 3.0)!!.low)
        assertEquals(0f, h.at(6.0, 5.5)!!.low)
        assertNull(h.at(6.0, 6.0))
        assertNull(h.at(6.0, 8.0))
        assertEquals(.5f, h.at(4.0, 3.0)!!.low)
        assertNull(h.at(Double.NaN, 3.0))
        assertNull(h.at(6.0, Double.NaN))
        assertNull(h.at(-1.0, 0.0))
        assertNull(h.at(13.0, 1.0))
    }

    @Test fun pausesAndForwardJumpsDoNotExtrapolateHistoryThroughUnheardGaps() {
        val h = history("""[
            {"t":0,"kind":"load","channel":"A","trackId":1},
            {"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":2,"kind":"transport","channel":"A","action":"seek","playhead":10},
            {"t":4,"kind":"transport","channel":"A","action":"pause","playhead":12},
            {"t":5,"kind":"control","channel":"A","control":"eqLow","value":0.1},
            {"t":20,"kind":"tick","playheads":{}}
        ]""")
        assertEquals(.5f, h.at(19.0, 1.0)!!.low)
        assertEquals(.5f, h.at(19.0, 11.0)!!.low)
        assertNull(h.at(19.0, 5.0))
        assertNull(h.at(19.0, 12.0))
    }

    @Test fun loopVisitsUseMostRecentHeardPassBeforeSessionTime() {
        val h = history("""[
            {"t":0,"kind":"load","channel":"A","trackId":1},
            {"t":0,"kind":"loop","channel":"A","playhead":0,"region":{"start":0,"end":4}},
            {"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":3,"kind":"control","channel":"A","control":"eqLow","value":0.1},
            {"t":9,"kind":"control","channel":"A","control":"eqLow","value":0.8},
            {"t":1000000,"kind":"tick","playheads":{}}
        ]""")
        assertEquals(.5f, h.at(2.0, 1.0)!!.low)
        assertEquals(.1f, h.at(8.5, 1.0)!!.low)
        assertEquals(.1f, h.at(9.0, 1.0)!!.low)
        assertEquals(.8f, h.at(9.01, 1.0)!!.low)
        assertEquals(.8f, h.at(999999.0, 1.0)!!.low)
        assertNull(h.at(9.5, 4.0))
    }

    @Test fun repeatedLoadOfSameTrackStartsAnIndependentOccurrence() {
        val h = history("""[
            {"t":0,"kind":"load","channel":"A","trackId":1},
            {"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":4,"kind":"control","channel":"A","control":"eqLow","value":0.1},
            {"t":5,"kind":"load","channel":"A","trackId":1},
            {"t":5,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":8,"kind":"load","channel":"A","trackId":null},
            {"t":10,"kind":"tick","playheads":{}}
        ]""")
        assertEquals(.5f, h.at(4.5, 2.0)!!.low)
        assertNull(h.at(5.0, 2.0))
        assertNull(h.at(5.1, 2.0))
        assertEquals(.1f, h.at(7.5, 2.0)!!.low)
        assertNull(h.at(8.0, 2.0))
        assertEquals(.5f, h.at(4.5, 2.0)!!.low)
    }

    @Test fun pitchBendAndBackwardTransportResolveExactTrackCoordinates() {
        val h = history("""[
            {"t":0,"kind":"load","channel":"A","trackId":1},
            {"t":0,"kind":"pitch","channel":"A","value":100},
            {"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":2,"kind":"bend","channel":"A","value":-50},
            {"t":3,"kind":"control","channel":"A","control":"eqLow","value":0.2},
            {"t":4,"kind":"transport","channel":"A","action":"seek","playhead":1},
            {"t":8,"kind":"tick","playheads":{}}
        ]""")
        assertEquals(.5f, h.at(3.5, 4.5)!!.low)
        assertEquals(.2f, h.at(5.5, 2.0)!!.low)
        assertEquals(.5f, h.at(3.5, 2.0)!!.low)
        assertNull(h.at(3.5, 5.5))
    }

    @Test fun previewsCountButSilentTenureAndUnknownScratchMotionDoNot() {
        val h = history("""[
            {"t":0,"kind":"load","channel":"A","trackId":1},
            {"t":0,"kind":"transport","channel":"A","action":"previewStart","playhead":0},
            {"t":1,"kind":"control","channel":"A","control":"fader","value":0},
            {"t":2,"kind":"control","channel":"A","control":"fader","value":1},
            {"t":3,"kind":"tenure","edge":"start","holder":"session-replay"},
            {"t":4,"kind":"tenure","edge":"end","holder":"session-replay"},
            {"t":5,"kind":"transport","channel":"A","action":"scratchBegin","playhead":5},
            {"t":6,"kind":"transport","channel":"A","action":"scratchEnd","playhead":6},
            {"t":10,"kind":"tick","playheads":{}}
        ]""")
        assertNotNull(h.at(9.0, .5))
        assertNull(h.at(9.0, 1.5))
        assertNull(h.at(9.0, 3.5))
        assertNull(h.at(9.0, 5.5))
        assertNotNull(h.at(9.0, 6.5))
    }

    @Test fun simultaneousLoadsAndDeckIsolationUseLastAcceptedOccurrence() {
        val events = """[
            {"t":0,"kind":"load","channel":"A","trackId":1},
            {"t":0,"kind":"load","channel":"B","trackId":2},
            {"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":0,"kind":"transport","channel":"B","action":"play","playhead":10},
            {"t":2,"kind":"load","channel":"A","trackId":3},
            {"t":2,"kind":"load","channel":"A","trackId":4},
            {"t":2,"kind":"transport","channel":"A","action":"play","playhead":20},
            {"t":5,"kind":"tick","playheads":{}}
        ]"""
        val a = history(events)
        val b = history(events, 1)
        assertNull(a.at(3.0, 1.0))
        assertNotNull(a.at(3.0, 20.5))
        assertNotNull(b.at(3.0, 11.0))
        assertNull(b.at(3.0, 20.5))
    }

    @Test fun reverseAndHeldTransportHaveExactExclusiveTimeBounds() {
        val h = history("""[
            {"t":0,"kind":"load","channel":"A","trackId":1},
            {"t":0,"kind":"pitch","channel":"A","value":-200},
            {"t":0,"kind":"transport","channel":"A","action":"play","playhead":10},
            {"t":2,"kind":"pitch","channel":"A","value":-100},
            {"t":5,"kind":"tick","playheads":{}}
        ]""")
        assertNotNull(h.at(1.0, 9.5))
        assertNull(h.at(1.0, 9.0))
        assertNull(h.at(2.0, 8.0))
        assertNotNull(h.at(3.0, 8.0))
        assertNull(h.at(3.0, 7.0))
    }

    @Test fun queriesNeverInvokeReducerMapperAgainAndEmptyLogsAreUnknown() {
        val log = SessionLog.parse("""{"uuid":"indexed","events":[
            {"t":0,"kind":"load","channel":"A","trackId":1},
            {"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":10,"kind":"tick","playheads":{}}
        ]}""")
        var mappings = 0
        val h = ReplayHeardHistory(log, 0) { _, _ -> mappings++; Strip() }
        assertEquals(1, mappings)
        repeat(10000) { assertNotNull(h.at(9.0, (it % 80) / 10.0)) }
        assertEquals("mapping happens only during indexing", 1, mappings)
        val empty = ReplayHeardHistory(SessionLog.parse("""{"uuid":"empty","events":[]}"""), 0) { _, _ -> Strip() }
        assertNull(empty.at(0.0, 0.0))
    }

    @Test fun latencyCannotCrossRenderedOccurrenceEvenWhenTrackIdRepeats() {
        val h = history("""[
            {"t":0,"kind":"load","channel":"A","trackId":1},
            {"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":4,"kind":"control","channel":"A","control":"eqLow","value":0.1},
            {"t":5,"kind":"load","channel":"A","trackId":1},
            {"t":5,"kind":"loop","channel":"A","playhead":3,"region":{"start":0,"end":4}},
            {"t":5,"kind":"transport","channel":"A","action":"play","playhead":3},
            {"t":12,"kind":"tick","playheads":{}}
        ]""")
        assertNull(h.at(4.91, 3.0, 5.01))
        assertNull(h.at(4.99, 3.0, 5.0))
        assertEquals(.5f, h.at(4.91, 3.0, 4.99)!!.low) // Valid latency within old occurrence.
        assertEquals(.1f, h.at(5.21, 3.1, 5.31)!!.low) // Valid latency within new occurrence.
        assertEquals(.1f, h.at(9.21, 3.1, 9.31)!!.low) // Loop wraps do not mint another Load.
        assertEquals(.5f, h.at(4.91, 3.0, 4.99)!!.low) // Seek backward, then forward, no mutable epoch cache.
        assertNull(h.at(4.91, 3.0, 5.01))
        assertNull(h.at(5.21, 3.1, Double.NaN))
    }
}
