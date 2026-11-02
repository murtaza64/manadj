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
import java.util.concurrent.ConcurrentHashMap

data class GroupProjectionDevice(val deviceId: String, val label: String, val revoked: Boolean) {
    fun json() = JSONObject().put("device_id", deviceId).put("label", label).put("revoked", revoked)
}
data class GroupProjectionTrack(val logicalTrackId: String, val assetState: String, val expectedAsset: String?) {
    fun json() = JSONObject().put("logical_track_id", logicalTrackId).put("asset_state", assetState)
        .put("expected_asset", expectedAsset?.let(::JSONObject) ?: JSONObject.NULL)
}
/** Replica-local shared #454 view. It never replaces a signed operation or grants replay. */
data class GroupSessionView(
    val groupId: String, val operationId: String, val sessionUuid: String, val operationSha256: String,
    val manifestSha256: String, val origin: GroupProjectionDevice, val relays: List<GroupProjectionDevice>,
    val startedAt: String, val endedAt: String, val status: String, val projected: Boolean,
    val conflictCount: Int, val tracks: List<GroupProjectionTrack>,
) {
    val key get() = "group:$groupId:$operationId"
    val playable get() = false
    val editable get() = false
    fun json() = JSONObject().put("format", "manadj-group-session-view/v1").put("group_id", groupId)
        .put("operation_id", operationId).put("session_uuid", sessionUuid).put("operation_sha256", operationSha256)
        .put("manifest_sha256", manifestSha256).put("origin", origin.json()).put("relays", JSONArray(relays.map { it.json() }))
        .put("started_at", startedAt).put("ended_at", endedAt).put("status", status).put("projected", projected)
        .put("playable", false).put("editable", false).put("conflict_count", conflictCount).put("tracks", JSONArray(tracks.map { it.json() }))
}
data class GroupHistorySnapshot(val items: List<GroupSessionView>, val knownUuids: Set<String>?, val error: String?, val invalidEvidence: Int,
    val ownIssuedClaims: Map<String, Set<GroupOperationClaim>> = emptyMap())

/** Read-only snapshots and an explicit separate derived-history commit. No audio/Track binding.
 * The monotonic authority index is independent of the derived projection: missing/revoked/failed
 * rows can never restore raw Session readers. Corrupt stores fail closed and are never repaired.
 */
