package dev.manadj.audio

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.ParcelFileDescriptor
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReferenceArray

enum class DeckId { A, B, C, D }
enum class LoadState { EMPTY, LOADING, READY, ERROR }

sealed interface AudioCommand {
    val deck: DeckId
    val gestureId: String?
    data class Play(override val deck: DeckId, override val gestureId: String? = null) : AudioCommand
    data class Pause(override val deck: DeckId, override val gestureId: String? = null) : AudioCommand
    data class CueDown(override val deck: DeckId, override val gestureId: String? = null) : AudioCommand
    data class CueUp(override val deck: DeckId, override val gestureId: String? = null) : AudioCommand
    data class HotCueDown(override val deck: DeckId, val seconds: Double, override val gestureId: String) : AudioCommand
    data class HotCueUp(override val deck: DeckId, override val gestureId: String) : AudioCommand
    data class Seek(override val deck: DeckId, val seconds: Double, override val gestureId: String? = null) : AudioCommand
    data class SetFader(override val deck: DeckId, val value: Double, override val gestureId: String? = null) : AudioCommand
    data class SetTrim(override val deck: DeckId, val value: Double, override val gestureId: String? = null) : AudioCommand
    data class SetPitch(override val deck: DeckId, val percent: Double, override val gestureId: String? = null) : AudioCommand
    data class SetBend(override val deck: DeckId, val percent: Double, override val gestureId: String? = null) : AudioCommand
    data class SetCrossfade(val value: Double, override val gestureId: String? = null) : AudioCommand {
        override val deck = DeckId.A // Global mixer command, not assigned to a deck's audio.
    }
}

data class CommandReceipt(val id: Long, val accepted: Boolean, val reason: String? = null)
data class DeckSnapshot(
    val sourceId: String?, val loadGeneration: Long, val loadState: LoadState, val error: String?,
    val sourceSeconds: Double, val sourceFrame: Long, val sampleRate: Int,
    val durationSeconds: Double?, val fader: Double, val trim: Double,
    val pitchPercent: Double, val bendPercent: Double,
    val playing: Boolean, val previewing: Boolean, val cueSeconds: Double?,
    val appliedCommandId: Long, val bufferedFrames: Long,
)
data class EngineSnapshot(
    val outputFrames: Long, val outputSampleRate: Int, val outputChannels: Int,
    val epoch: Long, val outputOpen: Boolean, val crossfade: Double,
    val starvedDeckFrames: Long, val outputXruns: Long,
    val outputError: Int, val acceptedCommandId: Long, val appliedCommandId: Long,
    val decks: Map<DeckId, DeckSnapshot>, val supportedCapabilities: Set<String>,
)

/** One shared Oboe output. Call close off the UI thread after disabling new app commands. */
class AudioEngine(private val offline: Boolean = false) : AutoCloseable {
    private data class Source(val id: String, val fd: ParcelFileDescriptor, val generation: Long)
    private val executors = Array(4) { Executors.newSingleThreadExecutor() }
    private val generations = Array(4) { AtomicLong() }
    private val sources = arrayOfNulls<Source>(4)
    private val errors = AtomicReferenceArray<String?>(4)
    private val durations = Array(4) { AtomicLong(-1L) }
    private val gate = AtomicReferenceArray<Pair<String, Double>?>(4)
    @Volatile private var handle: Long = nativeOpen(offline).also { check(it != 0L) { "Oboe output did not open" } }

    companion object {
        init { System.loadLibrary("manadj_audio") }
        val CAPABILITIES = setOf("play", "pause", "cue-gate", "hot-cue-gate", "seek", "fader", "trim", "crossfade", "varispeed", "bend")
        private const val PREPARE = 0
        private const val READY = 1
        private const val ERROR = 2
        private const val PLAY = 3
        private const val PAUSE = 4
        private const val CUE_DOWN = 5
        private const val CUE_UP = 6
        private const val SEEK = 7
        private const val FADER = 8
        private const val TRIM = 9
        private const val CROSSFADE = 10
        private const val PITCH = 11
        private const val BEND = 12
        private const val HOT_PREVIEW = 13
        private const val END = 14
    }

