package dev.manadj.library.group

import dev.manadj.library.LibraryTrack
import dev.manadj.library.session.SessionLog
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermissions
import java.util.UUID

data class GroupReplayReadiness(val state: String, val generation: String? = null, val reason: String? = null) {
    val playable get() = false // Only an actual engine decode can prepare a local load.
}
class GroupReplayTrack internal constructor(val logicalId: String, val selection: GroupReceiverSelection, val track: LibraryTrack) {
    fun sourceId(source: GroupReplaySource) = "group:${source.view.key}:${source.generation}:$logicalId:${selection.incarnation}"
}
class GroupReplaySource internal constructor(val view: GroupSessionView, val generation: String, val log: SessionLog, val tracks: Map<Int,GroupReplayTrack>)
class GroupLoadAttempt internal constructor(val source: GroupReplaySource, val trackId: Int, val file: File, val attemptId: String, internal val fileIdentity: String) {
    val sourceId get() = source.tracks.getValue(trackId).sourceId(source) + ":attempt:$attemptId"
}

/** Separate local GROUP authority. Never weakens raw/peer UUID fences or trusts readiness JSON. */
class GroupReplay(private val root: File, private val localHistory: () -> Set<String> = { emptySet() },
    private val additionalAuthority: (GroupSessionView) -> Boolean = { true }) {
    val selections=GroupBindings(root)
    private val history=GroupHistory(root)
    private val disk=GroupReplayStore(File(root,"group-replay/bindings"))
    private class Refused(val state: String): IllegalStateException(state)
    private data class Evidence(val view: GroupSessionView,val identity: JSONObject,val bundle: JSONObject,val events: JSONArray)
    @Volatile private var cachedEvidence: Pair<GroupHistorySnapshot,Evidence>? = null
    private fun key(view: GroupSessionView) = "${view.groupId}:${view.operationId}:${view.operationSha256}"
    private fun evidence(requested: GroupSessionView): Evidence {
        val snapshot=history.snapshot(localHistory())
        if(snapshot.error != null || snapshot.knownUuids == null) throw Refused("error")
        val view=snapshot.items.singleOrNull { it.key == requested.key } ?: throw Refused("invalid")
        if(view.operationSha256 != requested.operationSha256 || view.manifestSha256 != requested.manifestSha256) throw Refused("invalid")
        if(view.status == "revoked") throw Refused("revoked")
        if(view.conflictCount > 0) throw Refused("conflicted")
        if(!view.projected) throw Refused("projection-pending")
        if(!additionalAuthority(view)) throw Refused("invalid")
        cachedEvidence?.let { if(it.first === snapshot && it.second.view == view) return it.second }
        val replica=GroupReplica(File(root,"device-groups/${GroupWire.uuid(view.groupId)}"),view.groupId)
        val state=replica.historyState()
        val signed=replica.evidence().single { GroupWire.sha256(GroupWire.decode64(it.bodyBase64,GroupWire.MAX_OPERATION)) == view.operationSha256 }
        val body=GroupWire.parse(GroupWire.decode64(signed.bodyBase64,GroupWire.MAX_OPERATION))
        val publicKey=GroupWire.decode64(state.getJSONObject("members").getJSONObject(view.origin.deviceId).getString("public_key_b64"),32)
        GroupWire.verify(signed,publicKey)
        require(body.getString("operation_id") == view.operationId && body.getString("group_id") == view.groupId && body.getString("origin_device_id") == view.origin.deviceId)
        val bundle=body.getJSONObject("bundle")
        require(GroupBundle.validate(bundle,view.origin.deviceId) == view.sessionUuid)
        val events=JSONArray(); val chunks=bundle.getJSONArray("chunks")
        (0 until chunks.length()).map(chunks::getJSONObject).sortedBy { it.getInt("seq") }.forEach { chunk ->
            val a=chunk.getJSONArray("events"); for(i in 0 until a.length()) events.put(a.getJSONObject(i))
        }
        if(!GroupReplayContract.supports(events)) throw Refused("unsupported-grammar")
        val identity=JSONObject().put("group_id",view.groupId).put("operation_id",view.operationId).put("operation_sha256",view.operationSha256)
            .put("session_uuid",view.sessionUuid).put("origin_device_id",view.origin.deviceId).put("receiver_device_id",GroupWire.uuid(state.getString("device_id")))
        return Evidence(view,identity,bundle,events).also { cachedEvidence=snapshot to it }
    }
    fun bind(view: GroupSessionView, logicalId: String, selected: GroupReceiverSelection) = disk.locked {
        val e=evidence(view)
        val logical=GroupWire.uuid(logicalId)
        val current=selections.current(selected.selectionId)
        require(current == selected) { "Selection incarnation changed" }
        val expected=e.view.tracks.single { it.logicalTrackId == logical }.expectedAsset?.let(::JSONObject) ?: throw Refused("unverified")
        require(GroupWire.canonical(expected).contentEquals(GroupWire.canonical(selected.asset.json()))) { "Selected local audio is not the exact issuer asset" }
        val all=disk.read("bindings.json"); val bindings=all.optJSONObject(key(view)) ?: JSONObject()
        bindings.put(logical,JSONObject().put("selection_id",selected.selectionId).put("incarnation",selected.incarnation))
        all.put(key(view),bindings)
        // No ack/UI-ready state is returned before the durable binding commits.
        disk.write("bindings.json",all)
    }
    private data class Candidate(val evidence: Evidence,val generation: String,val locals: Map<String,GroupLocalBytes>,val bindings: JSONArray)
    private fun candidate(view: GroupSessionView, readBytes: Boolean = true): Candidate = disk.locked {
        val e=evidence(view)
        val bindings=disk.read("bindings.json").optJSONObject(key(view)) ?: throw Refused("unbound")
        val locals=linkedMapOf<String,GroupLocalBytes>(); val wire=JSONArray()
        for(track in e.view.tracks.sortedBy { it.logicalTrackId }) {
            val b=bindings.optJSONObject(track.logicalTrackId) ?: throw Refused("unbound")
            val local=try { selections.verified(b.getString("selection_id"),readBytes) }
                catch(e: GroupSelectionException) { throw Refused(e.state) }
            if(local.selection.incarnation != b.getString("incarnation")) throw Refused("stale-selection")
            val expected=track.expectedAsset?.let(::JSONObject) ?: throw Refused("unverified")
            if(!GroupWire.canonical(expected).contentEquals(GroupWire.canonical(local.selection.asset.json()))) throw Refused("changed")
            locals[track.logicalTrackId]=local
            wire.put(JSONObject().put("logical_track_id",track.logicalTrackId).put("selection_id",local.selection.selectionId)
                .put("receiver_key",local.selection.receiverKey).put("incarnation",local.selection.incarnation).put("asset",local.selection.asset.json()))
        }
        require(locals.values.map { it.track.id }.distinct().size == locals.size) { "Ambiguous local receiver mapping" }
        val generation=GroupReplayContract.generation(e.identity,wire)
        // Check authority again after all fallible local-file verification.
        val after=evidence(view)
        require(after.identity.toString() == e.identity.toString())
        Candidate(e,generation,locals,wire)
    }
    fun readiness(view: GroupSessionView): GroupReplayReadiness = try { GroupReplayReadiness("candidate-exact",candidate(view).generation) }
        catch(e: Refused) { GroupReplayReadiness(e.state,reason="Group replay refused; original evidence retained") }
        catch(_: Exception) { GroupReplayReadiness("error",reason="Group replay authority or local storage unavailable") }
    fun open(view: GroupSessionView, generation: String): GroupReplaySource {
        val c=candidate(view); require(c.generation == generation) { "Group generation changed; reopen explicit source" }
        val bySource=mutableMapOf<Long,Int>(); val tracks=linkedMapOf<Int,GroupReplayTrack>()
        val manifest=c.evidence.bundle.getJSONObject("manifest"); val refs=manifest.getJSONArray("tracks")
        for(i in 0 until refs.length()) {
            val ref=refs.getJSONObject(i); val logical=ref.getString("logical_track_id"); val local=c.locals.getValue(logical)
            bySource[ref.getLong("source_local_id")]=local.track.id
            tracks[local.track.id]=GroupReplayTrack(logical,local.selection,local.track)
        }
        val events=JSONArray(c.evidence.events.toString())
        for(i in 0 until events.length()) events.getJSONObject(i).let { event ->
            if(event.getString("kind") == "load" && !event.isNull("trackId")) event.put("trackId",bySource.getValue(event.getLong("trackId")))
        }
        val log=SessionLog.parse(JSONObject().put("uuid",view.sessionUuid).put("started_at",view.startedAt).put("ended_at",view.endedAt)
            .put("replay_generation",generation).put("events",events).toString().reader())
        return GroupReplaySource(c.evidence.view,generation,log,tracks)
    }
    fun validate(source: GroupReplaySource) {
        require(candidate(source.view).generation == source.generation) { "Group source generation is no longer current" }
    }
    /** Hot scheduling fence uses stable identity facts; full bytes are hashed on open/load. */
    fun validateAuthority(source: GroupReplaySource) {
        require(candidate(source.view,readBytes=false).generation == source.generation) { "Group source authority or incarnation changed" }
    }
    /** Freeze the bytes actually verified, never reopen an ordinary mutable cache path for decode. */
    fun audio(source: GroupReplaySource,trackId: Int): GroupLoadAttempt {
        val c=candidate(source.view); require(c.generation == source.generation)
        val track=source.tracks.getValue(trackId); val bytes=c.locals.getValue(track.logicalId).bytes
        val directory=File(root,"group-replay/load-attempts")
        if(directory.mkdirs()) Files.setPosixFilePermissions(directory.toPath(),PosixFilePermissions.fromString("rwx------"))
        require(directory.isDirectory)
        val attempt=UUID.randomUUID().toString(); val file=File(directory,"$attempt.audio")
        require(file.createNewFile())
        try {
            Files.setPosixFilePermissions(file.toPath(),PosixFilePermissions.fromString("rw-------"))
            FileOutputStream(file).use { it.write(bytes); it.fd.sync() }
            Files.setPosixFilePermissions(file.toPath(),PosixFilePermissions.fromString("r--------"))
            validate(source)
            return GroupLoadAttempt(source,trackId,file,attempt,selections.identity(file))
        } catch(e: Exception) { file.delete(); throw e }
    }
    /** Call again after asynchronous engine decode, and before accepting its load receipt. */
    fun validateLoad(attempt: GroupLoadAttempt) {
        validate(attempt.source)
        val expected=attempt.source.tracks.getValue(attempt.trackId).selection.asset
        require(selections.identity(attempt.file) == attempt.fileIdentity)
        val bytes=attempt.file.readBytes()
        require(bytes.size.toLong() == expected.byteLength && GroupWire.sha256(bytes) == expected.sha256 && selections.identity(attempt.file) == attempt.fileIdentity)
        validate(attempt.source)
    }
}
