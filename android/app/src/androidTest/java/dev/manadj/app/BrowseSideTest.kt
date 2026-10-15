package dev.manadj.app

import dev.manadj.audio.DeckId
import org.junit.Assert.assertEquals
import org.junit.Test

class BrowseSideTest {
    private fun deck(id: DeckId, playing: Boolean = false, loaded: Boolean = true, fader: Double = 1.0, xf: Double = 1.0, low: Double = .5, filter: Double = 0.0, at: Long? = 1) =
        DeckMix(id, loaded, playing, fader, xf, low, filter, at)

    @Test fun oneAudibleDeckIsCovered() {
        assertEquals(DeckId.B, coveredDeck(deck(DeckId.A), deck(DeckId.B, playing = true)))
        assertEquals(DeckId.A, coveredDeck(deck(DeckId.A, playing = true), deck(DeckId.B, playing = true, fader = 0.0)))
        assertEquals(DeckId.A, coveredDeck(deck(DeckId.A, playing = true), deck(DeckId.B, playing = true, xf = 0.0)))
    }

    @Test fun bothAudibleCoversTheBassCutDeck() {
        assertEquals(DeckId.A, coveredDeck(deck(DeckId.A, playing = true, low = .1), deck(DeckId.B, playing = true)))
        assertEquals(DeckId.B, coveredDeck(deck(DeckId.A, playing = true), deck(DeckId.B, playing = true, filter = .6)))
    }

    @Test fun similarBassFallsBackToLeastRecentlyLoaded() {
        assertEquals(DeckId.B, coveredDeck(deck(DeckId.A, playing = true, low = .48, at = 20), deck(DeckId.B, playing = true, at = 10)))
    }

    @Test fun nothingAudibleKeepsTheEmptyDeckVisible() {
        assertEquals(DeckId.A, coveredDeck(deck(DeckId.A), deck(DeckId.B, loaded = false, at = null)))
        assertEquals(DeckId.A, coveredDeck(deck(DeckId.A, at = 5), deck(DeckId.B, at = 9)))
    }
}
