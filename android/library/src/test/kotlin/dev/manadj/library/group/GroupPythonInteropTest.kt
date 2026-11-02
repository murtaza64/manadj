package dev.manadj.library.group

import java.io.File
import java.net.URI
import java.util.UUID
import org.json.JSONObject
import org.junit.jupiter.api.Assumptions.assumeTrue
import kotlin.test.*

/** Opt-in generated-only Python A/B ↔ actual Kotlin PHONE; no device/listener/pairing. */
class GroupPythonInteropTest {
    @Test fun pythonAtoNativePhoneToPythonBAndReverseConvergeWithoutDirectAtoBTransport() {
        val configured = System.getenv("MANADJ_GROUP_FIXTURE_URL")
        assumeTrue(!configured.isNullOrEmpty(), "Requires explicitly started generated Python fixture")
        val base = URI(configured!!)
        require(base.scheme == "http" && base.host == "127.0.0.1" && base.port > 0 &&
            base.rawUserInfo == null && base.rawQuery == null && base.rawFragment == null && base.rawPath.orEmpty() in setOf("", "/"))
        val url = base.toString().trimEnd('/')
        fun get(path: String): JSONObject = URI(url + path).toURL().openConnection().run {
            connectTimeout = 5000; readTimeout = 5000
            getInputStream().use { input ->
                val bytes = input.readNBytes(1024 * 1024 + 1); require(bytes.size <= 1024 * 1024)
                JSONObject(bytes.toString(Charsets.UTF_8))
            }
        }
        val info = get("/"); require(info.get("generated_only") == true)
        val gid = "33333333-3333-4333-8333-333333333333"
        val ids = mapOf("a" to "11111111-1111-4111-8111-111111111111", "phone" to "22222222-2222-4222-8222-222222222222", "b" to "88888888-8888-4888-8888-888888888888")
        val seeds = listOf("a", "phone", "b").mapIndexed { index, name -> name to ByteArray(32) { (index*32+it).toByte() } }.toMap()
        require(info.getString("group_id") == gid)
        ids.forEach { (name, id) ->
            require(info.getJSONObject("members").getJSONObject(name).getString("device_id") == id)
            require(info.getJSONObject("members").getJSONObject(name).getString("public_key_b64") == GroupWire.encode64(GroupWire.publicKey(seeds.getValue(name))))
        }
        // This fixed generated path is retained across retries; never reset an identity whose
        // peers already acknowledged its evidence. It is not an installed phone/cache location.
        val outputs = File(System.getProperty("user.dir"), "../../.lane-app/453").canonicalFile
        require(outputs.name == "453" && outputs.parentFile.name == ".lane-app")
        require(outputs.mkdirs() || outputs.isDirectory)
        val phoneRoot = File(outputs, "generated-python-interop-phone")
        val fresh = !File(phoneRoot, "replica.json").exists()
        val phone = if(!fresh) GroupReplica(phoneRoot, gid) else
            GroupReplica.provision(phoneRoot, gid, ids.getValue("phone"), seeds.getValue("phone")).also { replica ->
                ids.forEach { (name, id) -> replica.pinMember(id, GroupWire.publicKey(seeds.getValue(name))) }
            }
        val before = get("/status")
        val transportA = GroupHttpTransport("$url/a", gid)
        val transportB = GroupHttpTransport("$url/b", gid)
        val fromA = GroupExchange(phone).sync(ids.getValue("a"), transportA)
        val fromB = GroupExchange(GroupReplica(phoneRoot, gid)).sync(ids.getValue("b"), transportB)
        val reverse = GroupExchange(GroupReplica(phoneRoot, gid)).sync(ids.getValue("a"), transportA)
        if(fresh) {
            assertEquals(GroupExchangeResult(0, 1), fromA)
            assertEquals(GroupExchangeResult(1, 1), fromB) // no A-op echoed immediately by supplying peer B
            assertEquals(GroupExchangeResult(1, 0), reverse)
        }
        val restarted = GroupReplica(phoneRoot, gid)
        val processRestart = restartReplica(phoneRoot, gid, ids.getValue("a"))
        assertEquals(0, processRestart.getJSONArray("pending").length())
        val signatures = restarted.evidence()
        assertEquals(2, signatures.size)
        val ownFacts = signatures.associate { signed ->
            val raw = GroupWire.decode64(signed.bodyBase64, GroupWire.MAX_OPERATION)
            GroupWire.parse(raw).getString("operation_id") to GroupWire.sha256(raw)
        }
        val after = get("/status")
        for(name in listOf("a", "b")) {
            val ops = after.getJSONObject(name).getJSONArray("operations")
            assertEquals(ownFacts, (0 until ops.length()).associate { i -> ops.getJSONObject(i).let { it.getString("operation_id") to it.getString("sha256") } })
        }
        assertEquals(0, after.getJSONObject("phone").getJSONArray("operations").length()) // Python oracle phone never participated.
        assertEquals(GroupExchangeResult(0, 0), GroupExchange(restarted).sync(ids.getValue("a"), transportA))
        assertEquals(GroupExchangeResult(0, 0), GroupExchange(restarted).sync(ids.getValue("b"), transportB))
        assertEquals(signatures, GroupReplica(phoneRoot, gid).evidence())
        val receipt = JSONObject().put("generated_only", true).put("fixture", url).put("group_id", gid)
            .put("phone", "actual Kotlin persistent GroupReplica/GroupExchange/GroupHttpTransport")
            .put("operations", JSONObject(ownFacts)).put("before", before).put("after", after)
            .put("fresh_phone", fresh).put("first_A", fromA.toString()).put("first_B", fromB.toString()).put("reverse_A", reverse.toString())
            .put("separate_JVM_restart", processRestart)
            .put("repeat_scan", "0 pushed / 0 pulled for both peers").put("python_phone_unused", true)
            .put("device_effects", "NONE")
        val receiptFile = File(outputs, "python-interop-${UUID.randomUUID()}.json")
        receiptFile.writeText(receipt.toString(2)); println("Generated cross-language receipt: ${receiptFile.path}")
    }
}
