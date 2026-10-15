package dev.manadj.app.session

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import dev.manadj.library.DetailWaveform
import java.io.File
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Where this phone's decoder puts a track's audio in track time, against the desktop (the reference:
 * Session positions are desktop decode time). Decodes the first [SECONDS] like the engine does
 * (MediaExtractor + MediaCodec, sample time from presentation timestamps), rebuilds desktop-style peaks
 * (max-abs, 128 samples at 44.1 kHz) and cross-correlates them with the desktop detail waveform peaks.
 * [offsetMs] > 0: the phone hears the track that much LATE (e.g. MP3 encoder delay kept instead of trimmed).
 */
object DecodeProbe {
    const val SECONDS = 45.0

    /**
     * [offsetMs]: raw platform decode (presentation timestamps as-is) vs desktop. [engineOffsetMs]: after the engine's
     * MP3 timing rule (android-engine xrnkr PcmReader: LAME/Xing header → -(delay+padding), none → +529 frames).
     */
    data class Result(val mime: String, val sampleRate: Int, val encoderDelay: Int?, val encoderPadding: Int?, val firstPtsUs: Long, val offsetMs: Double?, val score: Double) {
        val engineShiftMs: Double get() = if (mime != MediaFormat.MIMETYPE_AUDIO_MPEG) 0.0
            else if (encoderDelay != null) -(encoderDelay + (encoderPadding ?: 0)) * 1000.0 / sampleRate else 529 * 1000.0 / sampleRate
        val engineOffsetMs: Double? get() = offsetMs?.let { it + engineShiftMs }
    }

    fun run(file: File, desktop: DetailWaveform): Result {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(file.path)
            val track = (0 until ex.trackCount).first { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
            ex.selectTrack(track)
            val format = ex.getTrackFormat(track)
            val mime = format.getString(MediaFormat.KEY_MIME)!!
            val delay = if (format.containsKey(MediaFormat.KEY_ENCODER_DELAY)) format.getInteger(MediaFormat.KEY_ENCODER_DELAY) else null
            val padding = if (format.containsKey(MediaFormat.KEY_ENCODER_PADDING)) format.getInteger(MediaFormat.KEY_ENCODER_PADDING) else null
            var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            val mono = FloatArray((SECONDS * rate * 1.2).toInt() + rate)
            var n = 0
            var firstPts = Long.MIN_VALUE
            if (mime == MediaFormat.MIMETYPE_AUDIO_RAW) error("raw PCM: no decoder offset")
            val codec = MediaCodec.createDecoderByType(mime)
            try {
                format.setInteger(MediaFormat.KEY_PCM_ENCODING, android.media.AudioFormat.ENCODING_PCM_16BIT)
                codec.configure(format, null, null, 0); codec.start()
                val info = MediaCodec.BufferInfo()
                var inputDone = false
                while (n < mono.size - 16384) {
                    if (!inputDone) {
                        val i = codec.dequeueInputBuffer(5_000)
                        if (i >= 0) {
                            val b = codec.getInputBuffer(i)!!
                            val size = ex.readSampleData(b, 0)
                            if (size < 0) { codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                            else { codec.queueInputBuffer(i, 0, size, ex.sampleTime, 0); ex.advance() }
                        }
                    }
                    val o = codec.dequeueOutputBuffer(info, 5_000)
                    if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        codec.outputFormat.let { f -> rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE); channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT) }
                    } else if (o >= 0) {
                        val b = codec.getOutputBuffer(o)!!.order(ByteOrder.LITTLE_ENDIAN)
                        b.position(info.offset); b.limit(info.offset + info.size)
                        val frames = info.size / (2 * channels)
                        if (frames > 0 && firstPts == Long.MIN_VALUE) firstPts = info.presentationTimeUs
                        val s = b.asShortBuffer()
                        for (f in 0 until min(frames, mono.size - n)) {
                            var acc = 0f
                            for (c in 0 until channels) acc += s.get(f * channels + c) / 32768f
                            mono[n++] = acc / channels
                        }
                        codec.releaseOutputBuffer(o, false)
                        if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break
                    }
                }
            } finally { codec.stop(); codec.release() }
            // Engine semantics: sample k sits at firstPts + k / rate in track time.
            val start = firstPts / 1e6
            val hop = desktop.secondsPerPeak
            val bins = min(desktop.bins, ((start + n.toDouble() / rate) / hop).toInt() - 1)
            val phone = FloatArray(bins)
            for (k in 0 until bins) {
                val a = ((k * hop - start) * rate).toInt(); val b = (((k + 1) * hop - start) * rate).toInt()
                var m = 0f
                for (i in max(0, a) until min(n, b)) m = max(m, abs(mono[i]))
                phone[k] = m
            }
            val ref = FloatArray(bins) { desktop.amplitude(it) }
            val (lag, score) = bestLag(ref, phone, (2.0 / hop).toInt(), bins - (1.0 / hop).toInt(), (0.2 / hop).toInt())
            return Result(mime, rate, delay, padding, firstPts, lag?.let { it * hop * 1000 }, score)
        } finally { ex.release() }
    }

    /** Lag (bins, sub-bin by parabola) maximising normalized correlation of phone[k + lag] with ref[k]. */
    private fun bestLag(ref: FloatArray, phone: FloatArray, from: Int, to: Int, maxLag: Int): Pair<Double?, Double> {
        fun corr(lag: Int): Double {
            var sxy = 0.0; var sx = 0.0; var sy = 0.0; var sxx = 0.0; var syy = 0.0; var c = 0
            for (k in from until to) {
                val j = k + lag
                if (j !in phone.indices) continue
                val x = ref[k].toDouble(); val y = phone[j].toDouble()
                sxy += x * y; sx += x; sy += y; sxx += x * x; syy += y * y; c++
            }
            if (c < 100) return -1.0
            val cov = sxy - sx * sy / c; val vx = sxx - sx * sx / c; val vy = syy - sy * sy / c
            return if (vx <= 0 || vy <= 0) -1.0 else cov / sqrt(vx * vy)
        }
        val scores = DoubleArray(2 * maxLag + 1) { corr(it - maxLag) }
        val i = scores.indices.maxBy { scores[it] }
        if (scores[i] < .5) return null to scores[i]
        val refine = if (i in 1 until scores.size - 1) { val a = scores[i - 1]; val b = scores[i]; val c = scores[i + 1]; val d = a - 2 * b + c; if (d < 0) .5 * (a - c) / d else 0.0 } else 0.0
        return (i - maxLag + refine) to scores[i]
    }
}
