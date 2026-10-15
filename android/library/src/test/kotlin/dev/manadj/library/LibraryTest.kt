package dev.manadj.library

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FilterTest {
    private val tracks = listOf(
        track(1, title = "Alpha", artist = "Sub Focus", bpm = 174.0, key = "8m", energy = 3, tags = listOf(1, 2), added = 10),
        track(2, title = "Beta", artist = "Camo", bpm = 87.0, key = "9m", energy = null, tags = listOf(2), added = 30),
        track(3, title = "Gamma", artist = null, bpm = null, key = null, energy = 5, tags = emptyList(), added = 20),
    )

    private fun ids(q: LibraryQuery) = LibraryFilter.apply(tracks, q).map { it.id }

    @Test fun defaultIsNewestFirst() = assertEquals(listOf(2, 3, 1), ids(LibraryQuery()))
    @Test fun searchTitleArtistFileName() {
        assertEquals(listOf(1), ids(LibraryQuery(search = "sub foc")))
        assertEquals(listOf(3), ids(LibraryQuery(search = "gamma.MP3")))
    }
    @Test fun tagsAnyAll() {
        assertEquals(listOf(2, 1), ids(LibraryQuery(tagIds = setOf(1, 2))))
        assertEquals(listOf(1), ids(LibraryQuery(tagIds = setOf(1, 2), tagMatch = TagMatch.ALL)))
    }
    @Test fun bpmFoldsAndExcludesMissing() = assertEquals(listOf(2, 1), ids(LibraryQuery(bpmCenter = 172.0, bpmPercent = 2.0)))
    @Test fun energyFullRangeKeepsNull() {
        assertEquals(3, ids(LibraryQuery(energy = 1..5)).size)
        assertEquals(listOf(3, 1), ids(LibraryQuery(energy = 3..5)))
    }
    @Test fun keys() = assertEquals(listOf(2), ids(LibraryQuery(keysOpenKey = setOf("9m"))))
    @Test fun sortNullsLast() {
        assertEquals(listOf(2, 1, 3), ids(LibraryQuery(sort = SortColumn.BPM, descending = false)))
        assertEquals(listOf(1, 2, 3), ids(LibraryQuery(sort = SortColumn.BPM)))
        assertEquals(listOf(1, 2, 3), ids(LibraryQuery(sort = SortColumn.TITLE, descending = false)))
    }
}

class PlaylistTest {
    private val lib = Library(
        snapshot(
            listOf(track(1, artist = null, bpm = 170.0, added = 3), track(2, artist = null, bpm = 174.0, added = 1), track(3, artist = null, bpm = 172.0, added = 2), track(4, artist = null)),
            playlists = listOf(Playlist(9, "Peak", null, 1, listOf(3, 1, 99, 2)), Playlist(8, "Warm", "#00ff00", 0, emptyList())),
            links = listOf(1 to 3, 3 to 4),
        ),
    )

    @Test fun orderedByDisplayOrder() = assertEquals(listOf("Warm", "Peak"), lib.playlists.map { it.name })
    @Test fun playOrderDropsUnknownMembers() = assertEquals(listOf(3, 1, 2), lib.playlistTracks(9).map { it.id })
    @Test fun queryWithinPlaylist() {
        assertEquals(listOf(3, 1, 2), lib.query(LibraryQuery(playlistId = 9, sort = SortColumn.PLAY_ORDER, descending = false)).map { it.id })
        assertEquals(listOf(1, 3, 2), lib.query(LibraryQuery(playlistId = 9, sort = SortColumn.BPM, descending = false)).map { it.id })
        assertEquals(listOf(3, 2), lib.query(LibraryQuery(playlistId = 9, sort = SortColumn.PLAY_ORDER, descending = false, bpmCenter = 173.0, bpmPercent = 1.0)).map { it.id })
    }
    @Test fun followWithinPlaylist() {
        assertEquals(listOf(1, 4), lib.follow(listOf(3)).map { it.track.id })
        assertEquals(listOf(1), lib.follow(listOf(3), within = LibraryQuery(playlistId = 9)).map { it.track.id })
    }
}

class MatchScoreTest {
    @Test fun keyRelations() {
        assertEquals(MatchScore.KeyRelation.SAME, MatchScore.keyRelation("8m", "8m"))
        assertEquals(MatchScore.KeyRelation.RELATIVE, MatchScore.keyRelation("8m", "8d"))
        assertEquals(MatchScore.KeyRelation.UP, MatchScore.keyRelation("12m", "1m"))
        assertEquals(MatchScore.KeyRelation.DOWN, MatchScore.keyRelation("1d", "12d"))
        assertEquals(MatchScore.KeyRelation.OTHER, MatchScore.keyRelation("1d", "2m"))
        assertEquals(MatchScore.KeyRelation.OTHER, MatchScore.keyRelation(null, "2m"))
    }
    @Test fun sharedArtistTokens() {
        assertTrue(MatchScore.sharedArtist("Sub Focus", "Sub Focus feat. Kele"))
        assertTrue(MatchScore.sharedArtist("Camo & Krooked", "Camo and Krooked"))
        assertTrue(MatchScore.sharedArtist("Noisia", "Noisa"))
        assertFalse(MatchScore.sharedArtist("Noisia", "Phace"))
    }
    @Test fun ladders() {
        assertEquals(0.5, MatchScore.tagContribution(2))
        assertEquals(1.06, MatchScore.tagContribution(6), 1e-9)
        assertEquals(1.0, MatchScore.bpmContribution(174.0, 87.5, 5.0))
        assertEquals(0.0, MatchScore.bpmContribution(174.0, 190.0, 5.0))
        assertEquals(15.0, MatchScore.AFFINITY_FLOOR)
    }
}

