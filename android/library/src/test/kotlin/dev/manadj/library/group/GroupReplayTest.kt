package dev.manadj.library.group

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import dev.manadj.library.LibraryStore
import dev.manadj.library.SnapshotJson
import kotlin.test.*

class GroupReplayTest {
    private val fixture = JSONObject(File("../../tests/fixtures/group_replay_v1.json").readText())

    @Test fun generationMatchesSharedPythonVectorAndSortsLogicalBindings() {
        val vector = fixture.getJSONObject("generation_vector")
        val bindings = vector.getJSONArray("bindings")
        assertEquals("98ef3a9eaeff94062a8f9f21c9c779d942587cb501811f1064a55ceee0d6ce71",
            GroupReplayContract.generation(vector.getJSONObject("identity"), JSONArray().put(bindings.get(1)).put(bindings.get(0))))
    }

    @Test fun commonGrammarRejectsUnsupportedActionsControlsAndExtraFields() {
        val events = JSONArray()
        val chunks = JSONObject(fixture.getString("body_utf8")).getJSONObject("bundle").getJSONArray("chunks")
        for (i in 0 until chunks.length()) chunks.getJSONObject(i).getJSONArray("events").let { a ->
            for (j in 0 until a.length()) events.put(a.get(j))
        }
        assertTrue(GroupReplayContract.supports(events))
        for (bad in listOf(
            """{"t":0,"kind":"transport","channel":"A","action":"scratchBegin","playhead":0}""",
            """{"t":0,"kind":"control","channel":"A","control":"stemVocals","value":1}""",
            """{"t":0,"kind":"load","channel":"A","trackId":7,"bpm":120,"unexpected":0}""",
            """{"t":0,"kind":"future-event"}""")) {
            assertFalse(GroupReplayContract.supports(JSONArray().put(JSONObject(bad))), bad)
        }
    }

    @Test fun explicitExactBindingsOpenOnlyGuardedMappedEvidenceAndRevocationRefusesIt() {
        val root=Files.createTempDirectory("generated-group-replay-").toFile()
        try {
            val body=JSONObject(fixture.getString("body_utf8")); val gid=body.getString("group_id")
            val origin=body.getString("origin_device_id"); val receiver="88888888-8888-4888-8888-888888888888"
            val replica=GroupReplica.provision(File(root,"device-groups/$gid"),gid,receiver,ByteArray(32) { (it+32).toByte() })
            replica.pinMember(origin,GroupWire.publicKey(ByteArray(32) { it.toByte() }),"Laptop A")
            val operation=GroupSigned(GroupWire.encode64(fixture.getString("body_utf8").toByteArray()),fixture.getString("signature_b64"))
            replica.receiveDelivery(GroupWire.sign(JSONObject().put("format",GroupWire.FORMAT).put("group_id",gid).put("origin_device_id",origin)
                .put("kind","deliver").put("recipient_device_id",receiver).put("operation",operation.json()),ByteArray(32) { it.toByte() }))
            val assets=fixture.getJSONArray("assets"); val rows=JSONArray(); val store=LibraryStore(root)
            for(i in 0..1) {
                val asset=assets.getJSONObject(i)
                val row=JSONObject().put("id",if(i==0) 73 else 88).put("title","Generated $i").put("file_name",asset.getString("file_name"))
                    .put("audio_rev","generated").put("tag_ids",JSONArray()).put("hot_cues",JSONArray())
                rows.put(row)
                val recipe=asset.getJSONObject("recipe"); val n=recipe.getInt("sample_frames"); val rate=recipe.getInt("sample_rate")
                val wave=ByteBuffer.allocate(44+2*n).order(ByteOrder.LITTLE_ENDIAN)
                wave.put("RIFF".toByteArray()).putInt(36+2*n).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1)
                    .putInt(rate).putInt(rate*2).putShort(2).putShort(16).put("data".toByteArray()).putInt(2*n)
                val period=recipe.getInt("period_frames"); val amp=recipe.getInt("amplitude")
                repeat(n) { wave.putShort((if(it%period<period/2) amp else -amp).toShort()) }
                assertEquals(asset.getJSONObject("asset").getString("sha256"),GroupWire.sha256(wave.array()))
                requireNotNull(store.audioFile(SnapshotJson.track(row))).apply { parentFile.mkdirs(); writeBytes(wave.array()) }
            }
            store.writeSnapshotText(JSONObject("""{"version":1,"tag_categories":[],"tags":[],"links":[],"transitions":[],"cameos":[],"takes":[],"settings":{}}""")
                .put("tracks",rows).toString())
            val view=GroupHistory(root).project().items.single()
            val replay=GroupReplay(root)
            assertEquals("unbound",replay.readiness(view).state)
            for(i in 0..1) replay.bind(view,assets.getJSONObject(i).getString("logical_track_id"),replay.selections.select(if(i==0) 73 else 88))
            val ready=replay.readiness(view)
            assertEquals("candidate-exact",ready.state); assertFalse(ready.playable)
            val opened=replay.open(view,requireNotNull(ready.generation))
            assertEquals(setOf(73,88),opened.tracks.keys)
            assertEquals(setOf(73,88),opened.log.appearances.map { it.trackId }.toSet())
            assertEquals(ready.generation,GroupReplay(root).readiness(view).generation)
            val load=replay.audio(opened,73)
            assertEquals("5701a517b798515676b1b1159bd2cc39c42e17830e2e5d1c9d01038e96509ba5",GroupWire.sha256(load.file.readBytes()))
            replay.validateLoad(load)
            assertNotEquals(load.sourceId,replay.audio(opened,73).sourceId)
            replica.revoke(origin)
            assertEquals("revoked",replay.readiness(view).state)
            assertFails { replay.open(view,ready.generation!!) }
            assertFails { replay.validateLoad(load) }
            assertTrue(load.file.isFile) // cached exact bytes do not restore playback authority
            assertTrue(replica.evidence().isNotEmpty())
        } finally { root.deleteRecursively() }
    }
}
