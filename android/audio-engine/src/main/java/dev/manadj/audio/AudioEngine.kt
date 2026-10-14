package dev.manadj.audio

import android.os.ParcelFileDescriptor
import android.os.Process
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReferenceArray

enum class DeckId { A, B, C, D }
enum class LoadState { EMPTY, LOADING, READY, ERROR }
enum class LoopChange { HALVE, DOUBLE, SET }

/** Active loop region in source seconds (desktop LoopRegion). */
data class LoopRegion(val start: Double, val end: Double, val beats: Double)

/** Desktop BEAT_FX_EFFECTS in GRV6 SELECT order. Ordinals match native `fx::Effect`. */
enum class BeatFxEffect(val label: String, val short: String) {
    ECHO("ECHO", "ECH"), LOW_CUT_ECHO("LOW CUT ECHO", "LCE"), REVERB("REVERB", "RVB"),
    FLANGER("FLANGER", "FLG"), TRANS("TRANS", "TRS"), ROLL("ROLL", "ROL"),
}

/** Beat FX CH SELECT. MASTER follows the tempo of the last deck target. Ordinals match native `fx::Target`. */
enum class BeatFxTarget { A, B, C, D, MASTER }

/**
 * The central Beat FX section (desktop BeatFxSectionState). [depth]: -1 original only, 0 both at unity,
 * +1 effect only. [beats]: one of [BeatFx.LADDER] (FLANGER reads it as bars). [held]: per-deck
 * momentary paddles, engaged regardless of [on] / [target]. A null [effect] forces [on] off.
 */
data class BeatFxState(
    val effect: BeatFxEffect?, val target: BeatFxTarget, val on: Boolean,
    val depth: Double, val beats: Double, val held: Set<DeckId> = emptySet(),
)

object BeatFx {
    /** GRV6 BEAT ◄ ► ladder. */
    val LADDER = listOf(.0625, .125, .25, .5, .75, 1.0, 2.0, 4.0, 8.0)
    /** Desktop initial section: ECHO on A, off, fully dry, 1/2 beat. */
    val DEFAULT = BeatFxState(BeatFxEffect.ECHO, BeatFxTarget.A, false, -1.0, .5)
    fun snap(beats: Double): Double = LADDER.minBy { kotlin.math.abs(it - beats) }
    /** BEAT ◄ ► one rung (desktop stepEchoBeats). */
    fun step(beats: Double, double: Boolean): Double {
        val i = LADDER.indexOf(snap(beats)) + if (double) 1 else -1
        return LADDER[i.coerceIn(0, LADDER.lastIndex)]
    }
}

/** Desktop filterSettings.ts FILTER_MODELS; [id] is the persisted value, ordinals match native `FilterModel`. */
enum class FilterModel(val id: String, val label: String, val description: String) {
    CURRENT("current", "Original 12 dB", "The original manadj response: fixed resonance, 80 Hz / 8 kHz endpoints and an open low-pass at center."),
    RES12("res12", "Resonant 12 dB", "One resonant stage. A broad, open sweep."),
    RES24("res24", "Resonant 24 dB", "Two stages with resonance on the sharper stage."),
    RES48("res48", "Steep 48 dB", "Four stages for a steeper cutoff and a sharper edge."),
    DUAL("dual", "Twin peak 24 dB", "Two resonant stages with separated cutoffs. Spread sets their distance."),
}

/**
 * Desktop sweep-filter settings (filterSettings.ts; persisted as JSON under [KEY]). Values outside
 * [RANGES] are clamped, as desktop sanitizeFilterSettings does.
 */
data class FilterSettings(
    val model: FilterModel = FilterModel.RES24,
    val resonance: Double = 17.0, val compensation: Double = .85, val curve: Double = 1.0, val deadzone: Double = .03,
    val lpMin: Double = 40.0, val hpMax: Double = 16000.0, val spread: Double = .8, val drive: Double = 0.0,
    val trim: Double = 0.0, val smoothing: Double = 20.0,
) {
    internal fun params() = doubleArrayOf(resonance, compensation, curve, deadzone, lpMin, hpMax, spread, drive, trim, smoothing)

    fun sanitized(): FilterSettings {
        fun c(key: String, v: Double, fallback: Double) = RANGES.getValue(key).let { (lo, hi) -> if (v.isFinite()) v.coerceIn(lo, hi) else fallback }
        val d = FilterSettings()
        return copy(
            resonance = c("resonance", resonance, d.resonance), compensation = c("compensation", compensation, d.compensation),
            curve = c("curve", curve, d.curve), deadzone = c("deadzone", deadzone, d.deadzone), lpMin = c("lpMin", lpMin, d.lpMin),
            hpMax = c("hpMax", hpMax, d.hpMax), spread = c("spread", spread, d.spread), drive = c("drive", drive, d.drive),
            trim = c("trim", trim, d.trim), smoothing = c("smoothing", smoothing, d.smoothing),
        )
    }

    /** The desktop JSON shape (`manadj-filter-settings`). */
    fun toJson(): String = org.json.JSONObject().apply {
        put("model", model.id)
        params().zip(KEYS).forEach { (v, k) -> put(k, v) }
    }.toString()

    companion object {
        const val KEY = "manadj-filter-settings"
        /**
         * The desktop's shipped value (backend/shipped_defaults.json) — what a desktop without a
         * customized filter runs. The no-arg constructor is the TS code fallback (DEFAULT_FILTER_SETTINGS,
         * 17 dB resonance / 0.85 compensation: ~12 dB quieter off-center), used only per-field by fromJson.
         */
        val SHIPPED = FilterSettings(resonance = 10.5, compensation = .1)
        val KEYS = listOf("resonance", "compensation", "curve", "deadzone", "lpMin", "hpMax", "spread", "drive", "trim", "smoothing")
        /** FILTER_PARAMETER_RANGES: min, max, step. */
        val RANGES: Map<String, Triple<Double, Double, Double>> = mapOf(
            "resonance" to Triple(0.0, 24.0, .1), "compensation" to Triple(0.0, 1.0, .01), "curve" to Triple(.35, 2.5, .05),
            "deadzone" to Triple(0.0, .12, .005), "lpMin" to Triple(20.0, 300.0, 5.0), "hpMax" to Triple(2000.0, 20000.0, 100.0),
            "spread" to Triple(0.0, 2.0, .1), "drive" to Triple(0.0, 18.0, .5), "trim" to Triple(-18.0, 12.0, .5),
            "smoothing" to Triple(5.0, 100.0, 5.0),
        )
        /** Parses the desktop JSON (unknown/missing fields fall back to defaults, like sanitizeFilterSettings). */
        fun fromJson(json: String?): FilterSettings {
            val o = runCatching { org.json.JSONObject(json ?: return FilterSettings()) }.getOrNull() ?: return FilterSettings()
            val d = FilterSettings()
            fun n(k: String, fallback: Double) = o.optDouble(k, fallback).takeIf { it.isFinite() } ?: fallback
            return FilterSettings(
                model = FilterModel.entries.firstOrNull { it.id == o.optString("model") } ?: d.model,
                resonance = n("resonance", d.resonance), compensation = n("compensation", d.compensation), curve = n("curve", d.curve),
                deadzone = n("deadzone", d.deadzone), lpMin = n("lpMin", d.lpMin), hpMax = n("hpMax", d.hpMax),
                spread = n("spread", d.spread), drive = n("drive", d.drive), trim = n("trim", d.trim), smoothing = n("smoothing", d.smoothing),
            ).sanitized()
        }
    }
}

