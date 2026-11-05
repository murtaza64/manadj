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

    private fun entry(code: Long, over: JSONObject.() -> Unit = {}): JSONObject {
        val id = "%064x".format(code)
        return JSONObject().put("release_id", id)
            .put("version_code", code).put("version_name", "0.1.0-rc.$code").put("min_sdk", 26).put("abis", JSONArray(listOf("arm64-v8a")))
            .put("source_revision", src).put("source_tree_sha256", "2".repeat(64)).put("build_batch_id", "33333333-3333-4333-8333-333333333333")
            .put("notes_sha256", "b".repeat(64)).put("qa_receipt_sha256s", JSONArray(listOf("5".repeat(64), "6".repeat(64))))
            .put("apk_url", "https://manadj.murtaza.earth/android/artifacts/$id/$sha.apk").put("apk_sha256", sha).put("apk_bytes", apk.size)
            .apply(over)
    }

    private fun channel(vararg entries: JSONObject, over: JSONObject.() -> Unit = {}) = JSONObject().put("format", "manadj_android_channel/v1")
        .put("channel", "stable").put("package", "dev.murt.manadj.excalibur").put("signer_cert_sha256", UpdatePolicy.SIGNER_SHA256)
        .put("entries", JSONArray(entries.toList())).apply(over).toString().toByteArray()

    private val installed = Installed("dev.murt.manadj.excalibur", 7, setOf(UpdatePolicy.SIGNER_SHA256), 34, listOf("arm64-v8a", "armeabi-v7a"))

    @Test fun highestApplicableVersionCodeWinsNeverLatestOrder() {
        val entries = UpdateChannel.parse(channel(entry(6), entry(8), entry(9), entry(11) { put("abis", JSONArray(listOf("x86_64"))) }, entry(12) { put("min_sdk", 35) }))
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
            channel(entry(8)) { put("extra", 1) },
            channel(entry(8) { put("extra", 1) }),
            channel(entry(8) { remove("qa_receipt_sha256s") }),
            channel(entry(8) { put("qa_receipt_sha256s", JSONArray(listOf("5".repeat(64)))) }),
            channel(entry(8) { put("qa_receipt_sha256s", JSONArray(listOf("6".repeat(64), "5".repeat(64)))) }),
            channel(entry(8) { put("abis", JSONArray(listOf("armeabi-v7a", "arm64-v8a"))) }),
            channel(entry(8) { put("abis", JSONArray(listOf("mips"))) }),
            channel(entry(8) { put("abis", JSONArray()) }),
            channel(entry(8) { put("build_batch_id", "not-a-uuid") }),
            channel(entry(8) { put("version_name", "rc8") }),
            channel(entry(8) { put("version_code", "8") }),
            channel(entry(8) { put("min_sdk", 21) }),
            channel(entry(9), entry(8)),
            channel(),
            channel(entry(8) { put("apk_url", "https://manadj.murtaza.earth/android/artifacts/${"%064x".format(9)}/$sha.apk") }),
            channel(entry(8) { put("apk_url", "https://manadj.murtaza.earth:443/android/artifacts/${"%064x".format(8)}/$sha.apk") }),
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

    @Test fun channelAndArtifactTopologyFollowTheCoreContract() {
        assertTrue(UpdatePolicy.channel("https://manadj.murtaza.earth/android/stable/channel.json"))
        assertFalse(UpdatePolicy.channel("https://manadj.murtaza.earth/android/stable/channel.json?x=1"))
        val good = "https://manadj.murtaza.earth/android/artifacts/${"a".repeat(64)}/${"b".repeat(64)}.apk"
        assertTrue(UpdatePolicy.artifact(good))
        for (bad in listOf("https://manadj.murtaza.earth/android/stable/manadj-8.apk", "https://manadj.murtaza.earth/android/artifacts/x/y.apk",
                good.replace("/android/", "/android/%61/"), good.replace("https", "http"), good.replace(".earth/", ".earth:8443/"),
                "$good?x", "https://github.com/murtaza64/manadj/releases/download/v8/a.apk",
                "https://github.com/murtaza64/manadj/releases/latest/download/a.apk")) assertFalse(UpdatePolicy.artifact(bad), bad)
    }

    /** The core contract's synthetic consumer fixture (88fea251), read verbatim; never published. */
    @Test fun coreSyntheticFixtureParses() {
        val bytes = File("../../tests/fixtures/android-channel-v1.sample.json").readBytes()
        val e = UpdateChannel.parse(bytes).single()
        assertEquals(8L, e.versionCode); assertEquals("0.1.0-rc.8", e.versionName)
        assertEquals("33333333-3333-4333-8333-333333333333", e.buildBatchId)
        assertEquals(listOf("5".repeat(64), "6".repeat(64)), e.qaReceiptSha256s)
        assertEquals(UpdatePolicy.artifactUrl(e.releaseId, e.apkSha256), e.apkUrl)
        assertEquals(8L, assertIs<Offer.Available>(UpdateChannel.offer(listOf(e), installed)).entry.versionCode)
        assertFails { UpdateChannel.parse(bytes, channel = "preview") }
    }

    @Test fun scheduleRateLimitsAndBacksOffAndPersists() {
        val dir = Files.createTempDirectory("sched-").toFile()
        try {
            val f = File(dir, "check.json")
            val h = 3600_000L; val m = 60_000L
            val s = UpdateSchedule(f)
            assertTrue(s.due(0), "never checked")
            s.record(1_000, ok = true, result = "Up to date")
            assertFalse(s.due(1_000 + 5 * h))
            assertTrue(UpdateSchedule(f).due(1_000 + 6 * h), "persisted across restart")
            assertTrue(s.due(0), "clock moved backwards")
            s.record(10 * h, ok = false, result = "offline")
            assertFalse(s.due(10 * h + 4 * m)); assertTrue(s.due(10 * h + 5 * m))
            s.record(11 * h, ok = false, result = "offline")
            assertFalse(s.due(11 * h + 9 * m)); assertTrue(s.due(11 * h + 10 * m))
            repeat(20) { s.record(12 * h, ok = false, result = "offline") }
            assertFalse(s.due(12 * h + 5 * h)); assertTrue(s.due(12 * h + 6 * h), "backoff capped at the interval")
            assertEquals("offline", s.read().lastResult); assertEquals(1_000L, s.read().lastSuccessMs)
            s.record(20 * h, ok = true, result = "Up to date")
            assertEquals(0, s.read().failures)
        } finally { dir.deleteRecursively() }
    }

    private fun build(o: JSONObject.() -> Unit = {}) = JSONObject().put("format", "manadj_android_build/v1").put("package", "dev.murt.manadj.excalibur")
        .put("version_code", 8).put("version_name", "0.1.0-rc.8").put("source_revision", src).put("source_tree_sha256", "2".repeat(64))
        .put("build_batch_id", "33333333-3333-4333-8333-333333333333").put("min_sdk", 26).put("target_sdk", 35)
        .put("abis", JSONArray(listOf("arm64-v8a", "armeabi-v7a"))).apply(o)

    @Test fun appliedRequiresAllThreeFilesAndTheInstalledReleaseBuild() {
        val body = "n"; val notes = ReleaseIdentity.sha256(body.toByteArray())
        val id = ReleaseIdentity.releaseId("0.1.0-rc.8", src, notes)
        val info = JSONObject().put("schema", 1).put("version", "0.1.0-rc.8").put("source_revision", src).put("notes_sha256", notes).put("release_id", id).toString().toByteArray()
        val rn = JSONObject().put("schema", 1).put("release_id", id).put("body", body).toString().toByteArray()
        fun b(o: JSONObject.() -> Unit = {}) = build { put("release_id", id).put("notes_sha256", notes); o() }.toString().toByteArray()
        val r = assertNotNull(ReleaseIdentity.parse(info, rn, b()))
        assertNull(ReleaseIdentity.parse(info, rn, null), "schema-1 pair alone is not an Android release")
        for (bad in listOf(b { put("version_name", "0.1.0-rc.9") }, b { put("release_id", "e".repeat(64)) }, b { put("notes_sha256", "f".repeat(64)) },
                b { put("source_revision", "9".repeat(40)) }, b { put("package", "dev.murt.manadj") }, b { put("format", "x") }, b { put("extra", 1) },
                b { put("abis", JSONArray(listOf("armeabi-v7a", "arm64-v8a"))) }, b { put("target_sdk", 25) }, b { put("build_batch_id", "x") }))
            assertNull(ReleaseIdentity.parse(info, rn, bad), String(bad))
        val ok = installed.copy(versionCode = 8, versionName = "0.1.0-rc.8")
        assertTrue(r.appliedOn(ok))
        assertFalse(r.appliedOn(ok.copy(versionCode = 7)))
        assertFalse(r.appliedOn(ok.copy(versionName = "0.1.0-rc.7")))
        assertFalse(r.appliedOn(ok.copy(versionName = null)))
        assertFalse(r.appliedOn(ok.copy(packageName = "dev.murt.manadj.excalibur.lane")))
        assertFalse(r.appliedOn(ok.copy(signerSha256 = setOf("a".repeat(64)))))
        assertFalse(ReleaseIdentity.parse(info, rn)!!.appliedOn(ok), "no android-build binding = not applied")
    }

    @Test fun seenNeedsAnExactReceipt() {
        val dir = Files.createTempDirectory("seen2-").toFile()
        try {
            val id = "c".repeat(64)
            val s = SeenReleases(dir)
            for (body in listOf("", "{}", "not json", "{\"schema\":1,\"release_id\":\"${"d".repeat(64)}\"}",
                    "{\"schema\":\"1\",\"release_id\":\"$id\"}", "{\"schema\":1,\"release_id\":\"$id\",\"x\":1}")) {
                File(dir, "$id.json").writeText(body); assertFalse(s.seen(id), body)
            }
            s.markSeen(id); assertTrue(s.seen(id))
        } finally { dir.deleteRecursively() }
    }

    /** Python json.dumps(..., ensure_ascii=True): every non-ASCII/control char as \\uXXXX (surrogate pairs above BMP). */
    private fun asciiJson(fields: List<Pair<String, Any>>): ByteArray = fields.joinToString(",", "{", "}") { (k, v) ->
        "\"$k\":" + when (v) {
            is String -> v.flatMap { c -> if (c.code in 0x20..0x7e && c != '"' && c != '\\') listOf(c.toString()) else listOf("\\u%04x".format(c.code)) }.joinToString("", "\"", "\"")
            else -> v.toString()
        }
    }.toByteArray(Charsets.US_ASCII)

    @Test fun maxSizeNotesEscapedAsAsciiAreAcceptedAndSchemaTypesStayStrict() {
        for (body in listOf("\u0001".repeat(32768), "\ud83c\udfa7".repeat(8192), "\u00e9".repeat(16384))) {
            assertEquals(32768, body.toByteArray(Charsets.UTF_8).size)
            val notes = ReleaseIdentity.sha256(body.toByteArray(Charsets.UTF_8))
            val id = ReleaseIdentity.releaseId("0.1.0-rc.8", src, notes)
            val info = asciiJson(listOf("schema" to 1, "version" to "0.1.0-rc.8", "source_revision" to src, "notes_sha256" to notes, "release_id" to id))
            val rn = asciiJson(listOf("schema" to 1, "release_id" to id, "body" to body))
            assertTrue(rn.size > 64 * 1024 || body.startsWith("\u00e9"), "escaped form exceeds the old 64 KiB bound")
            assertTrue(rn.size <= ReleaseIdentity.MAX_FILE_BYTES)
            assertEquals(body, assertNotNull(ReleaseIdentity.parse(info, rn)).body)
            val over = asciiJson(listOf("schema" to 1, "release_id" to id, "body" to body + "x"))
            assertNull(ReleaseIdentity.parse(info, over), "32769 body bytes refused")
        }
        val body = "n"; val notes = ReleaseIdentity.sha256(body.toByteArray()); val id = ReleaseIdentity.releaseId("0.1.0-rc.8", src, notes)
        fun info(schema: String) = "{\"schema\":$schema,\"version\":\"0.1.0-rc.8\",\"source_revision\":\"$src\",\"notes_sha256\":\"$notes\",\"release_id\":\"$id\"}".toByteArray()
        val rn = "{\"schema\":1,\"release_id\":\"$id\",\"body\":\"n\"}".toByteArray()
        assertNotNull(ReleaseIdentity.parse(info("1"), rn))
        for (bad in listOf("true", "1.0", "\"1\"", "2")) assertNull(ReleaseIdentity.parse(info(bad), rn), bad)
        val b = build { put("release_id", id).put("notes_sha256", notes) }.toString()
        assertNull(AndroidBuild.parse(b.replace("\"version_code\":8", "\"version_code\":8.0").toByteArray()))
        assertNull(AndroidBuild.parse(b.replace("\"version_code\":8", "\"version_code\":true").toByteArray()))
        assertNotNull(AndroidBuild.parse(b.toByteArray()))
    }

    /** Python-generated max-boundary triple (tests/fixtures/android-release-maxbody-v1, core canonical serialization). */
    @Test fun pythonGeneratedMaxBoundaryTripleParses() {
        val dir = File("../../tests/fixtures/android-release-maxbody-v1")
        fun f(n: String) = File(dir, n).readBytes()
        assertTrue(f("release-notes.json").size in (64 * 1024 + 1)..ReleaseIdentity.MAX_FILE_BYTES)
        val r = assertNotNull(ReleaseIdentity.parse(f("build-info.json"), f("release-notes.json"), f("android-build.json")))
        assertEquals("2acff59658cddeeda815028bfc4b53b4910babaa6df6b6860078b904e3eadf9d", r.releaseId)
        assertEquals("\u0001".repeat(32768), r.body)
        assertTrue(r.appliedOn(installed.copy(versionCode = 8, versionName = "0.1.0-rc.8")))
        val padded = f("release-notes.json") + ByteArray(ReleaseIdentity.MAX_FILE_BYTES + 1 - f("release-notes.json").size) { ' '.code.toByte() }
        assertNull(ReleaseIdentity.parse(f("build-info.json"), padded, f("android-build.json")), "over the 256 KiB per-file cap")
    }
}
