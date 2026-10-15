package dev.manadj.app

import dev.manadj.audio.BeatFxEffect
import dev.manadj.audio.BeatFxState
import dev.manadj.audio.BeatFxTarget
import dev.manadj.audio.DeckId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeckPersistenceTest {
    private val library = SavedDeck(
        source = SavedSource("library:12:3", "Track", "Artist", 312.5, file = "/data/user/0/x/files/12.m4a", bpm = 174.0,
            firstBeatSeconds = .12, mainCueSeconds = 1.5, hotCues = mapOf(0 to 2.0, 3 to 40.25), stems = listOf("/s/v", "/s/d", "/s/b", "/s/o")),
        position = 63.21, cue = 1.5, hotCues = listOf(2.0, null, null, 40.25, null, null, null, null),
        loopStart = 60.0, loopEnd = 61.38, pitch = -2.5, keyLock = true,
        fader = .8, trim = .55, eq = listOf(.5, .2, .9), filter = -.3, pfl = true, stemGains = listOf(1.0, 0.0, 1.0, 1.0),
    )
    private val local = SavedDeck(
        source = SavedSource("content://media/1", "Local", "", null, uri = "content://media/1"),
        position = -4.0, cue = null, hotCues = List(8) { null }, loopStart = null, loopEnd = null, pitch = 0.0, keyLock = false,
        fader = 1.0, trim = .5, eq = listOf(.5, .5, .5), filter = 0.0, pfl = false, stemGains = List(4) { 1.0 },
    )

    @Test fun roundTrip() {
        val session = SavedSession(
            mapOf(DeckId.A to library, DeckId.B to local), crossfade = .3, cueMix = .7,
            beatFx = BeatFxState(BeatFxEffect.REVERB, BeatFxTarget.MASTER, true, .25, 2.0, setOf(DeckId.B)),
        )
        assertEquals(session, DeckPersistence.decode(DeckPersistence.encode(session)))
    }

    @Test fun garbageDecodesToNull() {
        assertNull(DeckPersistence.decode(null))
        assertNull(DeckPersistence.decode("{"))
        assertNull(DeckPersistence.decode("""{"v":2}"""))
    }
}
