package dev.manadj.library.update

import org.json.JSONObject
import java.security.MessageDigest

/**
 * The release identity embedded in an APK (#419; core #420 schema 1, verbatim):
 * `assets/manadj-release/build-info.json` + `release-notes.json`. A dev build carries neither and has no identity.
 * Missing, malformed, inconsistent or wrong-release files expose NO release (never a partial claim).
 */
data class ReleaseIdentity(val version: String, val sourceRevision: String, val notesSha256: String, val releaseId: String, val body: String) {
    /**
     * APPLIED = this embedded identity belongs to the running installed build: release package, release signer, and
     * PackageManager versionName == build-info version. A self-consistent pair in any other build is not applied.
     */
    fun appliedOn(installed: Installed): Boolean =
        installed.packageName == UpdatePolicy.PACKAGE && UpdatePolicy.SIGNER_SHA256 in installed.signerSha256 &&
            installed.versionName == version

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

        /** Parses and cross-checks the pair; null = no release identity. */
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
