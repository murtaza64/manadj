package dev.manadj.library.session

import dev.manadj.library.LibraryTrack
import dev.manadj.library.SnapshotJson
import dev.manadj.library.SyncClient
import dev.manadj.library.SyncException
import dev.manadj.library.group.GroupOperationClaim
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

private class UnsupportedPeerAdapterVersion : IllegalArgumentException("Unsupported peer adapter version")
private class MalformedPeerAuthority : IllegalArgumentException("Malformed paired UUID authority; replay is disabled and evidence retained")

fun peerUuid(value: String): String = value.also {
    require(it.matches(Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))) { "Invalid peer UUID" }
}
fun peerDigest(value: String): String = value.also { require(it.matches(Regex("[0-9a-f]{64}"))) { "Invalid peer digest" } }

enum class PeerSessionState(val label: String) {
    PARTIAL_CHUNKS("RECEIVING"), UNRESOLVED_REFERENCES("UNRESOLVED TRACKS"), ASSETS_UNAVAILABLE("MISSING / CHANGED AUDIO"),
    NOT_MATERIALIZED("AWAITING DESKTOP INTAKE"), STALE_BINDING("STALE TRACK BINDING"), READY("RESOLVED · VERIFY TO PLAY"), SOURCE_INVALID("INVALID SOURCE"),
    GROUP_METADATA_ONLY("GROUP EVIDENCE · NOT PLAYABLE HERE"), UNKNOWN("UNSUPPORTED STATE");
    companion object { fun parse(value: String) = entries.firstOrNull { it.name.lowercase() == value } ?: UNKNOWN }
}

data class PeerDependency(val logicalId: String, val localId: Int?, val state: String, val sha256: String?, val length: Long?)
data class PeerSessionItem(
    val uuid: String, val originReplicaId: String, val recordingOrigin: String?, val manifest: String,
    val startedAt: String?, val endedAt: String?, val materialized: Boolean, val state: PeerSessionState,
    val generation: String?, val dependencies: List<PeerDependency>, val conflictCount: Int, val checked: Boolean = true,
    val groupManaged: Boolean = false,
) {
    val key get() = "peer:$originReplicaId:$uuid:$manifest"
    val canValidate get() = !groupManaged && state == PeerSessionState.READY && materialized && generation != null
    val statusLabel get() = (if (checked) "" else "CACHED · REVALIDATE · ") + state.label +
        if (conflictCount > 0) " · $conflictCount CONFLICT RECEIPT(S)" else ""
    fun header() = SessionHeader(uuid, startedAt, endedAt, 0, recordingOrigin, peer = this)
}
data class PeerTrack(val logicalId: String, val sha256: String, val length: Long, val track: LibraryTrack) {
    fun sourceId(replay: PeerReplay) = "peer:${replay.item.uuid}:${replay.generation}:${track.id}:$sha256"
}
data class PeerReplay(val item: PeerSessionItem, val log: SessionLog, val tracks: Map<Int, PeerTrack>) {
    val generation get() = requireNotNull(item.generation)
}

/** Own-phone read-only intake. Persisted metadata is inspectable, never an offline replay authorization. */
class PeerSessions(private val root: File, private val client: () -> SyncClient, private val io: CoroutineDispatcher = Dispatchers.IO) {
    private val lock = Mutex()
    private val listFile = File(root, "items.json")
    private val knownFile = File(root, "known-uuids.json")
    private val pendingAuthority = File(root, "authority-refresh.pending")
    private val groupClaimsFile = File(root, "group-owned-claims.json")
    private val ordinaryKnownFile = File(root, "ordinary-known-uuids.json")
    /** A received UUID never regains bare-ID authority when a list omits it or the desktop is offline. */
    @Volatile var knownUuids: Set<String>? = runCatching {
        require(!pendingAuthority.exists()) { "Interrupted peer authority refresh" }
        require(!knownFile.exists() || knownFile.isFile) { "Unreadable peer UUID authority" }
        require(!listFile.exists() || listFile.isFile) { "Unreadable peer metadata" }
        val remembered = if (knownFile.isFile) JSONArray(readBounded(knownFile)).let { a ->
            (0 until a.length()).map { peerUuid(a.getString(it)).lowercase() }.toSet()
        } else emptySet()
        remembered + if (listFile.isFile) parseList(readBounded(listFile)).map { it.uuid.lowercase() } else emptyList()
    }.getOrNull()
        private set
    /** Deny-only paired claims retain original signer namespaces, never import group trust. */
    @Volatile var groupOwnedClaims: Map<String, Set<GroupOperationClaim?>>? = runCatching {
        require(!pendingAuthority.exists())
        val saved = if(groupClaimsFile.exists()) parseClaims(JSONObject(readBounded(groupClaimsFile))) else emptyMap()
        mergeClaims(saved, if(listFile.isFile) groupDeniedClaims(readBounded(listFile)) else emptyMap())
    }.getOrNull()
        private set
    @Volatile private var ordinaryKnown: Set<String>? = runCatching {
        require(!pendingAuthority.exists())
        if(ordinaryKnownFile.exists()) parseIds(JSONArray(readBounded(ordinaryKnownFile)))
        else knownUuids ?: error("Unknown historical UUID authority") // conservative legacy migration
    }.getOrNull()
    fun rawAllowed(uuid: String, verifiedOwnClaims: Set<GroupOperationClaim> = emptySet()): Boolean {
        val id=uuid.lowercase(); val known=knownUuids ?: return false; val ordinary=ordinaryKnown ?: return false
        val groups=groupOwnedClaims ?: return false
        if(id in ordinary) return false
        val claims=groups[id] ?: return id !in known
        return claims.isNotEmpty() && claims.all { it != null && it in verifiedOwnClaims }
    }
    fun cached(): List<PeerSessionItem> = runCatching { parseList(readBounded(listFile)).map { it.copy(checked = false) } }.getOrDefault(emptyList())

