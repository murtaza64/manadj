package dev.manadj.app

import android.content.ClipData
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Always outside the current performance/settings/Session view. */
@Composable fun MasterRecordingBar(model: PlayerModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state = model.masterRecordings
    var expanded by rememberSaveable { mutableStateOf(false) }
    var exportPath by rememberSaveable { mutableStateOf<String?>(null) }
    var exportBusy by remember { mutableStateOf(false) }
    var exportError by remember { mutableStateOf<String?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("audio/wav")) { uri ->
        val path = exportPath
        exportPath = null
        if (uri != null && path != null) scope.launch {
            exportBusy = true
            exportError = withContext(Dispatchers.IO) {
                runCatching {
                    context.contentResolver.openOutputStream(uri, "w").use { target ->
                        checkNotNull(target) { "Cannot open export destination" }
                        File(path).inputStream().use { it.copyTo(target) }
                        target.flush()
                    }
                }.exceptionOrNull()?.let { "Export failed: ${it.message}; original retained" }
            }
            exportBusy = false
        }
    }
    Column(Modifier.fillMaxWidth().background(Ink.panel).padding(horizontal = 8.dp, vertical = 3.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (!state.busy) Key("REC MASTER", Modifier.width(110.dp).height(36.dp), enabled = model.output?.outputOpen == true) { model.startMasterRecording() }
            else {
                Key("STOP / SAVE", Modifier.width(105.dp).height(36.dp), enabled = !state.pending, engaged = true) { model.stopMasterRecording() }
                Key("CANCEL", Modifier.width(65.dp).height(36.dp), enabled = !state.pending) { model.stopMasterRecording(cancel = true) }
            }
            Text(state.label ?: "Master", modifier = Modifier.weight(1f).padding(top = 8.dp), size = 11)
            Key("SAVED ${state.files.size}", Modifier.width(78.dp).height(36.dp), engaged = expanded) { expanded = !expanded }
        }
        if (expanded) Column(Modifier.heightIn(max = 150.dp).verticalScroll(rememberScrollState())) {
            if (state.files.isEmpty()) Text("No completed recordings. Incomplete files are retained, never shared.", size = 11)
            state.files.forEach { file ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(file.name, modifier = Modifier.weight(1f).padding(top = 10.dp), size = 10)
                    Key("SHARE", Modifier.width(65.dp).height(36.dp), enabled = !exportBusy) {
                        runCatching {
                            val uri = FileProvider.getUriForFile(context, "${context.packageName}.recordings", file)
                            val intent = Intent(Intent.ACTION_SEND).setType("audio/wav").putExtra(Intent.EXTRA_STREAM, uri)
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            intent.clipData = ClipData.newRawUri("Master recording", uri)
                            context.startActivity(Intent.createChooser(intent, "Share Master recording"))
                        }.onFailure { exportError = "Share failed: ${it.message}" }
                    }
                    Key("EXPORT", Modifier.width(65.dp).height(36.dp), enabled = !exportBusy) { exportPath = file.path; save.launch(file.name) }
                }
            }
        }
        exportError?.let { Text(it, size = 11) }
        if (exportBusy) Text("Exporting… original retained", size = 11)
    }
}