/** Output stage mapping of the master and cue (PFL) buses. Ordinals match native `Routing`. */
enum class Routing(val label: String) {
    STEREO("Stereo master"),
    SPLIT_MONO("Split: L master / R cue"),
    QUAD("4-ch: 1/2 master, 3/4 cue"),
}

/**
 * Transport/mixer intents. Decisions (cue/hot-cue gating, relocation) are made
 * on the audio callback against the authoritative deck state, so a receipt
 * means "queued"; `appliedCommandId` in a snapshot means "the callback ran it".
 */
sealed interface AudioCommand {
    val deck: DeckId
    val gestureId: String?
    data class Play(override val deck: DeckId, override val gestureId: String? = null) : AudioCommand
    data class Pause(override val deck: DeckId, override val gestureId: String? = null) : AudioCommand
    data class CueDown(override val deck: DeckId, override val gestureId: String? = null) : AudioCommand
    data class CueUp(override val deck: DeckId, override val gestureId: String? = null) : AudioCommand
    data class HotCueDown(override val deck: DeckId, val slot: Int, override val gestureId: String? = null) : AudioCommand
    data class HotCueUp(override val deck: DeckId, val slot: Int, override val gestureId: String? = null) : AudioCommand
    /** Stores the deck's position at apply time (callback clock, not a UI estimate). */
    data class SetHotCue(override val deck: DeckId, val slot: Int, override val gestureId: String? = null) : AudioCommand
    /** Stored cue points (library tracks): main cue (a stopped deck parks there) / hot cue at [seconds]. */
    data class SetCueAt(override val deck: DeckId, val seconds: Double, override val gestureId: String? = null) : AudioCommand
    data class SetHotCueAt(override val deck: DeckId, val slot: Int, val seconds: Double, override val gestureId: String? = null) : AudioCommand
    data class ClearHotCue(override val deck: DeckId, val slot: Int, override val gestureId: String? = null) : AudioCommand
    data class Seek(override val deck: DeckId, val seconds: Double, override val gestureId: String? = null) : AudioCommand
    data class SetFader(override val deck: DeckId, val value: Double, override val gestureId: String? = null) : AudioCommand
    data class SetTrim(override val deck: DeckId, val value: Double, override val gestureId: String? = null) : AudioCommand
    data class SetPitch(override val deck: DeckId, val percent: Double, override val gestureId: String? = null) : AudioCommand
    data class SetBend(override val deck: DeckId, val percent: Double, override val gestureId: String? = null) : AudioCommand
    /** Isolator EQ knob 0..1 (0 = kill, .5 = 0 dB, 1 = +6 dB); band 0 low, 1 mid, 2 high. */
    data class SetEq(override val deck: DeckId, val band: Int, val value: Double, override val gestureId: String? = null) : AudioCommand
    /** Sweep filter -1 (LPF) .. 0 (bypass, deadzone ±0.03) .. +1 (HPF). */
    data class SetFilter(override val deck: DeckId, val position: Double, override val gestureId: String? = null) : AudioCommand
    /** Constant-tempo beat grid (bpm <= 0 clears): beat k at anchorSeconds + k * 60 / bpm. */
    data class SetGrid(override val deck: DeckId, val bpm: Double, val anchorSeconds: Double, override val gestureId: String? = null) : AudioCommand
    /** Relative jump by signed beats (gridless: 120 BPM); an active loop moves with it. */
    data class BeatJump(override val deck: DeckId, val beats: Double, override val gestureId: String? = null) : AudioCommand
    /** Engage at the playhead (snapped under quantize) with the pending size, or release. Inert without a grid. */
    data class LoopToggle(override val deck: DeckId, override val gestureId: String? = null) : AudioCommand
    /** Preset pad: engage at [beats]; same size while looping releases; other size resizes in place. */
    data class LoopPreset(override val deck: DeckId, val beats: Double, override val gestureId: String? = null) : AudioCommand
    /** Halve/double (or set) the active loop, anchored at its start; idle = pending size. 1/8..128 beats. */
    data class LoopResize(override val deck: DeckId, val change: LoopChange, val beats: Double = 0.0, override val gestureId: String? = null) : AudioCommand
    /** Global quantize (snaps loop engage to the nearest beat). */
    data class SetQuantize(val on: Boolean, override val gestureId: String? = null) : AudioCommand {
        override val deck = DeckId.A
    }
    /** Key lock (desktop Signalsmith Stretch): pitch/bend change tempo without changing key. */
    data class SetKeyLock(override val deck: DeckId, val on: Boolean, override val gestureId: String? = null) : AudioCommand
    /** Pre-fader listen: sends the deck (post-trim) to the cue bus. */
    data class SetPfl(override val deck: DeckId, val on: Boolean, override val gestureId: String? = null) : AudioCommand
    /** Headphone feed: 0 = cue bus only, 1 = master only. */
    data class SetCueMix(val value: Double, override val gestureId: String? = null) : AudioCommand {
        override val deck = DeckId.A // Global.
    }
    /** -1 = deck A only, 0 = both at unity, +1 = deck B only. */
    data class SetCrossfade(val value: Double, override val gestureId: String? = null) : AudioCommand {
        override val deck = DeckId.A // Global mixer command, not assigned to a deck's audio.
    }
    /** Sweep-filter settings for every deck (click-free live update; desktop FilterSettings). */
    data class SetFilterSettings(val settings: FilterSettings, override val gestureId: String? = null) : AudioCommand {
        override val deck = DeckId.A // Global.
    }
    /** Writes the whole Beat FX section (send the full state on every change). */
    data class SetBeatFx(
        val effect: BeatFxEffect?, val target: BeatFxTarget, val on: Boolean, val depth: Double, val beats: Double,
        val held: Set<DeckId> = emptySet(), override val gestureId: String? = null,
    ) : AudioCommand {
        override val deck = DeckId.A // Global.
        constructor(state: BeatFxState, gestureId: String? = null) :
            this(state.effect, state.target, state.on, state.depth, state.beats, state.held, gestureId)
    }
}

