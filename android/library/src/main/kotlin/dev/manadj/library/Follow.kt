package dev.manadj.library

import java.time.Instant
import kotlin.math.abs
import kotlin.math.ln
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

/**
 * Known strength, strongest first — desktop links/known.ts (KNOWN_FAVORITED,
 * KNOWN_LINKED, KNOWN_SAVED); a pair takes its best. Transitions count FROM
 * the followed reference; Linked is symmetric. Cameos and Takes are not
 * Known on the desktop.
 */
enum class KnownKind(val label: String) {
    FAVORITED_TRANSITION("★ Favorited transition"),
    LINKED("🔗 Linked"),
    SAVED_TRANSITION("◆ Saved transition"),
}

/** Desktop Follow has two strata: Known, then Compatible. OBSERVED is never produced (kept for API stability). */
enum class EvidenceTier { KNOWN, OBSERVED, COMPATIBLE }

/** Desktop FollowParams (follow/model.ts), synced as the `manadj-follow-params` setting. */
data class FollowParams(
    /** BPM gate on/off (Compatible tier only). */
    val bpm: Boolean = true,
    /** Gate width; the desktop's candidate query takes an integer percent. */
    val bpmThresholdPercent: Double = 5.0,
    /** Narrow to the Known tier. */
    val knownOnly: Boolean = false,
    /** 0 = Match-score order; 1 = adventurous score-weighted draw over Compatible (Gumbel, desktop orderRanked). */
    val temperature: Double = 0.0,
    /** Draw seed (desktop: session-random uint32, +1 per Reroll). Only used when temperature > 0. */
    val seed: Long = 0,
    @Deprecated("Desktop Follow has no Observed tier") val observedMinTakes: Int = 2,
)

/** Per-signal contributions of a Match score (weights applied), for the reference that gave the best score. */
data class ScoreBreakdown(
    val referenceId: Int,
    val keyRelation: MatchScore.KeyRelation,
    val key: Double,
    val sharedTags: Int,
    val tags: Double,
    val artist: Double,
    val energy: Double,
    val bpm: Double,
) {
    val affinity: Double get() = key + tags + artist
    val total: Double get() = affinity + energy + bpm
}

/** One Follow suggestion (desktop row: rank label, match score, matched signals). */
data class FollowRow(
    val track: LibraryTrack,
    val tier: EvidenceTier,
    val known: KnownKind?,
    val observedTakes: Int,
    val observedLastAt: Instant?,
    /** Best Match score across references (factual; the temperature draw never changes it). */
    val score: Double,
    val keyMatched: Boolean,
    val matchedTagIds: Set<Int>,
    val sharedArtist: Boolean,
    /** Contributions behind [score]. */
    val breakdown: ScoreBreakdown? = null,
) {
    /** Section header text — desktop rankLabel. */
    val label: String get() = known?.label ?: "Compatible"

    /** The score the desktop shows: none for Known rows (desktop scoreFor). */
    val displayScore: Double? get() = if (known != null) null else score
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

    /** Known kinds from [reference] to every Known candidate (knownStrengthOf). */
    fun known(reference: Int): Map<Int, KnownKind> {
        val out = HashMap<Int, KnownKind>()
        val from = transitionsFrom[reference].orEmpty()
        for (id in from.keys + links[reference].orEmpty()) {
            val info = from[id]
            out[id] = when {
                info?.favorite == true -> KnownKind.FAVORITED_TRANSITION
                linked(reference, id) -> KnownKind.LINKED
                else -> KnownKind.SAVED_TRANSITION
            }
        }
        return out
    }

    fun takesFrom(reference: Int): Map<Int, TakeEdge> = takesFrom[reference].orEmpty()
}

/**
 * Desktop Follow, exactly (frontend/src/follow/rankedFollow.ts FollowRanking +
 * matchScore.ts + the server's BPM-gated candidate query, crud.get_tracks):
 *
 * - admission: Known from any reference (bypasses gate and floor); otherwise,
 *   unless knownOnly, a candidate inside one reference's BPM gate whose
 *   affinity to THAT reference reaches the Affinity floor;
 * - rank: best (lowest) Known strength, then best Match score across ALL
 *   references (desktop rankAgainst);
 * - order: Known strata, then score descending; temperature > 0 perturbs the
 *   Compatible order with a seeded Gumbel draw keyed by (seed, followed set,
 *   track id); ties keep the pool order.
 *
 * Golden-tested against the desktop pipeline (FollowGoldenTest). The followed
 * Tracks themselves are never rows (the desktop pins them as "Following").
 */
object FollowRanker {
    private data class Rank(val known: KnownKind?, val score: Double)

    private val COMPARE = Comparator<Rank> { a, b ->
        if (a.known != null || b.known != null) {
            if (a.known == null) return@Comparator 1
            if (b.known == null) return@Comparator -1
            if (a.known != b.known) return@Comparator a.known.compareTo(b.known)
        }
        b.score.compareTo(a.score)
    }

