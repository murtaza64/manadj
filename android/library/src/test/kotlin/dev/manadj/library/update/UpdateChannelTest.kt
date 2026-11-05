package dev.manadj.library.update

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.nio.file.Files
import kotlin.test.*

/** #419 host tests: generated channel manifests, APK stand-in bytes, no network/device/install. */
class UpdateChannelTest {
    private val apk = ByteArray(300_000) { (it * 13 + 7).toByte() }
    private val sha = ReleaseIdentity.sha256(apk)
    private val src = "6dca1c7265e3aafdc95d4c2cdb687d360c81346d"

    private fun entry(code: Long, over: JSONObject.() -> Unit = {}) = JSONObject().put("release_id", "%064x".format(code))
        .put("version_code", code).put("version_name", "0.1.0-rc.$code").put("min_sdk", 26).put("abis", JSONArray(listOf("arm64-v8a")))
        .put("source_revision", src).put("notes_sha256", "b".repeat(64))
        .put("apk_url", "https://manadj.murtaza.earth/android/stable/manadj-$code.apk").put("apk_sha256", sha).put("apk_bytes", apk.size)
        .apply(over)

    private fun channel(vararg entries: JSONObject, over: JSONObject.() -> Unit = {}) = JSONObject().put("format", "manadj_android_channel/v1")
        .put("channel", "stable").put("package", "dev.murt.manadj.excalibur").put("signer_cert_sha256", UpdatePolicy.SIGNER_SHA256)
        .put("entries", JSONArray(entries.toList())).apply(over).toString().toByteArray()

    private val installed = Installed("dev.murt.manadj.excalibur", 7, setOf(UpdatePolicy.SIGNER_SHA256), 34, listOf("arm64-v8a", "armeabi-v7a"))

    @Test fun highestApplicableVersionCodeWinsNeverLatestOrder() {
        val entries = UpdateChannel.parse(channel(entry(9), entry(8), entry(12) { put("min_sdk", 35) }, entry(11) { put("abis", JSONArray(listOf("x86_64"))) }, entry(6)))
        assertEquals(9L, assertIs<Offer.Available>(UpdateChannel.offer(entries, installed)).entry.versionCode)
        assertIs<Offer.UpToDate>(UpdateChannel.offer(entries.filter { it.versionCode <= 7 }, installed))
        assertIs<Offer.Refused>(UpdateChannel.offer(entries.filter { it.versionCode >= 11 }, installed))
    }

    @Test fun installedIdentityGatesSelfUpdate() {
        val entries = UpdateChannel.parse(channel(entry(8)))
        assertIs<Offer.Refused>(UpdateChannel.offer(entries, installed.copy(packageName = "dev.murt.manadj.excalibur.lane")))
        assertIs<Offer.Refused>(UpdateChannel.offer(entries, installed.copy(signerSha256 = setOf("a".repeat(64)))))
    }

    @Test fun manifestOutsideThePinRefused() {
        val bad = listOf(
            channel(entry(8)) { put("format", "manadj_android_channel/v2") },
            channel(entry(8)) { put("channel", "beta") },
            channel(entry(8)) { put("package", "dev.murt.manadj") },
            channel(entry(8)) { put("signer_cert_sha256", "c".repeat(64)) },
            channel(entry(8) { put("apk_url", "http://manadj.murtaza.earth/a.apk") }),
            channel(entry(8) { put("apk_url", "https://github.com/murtaza64/manadj/releases/latest/download/a.apk") }),
            channel(entry(8) { put("apk_url", "https://manadj.murtaza.earth.evil.example/a.apk") }),
            channel(entry(8) { put("apk_url", "https://user@manadj.murtaza.earth/a.apk") }),
            channel(entry(8) { put("apk_sha256", "XYZ") }),
            channel(entry(8) { put("apk_bytes", 0) }),
            channel(entry(8), entry(8)),
        )
        for (b in bad) assertFails(String(b)) { UpdateChannel.parse(b) }
        assertFails { UpdateChannel.parse(ByteArray(UpdatePolicy.MAX_MANIFEST_BYTES + 1)) }
    }