    suspend fun refresh(): List<PeerSessionItem> = withContext(io) { lock.withLock {
        val known = knownUuids ?: throw SyncException("Peer UUID authority cache is unreadable; unscoped replay is disabled")
        val previousGroups = groupOwnedClaims ?: throw SyncException("Group UUID claim authority is unreadable")
        val previousOrdinary = ordinaryKnown ?: throw SyncException("Ordinary UUID authority is unreadable")
        // A crash/write failure after learning new IDs must not make an older empty cache
        // authoritative on restart. Persist intent before fetching any new authority.
        try { store(pendingAuthority, "pending") }
        catch (e: Exception) { knownUuids = null; groupOwnedClaims = null; ordinaryKnown = null; throw e }
        var learned = false
        try {
            val text = client().peerSessionsText()
            // A malformed v1 batch may contain a valid denial before a bad sibling. The durable
            // intent is already present: parse failures become unknown authority, never an old
            // empty permission set. Parse the complete batch before any fallible cache write.
            val claims = parseAuthority { groupDeniedClaims(text) }
            val items = parseAuthority { parseList(text) }
            val denied = claims.keys
            val next = known + denied + items.map { it.uuid.lowercase() }
            groupOwnedClaims = mergeClaims(previousGroups, claims)
            knownUuids = next // In-memory fence precedes every fallible metadata write.
            ordinaryKnown = previousOrdinary + items.filterNot { it.groupManaged }.map { it.uuid.lowercase() }
            learned = true
            store(ordinaryKnownFile, JSONArray(ordinaryKnown!!.sorted()).toString())
            store(groupClaimsFile, claimsJson(groupOwnedClaims!!).toString())
            store(knownFile, JSONArray(next.sorted()).toString())
            store(listFile, text)
            check(pendingAuthority.delete()) { "Cannot finish peer UUID authority refresh" }
            items
        } catch (e: Exception) {
            if(e is MalformedPeerAuthority) {
                knownUuids = null; groupOwnedClaims = null; ordinaryKnown = null
                learned = true // retain the fsynced intent; restart must remain fail-closed
            }
            // A rejected/unreachable response supplied no trusted new IDs. Preserve prior
            // authority; a failed cleanup is itself an unknown-authority state.
            if (!learned && !pendingAuthority.delete()) { knownUuids = null; groupOwnedClaims = null; ordinaryKnown = null }
            throw e
        }
    } }

    private fun <T> parseAuthority(block: () -> T): T = try { block() }
    catch(e: UnsupportedPeerAdapterVersion) { throw e }
    catch(e: Exception) { throw MalformedPeerAuthority() }

    /** Fresh desktop validation on every open/start/resume/seek; deliberately no cached-detail fallback. */
    suspend fun open(item: PeerSessionItem): PeerReplay = withContext(io) { lock.withLock {
        require(groupOwnedClaims?.containsKey(item.uuid.lowercase()) == false) { "Group-owned UUID cannot enter paired replay" }
        require(knownUuids?.contains(item.uuid.lowercase()) == true) { "Known received UUID authority required" }
        require(item.canValidate) { "Peer Session is not resolved/materialized with exact audio" }
        val text = client().peerSessionText(item.uuid, requireNotNull(item.generation))
        val replay = parseDetail(text)
        require(replay.item.key == item.key && replay.generation == item.generation) { "Peer Session generation/source changed; refresh and reopen" }
        store(File(root, "evidence/${hash(replay.item.key + replay.generation)}.json"), text)
        replay
    } }

