package dev.manadj.audio

import android.bluetooth.BluetoothClass
import android.media.AudioDeviceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RouteKindTest {
    @Test fun typesAndBluetoothClasses() {
        assertEquals(RouteKind.SPEAKER, RouteLatency.kindOfType(AudioDeviceInfo.TYPE_BLE_SPEAKER))
        assertEquals(RouteKind.HEADPHONES, RouteLatency.kindOfType(AudioDeviceInfo.TYPE_BLE_HEADSET))
        assertNull(RouteLatency.kindOfType(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP))      // needs the Bluetooth class
        assertEquals(RouteKind.UNKNOWN, RouteLatency.kindOfType(AudioDeviceInfo.TYPE_USB_DEVICE))
        assertEquals(RouteKind.SPEAKER, RouteLatency.kindOfBluetoothClass(BluetoothClass.Device.AUDIO_VIDEO_LOUDSPEAKER))
        assertEquals(RouteKind.SPEAKER, RouteLatency.kindOfBluetoothClass(BluetoothClass.Device.AUDIO_VIDEO_PORTABLE_AUDIO))
        assertEquals(RouteKind.HEADPHONES, RouteLatency.kindOfBluetoothClass(BluetoothClass.Device.AUDIO_VIDEO_HEADPHONES))
        assertEquals(RouteKind.UNKNOWN, RouteLatency.kindOfBluetoothClass(BluetoothClass.Device.AUDIO_VIDEO_UNCATEGORIZED))
    }
}
