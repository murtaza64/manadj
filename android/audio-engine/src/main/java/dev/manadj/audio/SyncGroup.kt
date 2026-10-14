package dev.manadj.audio

import kotlin.math.abs

/** Desktop tempo.ts: varispeed reach of the pitch fader (percent). */
const val PITCH_RANGE_PERCENT = 8.0

/** Audible tempo at a pitch setting (bend is momentary and excluded). */
fun effectiveBpm(baseBpm: Double, pitchPercent: Double) = baseBpm * (1 + pitchPercent / 100)

sealed interface BpmMatch {
    data class Match(val pitchPercent: Double) : BpmMatch
    data object OutOfReach : BpmMatch
}

/**
 * Desktop bpmMatch: the pitch that makes this deck's tempo equal [otherEffectiveBpm] or its double/half
 * feel, within ±[PITCH_RANGE_PERCENT]. The direct match wins when reachable, else the smallest move.
 */
fun bpmMatch(ownBaseBpm: Double, otherEffectiveBpm: Double): BpmMatch {
    val edge = 1e-6
    val direct = (otherEffectiveBpm / ownBaseBpm - 1) * 100
    val reachable = listOf(otherEffectiveBpm, otherEffectiveBpm * 2, otherEffectiveBpm / 2)
        .map { (it / ownBaseBpm - 1) * 100 }.filter { abs(it) <= PITCH_RANGE_PERCENT + edge }
    if (reachable.isEmpty()) return BpmMatch.OutOfReach
    val pitch = if (reachable[0] == direct) direct else reachable.minBy { abs(it) }
    return BpmMatch.Match(pitch.coerceIn(-PITCH_RANGE_PERCENT, PITCH_RANGE_PERCENT))
}

enum class SyncStatus { OFF, SYNCED, OUT_OF_LOCK, WAITING }

/** Group Tempo (null = no group) and every deck's membership state. */
data class SyncState(val tempo: Double?, val decks: Map<DeckId, SyncStatus>) {
    companion object { val NONE = SyncState(null, DeckId.entries.associateWith { SyncStatus.OFF }) }
}

/** What the Sync Group reads of a deck (from engine snapshots). */
data class SyncDeck(
    val ready: Boolean, val playing: Boolean, val bpm: Double?, val pitchPercent: Double,
    val sourceId: String?, val hasGrid: Boolean,
) {
    companion object {
        fun of(s: DeckSnapshot) = SyncDeck(
            ready = s.loadState == LoadState.READY, playing = s.playing, bpm = s.bpm?.takeIf { it.isFinite() && it > 0 },
            pitchPercent = s.pitchPercent, sourceId = s.sourceId, hasGrid = s.bpm != null,
        )
    }
}

/**
 * Desktop SyncGroup (frontend/src/playback/SyncGroup.ts, CONTEXT.md "Sync Group / Group Tempo",
 * "MATCH / SYNC"): one Group Tempo, per-deck half/double ratios, no Tempo Master, no chasing of
 * unsynced decks, no phase lock. Pitch on any member retargets the group; bend stays per deck;
 * members past ±8 % clamp and report OUT_OF_LOCK until the tempo is reachable again. With Quantize
 * on, a successful SYNC join or MATCH aligns the playing deck's beat phase once. Membership is
 * session-only and survives pause, reload and missing metadata (WAITING).
 *
 * Not ported: machine-audible ownership release (no Session playback surface on the phone yet) and
 * quantized launch of paused decks against the group (the engine has no cross-deck launch yet).
 */
class SyncGroup(private val actuator: Actuator) {
    interface Actuator {
        fun setPitch(deck: DeckId, percent: Double)
        /** One-shot phase micro-seek of [deck] against [reference]; [ratio] = own beats per reference beat. */
        fun alignPhase(deck: DeckId, reference: DeckId, ratio: Double)
        val quantize: Boolean
    }

    private var tempo: Double? = null
    private val ratios = linkedMapOf<DeckId, Double>()
    private var decks: Map<DeckId, SyncDeck> = DeckId.entries.associateWith { SyncDeck(false, false, null, 0.0, null, false) }
    /** Pitches written but possibly not yet visible in snapshots. */
    private val written = mutableMapOf<DeckId, Double>()

    var state: SyncState = SyncState.NONE
        private set

    /** Feed every engine snapshot: BPM/track/load changes re-derive a member's ratio and re-apply. */
    fun update(next: Map<DeckId, SyncDeck>) {
        val previous = decks
        decks = next
        for ((id, w) in written.toMap()) {
            val d = next.getValue(id)
            if (abs(d.pitchPercent - w) < 1e-4 || d.sourceId != previous.getValue(id).sourceId) written.remove(id)
        }
        var changed = false
        for (id in ratios.keys.toList()) {
            val before = previous.getValue(id)
            val now = next.getValue(id)
            if (now.bpm == before.bpm && now.sourceId == before.sourceId && now.ready == before.ready) continue
            changed = true
            val t = tempo
            if (now.bpm != null && t != null) ratios[id] = ratioFor(now.bpm, t)
        }
        if (changed) apply() else publish()
    }

