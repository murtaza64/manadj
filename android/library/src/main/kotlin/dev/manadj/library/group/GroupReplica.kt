package dev.manadj.library.group

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.nio.file.StandardOpenOption.READ
import java.nio.file.attribute.PosixFilePermissions
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

data class GroupPageReceipt(val acknowledgements: List<GroupSigned>, val nextAfter: Long, val more: Boolean)

/** Durable authenticated immutable ledger, NOT a desktop snapshot or a playable audio cache.
 * Local-owner provisioning/pinning have no network endpoint. Call off the UI thread.
 * One group directory is independent of every legacy cache/journal and of other groups.
 */
class GroupReplica(private val root: File, val groupId: String) {
    init { GroupWire.uuid(groupId) }
    private val stateFile get() = File(root, "replica.json")
    private fun <T> locked(block: () -> T): T {
        require(root.isDirectory) { "Group not locally provisioned" }
        return synchronized(locks.getOrPut(root.canonicalPath) { Any() }) {
            RandomAccessFile(File(root, ".lock"), "rw").use { file -> file.channel.lock().use { block() } }
        }
    }
    private fun load(): JSONObject {
        require(stateFile.isFile && stateFile.length() <= MAX_STATE) { "Group state missing/oversized; never reset automatically" }
        return JSONObject(stateFile.readText()).also {
            require(it.get("version") == 1 && it.getString("group_id") == groupId)
            GroupWire.uuid(it.getString("device_id"))
        }
    }
    private fun persist(state: JSONObject) {
        val bytes = state.toString().toByteArray(Charsets.UTF_8)
        require(bytes.size <= MAX_STATE) { "Group ledger capacity reached; existing evidence retained" }
        val tmp = File.createTempFile(".replica-", ".tmp", root)
        try {
            Files.setPosixFilePermissions(tmp.toPath(), PosixFilePermissions.fromString("rw-------"))
            FileOutputStream(tmp).use { it.write(bytes); it.fd.sync() }
            Files.move(tmp.toPath(), stateFile.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
            FileChannel.open(root.toPath(), READ).use { it.force(true) }
        } finally { tmp.delete() }
    }
    private fun <T> read(block: (JSONObject) -> T) = locked { block(load()) }
    private fun <T> write(block: (JSONObject) -> T) = locked {
        val state = load(); local(state)
        val result = block(state)
        GroupAuthority.forReplica(root,groupId).record(groupId,GroupAuthority.received(state,groupId))
        persist(state) // fsync + atomic replacement completes BEFORE any returned ack can escape.
        result
    }
    private fun member(state: JSONObject, id: String): ByteArray {
        GroupWire.uuid(id)
        val record = state.getJSONObject("members").optJSONObject(id) ?: error("Unknown group member")
        require(record.get("revoked") == false) { "Revoked group member" }
        return GroupWire.decode64(record.getString("public_key_b64"), 32).also { require(it.size == 32) }
    }
    private fun local(state: JSONObject): String = state.getString("device_id").also { member(state, it) }
    private fun sign(state: JSONObject, kind: String, fill: (JSONObject) -> Unit): GroupSigned {
        val body = JSONObject().put("format", GroupWire.FORMAT).put("group_id", groupId)
            .put("origin_device_id", local(state)).put("kind", kind)
        fill(body)
        return GroupWire.sign(body, GroupWire.decode64(state.getString("private_seed_b64"), 32))
    }
    private fun verify(state: JSONObject, signed: GroupSigned, kind: String, addressed: Boolean = false): VerifiedGroupBody {
        // Untrusted parse selects a pinned key; it never establishes authority.
        val preview = GroupWire.parse(GroupWire.decode64(signed.bodyBase64, GroupWire.MAX_BODY))
        val verified = GroupWire.verify(signed, member(state, preview.getString("origin_device_id")))
        val body = verified.body
        val extra = when(kind) {
            "session-create" -> arrayOf("operation_id", "parents", "bundle")
            "deliver" -> arrayOf("recipient_device_id", "operation")
            "ack" -> arrayOf("recipient_device_id", "operation_id", "operation_sha256")
            "pull" -> arrayOf("recipient_device_id", "request_id", "after")
            "page" -> arrayOf("recipient_device_id", "request_id", "next_after", "more", "operations")
            else -> error("Unsupported group message")
        }
        GroupWire.fields(body, "format", "group_id", "origin_device_id", "kind", *extra)
        require(body.get("format") == GroupWire.FORMAT && body.get("kind") == kind && body.get("group_id") == groupId)
        if(body.has("recipient_device_id")) GroupWire.uuid(body.getString("recipient_device_id"))
        if(addressed) require(body.getString("recipient_device_id") == local(state)) { "Wrong group recipient" }
        if(body.has("request_id")) GroupWire.uuid(body.getString("request_id"))
        if(body.has("operation_id")) GroupWire.uuid(body.getString("operation_id"))
        return verified
    }
    private fun operations(state: JSONObject) = state.getJSONArray("operations")
    private fun entries(state: JSONObject) = operations(state).let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
    private fun entry(state: JSONObject, id: String) = entries(state).singleOrNull { it.getString("operation_id") == id } ?: error("Group operation missing")
    private fun store(state: JSONObject, signed: GroupSigned): JSONObject {
        require(GroupWire.decode64(signed.bodyBase64, GroupWire.MAX_OPERATION).size <= GroupWire.MAX_OPERATION)
        val verified = verify(state, signed, "session-create")
        val body = verified.body
        require(body.getJSONArray("parents").length() == 0) { "Only immutable create supported" }
        val origin = body.getString("origin_device_id")
        val sid = GroupBundle.validate(body.getJSONObject("bundle"), origin)
        val id = body.getString("operation_id")
        entries(state).singleOrNull { it.getString("operation_id") == id }?.let {
            require(it.getString("sha256") == verified.sha256) { "Operation UUID equivocation" }
            if(origin != local(state)) rememberReceivedUuid(state,sid)
            return it
        }
        require(origin != local(state)) { "Unknown local-origin operation cannot be imported" }
        rememberReceivedUuid(state,sid)
        return append(state, signed, id, origin, sid, verified.sha256)
    }
    private fun rememberReceivedUuid(state: JSONObject, sid: String) {
        val owned=state.optJSONArray("received_session_uuids") ?: JSONArray().also { state.put("received_session_uuids",it) }
        if((0 until owned.length()).none { owned.getString(it) == sid }) owned.put(sid)
    }
    private fun append(state: JSONObject, signed: GroupSigned, id: String, origin: String, sid: String, sha: String): JSONObject =
        JSONObject().put("operation_id", id).put("origin_device_id", origin).put("session_uuid", sid)
            .put("sha256", sha).put("signed", signed.json()).also { operations(state).put(it) }
    private fun receipt(state: JSONObject, row: JSONObject, peer: String) = sign(state, "ack") {
        it.put("recipient_device_id", peer).put("operation_id", row.getString("operation_id")).put("operation_sha256", row.getString("sha256"))
    }
    private fun rememberPossession(state: JSONObject, row: JSONObject, peer: String, proof: GroupSigned) {
        // A verified relay-signed Delivery/Page carrying this exact operation proves possession,
        // not a peer-signed ack addressed to us. Keep those facts distinct and retain the proof.
        val possessions = state.optJSONObject("possessions") ?: JSONObject().also { state.put("possessions", it) }
        possessions.put(peer + ":" + row.getString("operation_id"), JSONObject()
            .put("sha256", row.getString("sha256")).put("proof", proof.json()))
    }
    private fun wants(state: JSONObject, row: JSONObject, peer: String): Boolean {
        val key = peer + ":" + row.getString("operation_id")
        return row.getString("origin_device_id") != peer &&
            state.getJSONObject("members").getJSONObject(row.getString("origin_device_id")).get("revoked") == false &&
            !state.getJSONObject("acks").has(key) &&
            state.optJSONObject("possessions")?.optJSONObject(key)?.optString("sha256") != row.getString("sha256")
    }

    /** Explicit local trust mutation, never called from network handlers. Existing pins are immutable. */
    fun pinMember(id: String, publicKey: ByteArray, label: String? = null) = write { state ->
        GroupWire.uuid(id); require(publicKey.size == 32)
        label?.let { require(it.isNotBlank() && it.length <= 80 && it.none(Char::isISOControl)) }
        val members = state.getJSONObject("members"); val encoded = GroupWire.encode64(publicKey)
        val old = members.optJSONObject(id)
        if(old != null) require(old.get("revoked") == false && old.getString("public_key_b64") == encoded) { "Member pin immutable" }
        else members.put(id, JSONObject().put("public_key_b64", encoded).put("revoked", false))
        if(label != null) members.getJSONObject(id).put("label", label)
        Unit
    }
    fun revoke(id: String) = write { state -> member(state, id); state.getJSONObject("members").getJSONObject(id).put("revoked", true); Unit }

    /** Complete explicitly prepared local-origin Bundle only; retry returns original bytes/UUID. */
    fun issue(bundle: JSONObject): GroupSigned = write { state ->
        val origin = local(state); val sid = GroupBundle.validate(bundle, origin)
        val old = entries(state).singleOrNull { it.getString("origin_device_id") == origin && it.getString("session_uuid") == sid }
        if(old != null) GroupSigned.parse(old.getJSONObject("signed")) else {
            val id = UUID.randomUUID().toString()
            val signed = sign(state, "session-create") { it.put("operation_id", id).put("parents", JSONArray()).put("bundle", bundle) }
            val raw = GroupWire.decode64(signed.bodyBase64, GroupWire.MAX_OPERATION)
            append(state, signed, id, origin, sid, GroupWire.sha256(raw))
            signed
        }
    }
    /** Preserved evidence includes revoked origins for audit; it is never automatically playable. */
    fun evidence(): List<GroupSigned> = read { state -> local(state); entries(state).map { GroupSigned.parse(it.getJSONObject("signed")) } }
    /** Read-only local history inspection includes revocation; private seed never leaves this class. */
    internal fun historyState(): JSONObject = read { state -> state.remove("private_seed_b64"); state }
    fun pendingFor(peer: String): List<String> = read { state ->
        local(state); member(state, peer)
        entries(state).filter { wants(state, it, peer) }.map { it.getString("operation_id") }
    }
    fun delivery(peer: String, id: String): GroupSigned = read { state ->
        member(state, peer); val row = entry(state, id); member(state, row.getString("origin_device_id"))
        sign(state, "deliver") { it.put("recipient_device_id", peer).put("operation", row.getJSONObject("signed")) }
    }
    fun receiveDelivery(signed: GroupSigned): GroupSigned = write { state ->
        val delivery = verify(state, signed, "deliver", true).body
        val row = store(state, GroupSigned.parse(delivery.getJSONObject("operation")))
        rememberPossession(state, row, delivery.getString("origin_device_id"), signed)
        receipt(state, row, delivery.getString("origin_device_id"))
    }
    fun acceptAck(signed: GroupSigned, expectedPeer: String) = write { state ->
        member(state, expectedPeer)
        val ack = verify(state, signed, "ack", true).body
        require(ack.getString("origin_device_id") == expectedPeer) { "Ack from unexpected peer" }
        val row = entry(state, ack.getString("operation_id")); member(state, row.getString("origin_device_id"))
        require(row.getString("sha256") == ack.getString("operation_sha256")) { "Ack operation/hash mismatch" }
        state.getJSONObject("acks").put(expectedPeer + ":" + row.getString("operation_id"), signed.json()); Unit
    }
    fun pullRequest(peer: String, after: Long = 0): GroupSigned = read { state ->
        member(state, peer); require(after in 0..9007199254740991L)
        sign(state, "pull") { it.put("recipient_device_id", peer).put("request_id", UUID.randomUUID().toString()).put("after", after) }
    }
    /** Same ledger seam as desktop pull; useful for adapters without requiring a phone listener. */
    fun page(request: GroupSigned): GroupSigned = read { state ->
        val pull = verify(state, request, "pull", true).body
        val after = GroupWire.counter(pull, "after"); val peer = pull.getString("origin_device_id")
        val candidates = entries(state).withIndex().filter { (index, row) ->
            index.toLong()+1 > after && wants(state, row, peer)
        }.take(2)
        sign(state, "page") { body ->
            body.put("recipient_device_id", peer).put("request_id", pull.getString("request_id"))
                .put("next_after", candidates.firstOrNull()?.index?.toLong()?.plus(1) ?: after).put("more", candidates.size > 1)
                .put("operations", JSONArray().also { a -> candidates.firstOrNull()?.let { a.put(it.value.getJSONObject("signed")) } })
        }
    }
    fun receivePage(response: GroupSigned, request: GroupSigned): GroupPageReceipt = write { state ->
        val pull = verify(state, request, "pull").body
        require(pull.getString("origin_device_id") == local(state))
        val page = verify(state, response, "page", true).body
        require(page.getString("origin_device_id") == pull.getString("recipient_device_id") && page.getString("request_id") == pull.getString("request_id")) { "Page/request mismatch" }
        val after = GroupWire.counter(pull, "after"); val next = GroupWire.counter(page, "next_after")
        val ops = page.getJSONArray("operations"); require(ops.length() <= 1 && page.get("more") is Boolean)
        val more = page.getBoolean("more")
        require(next >= after && (ops.length() == 0 && !more || ops.length() == 1 && next > after)) { "Non-progressing group page" }
        val acks = (0 until ops.length()).map {
            val row = store(state, GroupSigned.parse(ops.getJSONObject(it)))
            rememberPossession(state, row, page.getString("origin_device_id"), response)
            receipt(state, row, page.getString("origin_device_id"))
        }
        GroupPageReceipt(acks, next, more)
    }

    companion object {
        private const val MAX_STATE = 64 * 1024 * 1024
        private val locks = ConcurrentHashMap<String, Any>()
        /** Local-owner-only, refuses overwrite/reset. Caller retains local seed securely. */
        fun provision(root: File, groupId: String, deviceId: String, seed: ByteArray): GroupReplica {
            GroupWire.uuid(groupId); GroupWire.uuid(deviceId); require(seed.size == 32)
            require(root.mkdirs() || root.isDirectory)
            Files.setPosixFilePermissions(root.toPath(), PosixFilePermissions.fromString("rwx------"))
            val replica = GroupReplica(root, groupId)
            replica.locked {
                require(!replica.stateFile.exists()) { "Group already provisioned; no reset" }
                val state = JSONObject().put("version", 1).put("group_id", groupId).put("device_id", deviceId)
                    .put("private_seed_b64", GroupWire.encode64(seed)).put("operations", JSONArray()).put("acks", JSONObject()).put("received_session_uuids",JSONArray())
                    .put("members", JSONObject().put(deviceId, JSONObject().put("public_key_b64", GroupWire.encode64(GroupWire.publicKey(seed))).put("revoked", false)))
                GroupAuthority.forReplica(root,groupId).record(groupId,emptySet())
                replica.persist(state)
                FileChannel.open(root.parentFile.toPath(),READ).use { it.force(true) }
            }
            return replica
        }
    }
}
