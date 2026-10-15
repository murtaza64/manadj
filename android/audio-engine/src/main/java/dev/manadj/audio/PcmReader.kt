package dev.manadj.audio

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.Closeable
import java.io.FileDescriptor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.roundToLong

/**
 * Incremental decoder for one source, owned by one deck worker thread. Seeks
 * happen in place (extractor seek + codec flush); the codec is never recreated.
 * Output is interleaved stereo float in [samples].
 */
internal abstract class PcmReader(protected val extractor: MediaExtractor, format: MediaFormat) : Closeable {
    val durationSeconds: Double? = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) / 1e6 else null
    var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        protected set
    protected var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    protected var encoding = if (format.containsKey(MediaFormat.KEY_PCM_ENCODING)) format.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
    var samples = FloatArray(8192 * 2)
        private set
    /** Source seconds of the first frame returned by the last successful [read]. */
    var chunkStartSeconds = 0.0
        private set
    private var skipUntilUs = 0L

    open fun seek(seconds: Double) {
        val us = (seconds * 1e6).roundToLong()
        extractor.seekTo(us, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
        skipUntilUs = us
    }

    /** Frames decoded (>0), 0 if nothing is ready yet, -1 at end of stream. */
    abstract fun read(): Int

    protected fun validate() {
        require(channels in 1..8 && sampleRate in 8000..192000) { "Unsupported PCM layout: $channels ch @ $sampleRate Hz" }
        require(encoding in SUPPORTED_ENCODINGS) { "Unsupported PCM encoding $encoding" }
    }

    /** Converts [buffer] (position..limit) starting at [ptsUs], dropping frames before the seek target. */
    protected fun convert(buffer: ByteBuffer, ptsUs: Long): Int {
        validate()
        buffer.order(ByteOrder.LITTLE_ENDIAN)
        val bytesPerSample = when (encoding) {
            AudioFormat.ENCODING_PCM_8BIT -> 1
            AudioFormat.ENCODING_PCM_16BIT -> 2
            AudioFormat.ENCODING_PCM_24BIT_PACKED -> 3
            else -> 4
        }
        val frameBytes = bytesPerSample * channels
        val total = buffer.remaining() / frameBytes
        val skip = ((skipUntilUs - ptsUs).coerceAtLeast(0) * sampleRate / 1_000_000L).coerceAtMost(total.toLong()).toInt()
        val frames = total - skip
        if (frames <= 0) return 0
        skipUntilUs = 0
        chunkStartSeconds = ptsUs / 1e6 + skip.toDouble() / sampleRate
        if (samples.size < frames * 2) samples = FloatArray(max(frames * 2, samples.size * 2))
        val out = samples
        var at = buffer.position() + skip * frameBytes
        for (i in 0 until frames) {
            val left = sample(buffer, at)
            val right = if (channels > 1) sample(buffer, at + bytesPerSample) else left
            out[2 * i] = left
            out[2 * i + 1] = right
            at += frameBytes
        }
        return frames
    }

    private fun sample(b: ByteBuffer, at: Int): Float = when (encoding) {
        AudioFormat.ENCODING_PCM_8BIT -> ((b.get(at).toInt() and 0xff) - 128) / 128f
        AudioFormat.ENCODING_PCM_16BIT -> b.getShort(at) / 32768f
        AudioFormat.ENCODING_PCM_24BIT_PACKED ->
            (((b.get(at).toInt() and 0xff) or ((b.get(at + 1).toInt() and 0xff) shl 8) or (b.get(at + 2).toInt() shl 16))) / 8388608f
        AudioFormat.ENCODING_PCM_32BIT -> b.getInt(at) / 2147483648f
        else -> b.getFloat(at)
    }

    companion object {
        private val SUPPORTED_ENCODINGS = setOf(
            AudioFormat.ENCODING_PCM_8BIT, AudioFormat.ENCODING_PCM_16BIT, AudioFormat.ENCODING_PCM_FLOAT,
            AudioFormat.ENCODING_PCM_24BIT_PACKED, AudioFormat.ENCODING_PCM_32BIT,
        )

        fun open(fd: FileDescriptor): PcmReader {
            val extractor = MediaExtractor()
            try {
                extractor.setDataSource(fd)
                val track = (0 until extractor.trackCount).firstOrNull {
                    extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
                } ?: error("No audio track")
                extractor.selectTrack(track)
                val format = extractor.getTrackFormat(track)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: error("Unknown audio format")
                return if (mime == MediaFormat.MIMETYPE_AUDIO_RAW) RawReader(extractor, format) else CodecReader(extractor, format, mime)
            } catch (e: Exception) {
                extractor.release()
                throw e
            }
        }
    }
}

private class RawReader(extractor: MediaExtractor, format: MediaFormat) : PcmReader(extractor, format) {
    private val packet = ByteBuffer.allocateDirect(256 * 1024)

    override fun read(): Int {
        while (true) {
            packet.clear()
            val bytes = extractor.readSampleData(packet, 0)
            if (bytes < 0) return -1
            val pts = extractor.sampleTime
            packet.position(0)
            packet.limit(bytes)
            extractor.advance()
            val frames = convert(packet, pts)
            if (frames > 0) return frames
        }
    }

