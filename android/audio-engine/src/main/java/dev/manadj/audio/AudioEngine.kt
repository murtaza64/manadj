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
    data class ClearHotCue(override val deck: DeckId, val slot: Int, override val gestureId: String? = null) : AudioCommand
    data class Seek(override val deck: DeckId, val seconds: Double, override val gestureId: String? = null) : AudioCommand
    data class SetFader(override val deck: DeckId, val value: Double, override val gestureId: String? = null) : AudioCommand
    data class SetTrim(override val deck: DeckId, val value: Double, override val gestureId: String? = null) : AudioCommand
    data class SetPitch(override val deck: DeckId, val percent: Double, override val gestureId: String? = null) : AudioCommand
    data class SetBend(override val deck: DeckId, val percent: Double, override val gestureId: String? = null) : AudioCommand
    /** -1 = deck A only, 0 = both at unity, +1 = deck B only. */
    data class SetCrossfade(val value: Double, override val gestureId: String? = null) : AudioCommand {
        override val deck = DeckId.A // Global mixer command, not assigned to a deck's audio.
    }
}

data class CommandReceipt(val id: Long, val accepted: Boolean, val reason: String? = null)
data class DeckSnapshot(
    val sourceId: String?, val loadId: Long, val loadState: LoadState, val error: String?,
    val sourceSeconds: Double, val sourceFrame: Long, val sampleRate: Int,
    val durationSeconds: Double?, val fader: Double, val trim: Double,
    val pitchPercent: Double, val bendPercent: Double,
    val playing: Boolean, val previewing: Boolean,
    /** Held gate: null, a hot-cue slot 0..7, or [AudioEngine.MAIN_CUE]. */
    val previewSlot: Int?,
    val cueSeconds: Double?, val hotCues: List<Double?>,
    /** A relocation is refilling: audio is held silent and the clock does not advance. */
    val filling: Boolean, val atEnd: Boolean,
    val appliedCommandId: Long, val bufferedFrames: Long,
)
data class EngineSnapshot(
    val outputFrames: Long, val outputSampleRate: Int, val outputChannels: Int,
    val epoch: Long, val outputOpen: Boolean, val reopenCount: Int, val crossfade: Double,
    val starvedDeckFrames: Long, val outputXruns: Long,
    val outputError: Int, val acceptedCommandId: Long, val appliedCommandId: Long,
    val decks: Map<DeckId, DeckSnapshot>, val supportedCapabilities: Set<String>,
)

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
        val CAPABILITIES = setOf("play", "pause", "cue-gate", "hot-cue-gate", "hot-cue-set", "seek", "fader", "trim", "crossfade", "varispeed", "bend")
        private const val PRIME_FRAMES = 2048
        private const val HEADER = 13
        private const val DECK_FIELDS = 20 + HOT_CUES
        private enum class Op { PREPARE, PLAY, PAUSE, CUE_DOWN, CUE_UP, HOT_CUE_DOWN, HOT_CUE_UP, HOT_CUE_SET, HOT_CUE_CLEAR, SEEK, FADER, TRIM, CROSSFADE, PITCH, BEND }
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
        }
        if (slot !in 0 until HOT_CUES) return rejected("Invalid hot cue slot")
        if (!value.isFinite()) return rejected("Non-finite control")
        val id = nativeSubmit(handle, op.ordinal, deck, value, 0, slot)
        return if (id != 0L) CommandReceipt(id, true) else rejected("Command queue full")
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
                playing = current && data[p + 8] != 0.0, previewing = current && data[p + 9] != 0.0,
                previewSlot = data[p + 10].toInt().takeIf { current && it >= 0 },
                cueSeconds = data[p + 11].takeIf { current && state == LoadState.READY },
                hotCues = List(HOT_CUES) { h -> data[p + 20 + h].takeIf { current && it >= 0 } },
                filling = current && state == LoadState.READY && data[p + 4] == 0.0,
                atEnd = current && data[p + 5] != 0.0,
                appliedCommandId = data[p + 12].toLong(), bufferedFrames = data[p + 13].toLong(),
            )
        }
        return EngineSnapshot(
            outputFrames = data[0].toLong(), outputSampleRate = data[1].toInt(), outputChannels = data[2].toInt(),
            epoch = data[3].toLong(), outputOpen = data[10] != 0.0, reopenCount = data[11].toInt(), crossfade = data[9],
            starvedDeckFrames = data[4].toLong(), outputXruns = data[5].toLong(), outputError = data[6].toInt(),
            acceptedCommandId = data[7].toLong(), appliedCommandId = data[8].toLong(),
            decks = decks, supportedCapabilities = CAPABILITIES,
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
        try {
            ParcelFileDescriptor.dup(source.fd.fileDescriptor).use { fd ->
                PcmReader.open(fd.fileDescriptor).use { reader ->
                    reader.durationSeconds?.let { durations.set(deck, source.load to it) }
                    pump(deck, source, reader)
                }
            }
        } catch (_: InterruptedException) {
        } catch (e: Exception) {
            if (current(deck, source)) {
                errors.set(deck, source.load to (e.message ?: e.javaClass.simpleName))
                nativeFail(handle, deck, source.load)
            }
        }
    }

    private fun pump(deck: Int, source: Source, reader: PcmReader) {
        val transportState = DoubleArray(3)
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
                reader.seek(target)
                following = transport
                claimed = false; published = false; ended = false
                chunk = 0; cursor = 0; offered = 0
            }
            if (ended) { Thread.sleep(10); continue }
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
            if (accepted == 0) Thread.sleep(10) // Ring full (~1.3 s ahead).
        }
    }

    override fun close() {
        synchronized(this) { if (closed) return; closed = true }
        executors.forEach { it.shutdownNow() }
        val stopped = executors.all { it.awaitTermination(3, TimeUnit.SECONDS) }
        synchronized(this) {
            sources.forEach { runCatching { it?.fd?.close() } }
            // A worker stuck in a provider read keeps native memory alive (leak, not use-after-free).
            if (stopped) nativeClose(handle) else nativeStop(handle)
        }
    }

    /** Test-only sink: exercises the same decoder, command queue and mixer without a device. */
    fun renderOfflineForTest(frames: Int): FloatArray {
        check(offline && !closed)
        return nativeRenderOffline(handle, frames)
    }

    private fun rejected(reason: String) = CommandReceipt(0, false, reason)
    private external fun nativeOpen(offline: Boolean): Long
    private external fun nativeReopen(handle: Long): Int
    private external fun nativeStop(handle: Long)
    private external fun nativeClose(handle: Long)
    private external fun nativeSubmit(handle: Long, op: Int, deck: Int, value: Double, load: Long, slot: Int): Long
    private external fun nativeTransport(handle: Long, deck: Int, out: DoubleArray)
    private external fun nativeClaim(handle: Long, deck: Int, load: Long, transport: Long, rate: Int, start: Double): Boolean
    private external fun nativeOffer(handle: Long, deck: Int, transport: Long, pcm: FloatArray, offsetFrames: Int, frames: Int): Int
    private external fun nativePublish(handle: Long, deck: Int, load: Long, transport: Long, eof: Boolean): Boolean
    private external fun nativeFail(handle: Long, deck: Int, load: Long)
    private external fun nativeOutputInfo(handle: Long): DoubleArray
    private external fun nativeSnapshot(handle: Long): DoubleArray
    private external fun nativeRenderOffline(handle: Long, frames: Int): FloatArray
}
