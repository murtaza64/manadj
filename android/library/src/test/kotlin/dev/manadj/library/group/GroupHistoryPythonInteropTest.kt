package dev.manadj.library.group

import org.json.JSONArray
import org.json.JSONObject
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.io.File
import java.net.URI
import java.util.UUID
import kotlin.test.*

/** Separate full-Session sandbox; never resets/reuses the earlier #453 metadata phone store. */
class GroupHistoryPythonInteropTest {
    @Test fun fullSessionsRelayIntoNormalHistoryWithOriginalIdentitiesAndNoPlayableClaim() {
        val configured = System.getenv("MANADJ_GROUP_HISTORY_FIXTURE_URL")
        assumeTrue(!configured.isNullOrEmpty(), "Requires explicitly started generated full-Session fixture")
        val uri = URI(configured!!)
        require(uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port > 0 && uri.rawUserInfo == null &&
            uri.rawQuery == null && uri.rawFragment == null && uri.rawPath.orEmpty() in setOf("", "/"))
        val base = uri.toString().trimEnd('/')
        fun get(path: String): String = URI(base+path).toURL().openConnection().run {
            connectTimeout=5000; readTimeout=5000
            getInputStream().use { val bytes=it.readNBytes(1024*1024+1); require(bytes.size<=1024*1024); bytes.toString(Charsets.UTF_8) }
        }
        val info = JSONObject(get("/")); require(info.get("generated_only") == true)
        val gid = "33333333-3333-4333-8333-333333333333"
        val ids = mapOf("a" to "11111111-1111-4111-8111-111111111111", "phone" to "22222222-2222-4222-8222-222222222222", "b" to "88888888-8888-4888-8888-888888888888")
        val seeds = listOf("a", "phone", "b").mapIndexed { i, name -> name to ByteArray(32) { (i*32+it).toByte() } }.toMap()
        require(info.getString("group_id") == gid)
        ids.forEach { (name, id) ->
            val member = info.getJSONObject("members").getJSONObject(name)
            require(member.getString("device_id") == id && member.getString("public_key_b64") == GroupWire.encode64(GroupWire.publicKey(seeds.getValue(name))))
        }
        val static = JSONObject(get("/full-session-fixture"))
        assertEquals("9883b104a969e9cd916dedcac71eae28a52139556ffcfbeda1b70103a1770154", static.getString("sha256"))
        val output = File(System.getProperty("user.dir"), "../../.lane-app/455").canonicalFile
        require(output.name == "455" && output.parentFile.name == ".lane-app"); require(output.mkdirs() || output.isDirectory)
        val libraryRoot = File(output, "generated-full-session-phone")
        val groupRoot = File(libraryRoot, "device-groups/$gid")
        val fresh = !File(groupRoot, "replica.json").exists()
        val phone = if(!fresh) GroupReplica(groupRoot, gid) else GroupReplica.provision(groupRoot, gid, ids.getValue("phone"), seeds.getValue("phone")).also { replica ->
            ids.forEach { (name, id) -> replica.pinMember(id, GroupWire.publicKey(seeds.getValue(name)), if(name == "a") "Laptop A" else if(name == "b") "Laptop B" else "This phone") }
        }
        val history = GroupHistory(libraryRoot)
        val before = JSONObject(get("/status"))
        val a = GroupHttpTransport("$base/a", gid); val b = GroupHttpTransport("$base/b", gid)
        val fromA = GroupExchange(phone).sync(ids.getValue("a"), a)
        val afterA = history.project()
        assertTrue(afterA.items.isNotEmpty()); assertTrue(afterA.items.all { it.projected && !it.playable && !it.editable && it.status == "unbound" })
        val fromB = GroupExchange(GroupReplica(groupRoot, gid)).sync(ids.getValue("b"), b)
        val reverse = GroupExchange(GroupReplica(groupRoot, gid)).sync(ids.getValue("a"), a)
        if(fresh) {
            assertEquals(GroupExchangeResult(0,1), fromA); assertEquals(GroupExchangeResult(1,1), fromB); assertEquals(GroupExchangeResult(1,0), reverse)
        }
        val view = history.project()
        assertEquals(2, view.items.size); assertEquals(2, view.knownUuids!!.size)
        assertTrue(view.items.all { it.status == "unbound" && it.projected && !it.playable && !it.editable && it.tracks.size == 2 })
        val signed = GroupReplica(groupRoot, gid).evidence()
        val facts = signed.associate { op -> val raw=GroupWire.decode64(op.bodyBase64, GroupWire.MAX_OPERATION); GroupWire.parse(raw).getString("operation_id") to GroupWire.sha256(raw) }
        val after = JSONObject(get("/status"))
        val normal = JSONObject()
        for(name in listOf("a","b")) {
            val ops = after.getJSONObject(name).getJSONArray("operations")
            assertEquals(facts, (0 until ops.length()).associate { ops.getJSONObject(it).let { o -> o.getString("operation_id") to o.getString("sha256") } })
            val rows = JSONArray(get("/$name/api/sessions")); normal.put(name, rows)
            val receivedViews = (0 until rows.length()).flatMap { index ->
                val views=rows.getJSONObject(index).getJSONArray("group_history"); (0 until views.length()).map { views.getJSONObject(it) }
            }
            assertEquals(1, receivedViews.size)
            receivedViews.forEach { item ->
                assertEquals("manadj-group-session-view/v1", item.getString("format"))
                assertFalse(item.getBoolean("playable")); assertFalse(item.getBoolean("editable")); assertTrue(item.getBoolean("projected"))
                assertEquals(2, item.getJSONArray("tracks").length())
                assertEquals(facts.getValue(item.getString("operation_id")), item.getString("operation_sha256"))
            }
        }
        assertEquals(0, after.getJSONObject("phone").getJSONArray("operations").length())
        assertEquals(GroupExchangeResult(0,0), GroupExchange(GroupReplica(groupRoot,gid)).sync(ids.getValue("a"),a))
        assertEquals(GroupExchangeResult(0,0), GroupExchange(GroupReplica(groupRoot,gid)).sync(ids.getValue("b"),b))
        assertEquals(signed, GroupReplica(groupRoot,gid).evidence())
        val restart = restartReplica(groupRoot, gid, ids.getValue("a"))
        assertEquals(0, restart.getJSONArray("pending").length())
        val pairedRoot=File(output,"generated-unenrolled-paired-cache")
        val paired=dev.manadj.library.LibraryRepository(pairedRoot,"$base/a")
        val markers=kotlinx.coroutines.runBlocking { paired.peerSessions.refresh() }
        assertEquals(1,markers.size)
        markers.forEach { marker ->
            assertTrue(marker.groupManaged); assertFalse(marker.canValidate); assertFalse(paired.rawSessionAllowed(marker.uuid))
            val claims=paired.peerSessions.groupOwnedClaims!!.getValue(marker.uuid)
            assertTrue(claims.isNotEmpty() && claims.all { it != null && facts[it.operationId] == it.operationSha256 })
            val decoy=File(pairedRoot,"retained-raw-cache.json").also { it.parentFile.mkdirs(); it.writeText("generated original cache") }
            assertFails { dev.manadj.library.SyncClient("$base/a").downloadSession(marker.uuid,decoy) }
            assertEquals("generated original cache",decoy.readText())
            assertFails { kotlinx.coroutines.runBlocking { paired.peerSessions.open(marker) } }
        }
        assertFalse(File(pairedRoot,"device-groups").exists())
        val pairedRestart=dev.manadj.library.LibraryRepository(pairedRoot,"$base/a")
        markers.forEach { assertFalse(pairedRestart.rawSessionAllowed(it.uuid)) }
        val receipt = JSONObject().put("format", "generated-group-history-interop/v1").put("generated_only", true).put("fixture", base)
            .put("fresh_phone", fresh).put("full_fixture_sha256", static.getString("sha256")).put("first_A", fromA.toString())
            .put("first_B", fromB.toString()).put("reverse_A", reverse.toString()).put("before", before).put("after", after)
            .put("operations", JSONObject(facts)).put("native_history", JSONArray(view.items.map { it.json() })).put("desktop_history", normal)
            .put("separate_JVM_restart", restart).put("repeat_scans", "both0push0pull").put("device_effects", "NONE")
            .put("actual_paired_group_markers",JSONArray(markers.map { marker -> JSONObject().put("session_uuid",marker.uuid)
                .put("group_managed",marker.groupManaged).put("playable",marker.canValidate)
                .put("claims",JSONArray(paired.peerSessions.groupOwnedClaims!!.getValue(marker.uuid).map { it?.json() ?: JSONObject.NULL })) }))
            .put("paired_group_enrollment",false).put("legacy_raw_cache_retained",true)
        val target = File(output, "full-history-interop-${UUID.randomUUID()}.json")
        target.writeText(receipt.toString(2)); println("Full Session history receipt: ${target.path}")
    }
}
