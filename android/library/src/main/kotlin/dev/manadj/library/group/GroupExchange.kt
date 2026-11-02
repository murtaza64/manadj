package dev.manadj.library.group

import java.io.ByteArrayOutputStream
import java.io.InterruptedIOException
import java.net.HttpURLConnection
import java.net.URI

/** Transport does not choose group identity or authority. No legacy credentials are sent. */
interface GroupTransport {
    fun deliver(message: GroupSigned): GroupSigned
    fun pull(message: GroupSigned): GroupSigned
    fun acknowledge(message: GroupSigned)
}
data class GroupExchangeResult(val pushed: Int, val pulled: Int)

/** Explicit foreground push/pull. No listener, discovery, pairing or background scheduling. */
class GroupExchange(private val replica: GroupReplica) {
    fun sync(peer: String, transport: GroupTransport, maxPages: Int = 512): GroupExchangeResult {
        require(maxPages in 1..4096)
        var pushed = 0; var pulled = 0
        for(id in replica.pendingFor(peer)) {
            if(Thread.currentThread().isInterrupted) throw InterruptedIOException("Group exchange cancelled")
            replica.acceptAck(transport.deliver(replica.delivery(peer, id)), peer)
            pushed++
        }
        // Cursor is server-local scan state, NOT causal time. Every new scan starts at zero.
        var after = 0L
        repeat(maxPages) {
            if(Thread.currentThread().isInterrupted) throw InterruptedIOException("Group exchange cancelled")
            val request = replica.pullRequest(peer, after)
            val result = replica.receivePage(transport.pull(request), request)
            // Metadata is fsynced before ack transmission; failed ack is recovered by duplicate pull.
            result.acknowledgements.forEach { transport.acknowledge(it) }
            pulled += result.acknowledgements.size
            if(!result.more) return GroupExchangeResult(pushed, pulled)
            after = result.nextAfter
        }
        error("Group scan page limit reached; retained evidence is safe to retry")
    }
}

/** Existing HTTP route only. Caller supplies an already configured reachable peer address. */
class GroupHttpTransport(baseUrl: String, groupId: String, private val timeoutMs: Int = 15_000) : GroupTransport {
    private val base = URI(baseUrl.trimEnd('/')).also {
        require(it.scheme in setOf("http", "https") && it.host != null && it.rawUserInfo == null &&
            it.rawQuery == null && it.rawFragment == null &&
            it.rawPath.orEmpty().trimEnd('/').matches(Regex("(?:/[A-Za-z0-9_-]+)*"))) { "Explicit peer base URL with a bounded routing prefix required" }
        require(timeoutMs in 1..120_000)
    }.toString().trimEnd('/') + "/api/device-groups/" + GroupWire.uuid(groupId)

    private fun call(path: String, message: GroupSigned): org.json.JSONObject {
        val bytes = GroupWire.canonical(message.json())
        require(bytes.size <= GroupWire.MAX_BODY) { "Group HTTP request too large" }
        val connection = (URI(base + "/" + path).toURL().openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; doOutput = true; instanceFollowRedirects = false
            connectTimeout = timeoutMs; readTimeout = timeoutMs
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Cache-Control", "no-store")
            setFixedLengthStreamingMode(bytes.size)
        }
        try {
            connection.outputStream.use { it.write(bytes) }
            require(connection.responseCode in 200..299) { "Group HTTP ${connection.responseCode}" }
            require(connection.contentLengthLong <= GroupWire.MAX_BODY)
            val output = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(64 * 1024)
                while(true) {
                    if(Thread.currentThread().isInterrupted) throw InterruptedIOException("Group exchange cancelled")
                    val n = input.read(buffer); if(n < 0) break
                    require(output.size() <= GroupWire.MAX_BODY - n) { "Group HTTP response too large" }
                    output.write(buffer, 0, n)
                }
            }
            return GroupWire.parse(output.toByteArray())
        } finally { connection.disconnect() }
    }
    override fun deliver(message: GroupSigned) = GroupSigned.parse(call("deliver", message))
    override fun pull(message: GroupSigned) = GroupSigned.parse(call("pull", message))
    override fun acknowledge(message: GroupSigned) {
        val result = call("ack", message); GroupWire.fields(result, "stored")
        require(result.get("stored") == true)
    }
}
