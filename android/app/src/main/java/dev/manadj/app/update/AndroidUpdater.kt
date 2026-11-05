package dev.manadj.app.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.manadj.library.update.Activity
import dev.manadj.library.update.ChannelEntry
import dev.manadj.library.update.Installed
import dev.manadj.library.update.Offer
import dev.manadj.library.update.ReleaseIdentity
import dev.manadj.library.update.SeenReleases
import dev.manadj.library.update.UpdateChannel
import dev.manadj.library.update.UpdatePolicy
import dev.manadj.library.update.UpdateSchedule
import dev.manadj.library.update.UpdateStager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Android self-update (#419): check the pinned channel, stage a verified APK, install through PackageInstaller with
 * the system confirmation. Policy and pure checks: `dev.manadj.library.update`. States are evidence-bound:
 * OFFERED (channel entry) -> STAGED (bytes match the entry and the archive's package/versionCode/signer) ->
 * install requested (system dialog) -> INSTALLED (PackageManager after restart) -> APPLIED (embedded identity).
 * Never during playback, recording or transfer. No device install was performed while writing this.
 */
object AndroidUpdater {
    sealed interface State {
        data object Idle : State
        data object Checking : State
        data class UpToDate(val versionCode: Long) : State
        data class Offered(val entry: ChannelEntry) : State
        data class Downloading(val entry: ChannelEntry, val bytes: Long) : State
        data class Staged(val entry: ChannelEntry, val file: File) : State
        data class InstallRequested(val entry: ChannelEntry) : State
        data class Failed(val reason: String, val entry: ChannelEntry? = null) : State
    }

    var state by mutableStateOf<State>(State.Idle)
        internal set
    internal var scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // --- identity -----------------------------------------------------------------------------

    /** Release identity embedded in this APK; null = dev build (never claimed as an applied release). */
    fun applied(context: Context): ReleaseIdentity? {
        fun asset(name: String) = runCatching {
            context.assets.open("${ReleaseIdentity.ASSET_DIR}/$name").use { bounded(it, ReleaseIdentity.MAX_FILE_BYTES + 1) }
        }.getOrNull()
        val identity = ReleaseIdentity.parse(asset("build-info.json"), asset("release-notes.json")) ?: return null
        val installed = runCatching { installed(context) }.getOrNull() ?: return null
        return identity.takeIf { it.appliedOn(installed) }
    }

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<String> {
        val certs = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.let { s ->
            if (s.hasMultipleSigners()) s.apkContentsSigners else s.signingCertificateHistory
        } else info.signatures
        return certs.orEmpty().map { sha256(it.toByteArray()) }.toSet()
    }

    @Suppress("DEPRECATION")
    private fun versionCode(info: PackageInfo) = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private val signingFlag get() = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

    /** PackageManager facts about the running package. */
    internal var installedOverride: Installed? = null
    fun installed(context: Context): Installed {
        installedOverride?.let { return it }
        val info = context.packageManager.getPackageInfo(context.packageName, signingFlag)
        return Installed(context.packageName, versionCode(info), signers(info), Build.VERSION.SDK_INT, Build.SUPPORTED_ABIS.toList(), info.versionName)
    }

    // --- check / stage ------------------------------------------------------------------------

    /** HTTPS GET from the pinned origin only; redirects are refused (the pin covers the final URL). */
    internal fun open(url: String): InputStream {
        if (!UpdatePolicy.channel(url) && !UpdatePolicy.artifact(url)) throw IOException("Refusing an update URL outside the pinned channel/artifact hosts")
        val c = URL(url).openConnection() as HttpURLConnection
        c.instanceFollowRedirects = false
        c.connectTimeout = 10_000; c.readTimeout = 30_000
        c.useCaches = false
        c.setRequestProperty("Cache-Control", "no-cache")
        if (c.responseCode != 200) { c.disconnect(); throw IOException("Update server answered HTTP ${c.responseCode}") }
        return c.inputStream
    }

    /** Last automatic/manual check, for the status line. */
    var lastCheckedMs by mutableStateOf<Long?>(null)
        internal set
    internal var clock: () -> Long = System::currentTimeMillis
    internal var fetch: (String) -> InputStream = ::open
    internal fun schedule(context: Context) = UpdateSchedule(File(context.noBackupFilesDir, "update-check.json"))

    /**
     * App start / foreground: a rate-limited check (see [UpdateSchedule]); an applicable release is then staged
     * automatically only when [activity] is idle (download never competes with playback/recording/transfer).
     * Installing always stays a user action outside activity.
     */
    fun autoCheck(context: Context, activity: () -> Activity) {
        val sched = schedule(context)
        lastCheckedMs = sched.read().lastAttemptMs
        if (!sched.due(clock())) return
        check(context) { offered -> if (activity().blockReason == null) download(context, offered) }
    }

    /**
     * Foreground tick (every [TICK_MS] while the activity is visible, no service/permission): a due check per
     * [UpdateSchedule], and an Offered release starts staging as soon as activity returns to idle (play/record/sync
     * -> idle). In-flight checks/downloads coalesce (no second request).
     */
    fun foregroundTick(context: Context, activity: () -> Activity) {
        if (state is State.Checking || state is State.Downloading) return
        (state as? State.Offered)?.let { if (activity().blockReason == null) download(context, it.entry); return }
        autoCheck(context, activity)
    }

    const val TICK_MS = 5 * 60_000L

    fun check(context: Context, onOffer: (ChannelEntry) -> Unit = {}) {
        if (state is State.Checking || state is State.Downloading) return
        state = State.Checking
        scope.launch {
            var ok = false
            state = try {
                val bytes = fetch(UpdatePolicy.channelUrl).use { bounded(it, UpdatePolicy.MAX_MANIFEST_BYTES + 1) }
                val entries = UpdateChannel.parse(bytes)
                ok = true
                when (val offer = UpdateChannel.offer(entries, installed(context))) {
                    is Offer.Available -> stager(context).staged(offer.entry)?.let { verifyArchive(context, offer.entry, it); State.Staged(offer.entry, it) }
                        ?: State.Offered(offer.entry)
                    is Offer.UpToDate -> State.UpToDate(offer.versionCode)
                    is Offer.Refused -> State.Failed(offer.reason)
                }
            } catch (e: Exception) { ok = false; State.Failed("Update check failed: ${e.message ?: e.javaClass.simpleName}") }
            val now = clock()
            runCatching { schedule(context).record(now, ok, updateLine(state)) }
            lastCheckedMs = now
            (state as? State.Offered)?.let { onOffer(it.entry) }
        }
    }

    fun download(context: Context, entry: ChannelEntry) {
        if (state is State.Downloading) return
        state = State.Downloading(entry, 0)
        scope.launch {
            state = try {
                val file = stager(context).stage(entry, fetch) { n -> state = State.Downloading(entry, n) }
                verifyArchive(context, entry, file)
                State.Staged(entry, file)
            } catch (e: Exception) {
                stager(context).clear()
                State.Failed("Download refused: ${e.message ?: e.javaClass.simpleName}", entry)
            }
        }
    }

    /** The staged archive must be the offered package/versionCode signed by the pinned release certificate. */
    internal var verifyArchive: (Context, ChannelEntry, File) -> Unit = ::verifyArchiveReal

    internal fun verifyArchiveReal(context: Context, entry: ChannelEntry, file: File) {
        val info = context.packageManager.getPackageArchiveInfo(file.path, signingFlag) ?: throw IOException("Not an installable APK")
        if (info.packageName != UpdatePolicy.PACKAGE) throw IOException("APK is ${info.packageName}, not ${UpdatePolicy.PACKAGE}")
        if (versionCode(info) != entry.versionCode) throw IOException("APK versionCode ${versionCode(info)} differs from the offer ${entry.versionCode}")
        if (signers(info) != setOf(UpdatePolicy.SIGNER_SHA256)) throw IOException("APK is not signed by the release certificate")
    }

    private fun stager(context: Context) = UpdateStager(File(context.noBackupFilesDir, "update"))

    // --- install ------------------------------------------------------------------------------

    /** Null when installing is allowed now; otherwise the reason (shown, never silently skipped). */
    fun blocked(context: Context, activity: Activity): String? = activity.blockReason
        ?: if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) "Allow manaDJ to install updates" else null

    fun allowInstalls(context: Context) = context.startActivity(
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

    /** Re-verifies the staged bytes, then a PackageInstaller session; the system asks the user to confirm. */
    fun install(context: Context, activity: () -> Activity) {
        val staged = state as? State.Staged ?: return
        blocked(context, activity())?.let { state = State.Failed(it, staged.entry); return }
        scope.launch {
            state = try {
                val file = stager(context).staged(staged.entry) ?: throw IOException("Staged update changed; download again")
                verifyArchive(context, staged.entry, file)
                // Live provider, re-read after the archive check and before any installer session exists.
                activity().blockReason?.let { reason -> return@launch run { state = State.Failed(reason, staged.entry) } }
                val installer = context.packageManager.packageInstaller
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                    setAppPackageName(UpdatePolicy.PACKAGE)
                    setSize(file.length())
                }
                val id = installer.createSession(params)
                installer.openSession(id).use { session ->
                    session.openWrite("manadj.apk", 0, file.length()).use { out -> file.inputStream().use { it.copyTo(out) }; session.fsync(out) }
                    // Activity may have started while verifying/copying: re-check right before handing to Android.
                    activity().blockReason?.let { reason -> session.abandon(); return@launch run { state = State.Failed(reason, staged.entry) } }
                    val intent = Intent(context, UpdateInstallReceiver::class.java).putExtra(EXTRA_RELEASE, staged.entry.releaseId)
                    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                    session.commit(PendingIntent.getBroadcast(context, id, intent, flags).intentSender)
                }
                State.InstallRequested(staged.entry)
            } catch (e: Exception) { State.Failed("Install failed: ${e.message ?: e.javaClass.simpleName}", staged.entry) }
        }
    }

    internal fun installResult(context: Context, status: Int, message: String?) {
        val entry = (state as? State.InstallRequested)?.entry ?: (state as? State.Staged)?.entry
        state = when (status) {
            PackageInstaller.STATUS_SUCCESS -> State.Idle // the process restarts; INSTALLED/APPLIED are read fresh then
            PackageInstaller.STATUS_FAILURE_ABORTED -> entry?.let { e -> stager(context).staged(e)?.let { State.Staged(e, it) } } ?: State.Idle
            else -> State.Failed("Install refused by Android: ${message ?: "status $status"}", entry)
        }
    }

    // --- applied-release notes ----------------------------------------------------------------

    private fun seen(context: Context) = SeenReleases(File(context.noBackupFilesDir, "release-seen"))

    /** Notes to show automatically: only for a verified embedded identity not yet acknowledged. */
    fun unseenNotes(context: Context): ReleaseIdentity? = applied(context)?.takeIf { !seen(context).seen(it.releaseId) }

    fun markSeen(context: Context, release: ReleaseIdentity) = runCatching { seen(context).markSeen(release.releaseId) }.isSuccess

    const val EXTRA_RELEASE = "dev.manadj.update.RELEASE"

    private fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    /** At most [max] bytes (API 26: no InputStream.readNBytes). */
    private fun bounded(input: InputStream, max: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream(); val buf = ByteArray(8192)
        while (out.size() < max) { val n = input.read(buf, 0, minOf(buf.size, max - out.size())); if (n < 0) break; out.write(buf, 0, n) }
        return out.toByteArray()
    }
}

/** PackageInstaller status: hands the system confirmation to the user; records the outcome. */
class UpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else intent.getParcelableExtra(Intent.EXTRA_INTENT)
            confirm?.let { context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            return
        }
        AndroidUpdater.installResult(context, status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
    }
}
