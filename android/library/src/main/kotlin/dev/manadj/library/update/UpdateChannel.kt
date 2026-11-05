package dev.manadj.library.update

import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.security.MessageDigest

/**
 * Android self-update (#419). Trust policy (explicit; no feed key):
 * - The channel manifest is an OFFER only. It is fetched over HTTPS from the pinned origin and must name the pinned
 *   package and signer; it never decides what is installed.
 * - An entry applies only when: format + channel + package exact, signer == pinned == installed signer,
 *   version_code > installed, min_sdk <= device, an ABI matches; the highest such version_code wins (no "latest").
 * - Staged bytes must match apk_bytes + apk_sha256 (streamed); the app then checks the archive's package, versionCode
 *   and signing certificate before PackageInstaller. Android itself refuses a different signer on update.
 * States are distinct: offered (entry) / staged (verified bytes) / installed (PackageManager) / applied (embedded identity).
 */
object UpdatePolicy {
    const val FORMAT = "manadj_android_channel/v1"
    const val PACKAGE = "dev.murt.manadj.excalibur"
    const val SIGNER_SHA256 = "18f8fe820d6abd112be1fa5c99e3c69f77cbb5c834242899135c9b528af7417c"
    const val ORIGIN = "https://manadj.murtaza.earth"
    const val CHANNEL = "stable" // core contract: stable | preview
    val CHANNELS = setOf("stable", "preview")
    val ABIS = setOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86")
    val channelUrl get() = "$ORIGIN/android/$CHANNEL/channel.json"
    const val MAX_MANIFEST_BYTES = 256 * 1024
    const val MAX_APK_BYTES = 512L * 1024 * 1024

    /** Same scheme + host + default port as [origin] and under [pathPrefix]; no credentials/query/fragment/traversal/escapes. */
    fun pinned(url: String, origin: String = ORIGIN, pathPrefix: String = "/"): Boolean = runCatching {
        val u = URI(url); val o = URI(origin)
        u.scheme == "https" && u.scheme == o.scheme && u.host.equals(o.host, ignoreCase = true) && (u.port == -1 || u.port == 443) &&
            u.userInfo == null && u.rawQuery == null && u.rawFragment == null && !u.rawPath.contains("..") &&
            !u.rawPath.contains("%") && u.rawPath.startsWith(pathPrefix)
    }.getOrDefault(false)

    /** Core contract v1 topology: the immutable APK lives exactly at `<ORIGIN>/android/artifacts/<release_id>/<apk_sha256>.apk`. */
    fun artifactUrl(releaseId: String, apkSha256: String) = "$ORIGIN/android/artifacts/$releaseId/$apkSha256.apk"

    /** Any well-formed v1 artifact URL (for the fetch guard); the parser additionally binds it to its entry. */
    fun artifact(url: String) = pinned(url) && Regex("/android/artifacts/[0-9a-f]{64}/[0-9a-f]{64}\\.apk").matches(URI(url).rawPath)

    /** The channel URL itself (exact). */
    fun channel(url: String) = url == channelUrl
}

/** One offered release; fields = core contract `Entry` (88fea251). Provenance fields carry no applied claim. */
data class ChannelEntry(
    val releaseId: String, val versionCode: Long, val versionName: String, val minSdk: Int, val abis: List<String>,
    val sourceRevision: String, val notesSha256: String, val apkUrl: String, val apkSha256: String, val apkBytes: Long,
    val sourceTreeSha256: String = "0".repeat(64), val buildBatchId: String = "00000000-0000-4000-8000-000000000000",
    val qaReceiptSha256s: List<String> = emptyList(),
)

/** What this device has installed (PackageManager facts about the running package). */
data class Installed(val packageName: String, val versionCode: Long, val signerSha256: Set<String>, val sdk: Int, val abis: List<String>,
                     val versionName: String? = null)

sealed interface Offer {
    data class Available(val entry: ChannelEntry) : Offer
    data class UpToDate(val versionCode: Long) : Offer
    data class Refused(val reason: String) : Offer
}

object UpdateChannel {
    private val HEX40 = Regex("[0-9a-f]{40}")
    private val HEX64 = Regex("[0-9a-f]{64}")

    private val VERSION = Regex("\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.]+)?")
    private val BATCH = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
    private val ROOT = setOf("format", "channel", "package", "signer_cert_sha256", "entries")
    private val ENTRY = setOf("release_id", "version_code", "version_name", "min_sdk", "abis", "source_revision", "source_tree_sha256",
        "build_batch_id", "notes_sha256", "apk_url", "apk_sha256", "apk_bytes", "qa_receipt_sha256s")

    private fun JSONObject.str(k: String) = get(k) as? String ?: throw IllegalArgumentException("$k must be a string")
    private fun JSONObject.int(k: String): Long = when (val v = get(k)) {
        is Int -> v.toLong(); is Long -> v
        else -> throw IllegalArgumentException("$k must be an integer")
    }
    private fun JSONObject.strings(k: String): List<String> = getJSONArray(k).let { a -> (0 until a.length()).map { a.get(it) as? String ?: throw IllegalArgumentException(k) } }
    private fun List<String>.orderedUnique() = this == toSortedSet().toList()

