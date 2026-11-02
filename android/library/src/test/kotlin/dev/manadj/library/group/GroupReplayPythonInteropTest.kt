package dev.manadj.library.group

import dev.manadj.library.LibraryRepository
import dev.manadj.library.SnapshotJson
import org.json.JSONArray
import org.json.JSONObject
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import kotlin.test.*

/** Explicit NEW generated sandbox, not a reset/relabel of metadata or synthetic-phone proof. */
class GroupReplayPythonInteropTest {
    @Test fun actualPythonAThroughKotlinPhoneToInitiallyEmptyBRetainsExactEvidenceAndLocalAssets() {
        val configured=System.getenv("MANADJ_GROUP_REPLAY_FIXTURE_URL")
        assumeTrue(!configured.isNullOrBlank(),"Requires separately started unseeded generated #456 fixture")
        val uri=URI(configured!!)
        require(uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port>0 && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.rawPath.orEmpty() in setOf("","/"))
        val base=configured.trimEnd('/')
        fun request(path: String,body: JSONObject? = null): String {
            val c=URI(base+path).toURL().openConnection() as HttpURLConnection
            c.connectTimeout=10000;c.readTimeout=10000
            if(body != null) { c.requestMethod="POST";c.doOutput=true;c.setRequestProperty("Content-Type","application/json");c.outputStream.use { it.write(body.toString().toByteArray()) } }
            try { require(c.responseCode == 200) { "Generated fixture $path status ${c.responseCode}" };return c.inputStream.use { it.readNBytes(2*1024*1024).toString(Charsets.UTF_8) } }
            finally { c.disconnect() }
        }
        val fixture=JSONObject(request("/fixture.json")); require(fixture.getBoolean("generated_only"))
        val literal=JSONObject(File("../../tests/fixtures/group_replay_v1.json").readText())
        assertEquals(literal.getString("body_utf8"),fixture.getString("body_utf8"))
        assertEquals(literal.getString("signature_b64"),fixture.getString("signature_b64"))
        val body=JSONObject(literal.getString("body_utf8")); val gid=body.getString("group_id");val oid=body.getString("operation_id")
        val a="11111111-1111-4111-8111-111111111111";val p="22222222-2222-4222-8222-222222222222";val b="88888888-8888-4888-8888-888888888888"
        assertEquals(p,fixture.getJSONObject("devices").getString("phone"))
        val output=File("../../.lane-app/456").canonicalFile
        require(output.name == "456" && output.parentFile.name == ".lane-app");require(output.mkdirs() || output.isDirectory)
        val root=File(output,"generated-exact-local-phone");val groupRoot=File(root,"device-groups/$gid")
        val fresh=!File(groupRoot,"replica.json").exists()
        val replica=if(fresh) GroupReplica.provision(groupRoot,gid,p,ByteArray(32) { (32+it).toByte() }).also { phone ->
            listOf(a,p,b).forEachIndexed { i,id -> phone.pinMember(id,GroupWire.publicKey(ByteArray(32) { (i*32+it).toByte() }),if(i==0) "Laptop A" else if(i==1) "This phone" else "Laptop B") }
        } else GroupReplica(groupRoot,gid)
        val transportA=GroupHttpTransport("$base/a",gid);val transportB=GroupHttpTransport("$base/b",gid)
        val firstA=GroupExchange(replica).sync(a,transportA)
        val repo=LibraryRepository(root,"$base/b");val view=repo.groupHistory.project().items.single()
        assertEquals(literal.getString("operation_sha256"),view.operationSha256);assertFalse(view.playable)
        val firstB=GroupExchange(GroupReplica(groupRoot,gid)).sync(b,transportB)
        val reverseA=GroupExchange(GroupReplica(groupRoot,gid)).sync(a,transportA)
        if(fresh) { assertEquals(GroupExchangeResult(0,1),firstA);assertEquals(GroupExchangeResult(1,0),firstB);assertEquals(GroupExchangeResult(0,0),reverseA) }
        val original=replica.evidence().single()
        assertEquals(literal.getString("body_utf8"),GroupWire.decode64(original.bodyBase64,GroupWire.MAX_OPERATION).toString(Charsets.UTF_8))
        assertEquals(GroupExchangeResult(0,0),GroupExchange(GroupReplica(groupRoot,gid)).sync(a,transportA))
        assertEquals(GroupExchangeResult(0,0),GroupExchange(GroupReplica(groupRoot,gid)).sync(b,transportB))
        val assets=literal.getJSONArray("assets"); val rows=JSONArray()
        if(!File(root,"snapshot.json").exists()) {
            for(i in 0..1) {
                val asset=assets.getJSONObject(i);val recipe=asset.getJSONObject("recipe")
                val row=JSONObject().put("id",509+i).put("title","Generated local tone $i").put("file_name",asset.getString("file_name"))
                    .put("audio_rev","generated456").put("tag_ids",JSONArray()).put("hot_cues",JSONArray())
                rows.put(row)
                val n=recipe.getInt("sample_frames");val rate=recipe.getInt("sample_rate");val period=recipe.getInt("period_frames");val amp=recipe.getInt("amplitude")
                val wav=ByteBuffer.allocate(44+2*n).order(ByteOrder.LITTLE_ENDIAN)
                wav.put("RIFF".toByteArray()).putInt(36+2*n).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1)
                    .putInt(rate).putInt(rate*2).putShort(2).putShort(16).put("data".toByteArray()).putInt(2*n)
                repeat(n) { wav.putShort((if(it%period<period/2) amp else -amp).toShort()) }
                assertEquals(asset.getJSONObject("asset").getString("sha256"),GroupWire.sha256(wav.array()))
                requireNotNull(repo.store.audioFile(SnapshotJson.track(row))).apply { parentFile.mkdirs();writeBytes(wav.array()) }
            }
            repo.store.writeSnapshotText(JSONObject("""{"version":1,"tag_categories":[],"tags":[],"links":[],"transitions":[],"cameos":[],"takes":[],"settings":{}}""").put("tracks",rows).toString())
            val adapter=repo.groupReplay()
            for(i in 0..1) adapter.bind(view,assets.getJSONObject(i).getString("logical_track_id"),adapter.selections.select(509+i))
        }
        val adapter=repo.groupReplay();val ready=adapter.readiness(view)
        assertEquals("candidate-exact",ready.state);assertFalse(ready.playable)
        val source=adapter.open(view,requireNotNull(ready.generation));assertEquals(setOf(509,510),source.tracks.keys)
        val restart=LibraryRepository(root,"$base/b").groupReplay().readiness(view)
        assertEquals(ready,restart)
        val replayPath="/b/api/peer-sync/group-replay/$gid/$oid"
        for(i in 0..1) {
            val selected=JSONObject(request("/b/api/peer-sync/group-replay/selections/${if(i==0) 73 else 88}",JSONObject()))
            request("$replayPath/bindings",JSONObject().put("logical_track_id",assets.getJSONObject(i).getString("logical_track_id"))
                .put("selection_id",selected.getString("selection_id")).put("incarnation",selected.getString("incarnation")))
        }
        val backendReady=JSONObject(request("$replayPath/readiness"))
        assertEquals("candidate-exact",backendReady.getString("state"));assertFalse(backendReady.getBoolean("playable"))
        val backendSource=JSONObject(request("$replayPath/source?generation=${backendReady.getString("generation")}"))
        val history=JSONArray(request("/b/api/sessions"));assertTrue(history.length()>0)
        assertEquals(original,GroupReplica(groupRoot,gid).evidence().single())
        val receipt=JSONObject().put("format","generated-group-exact-local-interop/v1").put("fixture",base).put("fresh_phone",fresh)
            .put("first_A",firstA.toString()).put("first_B",firstB.toString()).put("reverse_A",reverseA.toString()).put("repeat_scans","both0push0pull")
            .put("operation_sha256",view.operationSha256).put("phone",p).put("receiver_ids",JSONArray(listOf(509,510)))
            .put("phone_generation",ready.generation).put("backend_readiness",backendReady).put("backend_source",backendSource)
            .put("native_view",view.json()).put("desktop_history",history).put("audio_transport",false).put("python_phone_used",false)
            .put("phone_directory",root.canonicalPath).put("device_effects","NONE")
        File(output,"exact-local-interop-${UUID.randomUUID()}.json").apply { writeText(receipt.toString(2));println("GROUP456 actual transport/local-binding receipt $path") }
    }
}
