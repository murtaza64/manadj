package dev.manadj.app

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

/**
 * Desktop-compatible waveform data (backend/waveform_data.py, MWF1 v2 layout): sqrt-gamma u8 broadband
 * peaks on a fine grid and 8 log-spaced band amplitudes on a coarser grid. The renderer is
 * style-agnostic over this, exactly like WaveformRendererV2.
 */
class WaveformData(
    val sampleRate: Int, val duration: Double, val peakHop: Int, val bandHop: Int, val stftWindow: Int,
    val peaks: ByteArray, val bands: ByteArray, val frames: Int, val complete: Boolean = true,
) {
    val framesPerSecond get() = sampleRate.toDouble() / bandHop

    companion object {
        const val N_BANDS = 8
        val BAND_EDGES = floatArrayOf(20f, 60f, 150f, 400f, 1000f, 2500f, 6000f, 12000f, 20000f)

        /** Parses a backend MWF1 blob (what #372 will ship from the desktop library). */
        fun parseMwf1(blob: ByteArray): WaveformData {
            val b = ByteBuffer.wrap(blob).order(ByteOrder.LITTLE_ENDIAN)
            val magic = ByteArray(4).also { b.get(it) }
            require(String(magic) == "MWF1") { "not an MWF1 blob" }
            b.short; b.short
            val sr = b.int; val duration = b.double; val peakHop = b.int; val bandHop = b.int; val window = b.int
            val nBands = b.get().toInt(); b.get(); b.get(); b.get(); b.float
            repeat(nBands + 1) { b.float }
            val peakCount = b.int; val bandCount = b.int
            val peaks = ByteArray(peakCount).also { b.get(it) }
            val bands = ByteArray(bandCount * nBands).also { b.get(it) }
            require(nBands == N_BANDS)
            return WaveformData(sr, duration, peakHop, bandHop, window, peaks, bands, bandCount)
        }
    }
}

/**
 * Phone-side analysis from decoded PCM until #372 ships desktop analysis: same band edges, hop, gamma and
 * normalization as the backend (one 1024-point Hann window for all bands instead of the backend's
 * multi-resolution set). Publishes partial results so the waveform fills in while decoding.
 */
object WaveformAnalyzer {
    private const val FFT = 1024
    private const val BAND_HOP = 512
    private const val PEAK_HOP = 128