    /** Parses a channel manifest per the core contract (exact keys, types, patterns, ordering, artifact path). */
    fun parse(bytes: ByteArray, channel: String = UpdatePolicy.CHANNEL): List<ChannelEntry> {
        require(bytes.size <= UpdatePolicy.MAX_MANIFEST_BYTES) { "Channel manifest too large" }
        require(channel in UpdatePolicy.CHANNELS)
        val o = JSONObject(String(bytes, Charsets.UTF_8))
        require(o.keySet() == ROOT) { "Unexpected channel fields" }
        require(o.get("format") == UpdatePolicy.FORMAT) { "Unknown channel format" }
        require(o.get("channel") == channel) { "Wrong channel" }
        require(o.get("package") == UpdatePolicy.PACKAGE) { "Channel names another package" }
        require(o.get("signer_cert_sha256") == UpdatePolicy.SIGNER_SHA256) { "Channel names another signer" }
        val entries = o.getJSONArray("entries")
        require(entries.length() in 1..128) { "Channel entry count" }
        return (0 until entries.length()).map { i ->
            val e = entries.getJSONObject(i)
            require(e.keySet() == ENTRY) { "Unexpected entry fields" }
            val releaseId = e.str("release_id").also { require(HEX64.matches(it)) { "release_id" } }
            val apkSha = e.str("apk_sha256").also { require(HEX64.matches(it)) { "apk_sha256" } }
            ChannelEntry(
                releaseId = releaseId,
                versionCode = e.int("version_code").also { require(it in 1..2_100_000_000) { "version_code" } },
                versionName = e.str("version_name").also { require(VERSION.matches(it)) { "version_name" } },
                minSdk = e.int("min_sdk").toInt().also { require(it in 26..100) { "min_sdk" } },
                abis = e.strings("abis").also { require(it.size in 1..4 && it.all { a -> a in UpdatePolicy.ABIS } && it.orderedUnique()) { "abis" } },
                sourceRevision = e.str("source_revision").also { require(HEX40.matches(it)) { "source_revision" } },
                notesSha256 = e.str("notes_sha256").also { require(HEX64.matches(it)) { "notes_sha256" } },
                apkUrl = e.str("apk_url").also { require(it == UpdatePolicy.artifactUrl(releaseId, apkSha)) { "APK URL must be the pinned immutable artifact path" } },
                apkSha256 = apkSha,
                apkBytes = e.int("apk_bytes").also { require(it in 1..UpdatePolicy.MAX_APK_BYTES) { "apk_bytes" } },
                sourceTreeSha256 = e.str("source_tree_sha256").also { require(HEX64.matches(it)) { "source_tree_sha256" } },
                buildBatchId = e.str("build_batch_id").also { require(BATCH.matches(it)) { "build_batch_id" } },
                qaReceiptSha256s = e.strings("qa_receipt_sha256s").also { require(it.size in 2..64 && it.all { h -> HEX64.matches(h) } && it.orderedUnique()) { "qa_receipt_sha256s" } },
            )
        }.also { list -> val codes = list.map { it.versionCode }; require(codes == codes.toSortedSet().toList()) { "Ordered unique version codes required" } }
    }

    /** Highest applicable entry for [installed], or why nothing applies. */
    fun offer(entries: List<ChannelEntry>, installed: Installed): Offer {
        if (installed.packageName != UpdatePolicy.PACKAGE) return Offer.Refused("This build (${installed.packageName}) does not self-update")
        if (UpdatePolicy.SIGNER_SHA256 !in installed.signerSha256) return Offer.Refused("Installed app is not signed by the release key")
        val newer = entries.filter { it.versionCode > installed.versionCode }
        val fits = newer.filter { it.minSdk <= installed.sdk && it.abis.any { a -> a in installed.abis } }
        return fits.maxByOrNull { it.versionCode }?.let { Offer.Available(it) }
            ?: if (newer.isEmpty()) Offer.UpToDate(installed.versionCode) else Offer.Refused("Newer release does not support this device")
    }
}

/** Downloads one entry into [dir] as `<release_id>.apk`, verifying size and SHA-256 while streaming. */
class UpdateStager(private val dir: File) {
    init { if (!dir.isDirectory) check(dir.mkdirs()) { "Update staging unavailable" } }

    fun staged(entry: ChannelEntry): File? = File(dir, "${entry.releaseId}.apk").takeIf {
        it.isFile && it.length() == entry.apkBytes && sha256(it) == entry.apkSha256
    }

