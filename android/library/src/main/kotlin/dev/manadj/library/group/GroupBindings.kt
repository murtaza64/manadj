package dev.manadj.library.group

import dev.manadj.library.LibraryStore
import dev.manadj.library.LibraryTrack
import dev.manadj.library.SnapshotJson
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.nio.file.StandardOpenOption.READ
import java.nio.file.attribute.PosixFilePermissions
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

data class GroupAsset(val sha256: String, val byteLength: Long) {
    fun json() = JSONObject().put("algorithm", "sha256-file-bytes-v1").put("sha256", sha256).put("byte_length", byteLength)
}
data class GroupReceiverSelection(val selectionId: String, val receiverKey: String, val incarnation: String, val label: String, val asset: GroupAsset) {
    fun json() = JSONObject().put("format", "manadj-group-receiver-selection/v1").put("selection_id", selectionId)
        .put("receiver_key", receiverKey).put("incarnation", incarnation).put("label", label).put("asset", asset.json())
}
internal data class GroupLocalBytes(val selection: GroupReceiverSelection, val track: LibraryTrack, val bytes: ByteArray)
class GroupSelectionException(val state: String): IllegalStateException("Local group selection refused: $state")

/** Explicit local-owner selection only. Snapshot IDs/revisions locate candidates; they grant nothing.
 * The stable identity provider intentionally refuses unsupported filesystems/platforms.
 */
class GroupBindings(private val libraryRoot: File) {
    private val store = LibraryStore(libraryRoot)
    private val disk = GroupReplayStore(File(libraryRoot, "group-replay"))
    private val snapshot = File(libraryRoot, "snapshot.json")
    private data class Catalog(val identity: String,val tracks: Map<Int,LibraryTrack>,val rows: Map<Int,String>)
    @Volatile private var cachedCatalog: Catalog? = null
    private data class Facts(val track: LibraryTrack, val snapshot: String, val row: String, val file: String, val bytes: ByteArray,val length: Long)
    internal fun identity(file: File): String {
        if(!file.exists()) throw GroupSelectionException("missing")
        val attrs = try { Files.readAttributes(file.toPath(), "unix:dev,ino,ctime,lastModifiedTime,size,isRegularFile", NOFOLLOW_LINKS) }
            catch(_: UnsupportedOperationException) { throw GroupSelectionException("unsupported-identity") }
        require(attrs["isRegularFile"] == true && attrs["ino"] != null && attrs["dev"] != null && attrs["ctime"] != null) { "Stable file identity unsupported" }
        return GroupWire.sha256(GroupWire.canonical(JSONObject().put("path",file.canonicalPath).put("dev",attrs["dev"].toString())
            .put("ino",attrs["ino"].toString()).put("ctime",attrs["ctime"].toString()).put("mtime",attrs["lastModifiedTime"].toString()).put("size",attrs["size"].toString())))
    }
    private fun facts(id: Int, readBytes: Boolean = true): Facts {
        val snap = identity(snapshot)
        val catalog=cachedCatalog?.takeIf { it.identity == snap } ?: run {
            val text=snapshot.readText(); val tracks=SnapshotJson.parse(text).tracks
            require(tracks.map { it.id }.distinct().size == tracks.size)
            val rows=JSONObject(text).getJSONArray("tracks")
            val proofs=(0 until rows.length()).map(rows::getJSONObject).associate { it.getInt("id") to GroupWire.sha256(GroupWire.canonical(it)) }
            require(identity(snapshot) == snap)
            Catalog(snap,tracks.associateBy { it.id },proofs).also { cachedCatalog=it }
        }
        val track=catalog.tracks[id] ?: throw GroupSelectionException("stale-selection")
        val file = requireNotNull(store.audioFile(track)) { "No currently cached local audio" }
        require(file.canonicalPath.startsWith(store.audioDir.canonicalPath + File.separator))
        val before = identity(file)
        val length=file.length()
        require(length in 0..512L * 1024 * 1024) { "Oversized local audio" }
        val bytes = if(readBytes) file.readBytes() else byteArrayOf()
        require(before == identity(file) && snap == identity(snapshot)) { "Local selection changed during verification" }
        return Facts(track,snap,catalog.rows.getValue(id),before,bytes,length)
    }
    private fun selection(record: JSONObject): GroupReceiverSelection {
        val s = record.getJSONObject("selection"); val a=s.getJSONObject("asset")
        return GroupReceiverSelection(s.getString("selection_id"),s.getString("receiver_key"),s.getString("incarnation"),s.getString("label"),GroupAsset(a.getString("sha256"),a.getLong("byte_length")))
    }
    fun select(trackId: Int): GroupReceiverSelection = disk.locked {
        val f=facts(trackId)
        require(f.length > 0) { "Empty local audio cannot be selected" }
        val id=UUID.randomUUID().toString()
        val incarnation=GroupWire.sha256(GroupWire.canonical(JSONObject().put("selection_id",id).put("snapshot",f.snapshot).put("row",f.row).put("file",f.file)))
        val selected=GroupReceiverSelection(id,trackId.toString(),incarnation,f.track.title.take(160).ifBlank { "Local audio" },GroupAsset(GroupWire.sha256(f.bytes),f.bytes.size.toLong()))
        val records=disk.read("selections.json")
        records.put(id,JSONObject().put("selection",selected.json()).put("snapshot",f.snapshot).put("row",f.row).put("file",f.file))
        disk.write("selections.json",records)
        selected
    }
    fun current(selectionId: String): GroupReceiverSelection = verified(selectionId).selection
    internal fun verified(selectionId: String, readBytes: Boolean = true): GroupLocalBytes = disk.locked {
        val record=disk.read("selections.json").getJSONObject(GroupWire.uuid(selectionId))
        val selected=selection(record); val f=facts(selected.receiverKey.toInt(),readBytes)
        if(f.snapshot != record.getString("snapshot") || f.row != record.getString("row")) throw GroupSelectionException("stale-selection")
        if(f.length < selected.asset.byteLength) throw GroupSelectionException("partial")
        if(f.length != selected.asset.byteLength || readBytes && GroupWire.sha256(f.bytes) != selected.asset.sha256) throw GroupSelectionException("changed")
        if(f.file != record.getString("file")) throw GroupSelectionException("stale-selection")
        GroupLocalBytes(selected,f.track,f.bytes)
    }
}

