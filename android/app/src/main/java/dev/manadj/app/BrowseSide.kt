package dev.manadj.app

import dev.manadj.audio.DeckId
import kotlin.math.abs
import kotlin.math.log10

/** What the landscape browser heuristic needs from one deck. */
data class DeckMix(
    val id: DeckId, val loaded: Boolean, val playing: Boolean,
    /** Channel fader 0..1, crossfader gain for this deck 0..1. */
    val fader: Double, val xfGain: Double,
    /** LOW EQ knob 0..1 (0.5 = unity) and filter -1 (LPF) .. +1 (HPF). */
    val lowEq: Double, val filter: Double,
    /** Monotonic load time; null = never loaded. */
    val loadedAt: Long?,
)

/** Bass level relative to unity, dB: LOW EQ gain, minus what a high-pass filter removes. */
fun bassDb(d: DeckMix): Double {
    val eq = 20 * log10(eqValueToGain(d.lowEq).toDouble().coerceAtLeast(1e-4))
    val hp = if (d.filter > .05) -36 * (d.filter - .05) / .95 else 0.0
    return eq + hp
}

fun audible(d: DeckMix) = d.loaded && d.playing && d.fader > .05 && d.xfGain > .05

/**
 * Landscape BROWSE covers the OUTGOING deck's controls and loads into the other one (#371):
 * 1) exactly one deck audible → cover it; 2) both audible → cover the one with less bass (> [bassThresholdDb]
 * apart), else the least recently loaded; 3) none audible → keep an empty deck visible (cover the loaded one),
 * else cover the least recently loaded.
 */
fun coveredDeck(a: DeckMix, b: DeckMix, bassThresholdDb: Double = 3.0): DeckId {
    fun older(): DeckId = when {
        a.loadedAt == null && b.loadedAt == null -> DeckId.A
        a.loadedAt == null -> DeckId.A
        b.loadedAt == null -> DeckId.B
        else -> if (a.loadedAt <= b.loadedAt) DeckId.A else DeckId.B
    }
    val aa = audible(a); val ab = audible(b)
    return when {
        aa && !ab -> DeckId.A
        ab && !aa -> DeckId.B
        aa && ab -> { val da = bassDb(a); val db = bassDb(b); if (abs(da - db) > bassThresholdDb) (if (da < db) DeckId.A else DeckId.B) else older() }
        a.loaded != b.loaded -> if (a.loaded) DeckId.A else DeckId.B
        else -> older()
    }
}

fun other(id: DeckId) = if (id == DeckId.A) DeckId.B else DeckId.A
