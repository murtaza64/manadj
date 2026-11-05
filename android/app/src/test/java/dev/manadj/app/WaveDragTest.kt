package dev.manadj.app

import org.junit.Assert.assertEquals
import org.junit.Test

/** #406: finger seek toggle on detail waves. */
class WaveDragTest {
    @Test fun defaultKeepsExistingBehaviour() {
        assertEquals(WaveDrag.SCRUB, waveDrag(true, vinyl = false, playing = true, ready = true, canScratch = true, canSeek = true))
        assertEquals(WaveDrag.SCRATCH, waveDrag(true, vinyl = false, playing = false, ready = true, canScratch = true, canSeek = true))
        assertEquals(WaveDrag.SCRATCH, waveDrag(true, vinyl = true, playing = true, ready = true, canScratch = true, canSeek = true))
    }

    @Test fun offDisablesScrubAndImplicitScratchButKeepsVinyl() {
        assertEquals(WaveDrag.NONE, waveDrag(false, vinyl = false, playing = true, ready = true, canScratch = true, canSeek = true))
        assertEquals(WaveDrag.NONE, waveDrag(false, vinyl = false, playing = false, ready = true, canScratch = true, canSeek = true))
        assertEquals(WaveDrag.SCRATCH, waveDrag(false, vinyl = true, playing = true, ready = true, canScratch = true, canSeek = true))
    }

    @Test fun notReadyDoesNothing() {
        assertEquals(WaveDrag.NONE, waveDrag(true, vinyl = true, playing = false, ready = false, canScratch = true, canSeek = true))
    }
}
