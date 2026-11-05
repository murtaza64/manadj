package dev.manadj.library.update

import org.json.JSONObject
import java.security.MessageDigest

/**
 * The release identity embedded in an APK (#419): core #420 schema 1 pair verbatim (`build-info.json`,
 * `release-notes.json`) + `android-build.json` (`manadj_android_build/v1`, core contract 88fea251) binding it to package,
 * versionCode/versionName, source, tree, batch, SDKs and ABIs. A dev build carries none and has no identity.
 * Missing, malformed, inconsistent or wrong-release files expose NO release (never a partial claim).
 */
data class ReleaseIdentity(val version: String, val sourceRevision: String, val notesSha256: String, val releaseId: String, val body: String,
                           val build: AndroidBuild? = null) {
    /**
     * APPLIED = this embedded identity belongs to the running installed build: release package, release signer, and
     * PackageManager versionName == build-info version. A self-consistent pair in any other build is not applied.
     */
    fun appliedOn(installed: Installed): Boolean {
        val b = build ?: return false
        return installed.packageName == UpdatePolicy.PACKAGE && UpdatePolicy.SIGNER_SHA256 in installed.signerSha256 &&
            installed.versionName == version && installed.versionCode == b.versionCode
    }

    companion object {
        const val ASSET_DIR = "manadj-release"
        const val MAX_BODY_BYTES = 32_768
        const val MAX_FILE_BYTES = 64 * 1024
        private val HEX40 = Regex("[0-9a-f]{40}")
        private val HEX64 = Regex("[0-9a-f]{64}")

        fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

        /** `json.dumps({notes_sha256, schema, source_revision, version}, sort_keys=True, separators=(',', ':'))`, ASCII only. */
        fun releaseId(version: String, sourceRevision: String, notesSha256: String): String {
            require(listOf(version, sourceRevision, notesSha256).all { s -> s.all { it.code in 0x20..0x7e } }) { "Identity strings are ASCII" }
            val esc = { s: String -> JSONObject.quote(s) }
            return sha256("{\"notes_sha256\":${esc(notesSha256)},\"schema\":1,\"source_revision\":${esc(sourceRevision)},\"version\":${esc(version)}}".toByteArray(Charsets.US_ASCII))
        }

        /** Parses and cross-checks all three files; null = no release identity. */
        fun parse(buildInfo: ByteArray?, releaseNotes: ByteArray?, androidBuild: ByteArray?): ReleaseIdentity? {
            val pair = parse(buildInfo, releaseNotes) ?: return null
            val build = AndroidBuild.parse(androidBuild ?: return null) ?: return null
            if (build.releaseId != pair.releaseId || build.versionName != pair.version || build.sourceRevision != pair.sourceRevision ||
                build.notesSha256 != pair.notesSha256) return null
            return pair.copy(build = build)
        }

        /** The #420 schema-1 pair alone (no Android binding; never applied by itself). */
        fun parse(buildInfo: ByteArray?, releaseNotes: ByteArray?): ReleaseIdentity? = runCatching {
            if (buildInfo == null || releaseNotes == null || buildInfo.size > MAX_FILE_BYTES || releaseNotes.size > MAX_FILE_BYTES) return null
            val b = JSONObject(String(buildInfo, Charsets.UTF_8))
            val n = JSONObject(String(releaseNotes, Charsets.UTF_8))
            if (b.keySet() != setOf("schema", "version", "source_revision", "notes_sha256", "release_id")) return null
            if (n.keySet() != setOf("schema", "release_id", "body")) return null
            if (b.get("schema") != 1 || n.get("schema") != 1) return null
            val version = b.get("version") as? String ?: return null
            val source = b.get("source_revision") as? String ?: return null
            val notesSha = b.get("notes_sha256") as? String ?: return null
            val id = b.get("release_id") as? String ?: return null
            val body = n.get("body") as? String ?: return null
            val bodyBytes = body.toByteArray(Charsets.UTF_8)
            if (version.isBlank() || version.length > 100 || !HEX40.matches(source) || !HEX64.matches(notesSha) || !HEX64.matches(id)) return null
            if (body.isBlank() || bodyBytes.size > MAX_BODY_BYTES || sha256(bodyBytes) != notesSha) return null
            if (n.get("release_id") != id || releaseId(version, source, notesSha) != id) return null
            ReleaseIdentity(version, source, notesSha, id, body)
        }.getOrNull()
    }
}

/** `assets/manadj-release/android-build.json` (`manadj_android_build/v1`). */
data class AndroidBuild(
    val releaseId: String, val packageName: String, val versionCode: Long, val versionName: String, val sourceRevision: String,
    val sourceTreeSha256: String, val buildBatchId: String, val notesSha256: String, val minSdk: Int, val targetSdk: Int, val abis: List<String>,
) {
    companion object {
        private val KEYS = setOf("format", "release_id", "package", "version_code", "version_name", "source_revision", "source_tree_sha256",
            "build_batch_id", "notes_sha256", "min_sdk", "target_sdk", "abis")
        private val HEX40 = Regex("[0-9a-f]{40}")
        private val HEX64 = Regex("[0-9a-f]{64}")
        private val BATCH = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
        private val VERSION = Regex("\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.]+)?")

        fun parse(bytes: ByteArray): AndroidBuild? = runCatching {
            if (bytes.size > ReleaseIdentity.MAX_FILE_BYTES) return null
            val o = JSONObject(String(bytes, Charsets.UTF_8))
            if (o.keySet() != KEYS || o.get("format") != "manadj_android_build/v1") return null
            fun str(k: String) = o.get(k) as String
            fun int(k: String) = when (val v = o.get(k)) { is Int -> v.toLong(); is Long -> v; else -> error(k) }
            val abis = o.getJSONArray("abis").let { a -> (0 until a.length()).map { a.get(it) as String } }
            val b = AndroidBuild(str("release_id"), str("package"), int("version_code"), str("version_name"), str("source_revision"),
                str("source_tree_sha256"), str("build_batch_id"), str("notes_sha256"), int("min_sdk").toInt(), int("target_sdk").toInt(), abis)
            val ok = HEX64.matches(b.releaseId) && b.packageName == UpdatePolicy.PACKAGE && b.versionCode in 1..2_100_000_000 &&
                VERSION.matches(b.versionName) && HEX40.matches(b.sourceRevision) && HEX64.matches(b.sourceTreeSha256) &&
                BATCH.matches(b.buildBatchId) && HEX64.matches(b.notesSha256) && b.minSdk in 26..100 && b.targetSdk in b.minSdk..100 &&
                abis.size in 1..4 && abis.all { it in UpdatePolicy.ABIS } && abis == abis.toSortedSet().toList()
            b.takeIf { ok }
        }.getOrNull()
    }
}
