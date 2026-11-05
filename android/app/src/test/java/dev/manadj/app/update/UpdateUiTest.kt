package dev.manadj.app.update

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import dev.manadj.app.Ink
import dev.manadj.library.update.Activity
import dev.manadj.library.update.ChannelEntry
import dev.manadj.library.update.ReleaseIdentity
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** #419 generated views: identity line, offer/staged states, applied-release notes + seen receipt. No network/install. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w420dp-h640dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class UpdateUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val src = "6dca1c7265e3aafdc95d4c2cdb687d360c81346d"
    private val entry = ChannelEntry("a".repeat(64), 8, "0.1.0-rc.8", 26, listOf("arm64-v8a"), src, "b".repeat(64),
        "https://manadj.murtaza.earth/android/stable/manadj-8.apk", "c".repeat(64), 41_000_000)

    @After fun reset() {
        AndroidUpdater.state = AndroidUpdater.State.Idle
        AndroidUpdater.fetch = AndroidUpdater::open
        AndroidUpdater.clock = System::currentTimeMillis
        AndroidUpdater.installedOverride = null
        AndroidUpdater.verifyArchive = AndroidUpdater::verifyArchiveReal
        AndroidUpdater.scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.IO)
        File(compose.activity.noBackupFilesDir, "update-check.json").delete()
        File(compose.activity.noBackupFilesDir, "update").deleteRecursively()
    }

    private fun shot(name: String) {
        val root = File(System.getProperty("manadj.previewViews") ?: "build/generated-views/419").apply { mkdirs() }
        compose.runOnIdle {
            val view = compose.activity.window.decorView
            val bitmap = android.graphics.Bitmap.createBitmap(view.width, view.height, android.graphics.Bitmap.Config.ARGB_8888)
            view.draw(android.graphics.Canvas(bitmap))
            File(root, "$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        }
    }

    @Test fun devBuildNeverClaimsAReleaseAndOfferedStateShowsDownload() {
        // Robolectric APK has no assets/manadj-release: a dev build.
        assertNull(AndroidUpdater.applied(compose.activity))
        AndroidUpdater.state = AndroidUpdater.State.Offered(entry)
        compose.setContent { Column(Modifier.fillMaxSize().background(Ink.background).padding(12.dp)) { UpdatePage { Activity(false, false, false) } } }
        compose.onNodeWithTag("update-identity").assertTextContains("Dev build", substring = true)
        compose.onNodeWithTag("update-identity").assertTextContains("no release identity", substring = true)
        compose.onNodeWithTag("update-state").assertTextContains("Offered: 0.1.0-rc.8 (code 8)", substring = true)
        compose.onNodeWithText("DOWNLOAD").assertExists()
        shot("419-offered-dev-build")
    }

    @Test fun stagedInstallIsBlockedDuringPlaybackWithReason() {
        AndroidUpdater.state = AndroidUpdater.State.Staged(entry, File("unused"))
        compose.setContent { Column(Modifier.fillMaxSize().background(Ink.background).padding(12.dp)) { UpdatePage { Activity(true, false, false) } } }
        compose.onNodeWithTag("update-state").assertTextContains("Verified and ready", substring = true)
        compose.onNodeWithText("Stop playback to install").assertExists()
        shot("419-staged-blocked")
    }

    @Test fun lineWordsAreEvidenceBound() {
        assertEquals("Not checked", updateLine(AndroidUpdater.State.Idle))
        assertEquals("Install requested: confirm in the system dialog", updateLine(AndroidUpdater.State.InstallRequested(entry)))
        assertFalse(updateLine(AndroidUpdater.State.InstallRequested(entry)).contains("installed", ignoreCase = true))
        val id = ReleaseIdentity("0.1.0-rc.8", src, "b".repeat(64), "d".repeat(64), "notes")
        assertTrue(identityLine(id, 8, "0.1.0-rc.8").startsWith("Release 0.1.0-rc.8 (code 8) · source 6dca1c7265"))
    }

    @Test fun releaseNotesDoneRecordsSeen() {
        val body = "Fixes: decks resume after rotation."
        val notes = ReleaseIdentity.sha256(body.toByteArray())
        val r = ReleaseIdentity("0.1.0-rc.8", src, notes, ReleaseIdentity.releaseId("0.1.0-rc.8", src, notes), body)
        var done = false
        compose.setContent { ReleaseNotes(r) { done = AndroidUpdater.markSeen(compose.activity, r) } }
        compose.onNodeWithText(body).assertExists()
        shot("419-release-notes")
        compose.onNodeWithText("DONE").performClick()
        compose.runOnIdle { assertTrue(done) }
        assertTrue(File(compose.activity.noBackupFilesDir, "release-seen/${r.releaseId}.json").isFile)
    }

    /** Generated channel + APK stand-in served by an injected fetch; counts requests per URL. */
    private inner class Server(val apk: ByteArray = ByteArray(5000) { it.toByte() }) {
        val hits = mutableListOf<String>()
        var offline = false
        val channel = org.json.JSONObject().put("format", "manadj_android_channel/v1").put("channel", "stable")
            .put("package", "dev.murt.manadj.excalibur").put("signer_cert_sha256", dev.manadj.library.update.UpdatePolicy.SIGNER_SHA256)
            .put("entries", org.json.JSONArray().put(org.json.JSONObject().put("release_id", "a".repeat(64)).put("version_code", 8)
                .put("version_name", "0.1.0-rc.8").put("min_sdk", 26).put("abis", org.json.JSONArray())
                .put("source_revision", src).put("notes_sha256", "b".repeat(64))
                .put("apk_url", "https://manadj.murtaza.earth/android/stable/manadj-8.apk")
                .put("apk_sha256", ReleaseIdentity.sha256(apk)).put("apk_bytes", apk.size)))
        fun install() {
            AndroidUpdater.fetch = { url ->
                hits.add(url)
                if (offline) throw java.io.IOException("offline")
                java.io.ByteArrayInputStream(if (url.endsWith(".apk")) apk else channel.toString().toByteArray())
            }
            AndroidUpdater.installedOverride = dev.manadj.library.update.Installed("dev.murt.manadj.excalibur", 7,
                setOf(dev.manadj.library.update.UpdatePolicy.SIGNER_SHA256), 35, listOf("arm64-v8a"))
            AndroidUpdater.verifyArchive = { _, _, _ -> } // archive cert check needs a real signed APK; device verification
            AndroidUpdater.scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined)
        }
    }

    @Test fun autoCheckIsRateLimitedAndStagesOnlyWhenIdle() {
        val server = Server().apply { install() }
        var now = 1_000_000L
        AndroidUpdater.clock = { now }
        val ctx = compose.activity
        AndroidUpdater.autoCheck(ctx) { Activity(playing = true, recording = false, transferring = false) }
        assertTrue(AndroidUpdater.state is AndroidUpdater.State.Offered)
        assertEquals(listOf("https://manadj.murtaza.earth/android/stable/channel.json"), server.hits) // no download while playing
        assertEquals(now, AndroidUpdater.lastCheckedMs)
        now += 60_000
        AndroidUpdater.state = AndroidUpdater.State.Idle
        AndroidUpdater.autoCheck(ctx) { Activity(false, false, false) }
        assertEquals(1, server.hits.size); assertTrue(AndroidUpdater.state is AndroidUpdater.State.Idle) // rate-limited
        now += 6 * 3600_000L
        AndroidUpdater.autoCheck(ctx) { Activity(false, false, false) }
        assertTrue(AndroidUpdater.state.toString(), AndroidUpdater.state is AndroidUpdater.State.Staged)
        assertEquals(3, server.hits.size); assertTrue(server.hits.last().endsWith("manadj-8.apk"))
        assertEquals("Stop recording to install", AndroidUpdater.blocked(ctx, Activity(false, true, false)))
    }

    @Test fun failedAutoCheckBacksOffAndIsVisible() {
        val server = Server().apply { install(); offline = true }
        var now = 5_000_000L
        AndroidUpdater.clock = { now }
        AndroidUpdater.autoCheck(compose.activity) { Activity(false, false, false) }
        assertTrue((AndroidUpdater.state as AndroidUpdater.State.Failed).reason.contains("offline"))
        now += 2 * 60_000
        AndroidUpdater.autoCheck(compose.activity) { Activity(false, false, false) }
        assertEquals(1, server.hits.size)
        now += 4 * 60_000
        server.offline = false
        AndroidUpdater.state = AndroidUpdater.State.Idle
        AndroidUpdater.autoCheck(compose.activity) { Activity(false, false, false) }
        assertEquals(3, server.hits.size) // channel + apk after the 5 min backoff
        assertEquals("Checked 12 min ago · checks automatically on launch (every 6 h)", lastCheckedLine(0, 12 * 60_000))
        assertEquals("Never checked · checks automatically on launch (every 6 h)", lastCheckedLine(null, 0))
    }

    @Test fun bannerShowsOfferAndOpensUpdatesWithoutInstalling() {
        AndroidUpdater.state = AndroidUpdater.State.Staged(entry, File("unused"))
        var opened = false
        compose.setContent { Column(Modifier.fillMaxSize().background(Ink.background)) { UpdateBanner { opened = true } } }
        compose.onNodeWithTag("update-banner").assertExists()
        shot("419-banner-staged")
        compose.onNodeWithText("UPDATE").performClick()
        compose.runOnIdle { assertTrue(opened); assertTrue(AndroidUpdater.state is AndroidUpdater.State.Staged) }
        compose.onNodeWithText("LATER").performClick()
        compose.onNodeWithTag("update-banner").assertDoesNotExist()
    }

    @Test fun foregroundTickStagesAnOfferWhenActivityEndsAndCoalesces() {
        val server = Server().apply { install() }
        var now = 9_000_000L
        AndroidUpdater.clock = { now }
        var playing = true
        val act = { Activity(playing, false, false) }
        AndroidUpdater.foregroundTick(compose.activity, act) // due: check, offer held while playing
        assertTrue(AndroidUpdater.state is AndroidUpdater.State.Offered); assertEquals(1, server.hits.size)
        now += AndroidUpdater.TICK_MS
        AndroidUpdater.foregroundTick(compose.activity, act) // still playing: nothing fetched
        assertEquals(1, server.hits.size)
        playing = false
        now += AndroidUpdater.TICK_MS
        AndroidUpdater.foregroundTick(compose.activity, act) // play -> idle: stage without app restart
        assertTrue(AndroidUpdater.state is AndroidUpdater.State.Staged); assertEquals(2, server.hits.size)
        now += AndroidUpdater.TICK_MS
        AndroidUpdater.foregroundTick(compose.activity, act) // staged + not due: no request
        assertEquals(2, server.hits.size)
        AndroidUpdater.state = AndroidUpdater.State.Checking
        AndroidUpdater.foregroundTick(compose.activity, act) // in flight: coalesced
        assertEquals(2, server.hits.size)
    }

    @Test fun installRefusesBeforeASessionWhenActivityStartsDuringVerification() {
        Server().apply { install() }
        val ctx = compose.activity
        org.robolectric.Shadows.shadowOf(ctx.packageManager).setCanRequestPackageInstalls(true)
        AndroidUpdater.clock = { 1L }
        AndroidUpdater.check(ctx) { AndroidUpdater.download(ctx, it) }
        var playing = false
        AndroidUpdater.verifyArchive = { _, _, _ -> playing = true }
        AndroidUpdater.install(ctx) { Activity(playing, false, false) }
        assertEquals("Stop playback to install", (AndroidUpdater.state as AndroidUpdater.State.Failed).reason)
        assertTrue(ctx.packageManager.packageInstaller.mySessions.isEmpty())
    }

    @Test fun installRechecksActivityBeforeCommitAndAbandonsTheSession() {
        val server = Server().apply { install() }
        val ctx = compose.activity
        org.robolectric.Shadows.shadowOf(ctx.packageManager).setCanRequestPackageInstalls(true)
        AndroidUpdater.clock = { 1L }
        AndroidUpdater.check(ctx) { AndroidUpdater.download(ctx, it) }
        val staged = AndroidUpdater.state as AndroidUpdater.State.Staged
        var calls = 0
        AndroidUpdater.install(ctx) { calls++; Activity(playing = calls > 2, recording = false, transferring = false) }
        assertEquals(3, calls) // before IO, after the archive check (before a session), right before commit
        assertEquals(AndroidUpdater.State.Failed("Stop playback to install", staged.entry), AndroidUpdater.state)
        assertTrue(ctx.packageManager.packageInstaller.mySessions.isEmpty()) // abandoned, never committed
        assertEquals(2, server.hits.size)
    }
}
