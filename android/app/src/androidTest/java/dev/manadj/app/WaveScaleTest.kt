package dev.manadj.app

import dev.manadj.audio.DeckId
import org.junit.Assert.assertEquals
import org.junit.Test

/** #49/#60: detail waves share one wall-clock scale; window = zoom × tempo rate (bend excluded). */
class WaveScaleTest {
    private val zoom = 12.0; private val width = 1000.0
    private fun deck(id: DeckId, pitch: Double, bend: Double = 0.0) = DeckUi(id).apply { this.pitch = pitch; this.bend = bend }
    private fun pxPerTrackSecond(d: DeckUi) = width / (zoom * tempoRate(d))

    @Test fun syncedDecksAtDifferentBpmsShareGridSpacingAndScrollSpeed() {
        val a = deck(DeckId.A, 0.0)                 // 170 BPM native
        val b = deck(DeckId.B, (170.0 / 174 - 1) * 100) // 174 BPM pitched to 170
        assertEquals(pxPerTrackSecond(a) * 60 / 170, pxPerTrackSecond(b) * 60 / 174, 1e-6)
        assertEquals(pxPerTrackSecond(a) * playbackRate(a), pxPerTrackSecond(b) * playbackRate(b), 1e-6) // px per wall-second
    }

    @Test fun bendMovesButDoesNotRescale() {
        val a = deck(DeckId.A, 2.0); val bent = deck(DeckId.A, 2.0, bend = 4.0)
        assertEquals(pxPerTrackSecond(a), pxPerTrackSecond(bent), 1e-9)
        assert(playbackRate(bent) > playbackRate(a))
    }
}