data class CommandReceipt(val id: Long, val accepted: Boolean, val reason: String? = null)
data class DeckSnapshot(
    val sourceId: String?, val loadId: Long, val loadState: LoadState, val error: String?,
    val sourceSeconds: Double, val sourceFrame: Long, val sampleRate: Int,
    val durationSeconds: Double?, val fader: Double, val trim: Double,
    val pitchPercent: Double, val bendPercent: Double,
    val playing: Boolean, val previewing: Boolean, val pfl: Boolean,
    /** EQ knobs (low, mid, high) 0..1 and filter -1..1 as applied by the callback. */
    val eq: List<Double>, val filter: Double,
    /** Grid tempo (null = gridless) and first-beat anchor; active loop; size the next engage uses. */
    val bpm: Double?, val gridAnchorSeconds: Double, val loop: LoopRegion?, val pendingLoopBeats: Double,
    /** Held gate: null, a hot-cue slot 0..7, or [AudioEngine.MAIN_CUE]. */
    val previewSlot: Int?,
    val cueSeconds: Double?, val hotCues: List<Double?>,
    /** A relocation is refilling: audio is held silent and the clock does not advance. */
    val filling: Boolean, val atEnd: Boolean,
    /** Bitmask of cue slots (hot cues 0..7, main cue 8, loop start 9) with pre-decoded audio ready for instant jumps. */
    val readyHeads: Int,
    /** Cue slot whose pre-decoded audio is playing (-1 none). */
    val headSlot: Int,
    val appliedCommandId: Long, val bufferedFrames: Long,
    /** Whole-track decode progress (source seconds held in memory); complete; playing from memory (exact jumps). */
    val decodedSeconds: Double = 0.0, val fullyDecoded: Boolean = false, val fromMemory: Boolean = false,
    /** Key lock requested; and actually time-stretching (needs the in-memory track at the playhead, else pitch follows tempo). */
    val keyLock: Boolean = false, val keyLockActive: Boolean = false,
)
data class EngineSnapshot(
    val outputFrames: Long, val outputSampleRate: Int, val outputChannels: Int,
    val epoch: Long, val outputOpen: Boolean, val reopenCount: Int, val crossfade: Double,
    val routing: Routing, val cueMix: Double, val quantize: Boolean,
    /** Beat FX section as applied, and the inserts currently sounding (engaged or ringing out a tail). */
    val beatFx: BeatFxState, val beatFxAudible: Set<BeatFxTarget>,
    val starvedDeckFrames: Long, val outputXruns: Long,
    val outputError: Int, val acceptedCommandId: Long, val appliedCommandId: Long,
    val decks: Map<DeckId, DeckSnapshot>, val supportedCapabilities: Set<String>,
    /** Engine output frame at which the deck positions were sampled. */
    val clockFrame: Long = 0,
    /** Engine frame heard at CLOCK_MONOTONIC [presentedNanos] (System.nanoTime domain); null offline / before the first timestamp. */
    val presentedFrame: Long? = null, val presentedNanos: Long? = null,
) {
    /**
     * The deck position being heard at [nanoTime] (System.nanoTime), extrapolated from the output
     * timestamp: render position minus output latency, advanced at the deck's speed. Use this for
     * smooth playheads/waveforms instead of interpolating raw snapshots. Extrapolation is capped at
     * 250 ms past the snapshot; without a timestamp it returns the render position.
     */
    fun audibleSeconds(deck: DeckId, nanoTime: Long = System.nanoTime()): Double {
        val d = decks.getValue(deck)
        val frame = presentedFrame ?: return d.sourceSeconds
        val at = presentedNanos ?: return d.sourceSeconds
        val heard = frame + (nanoTime - at).coerceIn(-250_000_000L, 250_000_000L) * outputSampleRate / 1e9
        val speed = if (d.playing || d.previewing) (1 + d.pitchPercent / 100) * (1 + d.bendPercent / 100) else 0.0
        val seconds = d.sourceSeconds + (heard - clockFrame) / outputSampleRate * speed
        val loop = d.loop
        return if (loop != null && seconds >= loop.end && d.sourceSeconds < loop.end) loop.start + (seconds - loop.end) % (loop.end - loop.start)
        else seconds.coerceAtLeast(0.0)
    }
}