    fun analyze(context: Context, uri: Uri, durationHint: Double?, cancelled: () -> Boolean, progress: (WaveformData) -> Unit): WaveformData? {
        val extractor = MediaExtractor()
        try {
            context.contentResolver.openFileDescriptor(uri, "r")?.use { extractor.setDataSource(it.fileDescriptor) } ?: return null
            val track = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true } ?: return null
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            val mime = format.getString(MediaFormat.KEY_MIME)!!
            var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            val duration = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) / 1e6 else durationHint ?: 0.0
            val codec = MediaCodec.createDecoderByType(mime)
            codec.configure(format, null, null, 0); codec.start()
            var encoding = AudioFormat.ENCODING_PCM_16BIT
            val estimate = ((duration + 1) * rate).toInt().coerceAtLeast(rate)
            val acc = Accumulator(rate, estimate)
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var lastPublish = 0
            try {
                while (!cancelled()) {
                    if (!inputDone) {
                        val i = codec.dequeueInputBuffer(5_000)
                        if (i >= 0) {
                            val n = extractor.readSampleData(codec.getInputBuffer(i)!!, 0)
                            if (n < 0) { codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                            else { codec.queueInputBuffer(i, 0, n, extractor.sampleTime, 0); extractor.advance() }
                        }
                    }
                    val o = codec.dequeueOutputBuffer(info, 5_000)
                    if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        val f = codec.outputFormat
                        rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE); channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        if (f.containsKey(MediaFormat.KEY_PCM_ENCODING)) encoding = f.getInteger(MediaFormat.KEY_PCM_ENCODING)
                        acc.rate = rate
                    } else if (o >= 0) {
                        val buffer = codec.getOutputBuffer(o)!!.order(ByteOrder.LITTLE_ENDIAN)
                        buffer.position(info.offset); buffer.limit(info.offset + info.size)
                        acc.push(buffer, channels, encoding)
                        codec.releaseOutputBuffer(o, false)
                        if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break
                        if (acc.frames - lastPublish > 400) { lastPublish = acc.frames; progress(acc.snapshot(duration, false)) }
                    }
                }
            } finally { codec.stop(); codec.release() }
            if (cancelled()) return null
            return acc.snapshot(acc.samples.toDouble() / rate, true).also(progress)
        } catch (e: Exception) {
            return null
        } finally { extractor.release() }
    }

    private class Accumulator(var rate: Int, estimate: Int) {
        var mono = FloatArray(estimate); var samples = 0
        var peaks = ByteArray(estimate / PEAK_HOP + 1); var peakCount = 0
        var bands = ByteArray((estimate / BAND_HOP + 1) * 8); var frames = 0
        private val hann = FloatArray(FFT) { (0.5 - 0.5 * cos(2 * PI * it / FFT)).toFloat() }
        private val rmsW = sqrt(hann.map { it * it }.average()).toFloat()
        private val re = FloatArray(FFT); private val im = FloatArray(FFT)

        fun push(b: ByteBuffer, channels: Int, encoding: Int) {
            val bytes = when (encoding) { AudioFormat.ENCODING_PCM_FLOAT -> 4; AudioFormat.ENCODING_PCM_8BIT -> 1; AudioFormat.ENCODING_PCM_24BIT_PACKED -> 3; AudioFormat.ENCODING_PCM_32BIT -> 4; else -> 2 }
            val count = b.remaining() / (bytes * channels)
            if (samples + count > mono.size) mono = mono.copyOf(max(mono.size * 3 / 2, samples + count))
            for (f in 0 until count) {
                var sum = 0f
                for (c in 0 until channels) sum += when (encoding) {
                    AudioFormat.ENCODING_PCM_FLOAT -> b.float
                    AudioFormat.ENCODING_PCM_8BIT -> ((b.get().toInt() and 0xff) - 128) / 128f
                    AudioFormat.ENCODING_PCM_24BIT_PACKED -> { val lo = b.get().toInt() and 0xff; val mid = b.get().toInt() and 0xff; val hi = b.get().toInt(); ((hi shl 16) or (mid shl 8) or lo) / 8388608f }
                    AudioFormat.ENCODING_PCM_32BIT -> b.int / 2147483648f
                    else -> b.short / 32768f
                }
                mono[samples++] = sum / channels
            }
            drain()
        }

        private fun drain() {
            while ((peakCount + 1) * PEAK_HOP <= samples) {
                var m = 0f; val s = peakCount * PEAK_HOP
                for (i in s until s + PEAK_HOP) m = max(m, abs(mono[i]))
                if (peakCount >= peaks.size) peaks = peaks.copyOf(peaks.size * 3 / 2 + 1)
                peaks[peakCount++] = quantize(m)
            }
            // Frame f is centered at f*hop + FFT/2 (backend alignment anchor).
            while (frames * BAND_HOP + FFT <= samples) {
                val s = frames * BAND_HOP
                for (i in 0 until FFT) { re[i] = mono[s + i] * hann[i]; im[i] = 0f }
                fft(re, im)
                if ((frames + 1) * 8 > bands.size) bands = bands.copyOf(bands.size * 3 / 2 + 8)
                for (band in 0 until 8) {
                    val lo = ceil(WaveformData.BAND_EDGES[band] * FFT / rate).toInt(); val hi = min(FFT / 2, ceil(WaveformData.BAND_EDGES[band + 1] * FFT / rate).toInt() - 1)
                    var power = 0f
                    for (k in lo..hi) power += re[k] * re[k] + im[k] * im[k]
                    bands[frames * 8 + band] = quantize(2f * sqrt(power) / (FFT * rmsW))
                }
                frames++
            }
        }

        fun snapshot(duration: Double, complete: Boolean) = WaveformData(rate, duration, PEAK_HOP, BAND_HOP, FFT, peaks.copyOf(peakCount), bands.copyOf(frames * 8), frames, complete)
        private fun quantize(a: Float) = (sqrt(a.coerceIn(0f, 1f)) * 255f + .5f).toInt().toByte()

        private fun fft(re: FloatArray, im: FloatArray) {
            val n = re.size
            var j = 0
            for (i in 1 until n) { var bit = n shr 1; while (j and bit != 0) { j = j xor bit; bit = bit shr 1 }; j = j xor bit; if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t } }
            var len = 2
            while (len <= n) {
                val ang = -2 * PI / len; val wr = cos(ang).toFloat(); val wi = sin(ang).toFloat()
                var i = 0
                while (i < n) {
                    var cr = 1f; var ci = 0f
                    for (k in 0 until len / 2) {
                        val a = i + k; val b = a + len / 2
                        val tr = re[b] * cr - im[b] * ci; val ti = re[b] * ci + im[b] * cr
                        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
                        val ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr
                    }
                    i += len
                }
                len = len shl 1
            }
        }
    }
}

