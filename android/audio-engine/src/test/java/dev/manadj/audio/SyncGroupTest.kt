package dev.manadj.audio

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import dev.manadj.audio.DeckId.*

/** Port of frontend/src/playback/SyncGroup.test.ts (engine pitch/phase faked; snapshots fed back each step). */
class SyncGroupTest {
    private class Fake { var ready = true; var playing = false; var bpm: Double? = 120.0; var pitch = 0.0; var bend = 0.0; var source = "t"; var grid = true }
    private val decks = DeckId.entries.associateWith { Fake().apply { ready = false; bpm = null } }
    private val aligns = mutableListOf<Triple<DeckId, DeckId, Double>>()
    private var quantize = false
    private lateinit var group: SyncGroup

    private fun feed() = group.update(decks.mapValues { (_, f) -> SyncDeck(f.ready, f.playing, f.bpm, f.pitch, f.source, f.grid && f.bpm != null) })
    private fun load(deck: DeckId, bpm: Double? = 120.0) { decks.getValue(deck).apply { ready = true; this.bpm = bpm; source = "t-$deck-$bpm"; pitch = 0.0 }; feed() }
    private fun play(deck: DeckId) { decks.getValue(deck).playing = true; feed() }
    private fun pitch(deck: DeckId) = decks.getValue(deck).pitch
    private fun tempo(deck: DeckId) = decks.getValue(deck).let { effectiveBpm(it.bpm!!, it.pitch) }
    private fun toggle(deck: DeckId) = group.toggle(deck).also { feed() }
    private fun setPitch(deck: DeckId, p: Double) { group.setPitch(deck, p); feed() }
    private fun match(deck: DeckId) = group.match(deck).also { feed() }
    private val status get() = group.state.decks

    @Before fun setUp() {
        group = SyncGroup(object : SyncGroup.Actuator {
            override fun setPitch(deck: DeckId, percent: Double) { decks.getValue(deck).pitch = percent.coerceIn(-25.0, 25.0) }
            override fun alignPhase(deck: DeckId, reference: DeckId, ratio: Double) { aligns += Triple(deck, reference, ratio) }
            override val quantize get() = this@SyncGroupTest.quantize
        })
        feed()
    }

    @Test fun capturesOwnTempoWithoutAPeerThenAnyOfFourMembersRidesTheGroup() {
        for (d in DeckId.entries) load(d)
        for (d in DeckId.entries) assertTrue(toggle(d) is BpmMatch.Match)
        for (d in DeckId.entries) {
            setPitch(d, d.ordinal + 1.0)
            for (m in DeckId.entries) assertEquals(d.ordinal + 1.0, pitch(m), 1e-9)
        }
        assertEquals(DeckId.entries.associateWith { SyncStatus.SYNCED }, status)
    }

    @Test fun capturesTheNearestPlayingPeerOnceRatherThanChasingUnsyncedPitch() {
        load(A, 120.0); load(B, 124.0); load(C, 128.0)
        play(B); play(C)
        toggle(A)
        assertEquals(124.0, tempo(A), 1e-9)
        setPitch(B, 4.0)
        assertEquals(124.0, tempo(A), 1e-9)
        toggle(B)
        assertEquals(124.0, tempo(B), 1e-9)
        setPitch(B, 2.0)
        assertEquals(tempo(B), tempo(A), 1e-9)
    }

    @Test fun holdsHalfDoubleRelationshipsExcludesBendAndLeavesPitchOnDisengage() {
        load(A, 85.0); load(B, 170.0)
        toggle(A); toggle(B)
        setPitch(B, 4.0)
        assertEquals(tempo(A) * 2, tempo(B), 1e-9)
        assertEquals(88.4, group.state.tempo!!, 1e-9) // bend never enters the group
        toggle(A); setPitch(B, 1.0)
        assertEquals(4.0, pitch(A), 1e-9)
        toggle(B)
        assertNull(group.state.tempo)
        assertEquals(1.0, pitch(B), 1e-9)
    }

    @Test fun refusesAnUnreachableJoinClampsAndRecoversMembersDuringARide() {
        load(A, 100.0); load(B, 108.0); load(C, 140.0)
        toggle(B); toggle(A)
        assertEquals(BpmMatch.OutOfReach, toggle(C))
        assertEquals(SyncStatus.OFF, status[C])
        assertEquals(0.0, pitch(C), 0.0)
        setPitch(B, 8.0)
        assertEquals(8.0, pitch(A), 1e-9)
        assertEquals(SyncStatus.OUT_OF_LOCK, status[A])
        setPitch(B, 0.0)
        assertEquals(SyncStatus.SYNCED, status[A])
        assertEquals(108.0, tempo(A), 1e-9)
    }

    @Test fun retainsMembershipThroughPauseReloadMissingBpmAndLateMetadata() {
        load(A); toggle(A); setPitch(A, 4.0)
        play(A); decks.getValue(A).playing = false; feed()
        assertEquals(SyncStatus.SYNCED, status[A])
        decks.getValue(A).ready = false; feed()
        assertEquals(SyncStatus.WAITING, status[A])
        load(A, null)
        assertEquals(SyncStatus.WAITING, status[A])
        decks.getValue(A).bpm = 240.0; feed()
        assertEquals(249.6, tempo(A), 1e-9)
        assertEquals(SyncStatus.SYNCED, status[A])
        assertEquals(124.8, group.state.tempo!!, 1e-9)
        decks.getValue(A).bpm = 140.0; feed()
        assertEquals(SyncStatus.OUT_OF_LOCK, status[A])
        toggle(A)
        assertEquals(SyncStatus.OFF, status[A])
    }

    @Test fun rejectsInvalidAndEmptyDecks() {
        assertNull(toggle(A))
        load(A, null); assertNull(toggle(A)); assertNull(match(A))
    }

    @Test fun matchChangesGroupTempoWithoutDroppingMembership() {
        load(A); load(B, 124.0); load(C)
        toggle(A); toggle(C); play(B)
        match(A)
        assertEquals(124.0, group.state.tempo!!, 1e-9)
        assertEquals(124.0, tempo(C), 1e-9)
        assertEquals(SyncStatus.SYNCED, status[A])
    }

    @Test fun phaseAlignsOnlyWithQuantizeAndProjectsOctaveMembers() {
        load(A, 120.0); load(B, 60.0); load(C, 240.0)
        toggle(A); toggle(B); play(B); play(C)
        toggle(C)
        assertTrue(aligns.isEmpty())                         // Quantize off: no phase move
        toggle(C)
        quantize = true
        toggle(C)
        assertEquals(Triple(C, B, 4.0), aligns.single())     // quotient of opposite octave members (2 / 0.5)
        aligns.clear()
        setPitch(C, 2.0)
        assertTrue(aligns.isEmpty())                         // never on pitch rides
        match(A)
        assertEquals(A, aligns.single().first)
    }
}
