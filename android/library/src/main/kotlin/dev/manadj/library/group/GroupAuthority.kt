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

/** Deny-only inventory OUTSIDE per-group stores and outside optional derived history.
 * It contains no member keys and grants no trust/playback. Registration precedes metadata ack.
 */
internal class GroupAuthority(val root: File) {
    private val file get() = File(root,"inventory.json")
    fun read(): Map<String,Set<String>> {
        if(!file.exists()) { require(!root.exists()) { "Known group authority inventory unavailable" }; return emptyMap() }
        require(file.isFile && file.length()<=16*1024*1024)
        val data=JSONObject(file.readText()); GroupWire.fields(data,"version","groups"); require(data.get("version")==1)
        val groups=data.getJSONObject("groups")
        return groups.keys().asSequence().associate { gid -> GroupWire.uuid(gid) to groups.getJSONArray(gid).let { a ->
            (0 until a.length()).map { GroupWire.uuid(a.getString(it)) }.toSet()
        } }
    }
    fun record(groupId: String, received: Set<String>) {
        GroupWire.uuid(groupId); received.forEach(GroupWire::uuid)
        synchronized(locks.getOrPut(root.canonicalPath) { Any() }) {
            val created=root.mkdirs()
            if(created) Files.setPosixFilePermissions(root.toPath(),PosixFilePermissions.fromString("rwx------")) else require(root.isDirectory)
            RandomAccessFile(File(root,".lock"),"rw").use { lock -> lock.channel.lock().use {
                val next=if(created) mutableMapOf<String,Set<String>>() else read().toMutableMap()
                next[groupId]=next[groupId].orEmpty()+received
                val groups=JSONObject(); next.toSortedMap().forEach { (gid, ids) -> groups.put(gid,JSONArray(ids.sorted())) }
                val bytes=JSONObject().put("version",1).put("groups",groups).toString().toByteArray(); require(bytes.size<=16*1024*1024)
                val temp=File.createTempFile(".authority-",".tmp",root)
                try {
                    Files.setPosixFilePermissions(temp.toPath(),PosixFilePermissions.fromString("rw-------"))
                    FileOutputStream(temp).use { it.write(bytes); it.fd.sync() }
                    Files.move(temp.toPath(),file.toPath(),ATOMIC_MOVE,REPLACE_EXISTING)
                    FileChannel.open(root.toPath(),READ).use { it.force(true) }
                    root.parentFile?.let { FileChannel.open(it.toPath(),READ).use { channel -> channel.force(true) } }
                    root.parentFile?.parentFile?.let { FileChannel.open(it.toPath(),READ).use { channel -> channel.force(true) } }
                } finally { temp.delete() }
            } }
        }
    }
    companion object {
        private val locks=ConcurrentHashMap<String,Any>()
        fun forLibrary(root: File)=GroupAuthority(File(root,"group-authority"))
        fun forReplica(root: File, groupId: String): GroupAuthority {
            val parent=root.absoluteFile.parentFile ?: error("Replica needs a private parent")
            return if(parent.name=="device-groups" && root.name==groupId) forLibrary(parent.parentFile)
            else GroupAuthority(File(parent,".${root.name}-group-authority"))
        }
        /** Validate complete signed inventory before asserting completeness of an outside anchor.
         * Bookkeeping/proof contradictions fail; mere row/index presence never excludes a claim.
         */
        fun received(state: JSONObject, gid: String): Set<String> {
            require(state.getString("group_id")==gid)
            val local=GroupWire.uuid(state.getString("device_id")); val rows=state.getJSONArray("operations")
            fun key(id: String)=GroupWire.decode64(state.getJSONObject("members").getJSONObject(GroupWire.uuid(id)).getString("public_key_b64"),32)
            val signedById=mutableMapOf<String,GroupSigned>(); val received=mutableSetOf<String>()
            for(i in 0 until rows.length()) {
                val row=rows.getJSONObject(i); val signed=GroupSigned.parse(row.getJSONObject("signed"))
                val peek=GroupWire.parse(GroupWire.decode64(signed.bodyBase64,GroupWire.MAX_OPERATION))
                val origin=GroupWire.uuid(peek.getString("origin_device_id")); val verified=GroupWire.verify(signed,key(origin)); val body=verified.body
                GroupWire.fields(body,"format","group_id","origin_device_id","kind","operation_id","parents","bundle")
                require(body.get("format")==GroupWire.FORMAT && body.get("group_id")==gid && body.get("kind")=="session-create" && body.getJSONArray("parents").length()==0)
                val op=GroupWire.uuid(body.getString("operation_id")); val sid=GroupBundle.validate(body.getJSONObject("bundle"),origin)
                require(row.getString("operation_id")==op && row.getString("session_uuid")==sid && row.getString("origin_device_id")==origin && row.getString("sha256")==verified.sha256)
                require(signedById.put(op,signed)==null)
                if(origin!=local) received += sid
            }
            val proofs=state.optJSONObject("possessions") ?: JSONObject()
            for(name in proofs.keys()) {
                val record=proofs.getJSONObject(name); val proof=GroupSigned.parse(record.getJSONObject("proof"))
                val peek=GroupWire.parse(GroupWire.decode64(proof.bodyBase64,GroupWire.MAX_BODY))
                val sender=GroupWire.uuid(peek.getString("origin_device_id")); val body=GroupWire.verify(proof,key(sender)).body
                require(body.get("format")==GroupWire.FORMAT && body.get("group_id")==gid && body.get("recipient_device_id")==local)
                val operation=when(body.getString("kind")) {
                    "deliver" -> { GroupWire.fields(body,"format","group_id","origin_device_id","kind","recipient_device_id","operation"); GroupSigned.parse(body.getJSONObject("operation")) }
                    "page" -> { GroupWire.fields(body,"format","group_id","origin_device_id","kind","recipient_device_id","request_id","next_after","more","operations")
                        GroupWire.uuid(body.getString("request_id")); GroupWire.counter(body,"next_after"); require(body.get("more") is Boolean)
                        body.getJSONArray("operations").let { a -> require(a.length()==1); GroupSigned.parse(a.getJSONObject(0)) } }
                    else -> error("Invalid supplier proof")
                }
                val raw=GroupWire.decode64(operation.bodyBase64,GroupWire.MAX_OPERATION); val op=GroupWire.parse(raw).getString("operation_id")
                require(name=="$sender:$op" && signedById[op]==operation && record.getString("sha256")==GroupWire.sha256(raw))
            }
            state.optJSONArray("received_session_uuids")?.let { a ->
                require((0 until a.length()).all { GroupWire.uuid(a.getString(it)) in received })
            }
            return received
        }
    }
}