/** Live strip as the waveform should show it: desktop DeckPanel liveStrip (EQ gain per group, trim gain on height). */
/** [stems]: audible-stem bitmask (bit i = AudioEngine.STEM_NAMES[i]; [ALL_STEMS] = the plain mix). */
data class Strip(val gain: Float = 1f, val low: Float = 1f, val mid: Float = 1f, val high: Float = 1f, val stems: Int = ALL_STEMS)
const val ALL_STEMS = 0b1111

/**
 * Desktop stem composite (WaveformRendererV2 fetchLoV/fetchPeakV): the audible stems' waveforms combined in
 * the linear domain — bands as a power sum, peaks as a clamped sum — re-encoded (bytes are amp^(1/2)).
 * Null when the stems don't share the mix's band layout.
 */
fun stemComposite(mix: WaveformData, stems: List<WaveformData>, mask: Int): WaveformData? {
    if (stems.size != 4 || stems.any { it.bandHop != mix.bandHop || it.sampleRate != mix.sampleRate || it.peakHop != mix.peakHop }) return null
    val frames = minOf(mix.frames, stems.minOf { it.frames })
    val bands = ByteArray(frames * 8)
    for (i in 0 until frames * 8) {
        var e = 0f
        for (s in 0..3) if (mask and (1 shl s) != 0) { val v = (stems[s].bands[i].toInt() and 0xff) / 255f; val a = v * v; e += a * a }
        bands[i] = (kotlin.math.sqrt(kotlin.math.sqrt(e).coerceAtMost(1f)) * 255 + .5f).toInt().toByte()
    }
    val peakCount = minOf(mix.peaks.size, stems.minOf { it.peaks.size })
    val peaks = ByteArray(peakCount)
    for (i in 0 until peakCount) {
        var a = 0f
        for (s in 0..3) if (mask and (1 shl s) != 0) { val v = (stems[s].peaks[i].toInt() and 0xff) / 255f; a += v * v }
        peaks[i] = (kotlin.math.sqrt(a.coerceAtMost(1f)) * 255 + .5f).toInt().toByte()
    }
    return WaveformData(mix.sampleRate, mix.duration, mix.peakHop, mix.bandHop, mix.stftWindow, peaks, bands, frames)
}

fun eqValueToGain(value: Double): Float { val v = value.coerceIn(0.0, 1.0); return (if (v >= .5) 10.0.pow((v - .5) * 12 / 20) else v / .5).toFloat() }
fun trimToRelativeGain(value: Double) = 10.0.pow((value.coerceIn(0.0, 1.0) - .5) * 24 / 20).toFloat()

/** Past-preserving modulation: behind the playhead the waveform shows the strip as it was when that audio played. */
class StripHistory {
    private var times = DoubleArray(256); private var values = arrayOfNulls<Strip>(256); private var n = 0
    fun clear() { n = 0 }
    fun record(t: Double, strip: Strip) {
        while (n > 0 && times[n - 1] > t) n-- // Seek backward: the future is unheard again.
        if (n > 0 && values[n - 1] == strip) return
        if (n == times.size) { times = times.copyOf(n * 2); values = values.copyOf(n * 2) }
        times[n] = t; values[n] = strip; n++
    }
    fun at(t: Double, live: Strip): Strip {
        if (n == 0 || t >= times[n - 1] + 0.05) return live
        var lo = 0; var hi = n - 1
        if (t < times[0]) return values[0]!!
        while (lo < hi) { val mid = (lo + hi + 1) / 2; if (times[mid] <= t) lo = mid else hi = mid - 1 }
        return values[lo]!!
    }
}
