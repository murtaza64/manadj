package dev.manadj.audio

/**
 * Exact MP3 (MPEG-1/2/2.5 Layer III) frame index: byte offset of every audio frame, so a decode can start at
 * frame k knowing its exact sample position (k × samples per frame) — MediaExtractor's MP3 seek is TOC-estimated.
 * Skips an ID3v2 tag and the Xing/Info/VBRI header frame (not audio; the platform extractor skips it too).
 * [delay]/[padding]: LAME gapless header (null without one). Null from [parse] = not a parseable CBR/VBR
 * Layer III stream (free format, mixed sample rates, …): callers fall back to decoding from the start.
 */
internal class Mp3Frames private constructor(
    val bytes: ByteArray, val offsets: IntArray, val sizes: IntArray,
    val sampleRate: Int, val channels: Int, val samplesPerFrame: Int, val delay: Int?, val padding: Int?,
) {
    val count get() = offsets.size

    companion object {
        private val BITRATES_V1 = intArrayOf(0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)
        private val BITRATES_V2 = intArrayOf(0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)
        private val RATES = mapOf(3 to intArrayOf(44100, 48000, 32000), 2 to intArrayOf(22050, 24000, 16000), 0 to intArrayOf(11025, 12000, 8000))

        private class Header(val version: Int, val rate: Int, val size: Int, val samples: Int, val channels: Int, val sideInfo: Int)

        private fun header(b: ByteArray, at: Int): Header? {
            if (at + 4 > b.size) return null
            val b1 = b[at + 1].toInt() and 0xff; val b2 = b[at + 2].toInt() and 0xff; val b3 = b[at + 3].toInt() and 0xff
            if ((b[at].toInt() and 0xff) != 0xff || (b1 and 0xe0) != 0xe0) return null
            val version = (b1 shr 3) and 3
            if (version == 1 || ((b1 shr 1) and 3) != 1) return null // reserved version / not Layer III
            val bitrateIndex = b2 shr 4; val rateIndex = (b2 shr 2) and 3
            if (bitrateIndex == 0 || bitrateIndex == 15 || rateIndex == 3) return null // free format / bad
            val v1 = version == 3
            val rate = RATES.getValue(version)[rateIndex]
            val kbps = (if (v1) BITRATES_V1 else BITRATES_V2)[bitrateIndex]
            val size = (if (v1) 144 else 72) * kbps * 1000 / rate + ((b2 shr 1) and 1)
            val mono = (b3 shr 6) == 3
            return Header(version, rate, size, if (v1) 1152 else 576, if (mono) 1 else 2, if (v1) (if (mono) 17 else 32) else (if (mono) 9 else 17))
        }

        /** Byte offset just past the leading ID3v2 tag(s). */
        fun audioStart(b: ByteArray): Int {
            var at = 0
            while (at + 10 <= b.size && b[at] == 'I'.code.toByte() && b[at + 1] == 'D'.code.toByte() && b[at + 2] == '3'.code.toByte()) {
                val size = (b[at + 6].toInt() and 0x7f shl 21) or (b[at + 7].toInt() and 0x7f shl 14) or (b[at + 8].toInt() and 0x7f shl 7) or (b[at + 9].toInt() and 0x7f)
                at += 10 + size + if ((b[at + 5].toInt() and 0x10) != 0) 10 else 0
            }
            return at
        }

        /** First frame at/after [from]: a header whose successor also parses (no false sync in tag padding / junk). */
        private fun firstFrame(b: ByteArray, from: Int): Pair<Int, Header>? {
            var at = from
            while (at + 4 <= b.size) {
                val h = header(b, at)
                if (h != null && header(b, at + h.size)?.let { it.version == h.version && it.rate == h.rate } == true) return at to h
                at++
            }
            return null
        }

        private class Gapless(val headerFrame: Boolean, val delay: Int?, val padding: Int?)

        /**
         * The Xing/Info (after the side info) or VBRI (offset 36) frame marks a header frame, not audio. Its LAME
         * extension counts only under ffmpeg's rule (desktop = Chrome/ffmpeg): version string "LAME", "Lavc" or
         * "Lavf" exactly. Other encoders' strings ("Lame3.100", "55.2", …) leave the delay untrimmed on desktop,
         * though Android's extractor reads the same bytes regardless (#410).
         */
        private fun gapless(b: ByteArray, at: Int, first: Header): Gapless {
            val tag = at + 4 + first.sideInfo
            fun ascii(p: Int, s: String) = p + 4 <= b.size && (0 until 4).all { b[p + it] == s[it].code.toByte() }
            if (ascii(tag, "Xing") || ascii(tag, "Info")) {
                val flags = (0 until 4).fold(0) { acc, i -> (acc shl 8) or (b[tag + 4 + i].toInt() and 0xff) }
                var p = tag + 8
                if (flags and 1 != 0) p += 4; if (flags and 2 != 0) p += 4; if (flags and 4 != 0) p += 100; if (flags and 8 != 0) p += 4
                // LAME extension: 9-byte version, then 12 bytes in, 3 bytes of delay (12 bits) | padding (12 bits).
                if (p + 24 <= at + first.size && (ascii(p, "LAME") || ascii(p, "Lavc") || ascii(p, "Lavf"))) {
                    val x = p + 21
                    return Gapless(true, ((b[x].toInt() and 0xff) shl 4) or ((b[x + 1].toInt() and 0xff) shr 4),
                        ((b[x + 1].toInt() and 0x0f) shl 8) or (b[x + 2].toInt() and 0xff))
                }
                return Gapless(true, null, null)
            }
            return Gapless(ascii(at + 36, "VBRI"), null, null)
        }

        /**
         * Frames desktop trims from the decoder output start (ffmpeg: LAME delay + 529 decoder delay when the LAME
         * tag is recognised, else 0). [head] = the file from [audioStart], at least the first two frames.
         */
        fun desktopTrim(head: ByteArray): Int {
            val (at, first) = firstFrame(head, 0) ?: return 0
            return gapless(head, at, first).delay?.let { it + DECODER_DELAY } ?: 0
        }

        const val DECODER_DELAY = 529

        fun parse(b: ByteArray): Mp3Frames? {
            val found = firstFrame(b, audioStart(b)) ?: return null
            var at = found.first
            val first = found.second
            val offsets = ArrayList<Int>(b.size / 300)
            val sizes = ArrayList<Int>(b.size / 300)
            val tag = gapless(b, at, first)
            val delay = tag.delay
            val padding = tag.padding
            if (tag.headerFrame) at += first.size
            while (true) {
                val h = header(b, at) ?: break
                if (h.version != first.version || h.rate != first.rate || at + h.size > b.size) break
                offsets.add(at); sizes.add(h.size)
                at += h.size
            }
            if (offsets.size < 2) return null
            return Mp3Frames(b, offsets.toIntArray(), sizes.toIntArray(), first.rate, first.channels, first.samples, delay, padding)
        }
    }
}
