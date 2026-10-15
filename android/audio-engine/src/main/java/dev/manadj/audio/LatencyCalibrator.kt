package dev.manadj.audio

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTimestamp
import android.media.MediaRecorder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** The calibration chirp (native Engine::clickSample): Hann-windowed linear 400 Hz → 6 kHz over [SECONDS], peak .7. */
object CalibrationClick {
    const val SECONDS = .012
    fun sample(t: Double): Double {
        if (t < 0 || t >= SECONDS) return 0.0
        val window = .5 - .5 * cos(2 * PI * t / SECONDS)
        return .7 * window * sin(2 * PI * (400 * t + (6000 - 400) * t * t / (2 * SECONDS)))
    }
}

/**
 * Acoustic output latency (#382): the engine plays calibration chirps, the phone mic records them, and a
 * matched filter finds each arrival. L = arrival (mic capture time, AudioRecord timestamp) − render
 * instant (engine callback clock), so it includes Bluetooth/codec delay that Android under-reports.
 * Blocking (~[count] × [intervalSeconds] + 1.5 s); call off the main thread with RECORD_AUDIO granted.
 */
class LatencyCalibrator(private val context: Context) {
    data class Result(
        /** Median latency in seconds, or null when the measurement is not trustworthy ([reason]). */
        val seconds: Double?, val samples: List<Double>, val spreadMillis: Double, val reason: String? = null,
        /** Mic path diagnostics: per rendered click, matched-filter peak / RMS of the search window (SNR, linear). */
        val snr: List<Double> = emptyList(),
    )