    /** The caller retains/closes descriptor; the engine duplicates it for its own lifetime. */
    @Synchronized fun load(deck: DeckId, sourceId: String, descriptor: ParcelFileDescriptor): CommandReceipt {
        if (handle == 0L) return rejected("Engine closed")
        val owned = try { ParcelFileDescriptor.dup(descriptor.fileDescriptor) }
        catch (e: Exception) { return rejected("Cannot retain source: ${e.message}") }
        val index = deck.ordinal
        val generation = generations[index].incrementAndGet()
        val previous = sources[index]
        sources[index] = Source(sourceId, owned, generation)
        errors.set(index, null)
        durations[index].set(-1)
        gate.set(index, null)
        val id = nativeSubmit(handle, PREPARE, index, 0.0, generation, 0, 0)
        if (id == 0L) {
            sources[index] = previous
            owned.close()
            return rejected("Command queue full")
        }
        val current = sources[index]!!
        executors[index].execute {
            previous?.fd?.close()
            decode(index, current, 0.0)
        }
        return CommandReceipt(id, true)
    }

    @Synchronized fun submit(command: AudioCommand): CommandReceipt {
        if (handle == 0L) return rejected("Engine closed")
        val deck = command.deck.ordinal
        val state = snapshot().decks.getValue(command.deck)
        if (command is AudioCommand.Seek || command is AudioCommand.HotCueDown) {
            val seconds = when (command) {
                is AudioCommand.Seek -> command.seconds
                is AudioCommand.HotCueDown -> command.seconds
                else -> 0.0
            }
            if (!seconds.isFinite() || seconds < 0 || sources[deck] == null) return rejected("No seekable source")
            if (command is AudioCommand.HotCueDown && !state.playing) gate.set(deck, command.gestureId to seconds)
            return seek(command.deck, seconds)
        }
        if (command is AudioCommand.HotCueUp) {
            val held = gate.get(deck)
            if (held == null && state.playing) {
                val id = nativeSubmit(handle, CUE_UP, deck, 0.0, 0, 0, 0)
                return if (id != 0L) CommandReceipt(id, true) else rejected("Command queue full")
            }
            if (held?.first != command.gestureId) return rejected("Gesture not held")
            gate.set(deck, null)
            if (state.playing) {
                val id = nativeSubmit(handle, CUE_UP, deck, 0.0, 0, 0, 0)
                return if (id != 0L) CommandReceipt(id, true) else rejected("Command queue full")
            }
            nativeSubmit(handle, PAUSE, deck, 0.0, 0, 0, 0)
            return seek(command.deck, held.second)
        }
        if (command is AudioCommand.CueDown && state.playing && state.cueSeconds != null) {
            nativeSubmit(handle, PAUSE, deck, 0.0, 0, 0, 0)
            return seek(command.deck, state.cueSeconds)
        }
        if (command is AudioCommand.CueUp && state.previewing && !state.playing && state.cueSeconds != null) {
            nativeSubmit(handle, CUE_UP, deck, 0.0, 0, 0, 0)
            return seek(command.deck, state.cueSeconds)
        }
        if (command is AudioCommand.Play && state.loadState != LoadState.READY) return rejected("Source not ready")
        if (command is AudioCommand.Play) gate.set(deck, null)
        val (op, value) = when (command) {
            is AudioCommand.Play -> PLAY to 0.0
            is AudioCommand.Pause -> PAUSE to 0.0
            is AudioCommand.CueDown -> CUE_DOWN to 0.0
            is AudioCommand.CueUp -> CUE_UP to 0.0
            is AudioCommand.SetFader -> FADER to command.value
            is AudioCommand.SetTrim -> TRIM to command.value
            is AudioCommand.SetCrossfade -> CROSSFADE to command.value
            is AudioCommand.SetPitch -> PITCH to command.percent
            is AudioCommand.SetBend -> BEND to command.percent
            else -> return rejected("Unsupported command")
        }
        if (!value.isFinite()) return rejected("Non-finite control")
        val id = nativeSubmit(handle, op, deck, value, 0, 0, 0)
        return if (id != 0L) CommandReceipt(id, true) else rejected("Command queue full")
    }

