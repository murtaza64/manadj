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
    const val CHANNEL = "stable"
    val channelUrl get() = "$ORIGIN/android/$CHANNEL/channel.json"
    const val MAX_MANIFEST_BYTES = 256 * 1024
    const val MAX_APK_BYTES = 512L * 1024 * 1024

    /** Same scheme + host + port as [ORIGIN]; nothing else is ever fetched. */
    fun pinned(url: String, origin: String = ORIGIN): Boolean = runCatching {
        val u = URI(url); val o = URI(origin)
        u.scheme == "https" && u.scheme == o.scheme && u.host.equals(o.host, ignoreCase = true) && u.port == o.port &&
            u.userInfo == null && u.rawQuery == null && u.rawFragment == null && !u.rawPath.contains("..")
    }.getOrDefault(false)
}

data class ChannelEntry(
    val releaseId: String, val versionCode: Long, val versionName: String, val minSdk: Int, val abis: List<String>,
    val sourceRevision: String, val notesSha256: String, val apkUrl: String, val apkSha256: String, val apkBytes: Long,
)

/** What this device has installed (PackageManager facts about the running package). */
data class Installed(val packageName: String, val versionCode: Long, val signerSha256: Set<String>, val sdk: Int, val abis: List<String>)

sealed interface Offer {
    data class Available(val entry: ChannelEntry) : Offer
    data class UpToDate(val versionCode: Long) : Offer
    data class Refused(val reason: String) : Offer
}

object UpdateChannel {
    private val HEX40 = Regex("[0-9a-f]{40}")
    private val HEX64 = Regex("[0-9a-f]{64}")

    /** Parses a channel manifest; refuses anything outside the pinned format/channel/package/signer/origin. */
    fun parse(bytes: ByteArray, origin: String = UpdatePolicy.ORIGIN, channel: String = UpdatePolicy.CHANNEL): List<ChannelEntry> {
        require(bytes.size <= UpdatePolicy.MAX_MANIFEST_BYTES) { "Channel manifest too large" }
        val o = JSONObject(String(bytes, Charsets.UTF_8))
        require(o.optString("format") == UpdatePolicy.FORMAT) { "Unknown channel format" }
        require(o.optString("channel") == channel) { "Wrong channel" }
        require(o.optString("package") == UpdatePolicy.PACKAGE) { "Channel names another package" }
        require(o.optString("signer_cert_sha256") == UpdatePolicy.SIGNER_SHA256) { "Channel names another signer" }
        val entries = o.getJSONArray("entries")
        return (0 until entries.length()).map { i ->
            val e = entries.getJSONObject(i)
            ChannelEntry(
                releaseId = e.getString("release_id").also { require(HEX64.matches(it)) { "release_id" } },
                versionCode = e.getLong("version_code").also { require(it > 0) { "version_code" } },
                versionName = e.getString("version_name").also { require(it.isNotBlank() && it.length <= 100) { "version_name" } },
                minSdk = e.getInt("min_sdk"),
                abis = e.getJSONArray("abis").let { a -> (0 until a.length()).map { a.getString(it) } },
                sourceRevision = e.getString("source_revision").also { require(HEX40.matches(it)) { "source_revision" } },
                notesSha256 = e.getString("notes_sha256").also { require(HEX64.matches(it)) { "notes_sha256" } },
                apkUrl = e.getString("apk_url").also { require(UpdatePolicy.pinned(it, origin)) { "APK URL outside the pinned origin" } },
                apkSha256 = e.getString("apk_sha256").also { require(HEX64.matches(it)) { "apk_sha256" } },
                apkBytes = e.getLong("apk_bytes").also { require(it in 1..UpdatePolicy.MAX_APK_BYTES) { "apk_bytes" } },
            )
        }.also { list -> require(list.map { it.versionCode }.toSet().size == list.size) { "Duplicate version_code in channel" } }
    }

    /** Highest applicable entry for [installed], or why nothing applies. */
    fun offer(entries: List<ChannelEntry>, installed: Installed): Offer {
        if (installed.packageName != UpdatePolicy.PACKAGE) return Offer.Refused("This build (${installed.packageName}) does not self-update")
        if (UpdatePolicy.SIGNER_SHA256 !in installed.signerSha256) return Offer.Refused("Installed app is not signed by the release key")
        val newer = entries.filter { it.versionCode > installed.versionCode }
        val fits = newer.filter { it.minSdk <= installed.sdk && (it.abis.isEmpty() || it.abis.any { a -> a in installed.abis }) }
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
    fun seen(releaseId: String): Boolean = File(dir, "$releaseId.json").isFile
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
