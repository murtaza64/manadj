package dev.manadj.library

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * A desktop MWF1 waveform blob (backend/waveform_data.py, ADR 0014), as
 * served for the 256-bin library preview. Values are quantized
 * `amp^gamma * 255`; [amplitude]/[band] dequantize like desktop blob.ts.
 */
class PreviewWaveform(
    val durationSecs: Double,
    val gamma: Float,
    val nBands: Int,
    /** Broadband max peaks, one byte per bin. */
    val peaks: ByteArray,
    /** Frame-major bins × nBands. */
    val bands: ByteArray,
) {
    val bins: Int get() = peaks.size
    val bandFrames: Int get() = if (nBands == 0) 0 else bands.size / nBands

    private fun dequant(q: Byte): Float = ((q.toInt() and 0xff) / 255f).toDouble().pow(1.0 / gamma).toFloat()

    /** Broadband peak amplitude 0..1 of [bin]. */
    fun amplitude(bin: Int): Float = dequant(peaks[bin])

    /** Amplitude 0..1 of band [b] (0 = lowest) at [frame]. */
    fun band(frame: Int, b: Int): Float = dequant(bands[frame * nBands + b])

    /**
     * Desktop's low/mid/high grouping (bands [0,3), [3,5), [5,8), RMS-combined)
     * for drawing the default additive style; values clamp to 1.
     */
    fun threeBand(frame: Int): FloatArray {
        val e = FloatArray(3)
        for (b in 0 until nBands) {
            val a = band(frame, b)
            e[if (b < 3) 0 else if (b < 5) 1 else 2] += a * a
        }
        return floatArrayOf(min(1f, sqrt(e[0])), min(1f, sqrt(e[1])), min(1f, sqrt(e[2])))
    }

    private val groups: Array<FloatArray> by lazy {
        val out = Array(3) { FloatArray(bandFrames) }
        for (f in 0 until bandFrames) threeBand(f).forEachIndexed { g, v -> out[g][f] = v }
        out
    }

    /** Per-bin low/mid/high amplitudes 0..1 (desktop default-style grouping). */
    val low: FloatArray get() = groups[0]
    val mid: FloatArray get() = groups[1]
    val high: FloatArray get() = groups[2]

    companion object {
        private const val HEADER_BYTES = 40

        fun parse(blob: ByteArray): PreviewWaveform {
            require(blob.size >= HEADER_BYTES + 8) { "waveform blob truncated (${blob.size} bytes)" }
            val buf = ByteBuffer.wrap(blob).order(ByteOrder.LITTLE_ENDIAN)
            val magic = String(blob, 0, 4, Charsets.US_ASCII)
            require(magic == "MWF1") { "waveform blob: bad magic $magic" }
            val version = buf.getShort(4).toInt()
            require(version == 1 || version == 2) { "waveform blob: unsupported version $version" }
            val duration = buf.getDouble(12)
            val nBands = blob[32].toInt() and 0xff
            val gamma = buf.getFloat(36)
            var off = HEADER_BYTES + (nBands + 1) * 4
            val peakCount = buf.getInt(off); off += 4
            val bandCount = buf.getInt(off); off += 4
            require(blob.size >= off + peakCount + bandCount * nBands) { "waveform blob truncated" }
            val peaks = blob.copyOfRange(off, off + peakCount)
            off += peakCount
            val bands = blob.copyOfRange(off, off + bandCount * nBands)
            return PreviewWaveform(duration, gamma, nBands, peaks, bands)
        }
    }
}

/** MPK1 pack from POST /api/device-sync/previews: id → MWF1 blob. */
object PreviewPack {
    fun parse(bytes: ByteArray): Map<Int, ByteArray> {
        require(bytes.size >= 8 && String(bytes, 0, 4, Charsets.US_ASCII) == "MPK1") { "bad preview pack" }
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val count = buf.getInt(4)
        var off = 8
        val out = LinkedHashMap<Int, ByteArray>(count)
        repeat(count) {
            val id = buf.getInt(off)
            val len = buf.getInt(off + 4)
            off += 8
            require(off + len <= bytes.size) { "preview pack truncated" }
            out[id] = bytes.copyOfRange(off, off + len)
            off += len
        }
        return out
    }
}