    private fun seek(deck: DeckId, seconds: Double): CommandReceipt {
        val index = deck.ordinal
        val source = sources[index] ?: return rejected("No source")
        val generation = generations[index].incrementAndGet()
        errors.set(index, null)
        val id = nativeSubmit(handle, SEEK, index, seconds, generation, 0, 0)
        if (id == 0L) return rejected("Command queue full")
        executors[index].execute { decode(index, source.copy(generation = generation), seconds) }
        return CommandReceipt(id, true)
    }

    @Synchronized fun snapshot(): EngineSnapshot {
        check(handle != 0L) { "Engine closed" }
        val data = nativeSnapshot(handle)
        val decks = DeckId.entries.associateWith { deck ->
            val i = deck.ordinal
            val p = 11 + i * 13
            val cue = data[p + 6]
            val isCurrent = generations[i].get() == data[p + 1].toLong()
            val state = if (sources[i] == null) LoadState.EMPTY
                else if (isCurrent) LoadState.entries[data[p].toInt().coerceIn(0, 3)] else LoadState.LOADING
            val seconds = if (isCurrent) data[p + 2] else 0.0
            val rate = if (isCurrent) data[p + 3].toInt() else 0
            DeckSnapshot(sources[i]?.id, data[p + 1].toLong(), state, errors.get(i),
                seconds, (seconds * rate).toLong(), rate,
                durations[i].get().takeIf { isCurrent && it >= 0 }?.div(1_000_000.0),
                data[p + 9], data[p + 10], data[p + 11], data[p + 12],
                isCurrent && data[p + 4] != 0.0, isCurrent && data[p + 5] != 0.0,
                cue.takeIf { isCurrent && it >= 0 },
                data[p + 7].toLong(), data[p + 8].toLong())
        }
        return EngineSnapshot(data[0].toLong(), data[1].toInt(), data[2].toInt(), data[3].toLong(), data[10] != 0.0, data[9],
            data[4].toLong(), data[5].toLong(), data[6].toInt(), data[7].toLong(), data[8].toLong(), decks, CAPABILITIES)
    }