class GroupHistory(private val libraryRoot: File) {
    private val groups = File(libraryRoot, "device-groups")
    private val root = File(libraryRoot, "group-history")
    private val authorityFile = File(root, "authority.json")
    private val projectionFile = File(root, "projections.json")
    private val authority = GroupAuthority.forLibrary(libraryRoot)
    @Volatile private var cached: Triple<String, Set<String>, GroupHistorySnapshot>? = null
    private fun fingerprint(): String = buildString {
        fun facts(file: File) {
            append(file.path).append(':').append(file.canRead()).append(':').append(file.canExecute())
            if(file.exists()) {
                val a = Files.readAttributes(file.toPath(), java.nio.file.attribute.BasicFileAttributes::class.java)
                append(':').append(a.fileKey()).append(':').append(a.size()).append(':').append(a.lastModifiedTime())
            }
            append(';')
        }
        facts(groups); facts(root); facts(authorityFile); facts(projectionFile); facts(authority.root); facts(File(authority.root,"inventory.json"))
        groups.listFiles()?.sortedBy { it.name }?.forEach { facts(it); facts(File(it, "replica.json")) }
    }
    private fun objectFile(file: File): JSONObject = if(!file.exists()) JSONObject() else {
        require(file.isFile && file.length() <= 16 * 1024 * 1024) { "Unreadable group history index" }
        JSONObject(file.readText())
    }
    private fun ids(array: JSONArray?): Set<String> = array?.let { a ->
        (0 until a.length()).map { GroupWire.uuid(a.getString(it)) }.toSet()
    } ?: emptySet()
    private fun member(state: JSONObject, id: String): Pair<GroupProjectionDevice, ByteArray> {
        GroupWire.uuid(id)
        val m = state.getJSONObject("members").getJSONObject(id)
        val key = GroupWire.decode64(m.getString("public_key_b64"), 32); require(key.size == 32)
        require(m.get("revoked") is Boolean)
        val label = m.optString("label", "Trusted device")
        require(label.isNotBlank() && label.length <= 80 && label.none(Char::isISOControl))
        return GroupProjectionDevice(id, label, m.getBoolean("revoked")) to key
    }
    private data class Scan(val snapshot: GroupHistorySnapshot, val groups: Set<String>, val known: Set<String>, val perGroup: Map<String,Set<String>>)
    private fun scan(localHistoryUuids: Set<String>): Scan {
        val seenGroups = mutableSetOf<String>(); val known = mutableSetOf<String>(); val rows = mutableListOf<GroupSessionView>()
        val ownIssued = mutableMapOf<String, MutableSet<GroupOperationClaim>>()
        val perGroup=mutableMapOf<String,Set<String>>()
        var invalid = 0; var error: String? = null; var unknown=false
        try {
            val anchored=authority.read()
            seenGroups += anchored.keys; known += anchored.values.flatten()
            val remembered = objectFile(authorityFile)
            if(remembered.length() > 0) {
                GroupWire.fields(remembered, "version", "groups", "known_uuids"); require(remembered.get("version") == 1)
                seenGroups += ids(remembered.getJSONArray("groups")); known += ids(remembered.getJSONArray("known_uuids"))
            }
            val projected = objectFile(projectionFile)
            val directories = if(!groups.exists()) emptyList() else {
                require(groups.isDirectory); (groups.listFiles() ?: error("Group directories unreadable")).toList()
            }
            val present = directories.map { dir ->
                require(dir.isDirectory && dir.canonicalFile.parentFile == groups.canonicalFile)
                GroupWire.uuid(dir.name)
            }.toSet()
            val missing=seenGroups-present
            require(missing.all { it in anchored }) { "Historical group authority unavailable" }
            if(missing.isNotEmpty()) error="Known group storage unavailable; original evidence and UUID denials retained"
            seenGroups += present
            for(dir in directories.sortedBy { it.name }) {
                val gid = dir.name
                val state = GroupReplica(dir, gid).historyState()
                perGroup[gid]=GroupAuthority.received(state,gid)
                if(!perGroup.getValue(gid).containsAll(anchored[gid].orEmpty()))
                    error="Received group evidence unavailable; original recordings and UUID denials retained"
                val local = GroupWire.uuid(state.getString("device_id")); val localMember = member(state, local).first
                val ops = state.getJSONArray("operations")
                val received = ids(state.optJSONArray("received_session_uuids"))
                known += received
                val indexedRows=(0 until ops.length()).map { ops.getJSONObject(it) }.associateBy { GroupWire.uuid(it.getString("operation_id")) }
                require(indexedRows.size == ops.length()) { "Duplicate operation bookkeeping identity" }
                val witnessed=mutableSetOf<String>()
                // Read signed bytes/retained outer proofs BEFORE any mutable bookkeeping filter.
                // They establish denial only; neither a stale index nor a missing op row can
                // hide a previously received UUID and resurrect local/cache integer playback.
                fun witness(signed: GroupSigned, requireRow: Boolean): String {
                    val rawBytes=GroupWire.decode64(signed.bodyBase64,GroupWire.MAX_OPERATION)
                    val raw=GroupWire.parse(rawBytes)
                    val sid=GroupWire.uuid(raw.getJSONObject("bundle").getJSONObject("manifest").getString("session_uuid"))
                    val origin=GroupWire.uuid(raw.getString("origin_device_id"))
                    val op=GroupWire.uuid(raw.getString("operation_id"))
                    if(origin != local) { known += sid; witnessed += sid }
                    require(raw.getString("group_id") == gid)
                    if(requireRow) {
                        val matching=indexedRows[op] ?: error("Retained group proof has no operation row")
                        require(GroupSigned.parse(matching.getJSONObject("signed")) == signed && matching.getString("sha256") == GroupWire.sha256(rawBytes) &&
                            matching.getString("session_uuid") == sid && matching.getString("origin_device_id") == origin) { "Retained proof does not exactly match the indexed signed operation" }
                    }
                    return op
                }
                val proofs=state.optJSONObject("possessions") ?: JSONObject()
                for(key in proofs.keys()) {
                    val proofRecord=proofs.getJSONObject(key)
                    val proof=GroupSigned.parse(proofRecord.getJSONObject("proof"))
                    val peek=GroupWire.parse(GroupWire.decode64(proof.bodyBase64,GroupWire.MAX_BODY))
                    val supplier=GroupWire.uuid(peek.getString("origin_device_id"))
                    val outer=GroupWire.verify(proof,member(state,supplier).second).body
                    require(outer.get("format") == GroupWire.FORMAT && outer.get("group_id") == gid && outer.get("recipient_device_id") == local)
                    val supplied=when(outer.getString("kind")) {
                        "deliver" -> { GroupWire.fields(outer,"format","group_id","origin_device_id","kind","recipient_device_id","operation"); GroupSigned.parse(outer.getJSONObject("operation")) }
                        "page" -> { GroupWire.fields(outer,"format","group_id","origin_device_id","kind","recipient_device_id","request_id","next_after","more","operations")
                            GroupWire.uuid(outer.getString("request_id")); GroupWire.counter(outer,"next_after"); require(outer.get("more") is Boolean)
                            outer.getJSONArray("operations").let { a -> require(a.length()==1); GroupSigned.parse(a.getJSONObject(0)) } }
                        else -> error("Invalid retained group supplier proof")
                    }
                    val suppliedId=witness(supplied,true)
                    require(key == "$supplier:$suppliedId" && proofRecord.getString("sha256") == GroupWire.sha256(GroupWire.decode64(supplied.bodyBase64,GroupWire.MAX_OPERATION)))
                }
                for(n in 0 until ops.length()) witness(GroupSigned.parse(ops.getJSONObject(n).getJSONObject("signed")),false)
                require(received.all { it in witnessed }) { "Received UUID authority outlived its signed evidence; fallback remains blocked" }
                require(state.has("received_session_uuids") || ops.length()>0 || proofs.length()>0) { "Historical empty group authority is unknown" }
                for(i in 0 until ops.length()) {
                    val row = ops.getJSONObject(i)
                    val claimedSid = GroupWire.uuid(row.getString("session_uuid"))
                    val claimedOrigin = GroupWire.uuid(row.getString("origin_device_id"))
                    if(claimedOrigin != local) known += claimedSid
                    try {
                        val signed = GroupSigned.parse(row.getJSONObject("signed"))
                        val raw = GroupWire.decode64(signed.bodyBase64, GroupWire.MAX_OPERATION)
                        val preview = GroupWire.parse(raw)
                        val originId = GroupWire.uuid(preview.getString("origin_device_id"))
                        val (origin, publicKey) = member(state, originId)
                        val verified = GroupWire.verify(signed, publicKey); val body = verified.body
                        GroupWire.fields(body, "format", "group_id", "origin_device_id", "kind", "operation_id", "parents", "bundle")
                        require(body.get("format") == GroupWire.FORMAT && body.get("group_id") == gid && body.get("kind") == "session-create")
                        require(body.getJSONArray("parents").length() == 0)
                        val opId = GroupWire.uuid(body.getString("operation_id"))
                        val bundle = body.getJSONObject("bundle"); val sid = GroupBundle.validate(bundle, originId)
                        require(row.getString("operation_id") == opId && claimedSid == sid && claimedOrigin == originId && row.getString("sha256") == verified.sha256)
                        if(originId == local) {
                            ownIssued.getOrPut(sid) { mutableSetOf() }.add(GroupOperationClaim(gid,opId,originId,verified.sha256))
                            continue // original own recording remains its original authority
                        }
                        known += sid
                        val m = bundle.getJSONObject("manifest"); val manifestSha = GroupWire.sha256(GroupWire.canonical(m))
                        val projection = projected.optJSONObject("$gid:$opId")
                        val isProjected = projection != null && projection.getString("operation_sha256") == verified.sha256 &&
                            projection.getString("manifest_sha256") == manifestSha && projection.getString("session_uuid") == sid
                        val relays = mutableListOf<GroupProjectionDevice>()
                        val possessions = state.optJSONObject("possessions") ?: JSONObject()
                        for(key in possessions.keys()) if(key.endsWith(":$opId")) {
                            val proofRecord = possessions.getJSONObject(key); require(proofRecord.getString("sha256") == verified.sha256)
                            val proof = GroupSigned.parse(proofRecord.getJSONObject("proof"))
                            val peer = GroupWire.parse(GroupWire.decode64(proof.bodyBase64, GroupWire.MAX_BODY)).getString("origin_device_id")
                            require(key == "$peer:$opId")
                            val (supplier, supplierKey) = member(state, peer)
                            val outer = GroupWire.verify(proof, supplierKey).body
                            require(outer.get("format") == GroupWire.FORMAT && outer.get("group_id") == gid && outer.get("recipient_device_id") == local)
                            val supplied = when(outer.getString("kind")) {
                                "deliver" -> { GroupWire.fields(outer, "format", "group_id", "origin_device_id", "kind", "recipient_device_id", "operation"); GroupSigned.parse(outer.getJSONObject("operation")) == signed }
                                "page" -> { GroupWire.fields(outer, "format", "group_id", "origin_device_id", "kind", "recipient_device_id", "request_id", "next_after", "more", "operations")
                                    GroupWire.uuid(outer.getString("request_id")); GroupWire.counter(outer, "next_after"); require(outer.get("more") is Boolean)
                                    val items = outer.getJSONArray("operations"); items.length() == 1 && GroupSigned.parse(items.getJSONObject(0)) == signed }
                                else -> false
                            }
                            require(supplied) { "Supplier proof does not bind original operation" }
                            if(peer != originId && peer != local) relays += supplier
                        }
                        val refs = m.getJSONArray("tracks")
                        val tracks = (0 until refs.length()).map { n -> refs.getJSONObject(n).let { ref ->
                            GroupProjectionTrack(ref.getString("logical_track_id"), "unbound", if(ref.isNull("asset")) null else GroupWire.canonical(ref.getJSONObject("asset")).toString(Charsets.UTF_8))
                        } }
                        val status = if(origin.revoked || localMember.revoked) "revoked" else if(!isProjected) "projection-pending" else "unbound"
                        rows += GroupSessionView(gid, opId, sid, verified.sha256, manifestSha, origin, relays.distinctBy { it.deviceId }.sortedBy { it.deviceId },
                            m.getString("started_at"), m.getString("ended_at"), status, isProjected, 0, tracks)
                    } catch(e: Exception) {
                        invalid++; unknown=true; error = "Group evidence validation failed; original evidence retained and raw replay blocked"
                    }
                }
            }
        } catch(e: Exception) {
            invalid++; unknown=true
            // Platform JSON exception messages may include source text; never expose a local
            // ledger (which contains its signing seed) through user-visible diagnostics.
            error = "Group history authority unavailable; evidence retained and raw replay blocked"
        }
        val views = rows.map { row ->
            val incompatible = rows.filter { it.sessionUuid == row.sessionUuid && it.manifestSha256 != row.manifestSha256 }.map { it.manifestSha256 }.distinct().size
            val conflicts = incompatible + if(row.sessionUuid in localHistoryUuids) 1 else 0
            row.copy(conflictCount = conflicts, status = if(conflicts > 0 && row.status != "revoked") "conflicted" else row.status)
        }.sortedWith(compareByDescending<GroupSessionView> { it.startedAt }.thenBy { it.key })
        return Scan(GroupHistorySnapshot(views, if(!unknown) known.toSet() else null, error, invalid, ownIssued.mapValues { it.value.toSet() }), seenGroups, known, perGroup)
    }
    /** Read never mutates/repairs derived history or the authority index. */
    fun snapshot(localHistoryUuids: Set<String> = emptySet()): GroupHistorySnapshot {
        // All owned writes atomically replace files. Inode/size/full FileTime/access facts keep
        // hot replay fences cheap without relying on timestamp ordering or a peer-provided clock.
        val stamp = try { fingerprint() } catch(e: Exception) { return scan(localHistoryUuids).snapshot }
        cached?.let { if(it.first == stamp && it.second == localHistoryUuids) return it.third }
        return scan(localHistoryUuids).snapshot.also { cached = Triple(stamp, localHistoryUuids.toSet(), it) }
    }