    override fun close() = extractor.release()
}

private const val MP3_DECODER_DELAY = 529

private class CodecReader(extractor: MediaExtractor, format: MediaFormat, mime: String) : PcmReader(extractor, format) {
    private val codec = MediaCodec.createDecoderByType(mime)
    private val info = MediaCodec.BufferInfo()
    private val csd = (0..2).mapNotNull { format.getByteBuffer("csd-$it")?.duplicate() }
    private var inputDone = false
    private var outputDone = false
    private var queuedInput = false
    private var outputSeen = false
    private var seeked = false
    /**
     * MP3 timing vs desktop (Chrome decodeAudioData = ffmpeg gapless), measured on Android 15/16 (emulator API 35,
     * Nothing phone API 36; AudioEngineTest.codecPrimingMatchesTheWav): with a LAME/Xing header the platform output
     * from the start is late by encoder delay + padding while desktop trims to the exact WAV alignment; without a
     * header the platform drops the 529-frame decoder delay that desktop keeps. AAC (MP4 edit list) needs nothing
     * (the extractor's negative PTS already trims the priming). After a seek the MP3 extractor's TOC-estimated PTS
     * is only approximate (tens of ms); the whole-track decode (from the start) is the exact path.
     */
    private val mp3ShiftUs: Long = if (mime != MediaFormat.MIMETYPE_AUDIO_MPEG) 0 else {
        val rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE).toLong()
        if (format.containsKey(MediaFormat.KEY_ENCODER_DELAY)) {
            val delay = format.getInteger(MediaFormat.KEY_ENCODER_DELAY)
            val padding = if (format.containsKey(MediaFormat.KEY_ENCODER_PADDING)) format.getInteger(MediaFormat.KEY_ENCODER_PADDING) else 0
            -(delay + padding) * 1_000_000L / rate
        } else MP3_DECODER_DELAY * 1_000_000L / rate
    }

    init {
        try {
            try {
                // Ask for float output (no 16-bit truncation); decoders may ignore or refuse it.
                format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_FLOAT)
                codec.configure(format, null, null, 0)
            } catch (_: Exception) {
                codec.reset()
                format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
                codec.configure(format, null, null, 0)
            }
            codec.start()
            adopt(codec.outputFormat)
        } catch (e: Exception) {
            codec.release()
            throw e
        }
    }

    private fun adopt(f: MediaFormat) {
        if (f.containsKey(MediaFormat.KEY_SAMPLE_RATE)) sampleRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        if (f.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        encoding = if (f.containsKey(MediaFormat.KEY_PCM_ENCODING)) f.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
    }

    override fun seek(seconds: Double) {
        super.seek(seconds)
        seeked = true
        if (queuedInput) {
            codec.flush()
            // A flush before the first output drops codec-specific data; resubmit it.
            if (!outputSeen) for (config in csd) {
                val input = codec.dequeueInputBuffer(100_000)
                if (input < 0) error("Codec input unavailable after flush")
                val buffer = codec.getInputBuffer(input) ?: error("Missing codec input")
                buffer.clear()
                buffer.put(config.duplicate().apply { rewind() })
                codec.queueInputBuffer(input, 0, buffer.position(), 0, MediaCodec.BUFFER_FLAG_CODEC_CONFIG)
            }
        }
        inputDone = false
        outputDone = false
    }

    override fun read(): Int {
        if (outputDone) return -1
        repeat(8) {
            if (!inputDone) {
                val input = codec.dequeueInputBuffer(2_000)
                if (input >= 0) {
                    val buffer = codec.getInputBuffer(input) ?: error("Missing codec input")
                    val n = extractor.readSampleData(buffer, 0)
                    if (n < 0) { codec.queueInputBuffer(input, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                    else { codec.queueInputBuffer(input, 0, n, extractor.sampleTime, 0); extractor.advance() }
                    queuedInput = true
                }
            }
            val output = codec.dequeueOutputBuffer(info, 5_000)
            when {
                output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    outputSeen = true
                    adopt(codec.outputFormat)
                    validate()
                }
                output >= 0 -> {
                    outputSeen = true
                    val frames = try {
                        val buffer = codec.getOutputBuffer(output) ?: error("Missing codec output")
                        buffer.position(info.offset)
                        buffer.limit(info.offset + info.size)
                        // The header shift is a from-the-start property; after a seek only the decoder-delay one holds.
                        val shift = if (seeked && mp3ShiftUs < 0) 0 else mp3ShiftUs
                        if (info.size > 0) convert(buffer, info.presentationTimeUs + shift) else 0
                    } finally { codec.releaseOutputBuffer(output, false) }
                    if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true
                    if (frames > 0) return frames
                    if (outputDone) return -1
                }
                output == MediaCodec.INFO_TRY_AGAIN_LATER && inputDone -> Unit
            }
        }
        return 0
    }

    override fun close() {
        try { codec.stop() } catch (_: Exception) {}
        finally { codec.release(); extractor.release() }
    }
}
