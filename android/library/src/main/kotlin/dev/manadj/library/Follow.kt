package dev.manadj.library

import java.time.Instant
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Match score — a port of desktop frontend/src/follow/matchScore.ts and
 * sharedArtist.ts. Keep the constants in lockstep with the desktop.
 */
object MatchScore {
    const val W_TAGS = 30.0
    const val W_KEY = 25.0
    const val W_ARTIST = 20.0
    const val W_ENERGY = 15.0
    const val W_BPM = 10.0
    val TAG_LADDER = doubleArrayOf(0.0, 0.3, 0.5, 0.9, 1.0)
    const val TAG_TAIL_STEP = 0.03
    const val BPM_FLAT_PERCENT = 2.0
    const val ARTIST_SIMILARITY_THRESHOLD = 0.8

    enum class KeyRelation(val bonus: Double) { SAME(1.0), RELATIVE(0.8), UP(0.7), DOWN(0.6), OTHER(0.0) }

    /** The weakest compatible key relation's earnings — the Affinity floor. */
    val AFFINITY_FLOOR = W_KEY * KeyRelation.DOWN.bonus

    private fun parseOpenKey(openKey: String?): Pair<Int, Char>? {
        val m = Regex("^(\\d+)([md])$").matchEntire(openKey ?: return null) ?: return null
        return m.groupValues[1].toInt() to m.groupValues[2][0]
    }

    fun keyRelation(reference: String?, candidate: String?): KeyRelation {
        val ref = parseOpenKey(reference) ?: return KeyRelation.OTHER
        val cand = parseOpenKey(candidate) ?: return KeyRelation.OTHER
        if (cand.first == ref.first) return if (cand.second == ref.second) KeyRelation.SAME else KeyRelation.RELATIVE
        if (cand.second != ref.second) return KeyRelation.OTHER
        val up = if (ref.first == 12) 1 else ref.first + 1
        val down = if (ref.first == 1) 12 else ref.first - 1
        return when (cand.first) { up -> KeyRelation.UP; down -> KeyRelation.DOWN; else -> KeyRelation.OTHER }
    }

    fun tagContribution(shared: Int): Double = when {
        shared <= 0 -> 0.0
        shared < TAG_LADDER.size -> TAG_LADDER[shared]
        else -> TAG_LADDER.last() + (shared - (TAG_LADDER.size - 1)) * TAG_TAIL_STEP
    }

    fun energyContribution(reference: Int?, candidate: Int?): Double {
        if (reference == null || candidate == null) return 0.0
        return when (candidate - reference) { 0 -> 1.0; 1 -> 0.9; -1 -> 0.7; else -> 0.0 }
    }

    fun foldedBpmDistancePercent(reference: Double, candidate: Double): Double =
        listOf(reference, reference * 2, reference / 2).minOf { abs(candidate - it) / it * 100 }

    fun bpmContribution(reference: Double?, candidate: Double?, thresholdPercent: Double): Double {
        if (reference == null || candidate == null || reference <= 0 || candidate <= 0) return 0.0
        val d = foldedBpmDistancePercent(reference, candidate)
        if (d <= BPM_FLAT_PERCENT) return 1.0
        if (d >= thresholdPercent) return 0.0
        return 1 - (d - BPM_FLAT_PERCENT) / (thresholdPercent - BPM_FLAT_PERCENT)
    }

    fun sharedTags(reference: LibraryTrack, candidate: LibraryTrack): Set<Int> =
        candidate.tagIds.filterTo(HashSet()) { it in reference.tagIds }

    fun affinity(reference: LibraryTrack, candidate: LibraryTrack): Double =
        W_KEY * keyRelation(reference.keyOpenKey, candidate.keyOpenKey).bonus +
            W_TAGS * tagContribution(sharedTags(reference, candidate).size) +
            W_ARTIST * (if (sharedArtist(reference.artist, candidate.artist)) 1.0 else 0.0)

    fun score(reference: LibraryTrack, candidate: LibraryTrack, bpmThresholdPercent: Double, affinity: Double = affinity(reference, candidate)): Double =
        affinity + W_ENERGY * energyContribution(reference.energy, candidate.energy) +
            W_BPM * bpmContribution(reference.bpm, candidate.bpm, bpmThresholdPercent)

    // ── Shared artist ──

    private val SEPARATORS = Regex("\\bfeat\\.?\\b|\\bfeaturing\\b|\\bft\\.?\\b|\\bvs\\.?\\b|\\band\\b|\\bx\\b|[&,+]", RegexOption.IGNORE_CASE)
    private val NON_WORD = Regex("[^\\p{L}\\p{N} ]")
    private val SPACES = Regex("\\s+")