    @SuppressLint("MissingPermission")
    fun measure(engine: AudioEngine, count: Int = 8, intervalSeconds: Double = 1.0): Result {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            return Result(null, emptyList(), 0.0, "Microphone permission needed")
        val rate = MIC_RATE
        val format = AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(rate)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO).build()
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
        val record = listOf(MediaRecorder.AudioSource.UNPROCESSED, MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC)
            .firstNotNullOfOrNull { source ->
                runCatching {
                    AudioRecord.Builder().setAudioSource(source).setAudioFormat(format).setBufferSizeInBytes(maxOf(min, rate * 4 / 5)).build()
                        .takeIf { it.state == AudioRecord.STATE_INITIALIZED }
                }.getOrNull()
            } ?: return Result(null, emptyList(), 0.0, "Microphone unavailable")
        // The phone's own mic: a Bluetooth headset mic would pull the route into SCO and silence A2DP output.
        context.getSystemService(android.media.AudioManager::class.java).getDevices(android.media.AudioManager.GET_DEVICES_INPUTS)
            .firstOrNull { it.type == android.media.AudioDeviceInfo.TYPE_BUILTIN_MIC }?.let { record.setPreferredDevice(it) }
        val total = ((PRE_ROLL + .1 + (count + 1) * intervalSeconds) * rate).toInt()
        val mic = FloatArray(total)
        val stamp = AudioTimestamp()
        var stamped = false
        try {
            record.startRecording()
            var read = 0
            var started = false
            while (read < total) {
                val n = record.read(mic, read, minOf(4800, total - read), AudioRecord.READ_BLOCKING)
                if (n <= 0) return Result(null, emptyList(), 0.0, "Microphone read failed ($n)")
                read += n
                if (!started && read >= PRE_ROLL * rate) {
                    if (!engine.startCalibrationClicks(count, intervalSeconds).accepted) return Result(null, emptyList(), 0.0, "Engine refused clicks")
                    started = true
                }
                if (record.getTimestamp(stamp, AudioTimestamp.TIMEBASE_MONOTONIC) == AudioRecord.SUCCESS) stamped = true
            }
        } finally {
            runCatching { record.stop() }
            record.release()
        }
        if (!stamped) return Result(null, emptyList(), 0.0, "No microphone timestamp")
        return analyze(mic, rate, stamp.framePosition, stamp.nanoTime, engine.clickNanos().take(count).toLongArray(), intervalSeconds * .95)
    }

    companion object {
        const val MIC_RATE = 48000
        /** Matched-filter peak must exceed this × the window's RMS correlation. */
        const val MIN_SNR = 5.0
        private const val PRE_ROLL = .3
        /** Tap-along: accented clicks every [TAP_PERIOD] s (≈110 BPM, comfortable to tap). */
        const val TAP_PERIOD = .55
        /** Reaction pre-pass: [REACTION_CLICKS] slow clicks to estimate L coarsely (resolves the tap period wrap). */
        const val REACTION_CLICKS = 4
        const val REACTION_PERIOD = 1.5
        private const val TYPICAL_REACTION = .18

        /**
         * Coarse L from the reaction pre-pass: median(tap − latest click before it) − typical reaction (~180 ms).
         * Clicks are [REACTION_PERIOD] apart, so the first click after a tap cannot be confused. Null with < 3 taps.
         */
        fun reactionCoarse(tapNanos: List<Long>, clickNanos: LongArray): Double? {
            val delays = tapNanos.mapNotNull { tap -> clickNanos.filter { it in 1..tap }.maxOrNull()?.let { (tap - it) / 1e9 } }
            if (delays.size < 3) return null
            return (delays.sorted()[delays.size / 2] - TYPICAL_REACTION).coerceAtLeast(0.0)
        }

        /**
         * Pure analysis (JVM-testable): [mic] at [rate] with capture time `nanos(f) = stampNanos + (f − stampFrame)/rate`;
         * for each rendered click ([clickNanos] > 0) the first matched-filter peak (the direct sound, before echoes)
         * within [searchSeconds] after its render instant (< the click interval, so L must be too), kept when it
         * stands clear of the window's correlation noise.
         */
        fun analyze(mic: FloatArray, rate: Int, stampFrame: Long, stampNanos: Long, clickNanos: LongArray, searchSeconds: Double = .95): Result {
            val template = DoubleArray((CalibrationClick.SECONDS * rate).toInt()) { CalibrationClick.sample(it.toDouble() / rate) }
            val samples = mutableListOf<Double>()
            val snr = mutableListOf<Double>()
            for (click in clickNanos) {
                if (click <= 0) continue
                val from = (stampFrame + (click - stampNanos) * rate / 1e9).toLong().coerceAtLeast(0)
                val to = minOf(mic.size.toLong() - template.size, from + (searchSeconds * rate).toLong())
                if (to <= from) continue
                val corr = DoubleArray((to - from).toInt())
                for (j in corr.indices) {
                    val at = (from + j).toInt()
                    var sum = 0.0
                    for (i in template.indices) sum += mic[at + i] * template[i]
                    corr[j] = abs(sum)
                }
                val strongest = corr.max()
                val noise = sqrt(corr.sumOf { it * it } / corr.size)
                snr += strongest / noise
                if (strongest < MIN_SNR * noise) continue
                val first = corr.indexOfFirst { it >= .5 * strongest }
                val peak = (first until minOf(corr.size, first + template.size)).maxBy { corr[it] }
                val arrivalNanos = stampNanos + ((from + peak - stampFrame) * 1e9 / rate).toLong()
                samples += (arrivalNanos - click) / 1e9
            }
            if (samples.size < maxOf(3, clickNanos.count { it > 0 } / 2)) return Result(null, samples, 0.0, "Clicks not heard (turn the volume up, quiet room); try tap-along", snr)
            val sorted = samples.sorted()
            val median = sorted[sorted.size / 2]
            val inliers = sorted.filter { abs(it - median) < .005 }
            val spread = (inliers.max() - inliers.min()) * 1000
            if (inliers.size < maxOf(3, samples.size / 2)) return Result(null, samples, spread, "Inconsistent arrivals (echoes or noise); try tap-along", snr)
            return Result(inliers.average(), samples, spread, snr = snr)
        }
    }
}
