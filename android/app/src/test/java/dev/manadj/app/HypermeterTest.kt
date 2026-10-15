package dev.manadj.app

import dev.manadj.library.Beatgrid
import dev.manadj.library.LibraryTrack
import dev.manadj.library.MetricLadder
import dev.manadj.library.SnapshotJson
import dev.manadj.library.TempoChange
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.abs

class HypermeterTest {
    /** Drop anchor: grid origin 0.37, Reset mark on the drop at bar 37 → lines on the drop and every 8 bars from it. */
    @Test fun resetMarkSetsThePhase() {
        val bar = 60.0 / 174 * 4
        val origin = .37
        val drop = origin + 36 * bar
        val t = synthetic(origin, listOf(drop))
        val m = Hypermeter.marks(t, 300.0)!!
        assertTrue(m.any { abs(it.seconds - drop) < 1e-6 && it.strong })
        assertTrue(m.any { abs(it.seconds - (drop - 8 * bar)) < 1e-6 })
        assertTrue(m.none { abs(it.seconds - (origin + 32 * bar)) < 1e-6 }) // grid-origin phase would put one here
    }

    /** The human's synced library (pulled from the phone): hot cues should mostly sit on lines. */
    @Test fun realLibraryCuesLandOnLines() {
        val f = File(SNAPSHOT); if (!f.isFile) return
        val snap = SnapshotJson.parse(f.readText())
        var cues = 0; var on = 0; var tracks = 0; var oldOn = 0; var on4 = 0
        for (t in snap.tracks) {
            val d = t.durationSecs ?: continue
            val m = Hypermeter.marks(t, d) ?: continue
            if (t.hotCues.isEmpty()) continue
            tracks++
            val bpm = t.bpm ?: continue
            val anchor = t.grid?.anchorTime ?: t.grid?.tempoChanges?.firstOrNull()?.startTime ?: 0.0
            for (c in t.hotCues) {
                cues++; if (m.any { abs(it.seconds - c.time) < .05 }) on++
                val k = (c.time - anchor) / (60.0 / bpm * 32); if (abs(k - Math.round(k)) * 60.0 / bpm * 32 < .05) oldOn++
                val k4 = (c.time - anchor) / (60.0 / bpm * 16); if (abs(k4 - Math.round(k4)) * 60.0 / bpm * 16 < .05) on4++
            }
        }
        println("hypermeter: $tracks tracks, ladder $on / $cues on an 8-bar line (${100 * on / maxOf(1, cues)}%); UH12 anchor rule $oldOn (${100 * oldOn / maxOf(1, cues)}%); on any 4-bar step from anchor $on4 (${100 * on4 / maxOf(1, cues)}%)")
        assertTrue(cues == 0 || on * 2 > cues)
    }

    private fun synthetic(origin: Double, marks: List<Double>): LibraryTrack {
        val base = SnapshotJson.parse(File(SNAPSHOT).takeIf { it.isFile }?.readText() ?: MINIMAL).tracks.first()
        return base.copy(bpm = 174.0, grid = Beatgrid("edited", origin, listOf(TempoChange(origin, 174.0, 4, 1))), ladder = MetricLadder(emptyList(), marks))
    }

    companion object {
        val SNAPSHOT: String = System.getProperty("manadj.snapshot") ?: "/Users/murtaza/manadj/.editspace/lanes/android-performance-365-apk/repos/murtaza64/manadj/.lane-tmp/snapshot.json"
        const val MINIMAL = """{"version":1,"categories":[],"tags":[],"playlists":[],"tracks":[{"id":1,"title":"t","file_name":"f","tag_ids":[],"hot_cues":[]}]}"""
    }
}