    private fun decode(deck: Int, source: Source, startSeconds: Double) {
        if (generations[deck].get() != source.generation) return
        try {
            ParcelFileDescriptor.dup(source.fd.fileDescriptor).use { fd ->
                val extractor = MediaExtractor()
                try {
                    extractor.setDataSource(fd.fileDescriptor)
                    val track = (0 until extractor.trackCount).firstOrNull {
                        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
                    } ?: error("No audio track")
                    extractor.selectTrack(track)
                    val format = extractor.getTrackFormat(track)
                    val mime = format.getString(MediaFormat.KEY_MIME) ?: error("Unknown audio format")
                    if (generations[deck].get() == source.generation && format.containsKey(MediaFormat.KEY_DURATION)) {
                        durations[deck].set(format.getLong(MediaFormat.KEY_DURATION))
                    }
                    val targetUs = (startSeconds * 1_000_000).toLong()
                    if (targetUs > 0) extractor.seekTo(targetUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
                    if (mime == "audio/raw") pumpRaw(deck, source.generation, extractor, format, targetUs)
                    else {
                        val codec = MediaCodec.createDecoderByType(mime)
                        var started = false
                        try {
                            codec.configure(format, null, null, 0)
                            codec.start()
                            started = true
                            pump(deck, source.generation, extractor, codec, targetUs)
                        } finally { if (started) codec.stop(); codec.release() }
                    }
                } finally { extractor.release() }
            }
        } catch (e: Exception) {
            if (generations[deck].get() == source.generation && handle != 0L) {
                errors.set(deck, e.message ?: e.javaClass.simpleName)
                nativeSubmit(handle, ERROR, deck, 0.0, source.generation, 0, 0)
            }
        }
    }

    private fun awaitFormat(deck: Int, generation: Long, seconds: Double, rate: Int, channels: Int): Boolean {
        while (nativeSnapshot(handle)[11 + deck * 13 + 1].toLong() != generation) {
            if (generations[deck].get() != generation) return false
            Thread.sleep(2)
        }
        val id = nativeSubmit(handle, SEEK, deck, seconds, generation, rate, channels)
        if (id == 0L) error("Audio command queue full")
        while (nativeSnapshot(handle)[11 + deck * 13 + 7].toLong() < id) {
            if (generations[deck].get() != generation) return false
            Thread.sleep(2)
        }
        return true
    }

    private fun pumpRaw(deck: Int, generation: Long, extractor: MediaExtractor, format: MediaFormat, targetUs: Long) {
        val rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        val channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        val encoding = if (format.containsKey(MediaFormat.KEY_PCM_ENCODING))
            format.getInteger(MediaFormat.KEY_PCM_ENCODING) else 2
        require(channels in 1..2 && rate in 8000..192000 && encoding == 2) { "Unsupported raw PCM format" }
        if (!awaitFormat(deck, generation, targetUs / 1_000_000.0, rate, channels)) return
        val packet = java.nio.ByteBuffer.allocate(65536).order(ByteOrder.LITTLE_ENDIAN)
        var total = 0
        var primed = false
        while (generations[deck].get() == generation) {
            packet.clear()
            val bytes = extractor.readSampleData(packet, 0)
            if (bytes < 0) break
            require(bytes % (channels * 2) == 0) { "Misaligned raw PCM" }
            val frames = bytes / (channels * 2)
            val skip = ((targetUs - extractor.sampleTime).coerceAtLeast(0) * rate / 1_000_000)
                .coerceAtMost(frames.toLong()).toInt()
            packet.position(skip * channels * 2)
            var remaining = frames - skip
            while (remaining > 0 && generations[deck].get() == generation) {
                val count = remaining.coerceAtMost(2048)
                val pcm = FloatArray(count * 2)
                for (i in 0 until count) {
                    val left = packet.short / 32768f
                    val right = if (channels == 2) packet.short / 32768f else left
                    pcm[2 * i] = left
                    pcm[2 * i + 1] = right
                }
                var cursor = 0
                while (cursor < count && generations[deck].get() == generation) {
                    val accepted = nativeOffer(handle, deck, generation, pcm.copyOfRange(cursor * 2, count * 2), count - cursor)
                    if (accepted == 0) Thread.sleep(2) else cursor += accepted
                }
                total += cursor
                if (!primed && total >= 2048) { nativeSubmit(handle, READY, deck, 0.0, generation, 0, 0); primed = true }
                remaining -= count
            }
            extractor.advance()
        }
        require(total > 0 || generations[deck].get() != generation) { "No playable PCM" }
        if (!primed && generations[deck].get() == generation) {
            nativeSubmit(handle, READY, deck, 0.0, generation, 0, 0)
            if (gate.get(deck) != null) nativeSubmit(handle, HOT_PREVIEW, deck, 0.0, generation, 0, 0)
        }
        if (generations[deck].get() == generation) nativeSubmit(handle, END, deck, 0.0, generation, 0, 0)
    }

    private fun pump(deck: Int, generation: Long, extractor: MediaExtractor, codec: MediaCodec, targetUs: Long) {
        val info = MediaCodec.BufferInfo()
        var sourceRate = 0
        var channels = 0
        var primed = false
        var offered = 0
        var inputDone = false
        while (generations[deck].get() == generation && !Thread.currentThread().isInterrupted) {
            if (!inputDone) {
                val inputIndex = codec.dequeueInputBuffer(10_000)
                if (inputIndex >= 0) {
                    val buffer = codec.getInputBuffer(inputIndex) ?: error("Missing codec input")
                    val n = extractor.readSampleData(buffer, 0)
                    if (n < 0) { codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                    else { codec.queueInputBuffer(inputIndex, 0, n, extractor.sampleTime, 0); extractor.advance() }
                }
            }
            val outputIndex = codec.dequeueOutputBuffer(info, 10_000)
            if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                val outputFormat = codec.outputFormat
                sourceRate = outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                channels = outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                val encoding = if (outputFormat.containsKey(MediaFormat.KEY_PCM_ENCODING))
                    outputFormat.getInteger(MediaFormat.KEY_PCM_ENCODING) else 2
                require(channels in 1..2 && sourceRate in 8000..192000 && encoding == 2) {
                    "Unsupported PCM encoding/channel/rate: $encoding/$channels/$sourceRate"
                }
                // New generation cannot publish until the callback has reset the ring.
                if (!awaitFormat(deck, generation, targetUs / 1_000_000.0, sourceRate, channels)) return
            } else if (outputIndex >= 0) {
                if (sourceRate == 0) error("Decoder returned PCM without output format")
                val buffer = codec.getOutputBuffer(outputIndex)?.order(ByteOrder.LITTLE_ENDIAN)
                    ?: error("Missing codec output")
                buffer.position(info.offset)
                buffer.limit(info.offset + info.size)
                val totalFrames = info.size / (channels * 2)
                val skip = ((targetUs - info.presentationTimeUs).coerceAtLeast(0) * sourceRate / 1_000_000)
                    .coerceAtMost(totalFrames.toLong()).toInt()
                buffer.position(info.offset + skip * channels * 2)
                var remaining = totalFrames - skip
                while (remaining > 0 && generations[deck].get() == generation) {
                    val count = remaining.coerceAtMost(2048)
                    val pcm = FloatArray(count * 2)
                    for (i in 0 until count) {
                        val left = buffer.short / 32768f
                        val right = if (channels == 2) buffer.short / 32768f else left
                        pcm[2 * i] = left
                        pcm[2 * i + 1] = right
                    }
                    var cursor = 0
                    while (cursor < count && generations[deck].get() == generation) {
                        val accepted = nativeOffer(handle, deck, generation, pcm.copyOfRange(cursor * 2, count * 2), count - cursor)
                        if (accepted == 0) Thread.sleep(2) else cursor += accepted
                        if (!primed && (offered + cursor >= 2048 || inputDone)) {
                            nativeSubmit(handle, READY, deck, 0.0, generation, 0, 0)
                            if (gate.get(deck) != null && generations[deck].get() == generation)
                                nativeSubmit(handle, HOT_PREVIEW, deck, 0.0, generation, 0, 0)
                            primed = true
                        }
                    }
                    offered += cursor
                    remaining -= count
                }
                codec.releaseOutputBuffer(outputIndex, false)
                if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                    require(offered > 0) { "No playable PCM" }
                    if (!primed) {
                        nativeSubmit(handle, READY, deck, 0.0, generation, 0, 0)
                        if (gate.get(deck) != null && generations[deck].get() == generation)
                            nativeSubmit(handle, HOT_PREVIEW, deck, 0.0, generation, 0, 0)
                    }
                    if (generations[deck].get() == generation) nativeSubmit(handle, END, deck, 0.0, generation, 0, 0)
                    return
                }
            }
        }
    }

    @Synchronized override fun close() {
        if (handle == 0L) return
        generations.forEach { it.incrementAndGet() }
        executors.forEach { it.shutdownNow() }
        executors.forEach { executor ->
            while (!executor.awaitTermination(1, java.util.concurrent.TimeUnit.SECONDS)) { /* no native free before workers stop */ }
        }
        sources.forEach { it?.fd?.close() }
        nativeClose(handle)
        handle = 0
    }

    /** Test-only sink: exercises the same decoder, command queue and mixer without a device. */
    fun renderOfflineForTest(frames: Int): FloatArray {
        check(offline && handle != 0L)
        return nativeRenderOffline(handle, frames)
    }

    private fun rejected(reason: String) = CommandReceipt(0, false, reason)
    private external fun nativeOpen(offline: Boolean): Long
    private external fun nativeClose(handle: Long)
    private external fun nativeSubmit(handle: Long, op: Int, deck: Int, value: Double, generation: Long, rate: Int, channels: Int): Long
    private external fun nativeOffer(handle: Long, deck: Int, generation: Long, pcm: FloatArray, frames: Int): Int
    private external fun nativeSnapshot(handle: Long): DoubleArray
    private external fun nativeRenderOffline(handle: Long, frames: Int): FloatArray
}