class FollowTest {
    private val ref = track(1, artist = "Ref", key = "8m", tags = listOf(1, 2, 3))
    private val compatibleKey = track(2, artist = "X", key = "9m")
    private val clash = track(3, artist = "Y", key = "3d")
    private val linked = track(4, artist = "Z", key = "3d", bpm = 120.0)
    private val favorited = track(5, artist = "W", bpm = 90.0)
    private val observed = track(6, artist = "V", bpm = 140.0)
    private val tagged = track(7, artist = "U", tags = listOf(1, 2, 3))
    private val savedCameo = track(8, artist = "T")
    private val offTempo = track(9, artist = "S", key = "8m", bpm = 150.0)
    private val all = listOf(ref, compatibleKey, clash, linked, favorited, observed, tagged, savedCameo, offTempo)

    private val lib = Library(
        snapshot(
            all,
            links = listOf(1 to 4),
            transitions = listOf(TransitionEdge(1, 5, 1, true), TransitionEdge(4, 1, 1, false)),
            cameos = listOf(CameoEdge(1, 8, 1, false)),
            takes = listOf(TakeEdge(1, 6, 3, Instant.EPOCH), TakeEdge(1, 3, 1, Instant.EPOCH)),
        ),
    )

    @Test fun tiersInOrder() {
        val rows = lib.follow(listOf(1))
        // Desktop parity: Known = favorited transition > linked > saved transition; cameos and Takes are not Known.
        assertEquals(listOf(KnownKind.FAVORITED_TRANSITION, KnownKind.LINKED), rows.take(2).map { it.known })
        assertTrue(rows.drop(2).all { it.tier == EvidenceTier.COMPATIBLE && it.known == null })
        assertFalse(rows.any { it.tier == EvidenceTier.OBSERVED })
        val tagged = rows.single { it.track.id == 7 }
        assertEquals(setOf(1, 2, 3), tagged.matchedTagIds)
        assertTrue(rows.single { it.track.id == 2 }.keyMatched)
        assertEquals("Compatible", tagged.label)
        assertEquals(null, rows.first().displayScore) // Known rows show no score
        assertEquals(tagged.score, tagged.breakdown!!.total, 1e-12)
    }

    @Test fun knownOnly() = assertEquals(listOf(5, 4), lib.follow(listOf(1), FollowParams(knownOnly = true)).map { it.track.id })

    @Test fun temperatureRerollKeepsKnownPinned() {
        val calm = lib.follow(listOf(1)).map { it.track.id }
        val hot = (0L..20L).map { seed -> lib.follow(listOf(1), FollowParams(temperature = 1.0, seed = seed)).map { it.track.id } }
        assertTrue(hot.all { it.take(2) == listOf(5, 4) && it.toSet() == calm.toSet() })
        assertTrue(hot.distinct().size > 1) // rerolls actually redraw
        assertEquals(hot[3], lib.follow(listOf(1), FollowParams(temperature = 1.0, seed = 3)).map { it.track.id }) // deterministic
    }

    @Test fun bpmGateOffAdmitsOffTempo() = assertTrue(9 in lib.follow(listOf(1), FollowParams(bpm = false)).map { it.track.id })

    @Test fun withinManualFilters() = assertEquals(listOf(4), lib.follow(listOf(1), within = LibraryQuery(search = "Track 4")).map { it.track.id })

    @Test fun marksFromDeckTrack() {
        assertEquals(RowMarks(TransitionMark.FAVORITED, false), lib.marks(1, 5))
        assertEquals(RowMarks(TransitionMark.NONE, true), lib.marks(1, 4))
        assertEquals(RowMarks(TransitionMark.SAVED, true), lib.marks(4, 1))
        assertEquals(RowMarks.NONE, lib.marks(null, 4))
    }

    @Test fun multiReferenceBestPositionWins() {
        val rows = lib.follow(listOf(1, 4))
        assertFalse(rows.any { it.track.id == 1 || it.track.id == 4 })
        assertEquals(5, rows.first().track.id)
    }
}

class WaveformTest {
    @Test fun parsesMwf1() {
        val wf = PreviewWaveform.parse(mwf1())
        assertEquals(4, wf.bins)
        assertEquals(300.0, wf.durationSecs)
        assertEquals(0f, wf.amplitude(0))
        assertEquals(1f, wf.amplitude(3))
        assertEquals((64 / 255.0) * (64 / 255.0), wf.amplitude(1).toDouble(), 1e-6)
        assertEquals(3, wf.threeBand(1).size)
    }

    @Test fun parsesPack() {
        val blob = mwf1()
        val pack = java.io.ByteArrayOutputStream().apply {
            write("MPK1".toByteArray())
            write(java.nio.ByteBuffer.allocate(12).order(java.nio.ByteOrder.LITTLE_ENDIAN).putInt(1).putInt(42).putInt(blob.size).array())
            write(blob)
        }.toByteArray()
        val parsed = PreviewPack.parse(pack)
        assertEquals(setOf(42), parsed.keys)
        assertTrue(parsed.getValue(42).contentEquals(blob))
    }

    @Test fun rejectsGarbage() {
        assertNull(runCatching { PreviewWaveform.parse(ByteArray(100)) }.getOrNull())
    }
}