    /** SYNC: join (capturing the group's or nearest playing peer's tempo) or leave. Null = not applicable. */
    fun toggle(deck: DeckId): BpmMatch? {
        if (ratios.remove(deck) != null) {
            if (ratios.isEmpty()) tempo = null
            publish()
            return null
        }
        val own = decks.getValue(deck)
        if (!own.ready || own.bpm == null) return null
        val reference = reference(deck, groupedOnly = tempo != null)
        val t = tempo ?: reference?.second ?: effectiveBpm(own.bpm, pitch(deck))
        val result = bpmMatch(own.bpm, t)
        if (result !is BpmMatch.Match) return result
        tempo = t
        ratios[deck] = ratioFor(own.bpm, t)
        apply()
        reference?.let { snap(deck, it.first) }
        return result
    }

    /** Pitch input: rides the Group Tempo for members, plain pitch otherwise. */
    fun setPitch(deck: DeckId, percent: Double) {
        if (!percent.isFinite()) return
        val own = decks.getValue(deck)
        val pitch = percent.coerceIn(-PITCH_RANGE_PERCENT, PITCH_RANGE_PERCENT)
        val ratio = ratios[deck]
        if (ratio == null || own.bpm == null) { write(deck, pitch); return }
        if (!own.ready) return
        tempo = effectiveBpm(own.bpm, pitch) / ratio
        apply()
    }

    /** MATCH: capture the nearest playing deck's tempo once; membership unchanged. */
    fun match(deck: DeckId): BpmMatch? {
        val own = decks.getValue(deck)
        if (!own.ready || own.bpm == null) return null
        val reference = reference(deck, groupedOnly = false) ?: return null
        val result = bpmMatch(own.bpm, reference.second)
        if (result is BpmMatch.Match) {
            setPitch(deck, result.pitchPercent)
            snap(deck, reference.first)
        }
        return result
    }

    private fun pitch(deck: DeckId) = written[deck] ?: decks.getValue(deck).pitchPercent

    private fun write(deck: DeckId, pitch: Double) {
        written[deck] = pitch
        actuator.setPitch(deck, pitch)
    }

    private fun ratioFor(bpm: Double, tempo: Double) =
        listOf(1.0, 2.0, .5).minBy { abs(tempo * it / bpm - 1) }

    /** Nearest other playing deck by effective tempo, folding half/double (desktop nearestPlayingTempoReference). */
    private fun reference(deck: DeckId, groupedOnly: Boolean): Pair<DeckId, Double>? {
        val own = decks.getValue(deck)
        val ownBpm = effectiveBpm(own.bpm ?: 0.0, pitch(deck))
        if (ownBpm <= 0) return null
        var best: Triple<DeckId, Double, Double>? = null
        for (id in DeckId.entries) {
            if (id == deck) continue
            val d = decks.getValue(id)
            if (!d.ready || !d.playing || d.bpm == null) continue
            if (groupedOnly && state.decks[id] != SyncStatus.SYNCED) continue
            val e = effectiveBpm(d.bpm, pitch(id))
            val distance = minOf(abs(e - ownBpm), abs(e * 2 - ownBpm), abs(e / 2 - ownBpm))
            if (best == null || distance < best.third) best = Triple(id, e, distance)
        }
        return best?.let { it.first to it.second }
    }

    private fun snap(deck: DeckId, referenceDeck: DeckId) {
        if (!actuator.quantize) return
        val own = decks.getValue(deck)
        val peer = decks.getValue(referenceDeck)
        if (own.bpm == null || peer.bpm == null || !own.hasGrid || !peer.hasGrid) return
        val ownRatio = ratios[deck]
        val peerRatio = ratios[referenceDeck]
        val ratio = if (ownRatio != null && peerRatio != null) ownRatio / peerRatio
            else ratioFor(effectiveBpm(own.bpm, pitch(deck)), effectiveBpm(peer.bpm, pitch(referenceDeck)))
        actuator.alignPhase(deck, referenceDeck, ratio)
    }

    private fun apply() {
        val t = tempo ?: return
        for ((id, ratio) in ratios) {
            val d = decks.getValue(id)
            if (!d.ready || d.bpm == null) continue
            write(id, ((t * ratio / d.bpm - 1) * 100).coerceIn(-PITCH_RANGE_PERCENT, PITCH_RANGE_PERCENT))
        }
        publish()
    }

    private fun publish() {
        val t = tempo
        val statuses = DeckId.entries.associateWith { id ->
            val ratio = ratios[id] ?: return@associateWith SyncStatus.OFF
            val d = decks.getValue(id)
            when {
                !d.ready || d.bpm == null || t == null -> SyncStatus.WAITING
                abs((t * ratio / d.bpm - 1) * 100) > PITCH_RANGE_PERCENT + 1e-6 -> SyncStatus.OUT_OF_LOCK
                else -> SyncStatus.SYNCED
            }
        }
        state = SyncState(t, statuses)
    }
}
