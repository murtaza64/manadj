package dev.manadj.audio

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager

/**
 * Remembered output latency (render → speaker, seconds) per output route, for HEARD quantize (#382).
 * A route is the device the stream actually plays to ([OutputInfo.deviceId]): type + product name +
 * address, so a Bluetooth speaker keeps its own value across reconnects.
 */
class RouteLatency(context: Context) {
    private val manager = context.getSystemService(AudioManager::class.java)
    private val prefs = context.getSharedPreferences("manadj-route-latency", Context.MODE_PRIVATE)

    /** Stable key of output device [deviceId], or null when it is not (or no longer) present. */
    fun key(deviceId: Int): String? {
        val device = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull { it.id == deviceId } ?: return null
        return key(device)
    }

    fun label(deviceId: Int): String? =
        manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull { it.id == deviceId }?.productName?.toString()

    /** Calibrated / user-set latency for [key], or null (use [EngineSnapshot.reportedLatencySeconds]). */
    operator fun get(key: String): Double? = if (prefs.contains(key)) prefs.getFloat(key, 0f).toDouble() else null

    operator fun set(key: String, seconds: Double) { prefs.edit().putFloat(key, seconds.coerceIn(0.0, 2.0).toFloat()).apply() }

    fun clear(key: String) { prefs.edit().remove(key).apply() }

    companion object {
        fun key(device: AudioDeviceInfo): String = "${device.type}:${device.productName}:${device.address}"
    }
}
