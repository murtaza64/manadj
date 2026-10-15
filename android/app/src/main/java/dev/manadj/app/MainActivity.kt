package dev.manadj.app

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.view.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.saveable.rememberSaveable
import dev.manadj.app.library.LibraryPanel
import dev.manadj.audio.*
import kotlinx.coroutines.CancellationException

class MainActivity : ComponentActivity() {
    private val model by viewModels<PlayerModel>()
    private val ux by viewModels<UiModel>()
    private val picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> model.pickerResult(uri) }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.attributes = window.attributes.apply { layoutInDisplayCutoutMode = if (android.os.Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES }
        immerse()
        setContent {
            BackHandler(model.browser != null || model.pitchDrawer != null || model.replace != null || ux.confirmLoad != null || model.outputPanel || ux.settings) { if (ux.confirmLoad != null) ux.confirmLoad = null else { model.browser = null; model.pitchDrawer = null; model.replace = null; model.outputPanel = false; ux.settings = false } }
            PerformanceApp(model, ux) { deck -> model.pickerTarget = deck; picker.launch(arrayOf("audio/*")) }
        }
    }
    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) immerse() }
    override fun onPause() { model.cancelGestures(); super.onPause() }
    private fun immerse() { WindowInsetsControllerCompat(window, window.decorView).apply { systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE; hide(WindowInsetsCompat.Type.systemBars()) } }
}

