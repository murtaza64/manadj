package dev.manadj.audio

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaFormat
import java.nio.ByteOrder

/**
 * Raw MP3 decode from frame [from] (fresh codec, no gapless keys: the platform decoder then trims nothing), fed
 * from an exact [Mp3Frames] index. Output sample m is raw stream sample from × samplesPerFrame + m — the same
 * value a decode from frame 0 produces there, once [PREROLL] frames have rebuilt the decoder state (bit
 * reservoir, overlap, synthesis filterbank). [onChunk] gets interleaved stereo float, the raw sample index of
 * its first frame and the frame count; return false to stop.
 */
internal class Mp3Decoder(private val frames: Mp3Frames) {
    companion object {
        /** Frames decoded and discarded before the first kept sample. */
        const val PREROLL = 10 // probe: 4 was already bit-exact on VBR (bit reservoir); margin for low bitrates
    }

    fun decode(from: Int, onChunk: (samples: FloatArray, firstRawSample: Long, count: Int) -> Boolean) {
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_MPEG, frames.sampleRate, frames.channels)
        val codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_MPEG)
        try {
            format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_FLOAT)
            try { codec.configure(format, null, null, 0) } catch (_: Exception) {
                codec.reset(); format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT); codec.configure(format, null, null, 0)
            }
            codec.start()
            var encoding = codec.outputFormat.let { if (it.containsKey(MediaFormat.KEY_PCM_ENCODING)) it.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT }
            var channels = frames.channels
            val info = MediaCodec.BufferInfo()
            var next = from.coerceIn(0, frames.count)
            var inputDone = false
            var produced = from.toLong() * frames.samplesPerFrame
            var out = FloatArray(8192 * 2)
            while (true) {
                if (!inputDone) {
                    val input = codec.dequeueInputBuffer(2_000)
                    if (input >= 0) {
                        val buffer = codec.getInputBuffer(input) ?: error("Missing codec input")
                        if (next >= frames.count) { codec.queueInputBuffer(input, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                        else {
                            buffer.clear(); buffer.put(frames.bytes, frames.offsets[next], frames.sizes[next])
                            codec.queueInputBuffer(input, 0, frames.sizes[next], next.toLong() * frames.samplesPerFrame * 1_000_000L / frames.sampleRate, 0)
                            next++
                        }
                    }
                }
                val output = codec.dequeueOutputBuffer(info, 2_000)
                if (output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val f = codec.outputFormat
                    if (f.containsKey(MediaFormat.KEY_PCM_ENCODING)) encoding = f.getInteger(MediaFormat.KEY_PCM_ENCODING)
                    if (f.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                } else if (output >= 0) {
                    val eos = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                    var keepGoing = true
                    if (info.size > 0) {
                        val b = codec.getOutputBuffer(output)!!.order(ByteOrder.LITTLE_ENDIAN)
                        val float = encoding == AudioFormat.ENCODING_PCM_FLOAT
                        val bytes = if (float) 4 else 2
                        val n = info.size / (bytes * channels)
                        if (out.size < n * 2) out = FloatArray(n * 2)
                        for (i in 0 until n) {
                            val at = info.offset + i * bytes * channels
                            val l = if (float) b.getFloat(at) else b.getShort(at) / 32768f
                            val r = if (channels > 1) (if (float) b.getFloat(at + bytes) else b.getShort(at + bytes) / 32768f) else l
                            out[2 * i] = l; out[2 * i + 1] = r
                        }
                        keepGoing = onChunk(out, produced, n)
                        produced += n
                    }
                    codec.releaseOutputBuffer(output, false)
                    if (eos || !keepGoing) return
                }
            }
        } finally {
            runCatching { codec.stop() }; codec.release()
        }
    }
}