    /** Separate from metadata ack. Authority is committed first and never shrinks. */
    fun project(localHistoryUuids: Set<String> = emptySet()): GroupHistorySnapshot {
        if(root.mkdirs()) Files.setPosixFilePermissions(root.toPath(), PosixFilePermissions.fromString("rwx------"))
        else require(root.isDirectory)
        return synchronized(locks.getOrPut(root.canonicalPath) { Any() }) {
            RandomAccessFile(File(root, ".lock"), "rw").use { lockFile -> lockFile.channel.lock().use {
                val scanned = scan(localHistoryUuids); require(scanned.snapshot.error == null) { scanned.snapshot.error.orEmpty() }
                scanned.perGroup.forEach { (gid, ids) -> authority.record(gid,ids) }
                persist(authorityFile, JSONObject().put("version", 1).put("groups", JSONArray(scanned.groups.sorted())).put("known_uuids", JSONArray(scanned.known.sorted())))
                val projections = objectFile(projectionFile)
                scanned.snapshot.items.filter { it.status != "revoked" }.forEach { view ->
                    projections.put("${view.groupId}:${view.operationId}", JSONObject().put("session_uuid", view.sessionUuid)
                        .put("operation_sha256", view.operationSha256).put("manifest_sha256", view.manifestSha256))
                }
                persist(projectionFile, projections)
                cached = null
                scan(localHistoryUuids).snapshot
            } }
        }
    }
    private fun persist(target: File, value: JSONObject) {
        val bytes = value.toString().toByteArray(); require(bytes.size <= 16 * 1024 * 1024)
        val tmp = File.createTempFile(".history-", ".tmp", root)
        try {
            Files.setPosixFilePermissions(tmp.toPath(), PosixFilePermissions.fromString("rw-------"))
            FileOutputStream(tmp).use { it.write(bytes); it.fd.sync() }
            Files.move(tmp.toPath(), target.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
            FileChannel.open(root.toPath(), READ).use { it.force(true) }
        } finally { tmp.delete() }
    }
    companion object { private val locks = ConcurrentHashMap<String, Any>() }
}