    /** Verify the generation again before every native load, even if the exact bytes are already cached. */
    suspend fun audio(replay: PeerReplay, id: Int): File = withContext(io) { lock.withLock {
        require(groupOwnedClaims?.containsKey(replay.item.uuid.lowercase()) == false) { "Group-owned UUID cannot load paired audio" }
        val remote = client()
        val current = parseDetail(remote.peerSessionText(replay.item.uuid, replay.generation))
        require(current.item.key == replay.item.key && current.generation == replay.generation &&
            current.item.dependencies == replay.item.dependencies && current.tracks == replay.tracks && current.log.events == replay.log.events) { "Peer Session source changed; reopen" }
        val asset = replay.tracks[id] ?: throw SyncException("Track is not a member of this peer generation")
        val target = File(root, "audio/${hash(remote.baseUrl + replay.item.key + replay.generation + id + asset.sha256)}.audio")
        if (!matches(target, asset)) {
            target.parentFile!!.mkdirs()
            if (target.parentFile!!.usableSpace < asset.length) throw SyncException("Not enough space for exact peer audio")
            remote.downloadPeerAudio(replay.item.uuid, replay.generation, id, asset.sha256, asset.length, target)
        }
        if (!matches(target, asset)) throw SyncException("Cached peer audio no longer matches its generation")
        target
    } }

