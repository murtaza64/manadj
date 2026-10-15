package dev.manadj.audio

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build

/** Whether the phone mic can hear the output (calibration) — speakers yes, headphones no; UNKNOWN never blocks. */
enum class RouteKind { SPEAKER, HEADPHONES, UNKNOWN }

/**
 * Remembered output latency (render → speaker, seconds) and speaker/headphones kind per output route, for
 * HEARD quantize (#382). A route is the device the stream actually plays to ([OutputInfo.deviceId]): type +
 * product name + address, so a Bluetooth speaker keeps its own values across reconnects.
 */
class RouteLatency(private val context: Context) {
    private val manager = context.getSystemService(AudioManager::class.java)
    private val prefs = context.getSharedPreferences("manadj-route-latency", Context.MODE_PRIVATE)

    private fun device(deviceId: Int): AudioDeviceInfo? =
        manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull { it.id == deviceId }

    /** Stable key of output device [deviceId], or null when it is not (or no longer) present. */
    fun key(deviceId: Int): String? = device(deviceId)?.let(::key)

    fun label(deviceId: Int): String? = device(deviceId)?.productName?.toString()

    /** Calibrated / user-set latency for [key], or null (use [EngineSnapshot.reportedLatencySeconds]). */
    operator fun get(key: String): Double? = if (prefs.contains(key)) prefs.getFloat(key, 0f).toDouble() else null

    operator fun set(key: String, seconds: Double) { prefs.edit().putFloat(key, seconds.coerceIn(0.0, 2.0).toFloat()).apply() }

    fun clear(key: String) { prefs.edit().remove(key).apply() }

    /** User override of [kind] for a route (null = automatic). */
    fun kindOverride(key: String): RouteKind? = prefs.getString("kind:$key", null)?.let { runCatching { RouteKind.valueOf(it) }.getOrNull() }

    fun setKindOverride(key: String, kind: RouteKind?) {
        prefs.edit().apply { if (kind == null) remove("kind:$key") else putString("kind:$key", kind.name) }.apply()
    }

    /** Classic Bluetooth classification needs BLUETOOTH_CONNECT (Android 12+); without it A2DP is UNKNOWN. */
    val bluetoothPermissionMissing: Boolean
        get() = Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED

    /** The route's kind: the user's override, else classified from the device type / Bluetooth class. */
    fun kind(deviceId: Int): RouteKind {
        val device = device(deviceId) ?: return RouteKind.UNKNOWN
        kindOverride(key(device))?.let { return it }
        return classify(device)
    }

    @SuppressLint("MissingPermission")
    private fun classify(device: AudioDeviceInfo): RouteKind {
        val byType = kindOfType(device.type)
        if (byType != null) return byType
        if (device.type != AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || bluetoothPermissionMissing) return RouteKind.UNKNOWN
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return RouteKind.UNKNOWN
        val cls = runCatching { adapter.getRemoteDevice(device.address).bluetoothClass }.getOrNull() ?: return RouteKind.UNKNOWN
        return kindOfBluetoothClass(cls.deviceClass, cls.majorDeviceClass)
    }

    companion object {
        fun key(device: AudioDeviceInfo): String = "${device.type}:${device.productName}:${device.address}"

        /** Explicit device types; null = needs more (A2DP) or unknown. */
        fun kindOfType(type: Int): RouteKind? = when (type) {
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE, AudioDeviceInfo.TYPE_BLE_SPEAKER -> RouteKind.SPEAKER
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_USB_HEADSET,
            AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> RouteKind.HEADPHONES
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> null
            else -> RouteKind.UNKNOWN
        }

        /**
         * A classic A2DP sink by BluetoothClass: wearable/headset classes are HEADPHONES; any other AUDIO_VIDEO
         * device (loudspeaker, hi-fi, car, receivers / set-top boxes / uncategorised) is a SPEAKER; else UNKNOWN.
         */
        fun kindOfBluetoothClass(deviceClass: Int, majorClass: Int = deviceClass and 0x1F00): RouteKind = when (deviceClass) {
            BluetoothClass.Device.AUDIO_VIDEO_LOUDSPEAKER, BluetoothClass.Device.AUDIO_VIDEO_PORTABLE_AUDIO,
            BluetoothClass.Device.AUDIO_VIDEO_HIFI_AUDIO, BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO -> RouteKind.SPEAKER
            BluetoothClass.Device.AUDIO_VIDEO_HEADPHONES, BluetoothClass.Device.AUDIO_VIDEO_WEARABLE_HEADSET,
            BluetoothClass.Device.AUDIO_VIDEO_HANDSFREE -> RouteKind.HEADPHONES
            else -> if (majorClass == BluetoothClass.Device.Major.AUDIO_VIDEO) RouteKind.SPEAKER else RouteKind.UNKNOWN
        }
    }
}
