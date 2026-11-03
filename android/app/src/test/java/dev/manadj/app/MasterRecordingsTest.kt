package dev.manadj.app

import dev.manadj.audio.MasterRecordingStatus
import org.junit.Assert.*
import org.junit.Test

class MasterRecordingsTest {
    @Test fun pendingAndActiveAreBusyButFailuresAreNotSuccess() {
        assertTrue(MasterRecordings(pending = true).busy)
        val recording = MasterRecordingStatus(1, 0, 48000 * 65L, 48000)
        assertTrue(MasterRecordings(status = recording).busy)
        assertEquals("REC 01:05", MasterRecordings(status = recording).label)
        assertFalse(recording.complete)
        for (error in 1..7) {
            val failed = MasterRecordingStatus(4, error, 48000, 48000)
            assertFalse(failed.complete)
            assertFalse(MasterRecordings(status = failed).busy)
            assertNotNull(failed.errorMessage)
        }
    }

    @Test fun rateAndCompletionAreTruthfulAndRemnantsAreVisible() {
        val complete = MasterRecordingStatus(3, 0, 44100, 44100)
        assertTrue(complete.complete)
        assertEquals(1.0, complete.seconds, 0.0)
        assertFalse(MasterRecordingStatus(3, 4, 44100, 44100).complete)
        assertEquals(0.0, MasterRecordingStatus(0, 0, 0, 0).seconds, 0.0)
        assertTrue(MasterRecordings(incomplete = 2).label!!.contains("not shareable"))
    }
}
