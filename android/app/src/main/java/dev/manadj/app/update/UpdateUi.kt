package dev.manadj.app.update

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import dev.manadj.app.Ink
import dev.manadj.app.Key
import dev.manadj.app.Text
import dev.manadj.library.update.Activity
import dev.manadj.library.update.ReleaseIdentity
import dev.manadj.library.update.UpdatePolicy

/** Running-build identity line: the embedded release (verified) or "dev build"; never claims more. */
fun identityLine(applied: ReleaseIdentity?, versionCode: Long, versionName: String?): String =
    if (applied == null) "Dev build $versionName (code $versionCode) · no release identity"
    else "Release ${applied.version} (code $versionCode) · source ${applied.sourceRevision.take(10)} · id ${applied.releaseId.take(10)}"

/** Settings → App & updates. [activity] gates installing (playback / recording / transfer). */
@Composable fun UpdatePage(activity: () -> Activity) {
    val context = LocalContext.current
    val applied = remember { AndroidUpdater.applied(context) }
    val installed = remember { runCatching { AndroidUpdater.installed(context) }.getOrNull() }
    val versionName = remember { runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() }
    Text(identityLine(applied, installed?.versionCode ?: -1, versionName), Modifier.testTag("update-identity"), Ink.text, 12, lines = 3)
    Text("Channel: ${UpdatePolicy.channelUrl}", color = Ink.muted, size = 10, lines = 2)
    val s = AndroidUpdater.state
    Text(updateLine(s), Modifier.testTag("update-state"), if (s is AndroidUpdater.State.Failed) Ink.warning else Ink.text, 12, lines = 3)
    Text(lastCheckedLine(AndroidUpdater.lastCheckedMs, System.currentTimeMillis()), Modifier.testTag("update-last-checked"), Ink.muted, 11)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Key("CHECK", Modifier.height(36.dp).widthIn(min = 80.dp), enabled = s !is AndroidUpdater.State.Checking && s !is AndroidUpdater.State.Downloading) {
            AndroidUpdater.check(context)
        }
        when (s) {
            is AndroidUpdater.State.Offered -> Key("DOWNLOAD", Modifier.height(36.dp).widthIn(min = 100.dp)) { AndroidUpdater.download(context, s.entry) }
            is AndroidUpdater.State.Staged -> {
                val reason = AndroidUpdater.blocked(context, activity())
                if (reason == "Allow manaDJ to install updates") Key("ALLOW", Modifier.height(36.dp).widthIn(min = 80.dp)) { AndroidUpdater.allowInstalls(context) }
                else Key("INSTALL", Modifier.height(36.dp).widthIn(min = 90.dp), color = Ink.play, enabled = reason == null) {
                    AndroidUpdater.install(context, activity)
                }
                reason?.let { Text(it, Modifier.align(Alignment.CenterVertically), Ink.warning, 11) }
            }
            else -> {}
        }
    }
    applied?.let { r ->
        var open by remember { mutableStateOf(false) }
        Key("RELEASE NOTES", Modifier.height(32.dp).widthIn(min = 120.dp), color = Ink.accent) { open = true }
        if (open) ReleaseNotes(r) { open = false }
    }
}

/** "Checked 12 min ago · automatic on launch (6 h)"; never-checked says so. */
fun lastCheckedLine(lastMs: Long?, nowMs: Long): String {
    val ago = lastMs?.let { (nowMs - it).coerceAtLeast(0) / 60_000 }
    val word = when {
        ago == null -> "Never checked"
        ago < 1 -> "Checked just now"
        ago < 120 -> "Checked $ago min ago"
        else -> "Checked ${ago / 60} h ago"
    }
    return "$word · checks automatically on launch (every 6 h)"
}

/**
 * Compact visible offer over the app (#419): shown while an update is offered/downloading/ready, until dismissed for
 * that release. [open] goes to Settings → App & updates (installing happens there, never from the banner).
 */
@Composable fun UpdateBanner(open: () -> Unit) {
    val s = AndroidUpdater.state
    val entry = when (s) {
        is AndroidUpdater.State.Offered -> s.entry
        is AndroidUpdater.State.Downloading -> s.entry
        is AndroidUpdater.State.Staged -> s.entry
        else -> null
    } ?: return
    var dismissed by remember { mutableStateOf<String?>(null) }
    if (dismissed == entry.releaseId) return
    Row(Modifier.fillMaxWidth().background(Ink.panel).padding(horizontal = 10.dp, vertical = 4.dp).testTag("update-banner"),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(updateLine(s), Modifier.weight(1f), if (s is AndroidUpdater.State.Staged) Ink.play else Ink.text, 12)
        Key("UPDATE", Modifier.height(30.dp).widthIn(min = 80.dp), color = Ink.play) { open() }
        Key("LATER", Modifier.height(30.dp).widthIn(min = 64.dp), color = Ink.muted) { dismissed = entry.releaseId }
    }
}

internal fun updateLine(s: AndroidUpdater.State): String = when (s) {
    AndroidUpdater.State.Idle -> "Not checked"
    AndroidUpdater.State.Checking -> "Checking…"
    is AndroidUpdater.State.UpToDate -> "Up to date (code ${s.versionCode})"
    is AndroidUpdater.State.Offered -> "Offered: ${s.entry.versionName} (code ${s.entry.versionCode}) · ${s.entry.apkBytes / 1_000_000} MB"
    is AndroidUpdater.State.Downloading -> "Downloading ${s.entry.versionName} · ${s.bytes * 100 / maxOf(1, s.entry.apkBytes)}%"
    is AndroidUpdater.State.Staged -> "Verified and ready: ${s.entry.versionName} (code ${s.entry.versionCode})"
    is AndroidUpdater.State.InstallRequested -> "Install requested: confirm in the system dialog"
    is AndroidUpdater.State.Failed -> s.reason
}

/** Applied-release notes: automatic once per verified embedded release; Done records the seen receipt. */
@Composable fun ReleaseNotesOnLaunch() {
    val context = LocalContext.current
    var notes by remember { mutableStateOf<ReleaseIdentity?>(null) }
    LaunchedEffect(Unit) { notes = AndroidUpdater.unseenNotes(context) }
    notes?.let { r -> ReleaseNotes(r) { if (AndroidUpdater.markSeen(context, r)) notes = null } }
}

@Composable fun ReleaseNotes(release: ReleaseIdentity, done: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Ink.background.copy(alpha = .85f)).testTag("release-notes"), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 520.dp).heightIn(max = 560.dp).background(Ink.panel).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("manaDJ ${release.version}", color = Ink.accent, size = 16, bold = true)
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
                Text(release.body, color = Ink.text, size = 13, lines = Int.MAX_VALUE)
            }
            Key("DONE", Modifier.fillMaxWidth().height(40.dp)) { done() }
        }
    }
}