    @Test fun stagingVerifiesSizeAndHashAndKeepsNothingOnMismatch() {
        val dir = Files.createTempDirectory("stage-").toFile()
        try {
            val e = UpdateChannel.parse(channel(entry(8))).single()
            val stager = UpdateStager(dir)
            val urls = mutableListOf<String>()
            val f = stager.stage(e, { urls.add(it); ByteArrayInputStream(apk) })
            assertContentEquals(apk, f.readBytes()); assertEquals(listOf(e.apkUrl), urls)
            assertEquals(f, stager.staged(e))
            assertEquals(f.path, stager.stage(e, { error("not refetched") }).path)
            stager.clear()
            for (wrong in listOf(apk.copyOf(apk.size - 1), apk + byteArrayOf(1), apk.copyOf().also { it[5] = 0 })) {
                assertFailsWith<IOException> { stager.stage(e, { ByteArrayInputStream(wrong) }) }
                assertTrue(dir.listFiles()!!.isEmpty(), "nothing staged after a mismatch")
                assertNull(stager.staged(e))
            }
        } finally { dir.deleteRecursively() }
    }

    @Test fun releaseIdentityMatchesCoreSchemaOneAndRefusesInconsistency() {
        val body = "Fixes: decks resume after rotation.\n"
        val notes = ReleaseIdentity.sha256(body.toByteArray())
        val id = ReleaseIdentity.releaseId("0.1.0-rc.8", src, notes)
        // Python: hashlib.sha256(json.dumps({"schema":1,"version":"0.1.0-rc.8","source_revision":src,"notes_sha256":notes},
        //   sort_keys=True, separators=(',',':')).encode()).hexdigest()
        val expected = ReleaseIdentity.sha256("{\"notes_sha256\":\"$notes\",\"schema\":1,\"source_revision\":\"$src\",\"version\":\"0.1.0-rc.8\"}".toByteArray())
        assertEquals(expected, id)
        fun info(o: JSONObject.() -> Unit = {}) = JSONObject().put("schema", 1).put("version", "0.1.0-rc.8").put("source_revision", src)
            .put("notes_sha256", notes).put("release_id", id).apply(o).toString().toByteArray()
        fun rn(o: JSONObject.() -> Unit = {}) = JSONObject().put("schema", 1).put("release_id", id).put("body", body).apply(o).toString().toByteArray()
        val ok = assertNotNull(ReleaseIdentity.parse(info(), rn()))
        assertEquals(id, ok.releaseId); assertEquals(body, ok.body)
        assertNull(ReleaseIdentity.parse(null, null), "dev build: no identity")
        assertNull(ReleaseIdentity.parse(info(), null))
        assertNull(ReleaseIdentity.parse(info { put("version", "0.1.0-rc.9") }, rn()))
        assertNull(ReleaseIdentity.parse(info { put("extra", 1) }, rn()))
        assertNull(ReleaseIdentity.parse(info { put("schema", 2) }, rn()))
        assertNull(ReleaseIdentity.parse(info(), rn { put("body", "other") }))
        assertNull(ReleaseIdentity.parse(info(), rn { put("release_id", "e".repeat(64)) }))
        assertNull(ReleaseIdentity.parse(info(), rn { put("body", "x".repeat(40_000)) }))
    }

    @Test fun seenReceiptsAndActivityGate() {
        val dir = Files.createTempDirectory("seen-").toFile()
        try {
            val s = SeenReleases(File(dir, "seen"))
            assertFalse(s.seen("a".repeat(64)))
            s.markSeen("a".repeat(64))
            assertTrue(SeenReleases(File(dir, "seen")).seen("a".repeat(64)))
            assertEquals("{\"schema\":1,\"release_id\":\"${"a".repeat(64)}\"}", File(dir, "seen/${"a".repeat(64)}.json").readText())
            assertFails { s.markSeen("../x") }
        } finally { dir.deleteRecursively() }
        assertNull(Activity(false, false, false).blockReason)
        assertEquals("Stop playback to install", Activity(true, true, true).blockReason)
        assertNotNull(Activity(false, false, true).blockReason)
    }
}