    fun artistTokens(artist: String?): List<String> {
        if (artist.isNullOrEmpty()) return emptyList()
        return artist.lowercase().replace(SEPARATORS, "\u0000").split('\u0000')
            .map { it.replace(NON_WORD, "").replace(SPACES, " ").trim() }
            .filter { it.length > 1 }
    }

    private fun levenshtein(a: String, b: String): Int {
        if (a == b) return 0
        var previous = IntArray(b.length + 1) { it }
        for (i in 1..a.length) {
            val current = IntArray(b.length + 1)
            current[0] = i
            for (j in 1..b.length) {
                current[j] = min(min(previous[j] + 1, current[j - 1] + 1), previous[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
            }
            previous = current
        }
        return previous[b.length]
    }

    private fun similar(a: String, b: String): Boolean {
        val maxLen = max(a.length, b.length)
        if (maxLen == 0) return false
        return 1 - levenshtein(a, b).toDouble() / maxLen >= ARTIST_SIMILARITY_THRESHOLD
    }

    fun sharedArtist(a: String?, b: String?): Boolean {
        val ta = artistTokens(a)
        if (ta.isEmpty()) return false
        val tb = artistTokens(b)
        return ta.any { x -> tb.any { y -> similar(x, y) } }
    }
}

/** Known strength, strongest first (CONTEXT.md Known; a pair takes its best). */
enum class KnownKind(val label: String) {
    FAVORITED_TRANSITION("★ Favorited transition"),
    FAVORITED_CAMEO("★ Favorited cameo"),
    LINKED("🔗 Linked"),
    SAVED_TRANSITION("◆ Saved transition"),
    SAVED_CAMEO("◆ Saved cameo"),
}

enum class EvidenceTier { KNOWN, OBSERVED, COMPATIBLE }

data class FollowParams(
    /** BPM gate on/off (Compatible tier only). */
    val bpm: Boolean = true,
    val bpmThresholdPercent: Double = 5.0,
    /** Narrow to the Known tier. */
    val knownOnly: Boolean = false,
    /** Observed Take-count floor (tunable heuristic, nominally 2). */
    val observedMinTakes: Int = 2,
)

/** One Follow suggestion, with why it matched (best position across references). */
data class FollowRow(
    val track: LibraryTrack,
    val tier: EvidenceTier,
    val known: KnownKind?,
    val observedTakes: Int,
    val observedLastAt: Instant?,
    /** Best Match score across references (shown for every tier). */
    val score: Double,
    val keyMatched: Boolean,
    val matchedTagIds: Set<Int>,
    val sharedArtist: Boolean,
) {
    /** Section header text, desktop rankLabel vocabulary. */
    val label: String get() = when (tier) {
        EvidenceTier.KNOWN -> known!!.label
        EvidenceTier.OBSERVED -> "Observed"
        EvidenceTier.COMPATIBLE -> "Compatible"
    }
}

enum class TransitionMark { NONE, SAVED, FAVORITED }

/** Library-row marks relative to a loaded deck's Track: ◆/★ and Linked. */
data class RowMarks(val transition: TransitionMark, val linked: Boolean) {
    companion object { val NONE = RowMarks(TransitionMark.NONE, false) }
}

/** Indexed Follow evidence over a Snapshot. */
class FollowIndex(snapshot: Snapshot) {
    private val transitionsFrom: Map<Int, Map<Int, TransitionEdge>> =
        snapshot.transitions.groupBy { it.a }.mapValues { (_, v) -> v.associateBy { it.b } }
    private val cameosHosted: Map<Int, Map<Int, CameoEdge>> =
        snapshot.cameos.groupBy { it.host }.mapValues { (_, v) -> v.associateBy { it.guest } }
    private val links: Map<Int, Set<Int>> = buildMap<Int, MutableSet<Int>> {
        for ((lo, hi) in snapshot.links) {
            getOrPut(lo) { HashSet() }.add(hi)
            getOrPut(hi) { HashSet() }.add(lo)
        }
    }
    private val takesFrom: Map<Int, Map<Int, TakeEdge>> =
        snapshot.takes.groupBy { it.a }.mapValues { (_, v) -> v.associateBy { it.b } }

    fun linked(a: Int, b: Int) = links[a]?.contains(b) == true

    fun marks(deckTrackId: Int?, candidateId: Int): RowMarks {
        if (deckTrackId == null) return RowMarks.NONE
        val t = transitionsFrom[deckTrackId]?.get(candidateId)
        val mark = when { t == null -> TransitionMark.NONE; t.favorite -> TransitionMark.FAVORITED; else -> TransitionMark.SAVED }
        return RowMarks(mark, linked(deckTrackId, candidateId))
    }

    /** Known kinds from [reference] to every Known candidate. */
    fun known(reference: Int): Map<Int, KnownKind> {
        val out = HashMap<Int, KnownKind>()
        fun offer(id: Int, kind: KnownKind) { if (id != reference) out.merge(id, kind) { a, b -> minOf(a, b) } }
        transitionsFrom[reference]?.values?.forEach { offer(it.b, if (it.favorite) KnownKind.FAVORITED_TRANSITION else KnownKind.SAVED_TRANSITION) }
        cameosHosted[reference]?.values?.forEach { offer(it.guest, if (it.favorite) KnownKind.FAVORITED_CAMEO else KnownKind.SAVED_CAMEO) }
        links[reference]?.forEach { offer(it, KnownKind.LINKED) }
        return out
    }

    fun takesFrom(reference: Int): Map<Int, TakeEdge> = takesFrom[reference].orEmpty()
}

/**
 * Follow ranking for the followed references (desktop Follow mode order):
 * Known strata in strength order, then Observed (Take count, then recency),
 * then Compatible by Match score. Multi-reference: best position wins.
 * The followed Tracks themselves are never candidates.
 */
object FollowRanker {
    private data class Pos(val tier: EvidenceTier, val known: KnownKind?, val takes: Int, val lastAt: Instant?)

    private val POS_ORDER = Comparator<Pos> { a, b ->
        if (a.tier != b.tier) return@Comparator a.tier.compareTo(b.tier)
        when (a.tier) {
            EvidenceTier.KNOWN -> a.known!!.compareTo(b.known!!)
            EvidenceTier.OBSERVED -> if (a.takes != b.takes) b.takes - a.takes else compareValues(b.lastAt, a.lastAt)
            EvidenceTier.COMPATIBLE -> 0
        }
    }

    fun rank(
        tracks: List<LibraryTrack>,
        index: FollowIndex,
        references: List<LibraryTrack>,
        params: FollowParams = FollowParams(),
    ): List<FollowRow> {
        if (references.isEmpty()) return emptyList()
        val referenceIds = references.mapTo(HashSet()) { it.id }
        val knownByRef = references.associate { it.id to index.known(it.id) }
        val takesByRef = references.associate { it.id to index.takesFrom(it.id) }
        val rows = ArrayList<FollowRow>()
        for (candidate in tracks) {
            if (candidate.id in referenceIds) continue
            var best: Pos? = null
            var score = Double.NEGATIVE_INFINITY
            var keyMatched = false
            var artist = false
            val tags = HashSet<Int>()
            for (reference in references) {
                val affinity = MatchScore.affinity(reference, candidate)
                score = max(score, MatchScore.score(reference, candidate, params.bpmThresholdPercent, affinity))
                if (MatchScore.keyRelation(reference.keyOpenKey, candidate.keyOpenKey) != MatchScore.KeyRelation.OTHER) keyMatched = true
                if (MatchScore.sharedArtist(reference.artist, candidate.artist)) artist = true
                tags += MatchScore.sharedTags(reference, candidate)

                val known = knownByRef.getValue(reference.id)[candidate.id]
                val take = takesByRef.getValue(reference.id)[candidate.id]
                val pos = when {
                    known != null -> Pos(EvidenceTier.KNOWN, known, 0, null)
                    params.knownOnly -> null
                    take != null && take.count >= params.observedMinTakes -> Pos(EvidenceTier.OBSERVED, null, take.count, take.lastAt)
                    passesBpmGate(reference, candidate, params) && affinity >= MatchScore.AFFINITY_FLOOR -> Pos(EvidenceTier.COMPATIBLE, null, 0, null)
                    else -> null
                }
                if (pos != null && (best == null || POS_ORDER.compare(pos, best) < 0)) best = pos
            }
            val b = best ?: continue
            rows += FollowRow(candidate, b.tier, b.known, b.takes, b.lastAt, score, keyMatched, tags, artist)
        }
        return rows.sortedWith { x, y ->
            val p = POS_ORDER.compare(Pos(x.tier, x.known, x.observedTakes, x.observedLastAt), Pos(y.tier, y.known, y.observedTakes, y.observedLastAt))
            if (p != 0) p else y.score.compareTo(x.score)
        }
    }

    private fun passesBpmGate(reference: LibraryTrack, candidate: LibraryTrack, params: FollowParams): Boolean {
        val refBpm = reference.bpm
        if (!params.bpm || refBpm == null || refBpm <= 0) return true
        val bpm = candidate.bpm ?: return false
        return LibraryFilter.inBpmWindow(bpm, refBpm, params.bpmThresholdPercent)
    }
}