    fun rank(
        tracks: List<LibraryTrack>,
        index: FollowIndex,
        references: List<LibraryTrack>,
        params: FollowParams = FollowParams(),
    ): List<FollowRow> {
        val refs = references.distinctBy { it.id }
        if (refs.isEmpty()) return emptyList()
        val referenceIds = refs.mapTo(HashSet()) { it.id }
        val knownByRef = refs.associate { it.id to index.known(it.id) }
        val gates = refs.associate { it.id to BpmGate.of(it, params) }
        val rows = ArrayList<FollowRow>()
        for (candidate in tracks) {
            if (candidate.id in referenceIds) continue
            var known: KnownKind? = null
            var admitted = false
            var score = Double.NEGATIVE_INFINITY
            var best: ScoreBreakdown? = null
            var keyMatched = false
            var artist = false
            val tags = HashSet<Int>()
            for (reference in refs) {
                knownByRef.getValue(reference.id)[candidate.id]?.let { k -> known = known?.let { minOf(it, k) } ?: k }
                val b = breakdown(reference, candidate, params.bpmThresholdPercent)
                if (b.total > score) { score = b.total; best = b }
                if (!params.knownOnly && b.affinity >= MatchScore.AFFINITY_FLOOR && gates.getValue(reference.id).admits(candidate)) admitted = true
                if (b.keyRelation != MatchScore.KeyRelation.OTHER) keyMatched = true
                if (b.artist > 0) artist = true
                tags += MatchScore.sharedTags(reference, candidate)
            }
            if (known == null && !admitted) continue
            val tier = if (known != null) EvidenceTier.KNOWN else EvidenceTier.COMPATIBLE
            rows += FollowRow(candidate, tier, known, 0, null, score, keyMatched, tags, artist, best)
        }
        val salt = "${params.seed}:${refs.map { it.id }.sorted().joinToString(",")}"
        val sortRanks = rows.associate { row ->
            var s = row.score
            if (row.known == null && params.temperature > 0) s -= 30 * params.temperature * ln(-ln(uniform("$salt:${row.track.id}")))
            row.track.id to Rank(row.known, s)
        }
        return rows.sortedWith { x, y -> COMPARE.compare(sortRanks.getValue(x.track.id), sortRanks.getValue(y.track.id)) }
    }

    fun breakdown(reference: LibraryTrack, candidate: LibraryTrack, bpmThresholdPercent: Double): ScoreBreakdown {
        val relation = MatchScore.keyRelation(reference.keyOpenKey, candidate.keyOpenKey)
        val shared = MatchScore.sharedTags(reference, candidate).size
        return ScoreBreakdown(
            referenceId = reference.id,
            keyRelation = relation,
            key = MatchScore.W_KEY * relation.bonus,
            sharedTags = shared,
            tags = MatchScore.W_TAGS * MatchScore.tagContribution(shared),
            artist = MatchScore.W_ARTIST * (if (MatchScore.sharedArtist(reference.artist, candidate.artist)) 1.0 else 0.0),
            energy = MatchScore.W_ENERGY * MatchScore.energyContribution(reference.energy, candidate.energy),
            bpm = MatchScore.W_BPM * MatchScore.bpmContribution(reference.bpm, candidate.bpm, bpmThresholdPercent),
        )
    }

    /** Desktop orderRanked's identity hash → uniform (FNV-1a over UTF-16 units, murmur3 fmix32). */
    fun uniform(key: String): Double {
        var h = 2166136261L.toInt()
        for (c in key) h = (h xor c.code) * 16777619
        h = (h xor (h ushr 16)) * 0x85ebca6bL.toInt()
        h = (h xor (h ushr 13)) * 0xc2b2ae35L.toInt()
        h = h xor (h ushr 16)
        return ((h.toLong() and 0xffffffffL) + 0.5) / 4294967296.0
    }
}

/**
 * The desktop's per-reference candidate query (crud.get_tracks bpm_center /
 * bpm_threshold_percent): the centiBPM COLUMN (snapshot bpm_centi, which can
 * differ from the served bpm) within ±pct of the center, ×2 or ÷2, each
 * bound truncated to an integer like the SQL. Off (everything passes) when
 * the gate is disabled or the reference has no served BPM.
 */
class BpmGate private constructor(private val ranges: List<LongRange>?) {
    fun admits(candidate: LibraryTrack): Boolean {
        val r = ranges ?: return true
        val c = candidate.bpmCenti ?: return false
        return r.any { c in it }
    }

    companion object {
        fun of(reference: LibraryTrack, params: FollowParams): BpmGate {
            val center = reference.bpm
            if (!params.bpm || center == null || center == 0.0) return BpmGate(null)
            val pct = params.bpmThresholdPercent.toInt().toDouble()
            return BpmGate(listOf(center, center * 2, center / 2).map { fold ->
                val t = fold * (pct / 100.0)
                ((fold - t) * 100).toLong()..((fold + t) * 100).toLong()
            })
        }
    }
}
