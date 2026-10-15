package dev.manadj.app.browse

import java.time.LocalDate
import kotlin.math.*
import kotlin.random.Random

/** Deterministic fixture rows standing in for #372 (no files: rows have uri = null and say so when loaded). */
object FixtureLibrary : LibrarySource {
    override val label = "FIXTURE · #372 pending"
    private val tagSet = listOf(
        TrackTag("rolling", "vibe", 0xff00e5ff.toInt()), TrackTag("liquid", "genre", 0xff2dff6a.toInt()), TrackTag("neuro", "genre", 0xffff2d2d.toInt()),
        TrackTag("vocal", "element", 0xffffe600.toInt()), TrackTag("dark", "vibe", 0xffa855f7.toInt()), TrackTag("anthem", "energy", 0xffff8a00.toInt()),
        TrackTag("minimal", "vibe", 0xff3d6aff.toInt()), TrackTag("jungle", "genre", 0xffff5cc8.toInt()),
    )
    private val names = listOf(
        "Neon Drive" to "Kessler", "After Hours" to "Halogen", "Subterranean" to "Mora", "Glass Signal" to "Ventral", "Overpass" to "Kessler",
        "Lowlight" to "Tamsin Rye", "Fracture Line" to "Ostra", "Kinetic" to "Halogen", "Night Bus" to "Polar Arc", "Amber" to "Mora",
        "Pressure Point" to "Ventral", "Saltwater" to "Tamsin Rye", "Hollow" to "Ostra", "Crosstown" to "Polar Arc", "Daybreak" to "Lumen",
        "Static Bloom" to "Lumen", "Iron Lung" to "Ostra", "Weightless" to "Tamsin Rye", "Undertow" to "Mora", "Afterimage" to "Halogen",
    )
    private val keys = (1..12).flatMap { listOf("${it}A", "${it}B") }
    private val rows: List<LibraryTrack> = names.mapIndexed { i, (title, artist) ->
        val r = Random(i * 7919)
        val bins = 96
        fun lane(scale: Float, phase: Float) = FloatArray(bins) { b -> val x = b / bins.toFloat(); (scale * (0.35f + 0.65f * abs(sin(x * 9f + phase))) * (if (x in 0.3f..0.45f) .35f else 1f) * (0.75f + .25f * r.nextFloat())).coerceIn(0f, 1f) }
        LibraryTrack(
            id = i + 1L, title = title, artist = artist,
            bpm = listOf(172.0, 174.0, 170.0, 175.0, 86.0, 140.0, 174.0, 173.0)[i % 8] + (i % 3) * .5,
            key = keys[(i * 5) % keys.size], tags = tagSet.shuffled(r).take(1 + i % 3),
            dateAdded = LocalDate.of(2026, 10, 1).minusDays((i * 3).toLong()), durationSeconds = 240.0 + r.nextInt(150), energy = 3 + i % 6,
            preview = WaveformPreview(bins, lane(.8f, i * .3f), lane(.6f, i * .7f), lane(.45f, i * 1.1f)), uri = null,
        )
    }
    private val lists = listOf(
        LibraryPlaylist(100, "GIGS", null, folder = true),
        LibraryPlaylist(101, "Warehouse 10·03", 100, false, listOf(3, 7, 1, 12, 9, 16, 5)),
        LibraryPlaylist(102, "Rooftop warmup", 100, false, listOf(14, 2, 10, 18, 6)),
        LibraryPlaylist(103, "Liquid rollers", null, false, listOf(15, 4, 20, 8, 11, 13)),
        LibraryPlaylist(104, "Peak time", null, false, listOf(7, 17, 3, 19, 1)),
    )
    override fun playlists() = lists
    override fun tracks() = rows
    override fun allTags() = tagSet
    override fun follow(references: Set<Long>): List<FollowCandidate> {
        if (references.isEmpty()) return emptyList()
        val best = mutableMapOf<Long, FollowCandidate>()
        for (ref in references) {
            val reference = rows.firstOrNull { it.id == ref } ?: continue
            for (t in rows) {
                if (t.id == ref) continue
                val r = Random(ref * 31 + t.id)
                val known = r.nextFloat() < .18f
                val bpmOk = reference.bpm != null && t.bpm != null && listOf(t.bpm, t.bpm * 2, t.bpm / 2).any { abs(it - reference.bpm) <= 6 }
                if (!known && !bpmOk) continue
                val c = if (known) FollowCandidate(t.id, EvidenceTier.KNOWN, "◆ Saved transition", null)
                    else FollowCandidate(t.id, EvidenceTier.COMPATIBLE, "Compatible", (20 + r.nextInt(70)).toDouble())
                val prev = best[t.id]
                if (prev == null || c.tier.ordinal < prev.tier.ordinal) best[t.id] = c
            }
        }
        return best.values.sortedWith(compareBy({ it.tier.ordinal }, { -(it.displayScore ?: 0.0) }))
    }
}
