package dev.manadj.app.session

import dev.manadj.audio.AudioCommand
import dev.manadj.library.session.ReplayEpoch
import dev.manadj.library.session.SessionLog
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** #378 replay start / track entry latency: decode time hidden without ever starting a deck off its stamped frame. */
class ReplayDriverTest {
    private fun ev(t: Double, kind: String, deck: String? = null) = JSONObject().put("t", t).put("kind", kind).apply { if (deck != null) put("channel", deck) }
    private fun log(vararg events: JSONObject) = SessionLog.parse(JSONObject().put("uuid", "t").put("events", JSONArray(events.toList())).toString())

    /** Engine stand-in: the output clock advances by [advance]; loads progress only when the test says so. */
    private class Fake : ReplayDriver.Engine {
        var frames = 0L
        override val sampleRate = 48000
        val scheduled = ArrayList<Pair<Long, List<AudioCommand>>>()
        val loads = ArrayList<Pair<Int, Int>>()
        val loadsAt = ArrayList<Long>()
        val state = HashMap<Int, ReplayDriver.Load>()
        val held = HashMap<Int, Int>()
        override fun outputFrames() = frames
        override fun schedule(frame: Long, commands: List<AudioCommand>, tag: Long): Boolean { scheduled += frame to commands; return true }
        override fun cancel(tag: Long) {}
        override fun submit(command: AudioCommand) {}
        override fun holds(deck: Int) = held[deck]
        override fun startLoad(deck: Int, trackId: Int) { loads += deck to trackId; loadsAt += frames; state[deck] = ReplayDriver.Load.Pending }
        override fun load(deck: Int, trackId: Int) = state[deck] ?: ReplayDriver.Load.Pending
    }

    private fun run(driver: ReplayDriver, fake: Fake, seconds: Double, step: Double = .05, each: () -> Unit = {}) {
        var wall = 0.0
        repeat((seconds / step).toInt()) { fake.frames += (step * 48000).toLong(); wall += step; each(); driver.tick(wall) }
    }

    @Test fun playWaitsOnlyForDecksThatSoundSoon() {
        val l = log(
            ev(0.0, "load", "A").put("trackId", 1), ev(0.0, "load", "B").put("trackId", 2),
            ev(0.0, "transport", "A").put("action", "play").put("playhead", 0.0),
            ev(60.0, "transport", "B").put("action", "play").put("playhead", 0.0),
            ev(120.0, "tick").put("playheads", JSONObject()),
        )
        val fake = Fake(); val driver = ReplayDriver(l, fake)
        driver.prepare(0.0)
        fake.state[0] = ReplayDriver.Load.Ready // B never finishes decoding
        run(driver, fake, 1.0)
        assertTrue("clock runs without B", driver.playing)
        assertEquals(ReplayDriver.Deck.LOADING, driver.decks[1])
        fake.state[1] = ReplayDriver.Load.Ready
        run(driver, fake, .5)
        assertEquals(ReplayDriver.Deck.LIVE, driver.decks[1])
    }

    @Test fun sessionLoadIsIssuedWhenItsDeckGoesSilentAndPlacedAtItsStampedFrame() {
        val l = log(
            ev(0.0, "load", "A").put("trackId", 1),
            ev(0.0, "transport", "A").put("action", "play").put("playhead", 0.0),
            ev(10.0, "transport", "A").put("action", "pause").put("playhead", 10.0),
            ev(40.0, "load", "A").put("trackId", 2),
            ev(40.0, "transport", "A").put("action", "seek").put("playhead", 30.0),
            ev(41.0, "transport", "A").put("action", "play").put("playhead", 30.0),
            ev(90.0, "tick").put("playheads", JSONObject()),
        )
        val fake = Fake(); val driver = ReplayDriver(l, fake)
        fake.held[0] = 1; fake.state[0] = ReplayDriver.Load.Ready
        driver.prepare(0.0)
        run(driver, fake, 15.0)
        val e = driver.epoch; assertNotNull(e)
        assertEquals("track 2 requested right after the deck went silent", listOf(0 to 2), fake.loads)
        assertTrue(e!!.timeAt(fake.loadsAt.single()) in 10.0..10.5)
        // Decoded only up to 20 s of the track; it must cover what it plays (30 s+): not ready yet.
        fake.state[0] = ReplayDriver.Load.Partial(20.0)
        run(driver, fake, 20.0)
        assertFalse(fake.scheduled.any { (f, c) -> e.timeAt(f) in 15.0..39.99 && c.any { it is AudioCommand.SetLoopRegion } })
        fake.state[0] = ReplayDriver.Load.Partial(60.0)
        run(driver, fake, 10.0)
        // Placed exactly at the Load's frame (not "now"), at the reference position for that frame.
        val place = fake.scheduled.first { (f, c) -> e.timeAt(f) >= 39.0 && c.any { it is AudioCommand.SetLoopRegion } }
        assertEquals(e.frameOf(40.0), place.first)
        assertEquals(30.0, (place.second.first { it is AudioCommand.SetLoopRegion } as AudioCommand.SetLoopRegion).playhead!!, 1e-9)
        assertTrue(fake.scheduled.any { (f, c) -> f == e.frameOf(41.0) && c.any { it is AudioCommand.Play } })
        assertEquals("never reloaded at the Load itself", 1, fake.loads.size)
    }

