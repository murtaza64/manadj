package dev.manadj.app

import dev.manadj.library.GridMath
import dev.manadj.library.LadderProjection
import dev.manadj.library.LibraryTrack

/** A minimap hypermeter line: a downbeat starting an 8-bar group ([strong] = 16-bar group). */
data class HyperMark(val seconds: Double, val strong: Boolean)

/**
 * Hypermeter marks from the desktop Metric ladder (UH17): the track's Beatgrid downbeats projected through its
 * Reset marks / Ladder anchor (LadderProjection = frontend meter/ladder.ts). An 8-bar tier (32 beats in 4/4) or
 * higher, not parenthetical, gets a line; 16-bar (64 beats) is strong. Cached per (track, grid, ladder).
 */
object Hypermeter {
    private val cache = object : LinkedHashMap<Any, List<HyperMark>>(16, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Any, List<HyperMark>>) = size > 8
    }

    @Synchronized fun marks(track: LibraryTrack, duration: Double): List<HyperMark>? {
        val key = listOf(track.id, track.grid, track.ladder, track.bpm, duration)
        cache[key]?.let { return it }
        val changes = GridMath.base(track.grid, track.bpm) ?: return null
        val e = GridMath.expand(changes, duration.coerceAtLeast(1.0))
        val p = LadderProjection.resolve(changes, e.downbeats, track.ladder?.resetMarks.orEmpty(), track.ladder?.arities.orEmpty()) ?: return null
        val out = ArrayList<HyperMark>()
        for (i in e.downbeats.indices) {
            if (p.parentheticals[i] || p.tiers[i] < 3) continue
            out += HyperMark(e.downbeats[i], p.tiers[i] >= 4)
        }
        return out.also { cache[key] = it }
    }
}