    private fun matches(file: File, asset: PeerTrack): Boolean = file.isFile && file.length() == asset.length &&
        file.inputStream().use { input ->
            val digest = MessageDigest.getInstance("SHA-256"); val bytes = ByteArray(64 * 1024)
            while (true) { val n = input.read(bytes); if (n < 0) break; digest.update(bytes, 0, n) }
            hex(digest.digest()) == asset.sha256
        }
    private fun store(file: File, text: String) {
        val bytes=text.toByteArray(Charsets.UTF_8); require(bytes.size<=64*1024*1024) { "Peer authority cache capacity reached; existing evidence retained" }
        file.parentFile!!.mkdirs()
        val tmp = File.createTempFile(".peer-", ".tmp", file.parentFile)
        try {
            java.io.FileOutputStream(tmp).use { it.write(bytes); it.fd.sync() }
            java.nio.file.Files.move(tmp.toPath(), file.toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
            java.nio.channels.FileChannel.open(file.parentFile!!.toPath(),java.nio.file.StandardOpenOption.READ).use { it.force(true) }
        }
        finally { tmp.delete() }
    }

    companion object {
        private fun readBounded(file: File): String {
            require(file.isFile && file.length()<=64*1024*1024) { "Peer authority cache unreadable" }
            return file.readText()
        }
        private fun integer(o: JSONObject, key: String): Long = o.get(key).toString().toLongOrNull()
            ?.takeIf { o.get(key) is Number } ?: error("Invalid peer integer $key")
        private fun id(o: JSONObject, key: String): Int = integer(o, key).also { require(it in 1..Int.MAX_VALUE) }.toInt()
        private fun str(o: JSONObject, key: String): String? = if (o.isNull(key)) null else o.getString(key)
        private fun version(o: JSONObject) { if(integer(o, "version") != 1L) throw UnsupportedPeerAdapterVersion() }
        fun parseItem(o: JSONObject): PeerSessionItem {
            require(!o.has("group_managed") || o.get("group_managed") is Boolean) { "Invalid group ownership marker" }
            val groupManaged = o.opt("group_managed") == true || o.optString("state") == "group_metadata_only"
            val deps = o.getJSONArray("dependencies")
            require(deps.length() <= 10000)
            val dependencies = (0 until deps.length()).map { i -> deps.getJSONObject(i).let { d ->
                PeerDependency(peerUuid(d.getString("logical_track_id")), if (d.isNull("local_track_id")) null else id(d,"local_track_id"),
                    d.getString("asset_state"), str(d,"sha256")?.let(::peerDigest),
                    if (d.isNull("byte_length")) null else integer(d,"byte_length").also { require(it > 0) })
            } }
            require(dependencies.map { it.logicalId }.distinct().size == dependencies.size)
            val item = PeerSessionItem(peerUuid(o.getString("session_uuid")), peerUuid(o.getString("origin_replica_id")),
                str(o,"recording_origin"), peerDigest(o.getString("manifest_sha256")), str(o,"started_at"), str(o,"ended_at"),
                o.getBoolean("materialized"), if(groupManaged) PeerSessionState.GROUP_METADATA_ONLY else PeerSessionState.parse(o.getString("state")), str(o,"replay_generation")?.let(::peerDigest),
                dependencies, integer(o,"conflict_count").also { require(it in 0..Int.MAX_VALUE) }.toInt(), groupManaged=groupManaged)
            if (item.state == PeerSessionState.READY) {
                require(item.materialized && item.generation != null && dependencies.all { it.state == "exact" && it.localId != null && it.sha256 != null && it.length != null })
                require(dependencies.map { it.localId }.distinct().size == dependencies.size)
            }
            return item
        }
        private fun groupDeniedClaims(text: String): Map<String, Set<GroupOperationClaim?>> {
            val o=JSONObject(text); version(o); val a=o.getJSONArray("items"); require(a.length()<=10000)
            return (0 until a.length()).map { a.getJSONObject(it) }.filter {
                it.opt("group_managed") == true || it.optString("state") == "group_metadata_only"
            }.groupBy { peerUuid(it.getString("session_uuid")).lowercase() }.mapValues { (_, rows) -> rows.flatMap { marker ->
                val claims=runCatching {
                    val a=marker.getJSONArray("group_claims"); require(a.length() in 1..256)
                    (0 until a.length()).map { i -> runCatching { GroupOperationClaim.parse(a.getJSONObject(i)) }.getOrNull() }
                }.getOrDefault(listOf(null))
                val legacyOrigin=runCatching { peerUuid(marker.getString("origin_replica_id")).lowercase() }.getOrNull()
                if(legacyOrigin == null || claims.none { it?.originDeviceId == legacyOrigin }) claims+listOf(null) else claims
            }.toSet() }
        }
        private fun parseIds(a: JSONArray) = (0 until a.length()).map { peerUuid(a.getString(it)).lowercase() }.toSet()
        private fun parseClaims(o: JSONObject) = o.keys().asSequence().associate { key ->
            peerUuid(key).lowercase() to o.getJSONArray(key).let { a -> (0 until a.length()).map {
                // Missing/malformed and historical origin-only reasons remain permanent denies.
                runCatching { GroupOperationClaim.parse(a.getJSONObject(it)) }.getOrNull()
            }.toSet().also { require(it.isNotEmpty()) } }
        }
        private fun mergeClaims(a: Map<String,Set<GroupOperationClaim?>>, b: Map<String,Set<GroupOperationClaim?>>) = (a.keys+b.keys).associateWith { a[it].orEmpty()+b[it].orEmpty() }
        private fun claimsJson(claims: Map<String,Set<GroupOperationClaim?>>) = JSONObject().also { o -> claims.toSortedMap().forEach { (id, reasons) ->
            o.put(id,JSONArray(reasons.map { it?.json() ?: JSONObject.NULL }))
        } }
        fun parseList(text: String): List<PeerSessionItem> {
            val o = JSONObject(text); version(o); val a = o.getJSONArray("items"); require(a.length() <= 10000)
            return (0 until a.length()).map { parseItem(a.getJSONObject(it)) }.also { require(it.map { x -> x.key }.distinct().size == it.size) }
        }
        fun parseDetail(text: String): PeerReplay {
            val o = JSONObject(text); version(o); val item = parseItem(o.getJSONObject("item"))
            require(item.canValidate) { "Peer Session is not ready" }
            val session = o.getJSONObject("session")
            require(session.getString("uuid") == item.uuid && session.getString("replay_generation") == item.generation)
            val a = o.getJSONArray("tracks"); require(a.length() == item.dependencies.size)
            val tracks = (0 until a.length()).map { i -> a.getJSONObject(i).let { t ->
                val localId = id(t,"local_track_id"); val logical = peerUuid(t.getString("logical_track_id"))
                val sha = peerDigest(t.getString("sha256")); val length = integer(t,"byte_length")
                val dep = item.dependencies.single { it.logicalId == logical }
                require(dep.localId == localId && dep.sha256 == sha && dep.length == length)
                val track = JSONObject(t.getJSONObject("track").toString()).put("file_name", "received-$localId").put("tag_ids", JSONArray())
                require(id(track,"id") == localId)
                PeerTrack(logical, sha, length, SnapshotJson.track(track))
            } }
            require(tracks.map { it.track.id }.distinct().size == tracks.size)
            val ids = tracks.map { it.track.id }.toSet()
            val events = session.getJSONArray("events")
            for (i in 0 until events.length()) events.getJSONObject(i).let { e ->
                if (e.getString("kind") == "load" && !e.isNull("trackId")) require(id(e,"trackId") in ids) { "Foreign/nonmember Track ID in peer Session" }
            }
            val log = SessionLog.parse(session.toString())
            require(log.events.filterIsInstance<CaptureEvent.Load>().all { it.trackId == null || it.trackId in ids }) { "Foreign/nonmember Track ID in peer Session" }
            return PeerReplay(item, log, tracks.associateBy { it.track.id })
        }
        private fun hash(text: String) = hex(MessageDigest.getInstance("SHA-256").digest(text.toByteArray()))
        private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }
    }
}