/** Negotiated Oboe output; enum fields are Oboe ordinals rendered as names. */
data class OutputInfo(
    val api: String, val sharing: String, val performance: String, val sampleRate: Int, val channels: Int,
    val framesPerBurst: Int, val bufferFrames: Int, val capacityFrames: Int, val latencyMillis: Double?,
    val deviceId: Int, val xruns: Long, val minCallbackFrames: Int, val maxCallbackFrames: Int,
) {
    val bufferMillis get() = bufferFrames * 1000.0 / sampleRate
    override fun toString() = "$api/$sharing/$performance ${sampleRate}Hz ${channels}ch burst=$framesPerBurst " +
        "buffer=$bufferFrames (${"%.1f".format(bufferMillis)} ms) cap=$capacityFrames latency=${latencyMillis?.let { "%.1f ms".format(it) } ?: "?"} " +
        "device=$deviceId xruns=$xruns callback=$minCallbackFrames..$maxCallbackFrames"
}

/** One shared Oboe output. Call close off the UI thread after disabling new app commands. */
class AudioEngine(private val offline: Boolean = false) : AutoCloseable {
    private class Source(val id: String, val fd: ParcelFileDescriptor, val load: Long)

    private val handle: Long = nativeOpen(offline).also { check(it != 0L) { "Oboe output did not open" } }
    private val executors: Array<ExecutorService> = Array(4) { deck ->
        Executors.newSingleThreadExecutor { task ->
            Thread({ Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO); task.run() }, "manadj-decode-${DeckId.entries[deck]}")
        }
    }
    /** Whole-track decoders: fill native memory front-to-back so jumps are exact and gapless. */
    private val trackExecutors: Array<ExecutorService> = Array(4) { deck ->
        Executors.newSingleThreadExecutor { task -> Thread(task, "manadj-track-${DeckId.entries[deck]}") }
    }
    private val loads = Array(4) { AtomicLong() }
    private val sources = arrayOfNulls<Source>(4) // Guarded by this.
    private val errors = AtomicReferenceArray<Pair<Long, String>?>(4)
    private val durations = AtomicReferenceArray<Pair<Long, Double>?>(4)
    private var loadCounter = 0L
    @Volatile private var closed = false

    companion object {
        init { System.loadLibrary("manadj_audio") }
        const val MAIN_CUE = 8
        const val HOT_CUES = 8
        val CAPABILITIES = setOf("play", "pause", "cue-gate", "hot-cue-gate", "hot-cue-set", "seek", "fader", "trim", "crossfade", "varispeed", "bend", "pfl", "cue-mix", "routing", "eq", "filter", "grid", "beat-jump", "loop", "quantize", "beat-fx", "filter-settings", "key-lock")
        private const val PRIME_FRAMES = 2048
        private const val MEMORY_RESERVE_BYTES = 768L shl 20
        private const val HEAD_PRIORITY_FRAMES = 16384 // ~340 ms buffered before a head fill may interrupt the ring
        private const val HEAD_SLOTS = HOT_CUES + 2
        /** Main cue first (CUE stabs), then the loop start, then hot cues. */
        private val FILL_ORDER = listOf(MAIN_CUE, MAIN_CUE + 1) + (0 until HOT_CUES)
        private const val HEAD_FRAMES = 8192
        private const val HEADER = 27
        private const val DECK_FIELDS = 40 + HOT_CUES
        private enum class Op { PREPARE, PLAY, PAUSE, CUE_DOWN, CUE_UP, HOT_CUE_DOWN, HOT_CUE_UP, HOT_CUE_SET, HOT_CUE_CLEAR, SEEK, FADER, TRIM, CROSSFADE, PITCH, BEND, PFL, CUE_MIX, EQ, FILTER, SET_GRID, BEAT_JUMP, LOOP_TOGGLE, LOOP_RESIZE, LOOP_PRESET, QUANTIZE, CUE_SET_AT, HOT_CUE_SET_AT, BEAT_FX, KEY_LOCK }
    }

    /** The caller retains/closes descriptor; the engine duplicates it for its own lifetime. */
    @Synchronized fun load(deck: DeckId, sourceId: String, descriptor: ParcelFileDescriptor): CommandReceipt {
        if (closed) return rejected("Engine closed")
        val owned = try { ParcelFileDescriptor.dup(descriptor.fileDescriptor) }
            catch (e: Exception) { return rejected("Cannot retain source: ${e.message}") }
        // Relocations re-read the descriptor; pipes/streams cannot seek.
        if (owned.statSize < 0) { owned.close(); return rejected("Source is not a seekable file") }
        val index = deck.ordinal
        val load = loadCounter + 1
        val id = nativeSubmit(handle, Op.PREPARE.ordinal, index, 0.0, load, 0)
        if (id == 0L) { owned.close(); return rejected("Command queue full") }
        loadCounter = load
        val previous = sources[index]
        val source = Source(sourceId, owned, load)
        sources[index] = source
        loads[index].set(load)
        executors[index].execute {
            // The previous worker has exited (same executor), so its descriptor is free.
            runCatching { previous?.fd?.close() }
            decode(index, source)
        }
        trackExecutors[index].execute { decodeWholeTrack(index, source) }
        return CommandReceipt(id, true)
    }

    @Synchronized fun submit(command: AudioCommand): CommandReceipt {
        if (closed) return rejected("Engine closed")
        val deck = command.deck.ordinal
        var slot = 0
        val (op, value) = when (command) {
            is AudioCommand.Play -> Op.PLAY to 0.0
            is AudioCommand.Pause -> Op.PAUSE to 0.0
            is AudioCommand.CueDown -> Op.CUE_DOWN to 0.0
            is AudioCommand.CueUp -> Op.CUE_UP to 0.0
            is AudioCommand.HotCueDown -> { slot = command.slot; Op.HOT_CUE_DOWN to 0.0 }
            is AudioCommand.HotCueUp -> { slot = command.slot; Op.HOT_CUE_UP to 0.0 }
            is AudioCommand.SetHotCue -> { slot = command.slot; Op.HOT_CUE_SET to 0.0 }
            is AudioCommand.SetCueAt -> Op.CUE_SET_AT to command.seconds
            is AudioCommand.SetHotCueAt -> { slot = command.slot; Op.HOT_CUE_SET_AT to command.seconds }
            is AudioCommand.ClearHotCue -> { slot = command.slot; Op.HOT_CUE_CLEAR to 0.0 }
            is AudioCommand.Seek -> {
                if (!command.seconds.isFinite() || command.seconds < 0) return rejected("Invalid seek target")
                if (sources[deck] == null) return rejected("No source")
                Op.SEEK to command.seconds
            }
            is AudioCommand.SetFader -> Op.FADER to command.value
            is AudioCommand.SetTrim -> Op.TRIM to command.value
            is AudioCommand.SetCrossfade -> Op.CROSSFADE to command.value
            is AudioCommand.SetPitch -> Op.PITCH to command.percent
            is AudioCommand.SetBend -> Op.BEND to command.percent
            is AudioCommand.SetPfl -> Op.PFL to if (command.on) 1.0 else 0.0
            is AudioCommand.SetCueMix -> Op.CUE_MIX to command.value
            is AudioCommand.SetEq -> {
                if (command.band !in 0..2) return rejected("Invalid EQ band")
                slot = command.band; Op.EQ to command.value
            }
            is AudioCommand.SetGrid -> {
                if (!command.bpm.isFinite() || !command.anchorSeconds.isFinite()) return rejected("Non-finite grid")
                val id = nativeSetGrid(handle, deck, command.bpm, command.anchorSeconds)
                return if (id != 0L) CommandReceipt(id, true) else rejected("Command queue full")
            }
            is AudioCommand.BeatJump -> Op.BEAT_JUMP to command.beats
            is AudioCommand.LoopToggle -> Op.LOOP_TOGGLE to 0.0
            is AudioCommand.LoopPreset -> Op.LOOP_PRESET to command.beats
            is AudioCommand.LoopResize -> { slot = command.change.ordinal; Op.LOOP_RESIZE to command.beats }
            is AudioCommand.SetQuantize -> Op.QUANTIZE to if (command.on) 1.0 else 0.0
            is AudioCommand.SetKeyLock -> Op.KEY_LOCK to if (command.on) 1.0 else 0.0
            is AudioCommand.SetFilterSettings -> {
                val s = command.settings.sanitized()
                val id = nativeSetFilterSettings(handle, s.model.ordinal, s.params())
                if (id != 0L) filterSettings = s
                return if (id != 0L) CommandReceipt(id, true) else rejected("Command queue full")
            }
            is AudioCommand.SetBeatFx -> {
                if (!command.depth.isFinite() || !command.beats.isFinite() || command.beats <= 0) return rejected("Non-finite control")
                val held = command.held.fold(0) { mask, d -> mask or (1 shl d.ordinal) }
                val id = nativeSubmitBeatFx(handle, command.effect?.ordinal ?: -1, command.target.ordinal, command.on, command.depth, command.beats, held)
                return if (id != 0L) CommandReceipt(id, true) else rejected("Command queue full")
            }
            is AudioCommand.SetFilter -> {
                if (!command.position.isFinite()) return rejected("Non-finite control")
                val id = nativeSubmitFilter(handle, deck, command.position)
                return if (id != 0L) CommandReceipt(id, true) else rejected("Command queue full")
            }
        }
        if (slot !in 0 until HOT_CUES) return rejected("Invalid hot cue slot")
        if (!value.isFinite()) return rejected("Non-finite control")
        val id = nativeSubmit(handle, op.ordinal, deck, value, 0, slot)
        return if (id != 0L) CommandReceipt(id, true) else rejected("Command queue full")
    }

    /** Settings last applied via [AudioCommand.SetFilterSettings]. */
    @Volatile var filterSettings = FilterSettings.SHIPPED
        private set

    /** Desktop sweepResponseDb: magnitude response (dB) of [settings] at knob [position] for [frequencies] (Settings graph). */
    fun filterResponseDb(settings: FilterSettings, position: Double, frequencies: DoubleArray, sampleRate: Double = 48000.0): DoubleArray =
        settings.sanitized().let { nativeFilterResponse(it.model.ordinal, it.params(), position, frequencies, sampleRate) }

    /** Audio-callback render cost since the previous call (resets): max µs, mean µs, callbacks, callbacks over half their period. */
    data class RenderCost(val maxMicros: Double, val meanMicros: Double, val callbacks: Long, val nearMisses: Long)
    @Synchronized fun renderCost(): RenderCost? {
        if (closed || offline) return null
        val d = nativeRenderCost(handle)
        return RenderCost(d[0], d[1], d[2].toLong(), d[3].toLong())
    }

    @Synchronized fun outputInfo(): OutputInfo? {
        if (closed) return null
        val d = nativeOutputInfo(handle)
        if (d.size < 13) return null
        return OutputInfo(
            api = listOf("Unspecified", "OpenSLES", "AAudio").getOrElse(d[0].toInt()) { "?" },
            sharing = listOf("Exclusive", "Shared").getOrElse(d[1].toInt()) { "?" },
            performance = when (d[2].toInt()) { 10 -> "None"; 11 -> "PowerSaving"; 12 -> "LowLatency"; 13 -> "PowerSavingOffloaded"; else -> "?" },
            sampleRate = d[3].toInt(), channels = d[4].toInt(), framesPerBurst = d[5].toInt(), bufferFrames = d[6].toInt(),
            capacityFrames = d[7].toInt(), latencyMillis = d[8].takeIf { it >= 0 }, deviceId = d[9].toInt(), xruns = d[10].toLong(),
            minCallbackFrames = d[11].toInt(), maxCallbackFrames = d[12].toInt(),
        )
    }

    /**
     * Selects the bus routing and output device (0 = system default). QUAD reopens the
     * stream with 4 channels; callers must only offer it for devices reporting >= 4.
     * Returns 0 or an Oboe error (the stream is then closed; [reopen] retries).
     */
    @Synchronized fun configureOutput(routing: Routing, deviceId: Int = 0): Int =
        if (closed) -1 else nativeConfigure(handle, routing.ordinal, deviceId, offline)

    /** Reopens the output after a failed automatic recovery. Returns 0 or an Oboe error. */
    @Synchronized fun reopen(): Int = if (closed || offline) -1 else nativeReopen(handle)

    @Synchronized fun snapshot(): EngineSnapshot {
        check(!closed) { "Engine closed" }
        val data = nativeSnapshot(handle)
        val decks = DeckId.entries.associateWith { deck ->
            val i = deck.ordinal
            val p = HEADER + i * DECK_FIELDS
            val source = sources[i]
            val current = source != null && data[p + 2].toLong() == source.load
            val state = when {
                source == null -> LoadState.EMPTY
                current && data[p + 1].toLong() == source.load -> LoadState.entries[data[p].toInt().coerceIn(0, 3)]
                else -> LoadState.LOADING
            }
            val seconds = if (current) data[p + 6] else 0.0
            val rate = data[p + 7].toInt()
            DeckSnapshot(
                sourceId = source?.id, loadId = source?.load ?: 0, loadState = state,
                error = errors.get(i)?.takeIf { it.first == source?.load }?.second,
                sourceSeconds = seconds, sourceFrame = (seconds * rate).toLong(), sampleRate = rate,
                durationSeconds = durations.get(i)?.takeIf { it.first == source?.load }?.second,
                fader = data[p + 14], trim = data[p + 15], pitchPercent = data[p + 16], bendPercent = data[p + 17],
                playing = current && data[p + 8] != 0.0, previewing = current && data[p + 9] != 0.0, pfl = data[p + 20] != 0.0,
                eq = listOf(data[p + 21], data[p + 22], data[p + 23]), filter = data[p + 24],
                bpm = data[p + 25].takeIf { current && it > 0 }, gridAnchorSeconds = data[p + 26],
                loop = if (current && data[p + 27] != 0.0) LoopRegion(data[p + 28], data[p + 29], data[p + 30]) else null,
                pendingLoopBeats = data[p + 31],
                previewSlot = data[p + 10].toInt().takeIf { current && it >= 0 },
                cueSeconds = data[p + 11].takeIf { current && state == LoadState.READY },
                hotCues = List(HOT_CUES) { h -> data[p + 40 + h].takeIf { current && it >= 0 } },
                filling = current && state == LoadState.READY && data[p + 4] == 0.0 && data[p + 18] < 0 && data[p + 34] == 0.0 && data[p + 35] == 0.0,
                readyHeads = if (current) data[p + 19].toInt() else 0,
                headSlot = if (current) data[p + 18].toInt() else -1,
                atEnd = current && data[p + 5] != 0.0,
                appliedCommandId = data[p + 12].toLong(), bufferedFrames = data[p + 13].toLong(),
                decodedSeconds = if (current) data[p + 32] else 0.0, fullyDecoded = current && data[p + 33] != 0.0,
                fromMemory = current && data[p + 34] != 0.0,
                keyLock = data[p + 36] != 0.0, keyLockActive = current && data[p + 37] != 0.0,
            )
        }
        return EngineSnapshot(
            outputFrames = data[0].toLong(), outputSampleRate = data[1].toInt(), outputChannels = data[13].toInt(),
            routing = Routing.entries[data[12].toInt().coerceIn(0, 2)], cueMix = data[14], quantize = data[15] != 0.0,
            epoch = data[3].toLong(), outputOpen = data[10] != 0.0, reopenCount = data[11].toInt(), crossfade = data[9],
            starvedDeckFrames = data[4].toLong(), outputXruns = data[5].toLong(), outputError = data[6].toInt(),
            acceptedCommandId = data[7].toLong(), appliedCommandId = data[8].toLong(),
            decks = decks, supportedCapabilities = CAPABILITIES,
            clockFrame = data[23].toLong(),
            presentedFrame = data[24].takeIf { it >= 0 }?.toLong(), presentedNanos = data[25].takeIf { it >= 0 }?.toLong(),
            beatFx = BeatFxState(
                effect = BeatFxEffect.entries.getOrNull(data[16].toInt()), target = BeatFxTarget.entries[data[17].toInt().coerceIn(0, 4)],
                on = data[18] != 0.0, depth = data[19], beats = data[20],
                held = DeckId.entries.filter { (data[21].toInt() shr it.ordinal) and 1 == 1 }.toSet(),
            ),
            beatFxAudible = BeatFxTarget.entries.filter { (data[22].toInt() shr it.ordinal) and 1 == 1 }.toSet(),
        )
    }

    private fun current(deck: Int, source: Source) = !closed && loads[deck].get() == source.load

    /**
     * Deck worker: one per loaded source, on the deck's single-thread executor.
     * Follows the callback's transport (load/seek/cue relocations) by seeking
     * the same decoder in place, refilling the ring, then publishing.
     */
    private fun decode(deck: Int, source: Source) {
        if (!current(deck, source)) return
        var heads: HeadFiller? = null
        try {
            independent(source.fd).use { fd ->
                PcmReader.open(fd.fileDescriptor).use { reader ->
                    reader.durationSeconds?.let { durations.set(deck, source.load to it) }
                    heads = HeadFiller(deck, source)
                    pump(deck, source, reader, heads!!)
                }
            }
        } catch (_: InterruptedException) {
        } catch (e: Exception) {
            if (current(deck, source)) {
                errors.set(deck, source.load to (e.message ?: e.javaClass.simpleName))
                nativeFail(handle, deck, source.load)
            }
        } finally { heads?.close() }
    }

    /**
     * Keeps pre-decoded audio at the deck's cue points (hot cues + main cue) with
     * a second decoder, so cue jumps start without waiting for the ring refill.
     */
    private inner class HeadFiller(private val deck: Int, private val source: Source) : AutoCloseable {
        private var fd: ParcelFileDescriptor? = null
        private var reader: PcmReader? = null
        private val filled = DoubleArray(HEAD_SLOTS) { Double.NaN }

        /** Fills at most one stale slot; true if it did work. */
        fun fillOne(targets: DoubleArray): Boolean {
            for (slot in FILL_ORDER) {
                val at = targets[4 + slot]
                if (at < 0 || at == filled[slot]) continue
                if (!nativeHeadBegin(handle, deck, slot)) continue // Being played; retry later.
                var frames = 0
                try {
                    val r = reader ?: run {
                        val dup = independent(source.fd).also { fd = it }
                        PcmReader.open(dup.fileDescriptor).also { reader = it }
                    }
                    r.seek(at)
                    while (frames < HEAD_FRAMES && current(deck, source)) {
                        val n = r.read()
                        if (n < 0) break
                        if (n == 0) continue
                        frames += nativeHeadWrite(handle, deck, slot, frames, r.samples, n)
                    }
                } finally { nativeHeadCommit(handle, deck, slot, source.load, at, frames) }
                filled[slot] = at
                return true
            }
            return false
        }

        override fun close() {
            runCatching { reader?.close() }
            runCatching { fd?.close() }
        }
    }

    /**
     * Decodes the whole source into native memory (int16, ~10 MB per stereo minute at 44.1 kHz)
     * when the device has room, so every relocation inside it is exact and needs no refill.
     * Until a region is decoded the streaming ring serves it.
     */
    private fun decodeWholeTrack(deck: Int, source: Source) {
        val state = DoubleArray(5 + HEAD_SLOTS)
        try {
            while (current(deck, source)) { // Prepare(load) must apply first (older tracks are then unread).
                nativeTransport(handle, deck, state)
                val applied = state[0].toLong()
                if (applied == source.load) break
                if (applied > source.load) return
                Thread.sleep(2)
            }
            // Start after the streaming path is up (instant start first), on an independent descriptor.
            while (current(deck, source)) {
                val status = nativeSnapshotStatus(deck)
                if (status == LoadState.READY) break
                if (status == LoadState.ERROR) return
                Thread.sleep(5)
            }
            independent(source.fd).use { fd ->
                PcmReader.open(fd.fileDescriptor).use { reader ->
                    val duration = reader.durationSeconds ?: return
                    var started = false
                    while (current(deck, source)) {
                        val n = reader.read()
                        if (n < 0) break
                        if (n == 0) continue
                        if (!started) {
                            val capacity = ((duration + 2) * reader.sampleRate).toLong()
                            if (!memoryAllows(capacity * 4)) return
                            if (!nativeTrackBegin(handle, deck, source.load, capacity, reader.sampleRate, reader.chunkStartSeconds)) return
                            started = true
                        }
                        if (nativeTrackWrite(handle, deck, source.load, reader.samples, n) < n) return // Superseded or full.
                    }
                    if (started && current(deck, source)) nativeTrackFinish(handle, deck, source.load)
                }
            }
        } catch (_: InterruptedException) {
        } catch (_: Exception) { /* The streaming path still plays the track. */ }
    }

    /** Load state of [deck]'s current load as the callback sees it. */
    private fun nativeSnapshotStatus(deck: Int): LoadState = snapshot().decks.getValue(DeckId.entries[deck]).loadState

    /**
     * A descriptor with its own file offset. `dup` shares the offset, and MediaExtractor instances
     * opening dup'ed descriptors concurrently can misread the container ("No audio track").
     */
    private fun independent(fd: ParcelFileDescriptor): ParcelFileDescriptor =
        runCatching { ParcelFileDescriptor.open(java.io.File("/proc/self/fd/${fd.fd}"), ParcelFileDescriptor.MODE_READ_ONLY) }
            .getOrElse { ParcelFileDescriptor.dup(fd.fileDescriptor) }

    /** Keeps [MEMORY_RESERVE_BYTES] of system memory available after the allocation. */
    private fun memoryAllows(bytes: Long): Boolean {
        val availableKb = runCatching {
            java.io.File("/proc/meminfo").readLines().first { it.startsWith("MemAvailable:") }.split(Regex("\\s+"))[1].toLong()
        }.getOrNull() ?: return false
        return availableKb * 1024 - bytes > MEMORY_RESERVE_BYTES
    }

    private fun pump(deck: Int, source: Source, reader: PcmReader, heads: HeadFiller) {
        val transportState = DoubleArray(5 + HEAD_SLOTS) // ..., heads, buffered frames
        var following = -1L      // Transport the reader is positioned for.
        var claimed = false      // Ring reset + rate/start recorded for `following`.
        var published = false
        var ended = false
        var everPublished = false
        var target = 0.0
        var chunk = 0
        var cursor = 0
        var offered = 0
        var claimedRate = 0
        while (current(deck, source)) {
            nativeTransport(handle, deck, transportState)
            val nativeLoad = transportState[0].toLong()
            if (nativeLoad != source.load) {
                if (nativeLoad > source.load) return
                Thread.sleep(2) // Prepare not applied yet.
                continue
            }
            val transport = transportState[1].toLong()
            if (transport != following) {
                target = transportState[2]
                // After a pre-decoded head the ring continues at the head's last frame.
                val offset = transportState[3].toInt()
                reader.seek(if (offset > 0) target + offset.toDouble() / reader.sampleRate else target)
                following = transport
                claimed = false; published = false; ended = false
                chunk = 0; cursor = 0; offered = 0
            }
            if (ended) { if (!heads.fillOne(transportState)) Thread.sleep(10); continue }
            if (cursor >= chunk) {
                val frames = reader.read()
                if (frames < 0) {
                    if (!everPublished && offered == 0) error("No playable PCM")
                    // Seeking past the end is a parked end-of-track, not a decode error.
                    if (!claimed && !nativeClaim(handle, deck, source.load, transport, reader.sampleRate, target)) continue
                    claimed = true
                    nativePublish(handle, deck, source.load, transport, true)
                    published = true; ended = true; everPublished = true
                    continue
                }
                if (frames == 0) continue
                if (!claimed || reader.sampleRate != claimedRate) {
                    if (published) error("Sample rate changed mid-stream")
                    if (!nativeClaim(handle, deck, source.load, transport, reader.sampleRate, reader.chunkStartSeconds)) continue
                    claimed = true; claimedRate = reader.sampleRate; offered = 0
                }
                chunk = frames; cursor = 0
            }
            val accepted = nativeOffer(handle, deck, transport, reader.samples, cursor, chunk - cursor)
            if (accepted < 0) continue // Relocated; the loop head follows the new transport.
            cursor += accepted; offered += accepted
            if (!published && (offered >= PRIME_FRAMES || accepted == 0)) {
                nativePublish(handle, deck, source.load, transport, false)
                published = true; everPublished = true
            }
            if (accepted == 0 && !heads.fillOne(transportState)) Thread.sleep(10) // Ring full (~1.3 s ahead).
            // Cue heads take priority over topping up the ring once it holds a safe margin: rapid
            // CUE / hot-cue stabs relocate (and restart the ring fill) faster than it can fill up,
            // so waiting for a full ring would leave every stab on the slow refill path.
            else if (published && transportState[4 + HEAD_SLOTS] >= HEAD_PRIORITY_FRAMES) heads.fillOne(transportState)
        }
    }

    override fun close() {
        synchronized(this) { if (closed) return; closed = true }
        executors.forEach { it.shutdownNow() }
        trackExecutors.forEach { it.shutdownNow() }
        val stopped = executors.all { it.awaitTermination(3, TimeUnit.SECONDS) } && trackExecutors.all { it.awaitTermination(3, TimeUnit.SECONDS) }
        synchronized(this) {
            sources.forEach { runCatching { it?.fd?.close() } }
            // A worker stuck in a provider read keeps native memory alive (leak, not use-after-free).
            if (stopped) nativeClose(handle) else nativeStop(handle)
        }
    }

    /** Test-only sink: exercises the same decoder, command queue and mixer without a device. */
    fun renderOfflineForTest(frames: Int, channels: Int = 2): FloatArray {
        check(offline && !closed)
        return nativeRenderOffline(handle, frames, channels)
    }

    private fun rejected(reason: String) = CommandReceipt(0, false, reason)
    private external fun nativeOpen(offline: Boolean): Long
    private external fun nativeReopen(handle: Long): Int
    private external fun nativeStop(handle: Long)
    private external fun nativeClose(handle: Long)
    private external fun nativeSubmit(handle: Long, op: Int, deck: Int, value: Double, load: Long, slot: Int): Long
    private external fun nativeSetGrid(handle: Long, deck: Int, bpm: Double, anchor: Double): Long
    private external fun nativeSubmitBeatFx(handle: Long, effect: Int, target: Int, on: Boolean, depth: Double, beats: Double, held: Int): Long
    private external fun nativeSetFilterSettings(handle: Long, model: Int, params: DoubleArray): Long
    private external fun nativeFilterResponse(model: Int, params: DoubleArray, position: Double, freqs: DoubleArray, rate: Double): DoubleArray
    private external fun nativeSubmitFilter(handle: Long, deck: Int, position: Double): Long
    private external fun nativeTransport(handle: Long, deck: Int, out: DoubleArray)
    private external fun nativeClaim(handle: Long, deck: Int, load: Long, transport: Long, rate: Int, start: Double): Boolean
    private external fun nativeOffer(handle: Long, deck: Int, transport: Long, pcm: FloatArray, offsetFrames: Int, frames: Int): Int
    private external fun nativeHeadBegin(handle: Long, deck: Int, slot: Int): Boolean
    private external fun nativeHeadWrite(handle: Long, deck: Int, slot: Int, at: Int, pcm: FloatArray, frames: Int): Int
    private external fun nativeHeadCommit(handle: Long, deck: Int, slot: Int, load: Long, seconds: Double, frames: Int)
    private external fun nativeTrackBegin(handle: Long, deck: Int, load: Long, capacity: Long, rate: Int, start: Double): Boolean
    private external fun nativeTrackWrite(handle: Long, deck: Int, load: Long, pcm: FloatArray, frames: Int): Int
    private external fun nativeTrackFinish(handle: Long, deck: Int, load: Long)
    private external fun nativePublish(handle: Long, deck: Int, load: Long, transport: Long, eof: Boolean): Boolean
    private external fun nativeFail(handle: Long, deck: Int, load: Long)
    private external fun nativeOutputInfo(handle: Long): DoubleArray
    private external fun nativeRenderCost(handle: Long): DoubleArray
    private external fun nativeSnapshot(handle: Long): DoubleArray
    private external fun nativeRenderOffline(handle: Long, frames: Int, channels: Int): FloatArray
    private external fun nativeConfigure(handle: Long, routing: Int, device: Int, offline: Boolean): Int
}