/** Dedicated fsynced local state; corrupt/missing records are not repaired on read. */
internal class GroupReplayStore(val root: File) {
    fun <T> locked(block: () -> T): T = synchronized(locks.getOrPut(root.canonicalPath) { Any() }) {
        if(root.mkdirs()) Files.setPosixFilePermissions(root.toPath(),PosixFilePermissions.fromString("rwx------"))
        require(root.isDirectory)
        RandomAccessFile(File(root,".lock"),"rw").use { f -> f.channel.lock().use { block() } }
    }
    fun read(name: String): JSONObject {
        val file=File(root,name)
        if(!file.exists()) return JSONObject()
        require(file.isFile && file.length() <= 16 * 1024 * 1024)
        return JSONObject(file.readText())
    }
    fun write(name: String,value: JSONObject) {
        val bytes=value.toString().toByteArray(); require(bytes.size <= 16 * 1024 * 1024)
        val tmp=File.createTempFile(".replay-",".tmp",root)
        try {
            Files.setPosixFilePermissions(tmp.toPath(),PosixFilePermissions.fromString("rw-------"))
            FileOutputStream(tmp).use { it.write(bytes); it.fd.sync() }
            Files.move(tmp.toPath(),File(root,name).toPath(),ATOMIC_MOVE,REPLACE_EXISTING)
            FileChannel.open(root.toPath(),READ).use { it.force(true) }
        } finally { tmp.delete() }
    }
    companion object { private val locks=ConcurrentHashMap<String,Any>() }
}