    /** Throws (and leaves nothing staged) on any mismatch; [progress] gets bytes so far. */
    fun stage(entry: ChannelEntry, open: (String) -> InputStream, progress: (Long) -> Unit = {}): File {
        staged(entry)?.let { return it }
        val target = File(dir, "${entry.releaseId}.apk")
        val part = File(dir, "${entry.releaseId}.part")
        dir.listFiles()?.filter { it != target }?.forEach { it.delete() } // one staged release at a time
        val md = MessageDigest.getInstance("SHA-256")
        var count = 0L
        try {
            open(entry.apkUrl).use { input ->
                FileOutputStream(part).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf); if (n < 0) break
                        count += n
                        if (count > entry.apkBytes) throw IOException("Download is larger than the offered release")
                        md.update(buf, 0, n); out.write(buf, 0, n)
                        progress(count)
                    }
                    out.flush(); out.fd.sync()
                }
            }
            if (count != entry.apkBytes) throw IOException("Download size differs from the offered release")
            if (md.digest().joinToString("") { "%02x".format(it) } != entry.apkSha256) throw IOException("Download does not match the offered release")
            if (!part.renameTo(target)) throw IOException("Cannot stage the update")
            return target
        } catch (e: Exception) {
            part.delete(); target.delete()
            throw e
        }
    }

    fun clear() { dir.listFiles()?.forEach { it.delete() } }

    private fun sha256(f: File): String = MessageDigest.getInstance("SHA-256").let { md ->
        f.inputStream().use { i -> val b = ByteArray(65536); while (true) { val n = i.read(b); if (n < 0) break; md.update(b, 0, n) } }
        md.digest().joinToString("") { "%02x".format(it) }
    }
}

/** Seen receipts for applied-release notes: one file per release_id in app-private storage. */
class SeenReleases(private val dir: File) {
    /** Seen only with an exact receipt for this release (`{"schema":1,"release_id":"<id>"}`); anything else = unseen. */
    fun seen(releaseId: String): Boolean = runCatching {
        val f = File(dir, "$releaseId.json")
        if (!f.isFile || f.length() > 4096) return false
        val o = JSONObject(f.readText())
        o.keySet() == setOf("schema", "release_id") && o.get("schema") == 1 && o.get("release_id") == releaseId
    }.getOrDefault(false)
    fun markSeen(releaseId: String) {
        require(Regex("[0-9a-f]{64}").matches(releaseId))
        if (!dir.isDirectory) check(dir.mkdirs())
        val tmp = File(dir, "$releaseId.tmp")
        FileOutputStream(tmp).use { it.write("{\"schema\":1,\"release_id\":\"$releaseId\"}".toByteArray()); it.fd.sync() }
        if (!tmp.renameTo(File(dir, "$releaseId.json"))) throw IOException("Cannot record seen release")
    }
}

/** Install only outside active playback, recording or transfer; the reason is shown, never silently skipped. */
data class Activity(val playing: Boolean, val recording: Boolean, val transferring: Boolean) {
    val blockReason: String?
        get() = when {
            playing -> "Stop playback to install"
            recording -> "Stop recording to install"
            transferring -> "Wait for the library transfer to finish"
            else -> null
        }
}

/**
 * Automatic check cadence (#419): on app start and each return to the foreground, at most once per [intervalMs]
 * after a completed check; after a failure, exponential backoff from [retryMs] up to [intervalMs]. Persisted so a
 * restart does not hammer the host. A manual CHECK always runs.
 */
class UpdateSchedule(private val file: File, private val intervalMs: Long = 6 * 3600_000L, private val retryMs: Long = 5 * 60_000L) {
    data class Record(val lastAttemptMs: Long?, val lastSuccessMs: Long?, val failures: Int, val lastResult: String?)

    fun read(): Record = runCatching {
        val o = JSONObject(file.readText())
        Record(o.optLong("last_attempt_ms").takeIf { o.has("last_attempt_ms") }, o.optLong("last_success_ms").takeIf { o.has("last_success_ms") },
            o.optInt("failures"), o.optString("last_result").ifEmpty { null })
    }.getOrDefault(Record(null, null, 0, null))

    /** True when an automatic check is due at [nowMs]. A clock moved backwards counts as due. */
    fun due(nowMs: Long): Boolean {
        val r = read()
        val last = r.lastAttemptMs ?: return true
        if (nowMs < last) return true
        val wait = if (r.failures == 0) intervalMs else minOf(intervalMs, retryMs shl minOf(r.failures - 1, 10))
        return nowMs - last >= wait
    }

    fun record(nowMs: Long, ok: Boolean, result: String) {
        val r = read()
        val o = JSONObject().put("last_attempt_ms", nowMs).put("failures", if (ok) 0 else r.failures + 1).put("last_result", result.take(200))
        (if (ok) nowMs else r.lastSuccessMs)?.let { o.put("last_success_ms", it) }
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        FileOutputStream(tmp).use { it.write(o.toString().toByteArray()); it.fd.sync() }
        if (!tmp.renameTo(file)) throw IOException("Cannot record update check")
    }
}
