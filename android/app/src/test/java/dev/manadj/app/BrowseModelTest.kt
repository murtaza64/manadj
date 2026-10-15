package dev.manadj.app

import dev.manadj.app.browse.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowseModelTest {
    private fun t(id: Long, bpm: Double? = null, key: String? = null) = LibraryTrack(id, "t$id", "", bpm, key, emptyList(), null, null, null, null, null)

    @Test fun keyOrderIsDesktopEngineId() {
        assertEquals(0, keyOrder("1d")); assertEquals(1, keyOrder("1m")); assertEquals(7, keyOrder("4m"))
        assertEquals(keyOrder("1m"), keyOrder("8A")) // Camelot input
    }

    @Test fun nullsLastBothDirectionsAndStableTies() {
        val rows = listOf(t(1, 170.0), t(2, null), t(3, 174.0), t(4, 170.0))
        assertEquals(listOf(3L, 1, 4, 2), sortRows(rows, LibrarySort.BPM, true).map { it.id })
        assertEquals(listOf(1L, 4, 3, 2), sortRows(rows, LibrarySort.BPM, false).map { it.id })
    }

    @Test fun playOrderNeverResortsOnlyReverses() {
        val rows = listOf(t(5), t(2), t(9))
        assertEquals(listOf(5L, 2, 9), sortRows(rows, LibrarySort.PLAY_ORDER, false).map { it.id })
        assertEquals(listOf(9L, 2, 5), sortRows(rows, LibrarySort.PLAY_ORDER, true).map { it.id })
    }

    @Test fun pathsResolveThroughFoldersAndTags() {
        val lib = FixtureLibrary
        assertEquals(listOf(BrowseNode.Root, BrowseNode.Playlists(null), BrowseNode.Playlists(100), BrowseNode.Playlist(101)), lib.pathTo(BrowseNode.Playlist(101)))
        assertEquals(listOf(BrowseNode.Root, BrowseNode.Tags, BrowseNode.TagCategory("genre"), BrowseNode.Tag("genre", "liquid")), lib.pathTo(BrowseNode.Tag("genre", "liquid")))
        for (n in listOf(BrowseNode.Playlist(101), BrowseNode.Tag("genre", "liquid"), BrowseNode.Playlists(100), BrowseNode.Follow)) assertEquals(n, BrowseNode.parse(n.key))
    }

    @Test fun tagTierCountsMatchTrackRows() {
        val lib = FixtureLibrary
        val f = LibraryFilter()
        for (cat in lib.children(BrowseNode.Tags, f, emptyList())) for (tag in lib.children(cat.node, f, emptyList()))
            assertEquals(tag.count, lib.rows(tag.node, f, null, emptyList()).size)
        assertTrue(lib.children(BrowseNode.Root, f, emptyList()).first().count == lib.tracks().size)
    }
}
