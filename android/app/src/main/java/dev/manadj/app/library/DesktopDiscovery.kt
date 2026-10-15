package dev.manadj.app.library

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import dev.manadj.library.FoundDesktop
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.ArrayDeque

/**
 * Finds manaDJ desktops on the LAN (#374): the desktop's Phone sync listener
 * advertises `_manadj._tcp` over DNS-SD. [start] while a pairing/sync screen
 * is visible, [stop] when it goes away (discovery costs battery).
 */
class DesktopDiscovery(context: Context) {
    private val nsd = context.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val _found = MutableStateFlow<List<FoundDesktop>>(emptyList())
    val found: StateFlow<List<FoundDesktop>> = _found.asStateFlow()
    private val _searching = MutableStateFlow(false)
    val searching: StateFlow<Boolean> = _searching.asStateFlow()

    private var listener: NsdManager.DiscoveryListener? = null
    // resolveService allows one resolve at a time before API 34; queue them.
    private val pending = ArrayDeque<NsdServiceInfo>()
    private var resolving = false

    @Synchronized fun start() {
        if (listener != null) return
        _found.value = emptyList()
        val l = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) { _searching.value = true }
            override fun onDiscoveryStopped(serviceType: String) { _searching.value = false }
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { Log.w(TAG, "discovery failed $errorCode"); _searching.value = false }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onServiceFound(info: NsdServiceInfo) = enqueue(info)
            override fun onServiceLost(info: NsdServiceInfo) { _found.update { list -> list.filterNot { it.name == info.serviceName } } }
        }
        listener = l
        nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, l)
    }

    @Synchronized fun stop() {
        listener?.let { runCatching { nsd.stopServiceDiscovery(it) } }
        listener = null
        pending.clear()
        _searching.value = false
    }

    @Synchronized private fun enqueue(info: NsdServiceInfo) {
        pending.add(info)
        if (!resolving) next()
    }

    @Synchronized private fun next() {
        val info = pending.poll() ?: run { resolving = false; return }
        resolving = true
        @Suppress("DEPRECATION")
        nsd.resolveService(info, object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) { next() }
            override fun onServiceResolved(info: NsdServiceInfo) {
                @Suppress("DEPRECATION")
                val host = info.host?.hostAddress
                if (host != null) {
                    val desktop = FoundDesktop(info.serviceName, host, info.port)
                    _found.update { list -> list.filterNot { it.name == desktop.name } + desktop }
                }
                next()
            }
        })
    }

    companion object {
        const val SERVICE_TYPE = "_manadj._tcp."
        private const val TAG = "DesktopDiscovery"
    }
}
