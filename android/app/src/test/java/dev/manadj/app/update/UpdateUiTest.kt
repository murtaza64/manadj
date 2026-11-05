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

    @After fun reset() { AndroidUpdater.state = AndroidUpdater.State.Idle }

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
}