    @Test fun lateDeckJoinsAtAStampedFrameWithTheReferencePositionThere() {
        val l = log(
            ev(0.0, "load", "A").put("trackId", 1),
            ev(0.0, "transport", "A").put("action", "play").put("playhead", 0.0),
            ev(5.0, "load", "B").put("trackId", 2),
            ev(5.0, "transport", "B").put("action", "play").put("playhead", 0.0),
            ev(60.0, "tick").put("playheads", JSONObject()),
        )
        val fake = Fake(); val driver = ReplayDriver(l, fake)
        fake.held[0] = 1; fake.state[0] = ReplayDriver.Load.Ready
        driver.prepare(0.0)
        run(driver, fake, 8.0)
        fake.state[1] = ReplayDriver.Load.Ready // B ready ~3 s after it should have started
        run(driver, fake, 1.0)
        val e = driver.epoch!!
        val place = fake.scheduled.first { (_, c) -> c.any { it is AudioCommand.SetLoopRegion && it.deck == dev.manadj.audio.DeckId.B } }
        val at = e.timeAt(place.first)
        val p = (place.second.first { it is AudioCommand.SetLoopRegion } as AudioCommand.SetLoopRegion).playhead!!
        assertEquals("position is the reference at the stamped frame (catch up exactly)", at - 5.0, p, 1.0 / 48000)
    }

    @Test fun pumpAheadKeepsOpsStampedWhileTicksStall() {
        val l = log(
            ev(0.0, "load", "A").put("trackId", 1),
            ev(0.0, "transport", "A").put("action", "play").put("playhead", 0.0),
            *(1..60).map { ev(it.toDouble(), "control", "A").put("control", "fader").put("value", (it % 2).toDouble()) }.toTypedArray(),
            ev(70.0, "tick").put("playheads", JSONObject()),
        )
        val fake = Fake(); val driver = ReplayDriver(l, fake)
        fake.held[0] = 1; fake.state[0] = ReplayDriver.Load.Ready
        driver.prepare(0.0)
        run(driver, fake, 1.0)
        val e = driver.epoch!!
        // The UI thread stalls for 10 s (no tick); the background pump alone keeps the lookahead.
        repeat(200) { fake.frames += 2400; driver.pumpAhead() }
        val now = e.timeAt(fake.frames)
        val last = fake.scheduled.maxOf { e.timeAt(it.first) }
        assertTrue("stamped through %.2f at %.2f".format(last, now), last >= now + ReplayDriver.LOOKAHEAD - ReplayDriver.WINDOW - 1.0)
    }

    @Test fun partialDecodeIsReadyJustAheadOfThePlayheadUnlessAJumpOutrunsTheDecode() {
        // A plays from 240 s of its track; at t=6 it hot-cues to 400 s.
        val l = log(
            ev(0.0, "load", "A").put("trackId", 1),
            ev(0.0, "transport", "A").put("action", "play").put("playhead", 240.0),
            ev(6.0, "transport", "A").put("action", "hotCue").put("playhead", 400.0).put("detail", 1),
            ev(60.0, "tick").put("playheads", JSONObject()),
        )
        // Decode measured at 20x: by t=6 it is 120 s further, far short of 400 -> waits for the jump target.
        val fake = Fake(); val driver = ReplayDriver(l, fake)
        driver.prepare(0.0)
        var decoded = 230.0
        run(driver, fake, 3.0) { decoded += 1.0; fake.state[0] = ReplayDriver.Load.Partial(decoded) } // 20 s/s
        assertTrue("decoded %.0f: the jump to 400 s at t=6 needs ~343 s now".format(decoded), driver.preparing)
        run(driver, fake, 3.0) { decoded = minOf(decoded + 30.0, 600.0); fake.state[0] = ReplayDriver.Load.Partial(decoded) }
        assertTrue(driver.playing)
        // Without the jump, 243 s decoded is enough (was playhead + 10 s horizon + 2 s = 252 s).
        val plain = log(
            ev(0.0, "load", "A").put("trackId", 1),
            ev(0.0, "transport", "A").put("action", "play").put("playhead", 240.0),
            ev(60.0, "tick").put("playheads", JSONObject()),
        )
        val fake2 = Fake(); val driver2 = ReplayDriver(plain, fake2)
        driver2.prepare(0.0)
        var d2 = 236.0
        run(driver2, fake2, .5) { d2 += 1.0; fake2.state[0] = ReplayDriver.Load.Partial(d2) }
        assertTrue("decoded %.0f".format(d2), driver2.playing)
    }
}
