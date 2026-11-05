package dev.manadj.app

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.unit.dp
import dev.manadj.library.HotCue
import dev.manadj.library.LibraryTrack
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** #405: hot cue flags over the browser preview strip; in-range cues only. PNG: build/generated-views/405. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h120dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PreviewCuesTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun flagsDrawForInRangeCues() {
        val track = LibraryTrack(id = 1, title = "t", artist = null, fileName = "t.mp3", bpm = 128.0, key = null, keyOpenKey = null, keyCamelot = null,
            energy = null, durationSecs = 300.0, dateAdded = null, mainCue = null, codec = null, fileSizeBytes = null, audioRev = "r", previewRev = null,
            tagIds = emptyList(), grid = null,
            hotCues = listOf(HotCue(1, 0.0, null, null), HotCue(4, 150.0, "drop", null), HotCue(6, 280.0, null, "#00ff00"), HotCue(8, 400.0, null, null)))
        // The overlay PreviewWave draws over its (async, cached) bitmap; drawn here over a plain strip to stay off the bitmap worker.
        compose.setContent { Box(Modifier.background(Ink.background).padding(8.dp)) { Box(Modifier.size(300.dp, 40.dp).background(Ink.panel)) { PreviewCues(track.hotCues, track.durationSecs!!, Modifier.fillMaxSize()) } } }
        compose.onNodeWithContentDescription("3 hot cues").assertExists() // 400 s is past the end: not drawn
        val root = File(System.getProperty("manadj.previewViews") ?: "build/generated-views/405").apply { mkdirs() }
        compose.runOnIdle {
            val view = compose.activity.window.decorView
            val bitmap = android.graphics.Bitmap.createBitmap(view.width, view.height, android.graphics.Bitmap.Config.ARGB_8888)
            view.draw(android.graphics.Canvas(bitmap))
            File(root, "405-preview-cues.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        }
    }
}
