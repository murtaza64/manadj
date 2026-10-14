package dev.manadj.library

import kotlinx.coroutines.delay
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** A desktop found on the network (DNS-SD `_manadj._tcp`, #374) or typed by hand. */
data class FoundDesktop(val name: String, val host: String, val port: Int) {
    val url: String get() = "http://${if (':' in host) "[$host]" else host}:$port"
}

/** Progress of approve-on-desktop pairing, for the pairing UI. */
sealed interface PairingState {
    data object Idle : PairingState
    data object Requesting : PairingState
    /** Show [matchCode] big: the user checks the desktop prompt shows the same code. */
    data class AwaitingApproval(val desktop: String, val matchCode: String) : PairingState
    data class Paired(val desktop: String) : PairingState
    data class Failed(val reason: String) : PairingState
}

/**
 * Client for the desktop's /api/device-pair endpoints (backend/device_listener.py).
 * Blocking calls; [pair] suspends while polling.
 */
class PairingClient(baseUrl: String, private val timeoutMs: Int = 10_000) {
    private val base = baseUrl.trimEnd('/')

    data class Ticket(val id: String, val matchCode: String, val expiresSeconds: Int)

    private fun call(method: String, path: String, body: JSONObject? = null): Pair<Int, JSONObject?> = try {
        val conn = (URL("$base/api/device-pair$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = timeoutMs
            readTimeout = timeoutMs
        }
        if (body != null) {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val code = conn.responseCode
        val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.use { it.readBytes().decodeToString() }
        conn.disconnect()
        code to text?.let { runCatching { JSONObject(it) }.getOrNull() }
    } catch (e: IOException) {
        throw SyncException("Desktop unreachable at $base (${e.message ?: e.javaClass.simpleName})", e)
    }

    fun request(deviceId: String, deviceName: String): Ticket {
        val (code, json) = call("POST", "/request", JSONObject().put("device_id", deviceId).put("device_name", deviceName))
        if (code == 429) throw SyncException("Desktop is busy with other pairing requests — try again in a minute")
        if (code !in 200..299 || json == null) throw SyncException("Pairing request refused (HTTP $code)")
        return Ticket(json.getString("id"), json.getString("match_code"), json.optInt("expires_s", 120))
    }

    /** "pending" | "approved" | "denied" | "expired" | "gone", plus the token once approved. */
    fun poll(ticketId: String): Pair<String, String?> {
        val (code, json) = call("GET", "/request/$ticketId")
        if (code == 404 || json == null) return "gone" to null
        return json.getString("status") to json.optString("token").takeIf { it.isNotEmpty() }
    }

    /**
     * Request pairing and wait for the desktop's decision. Reports progress via
     * [onState]; returns the device token on approval, null otherwise.
     */
    suspend fun pair(
        deviceId: String,
        deviceName: String,
        desktopName: String,
        pollMs: Long = 1_000,
        onState: (PairingState) -> Unit,
    ): String? {
        onState(PairingState.Requesting)
        val ticket = try { request(deviceId, deviceName) } catch (e: SyncException) {
            onState(PairingState.Failed(e.message ?: "Pairing failed")); return null
        }
        onState(PairingState.AwaitingApproval(desktopName, ticket.matchCode))
        val deadline = System.currentTimeMillis() + ticket.expiresSeconds * 1000L
        while (System.currentTimeMillis() < deadline) {
            delay(pollMs)
            val (status, token) = try { poll(ticket.id) } catch (e: SyncException) {
                onState(PairingState.Failed(e.message ?: "Pairing failed")); return null
            }
            when (status) {
                "pending" -> continue
                "approved" -> if (token != null) { onState(PairingState.Paired(desktopName)); return token }
                "denied" -> { onState(PairingState.Failed("Declined on the desktop")); return null }
                else -> { onState(PairingState.Failed("Pairing request expired — try again")); return null }
            }
        }
        onState(PairingState.Failed("No answer from the desktop — try again"))
        return null
    }
}
