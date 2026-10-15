package dev.manadj.app

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.manadj.audio.*

/** An output device as Android reports it; channel counts decide whether 4-ch routing is offered. */
data class OutputDevice(val id: Int, val type: String, val name: String, val channelCounts: List<Int>, val sampleRates: List<Int>) {
    /** Empty channel list = "any" per AudioDeviceInfo docs; treat as stereo-only (unknown). */
    val maxChannels get() = channelCounts.maxOrNull() ?: 2
    val supportsQuad get() = maxChannels >= 4
}

/** Enumerates outputs and tracks hot-plug (USB controllers like the DDJ-GRV6 appear here). */
class OutputDevices(context: Context, private val changed: (List<OutputDevice>) -> Unit) {
    private val manager = context.getSystemService(AudioManager::class.java)
    private val callback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = changed(list())
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = changed(list())
    }

    init { manager.registerAudioDeviceCallback(callback, Handler(Looper.getMainLooper())) }

    fun list(): List<OutputDevice> = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).filter { it.isSink && it.type !in NON_MEDIA }.map {
        OutputDevice(it.id, typeName(it.type), it.productName?.toString().orEmpty(), it.channelCounts.toList().distinct().sorted(), it.sampleRates.toList().distinct().sorted())
    }

    fun close() = manager.unregisterAudioDeviceCallback(callback)

    private companion object {
        /** Call/voice sinks are never DJ outputs. */
        val NON_MEDIA = setOf(AudioDeviceInfo.TYPE_TELEPHONY, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE, AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
    }

    private fun typeName(type: Int) = when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Speaker"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "Earpiece"
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "Wired headphones"
        AudioDeviceInfo.TYPE_WIRED_HEADSET -> "Wired headset"
        AudioDeviceInfo.TYPE_USB_DEVICE -> "USB device"
        AudioDeviceInfo.TYPE_USB_HEADSET -> "USB headset"
        AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB accessory"
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "Bluetooth A2DP"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "Bluetooth SCO"
        AudioDeviceInfo.TYPE_BLE_HEADSET -> "BLE headset"
        AudioDeviceInfo.TYPE_BLE_SPEAKER -> "BLE speaker"
        AudioDeviceInfo.TYPE_HDMI -> "HDMI"
        AudioDeviceInfo.TYPE_TELEPHONY -> "Telephony"
        AudioDeviceInfo.TYPE_REMOTE_SUBMIX -> "Remote submix"
        else -> "Type $type"
    }
}

/** Debug panel: devices + channel counts, negotiated stream, bus routing and cue mix. */
@Composable fun OutputPanel(model: PlayerModel, modifier: Modifier) {
    val selected = model.devices.firstOrNull { it.id == model.routingDevice }
    Column(modifier.background(Ink.background).border(2.dp, Ink.accent).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}.padding(8.dp)) {
        Row(Modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("OUTPUT / ROUTING", Modifier.weight(1f), Ink.accent, 18, true)
            Key("CLOSE", Modifier.width(64.dp).fillMaxHeight()) { model.outputPanel = false }
        }
        Text(model.outputInfo?.toString() ?: "No stream open", color = Ink.muted, size = 11, lines = 3)
        Text("Routing", color = Ink.text, size = 13, bold = true)
        for (routing in Routing.entries) {
            val quadOk = routing != Routing.QUAD || selected?.supportsQuad == true
            Key(routing.label + if (!quadOk) " (device <4 ch)" else "", Modifier.fillMaxWidth().height(44.dp), Ink.accent, quadOk, model.output?.routing == routing) {
                model.configureOutput(routing, model.routingDevice)
            }
        }
        Row(Modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("CUE MIX", Modifier.width(80.dp), Ink.text, 12, true)
            PhysicalFader("MIX", model.cueMix, model, DeckId.A, Modifier.weight(1f).fillMaxHeight(), model.supports("cue-mix"), true) { value, id -> model.updateCueMix(value, id) }
        }
        Text("Devices (tap to route there)", color = Ink.text, size = 13, bold = true)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            Key("System default", Modifier.fillMaxWidth().height(44.dp), Ink.accent, engaged = model.routingDevice == 0) { model.configureOutput(model.output?.routing ?: Routing.STEREO, 0) }
            for (device in model.devices) {
                Column(Modifier.fillMaxWidth().border(1.dp, if (device.id == model.routingDevice) Ink.accent else Ink.edge).clickable {
                    val routing = model.output?.routing?.takeIf { it != Routing.QUAD || device.supportsQuad } ?: Routing.STEREO
                    model.configureOutput(routing, device.id)
                }.padding(6.dp)) {
                    Text("#${device.id} ${device.type} ${device.name}", bold = true, size = 12)
                    Text("channels ${device.channelCounts.ifEmpty { listOf("any") }} · rates ${device.sampleRates.ifEmpty { listOf("any") }}", color = Ink.muted, size = 11, lines = 2)
                }
            }
        }
    }
}
