package dev.manadj.app

import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import dev.manadj.audio.DeckId
import dev.manadj.audio.QuantizeMode

/** Floating card chrome shared by popups: rounded, glowing edge in [color], swallows touches. */
@Composable fun Card(color: Color, modifier: Modifier, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(modifier.halo(color, .45f, 10.dp).padding(10.dp).clip(shape)
        .background(Brush.verticalGradient(listOf(color.copy(alpha = .10f), Ink.panel, Ink.panel))).background(Ink.panel.copy(alpha = .92f))
        .border(1.5.dp, color, shape).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}.padding(10.dp), content = content)
}

@Composable fun CardHeader(title: String, color: Color, close: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(36.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), color, 16, true)
        Key("", Modifier.size(36.dp), Ink.muted, description = "Close", icon = Glyph.Close, style = KeyStyle.BARE, action = close)
    }
}


@Composable fun SettingsSheet(model: PlayerModel, ux: UiModel, modifier: Modifier) {
    Card(Ink.accent, modifier) {
        CardHeader("SETTINGS", Ink.accent) { ux.settings = false }
        Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            @Composable fun Toggle(label: String, detail: String, on: Boolean, pending: Boolean = false, flip: () -> Unit) {
                Row(Modifier.fillMaxWidth().clickable(onClick = flip).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Row { Text(label, bold = true); if (pending) { Spacer(Modifier.width(6.dp)); PendingTag() } }; Text(detail, color = Ink.muted, size = 11, lines = 2) }
                    Box(Modifier.size(52.dp, 28.dp).clip(RoundedCornerShape(50)).background(if (on) Ink.accent.copy(alpha = .35f) else Ink.crust).border(1.5.dp, if (on) Ink.accent else Ink.surface, RoundedCornerShape(50)), contentAlignment = if (on) Alignment.CenterEnd else Alignment.CenterStart) {
                        Box(Modifier.padding(4.dp).size(20.dp).clip(RoundedCornerShape(50)).background(if (on) Ink.accent else Ink.surface2))
                    }
                }
            }
            val mode = model.output?.quantizeMode ?: ux.quantizeMode
            Toggle("Quantize", "Snap cues, loops and jumps to the beat grid.", mode.quantized, !model.supports("quantize")) { ux.setQuantize(model, on = !mode.quantized) }
            Toggle("Heard (lag compensation)", "Cues and launches line up with what you hear, offset by the output latency below. Works with Quantize on or off. Long-press Q.", ux.quantizeHeard) { ux.setQuantize(model, heard = !ux.quantizeHeard) }
            if (ux.quantizeHeard) HeardLatency(model)
            // Landscape BROWSE parity: which deck stays on screen next to the browser.
            Text("Browse beside (landscape)", bold = true)
            Row(Modifier.fillMaxWidth().height(40.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for ((mode, label) in listOf(BrowseBeside.LOADING to "LOADING DECK", BrowseBeside.PLAYING to "PLAYING DECK", BrowseBeside.BOTH to "BOTH DECKS"))
                    Key(label, Modifier.weight(1f).fillMaxHeight(), Ink.accent, engaged = ux.browseBeside == mode, description = "Browse beside: $label", textSize = 10, style = KeyStyle.PILL) { ux.browseBeside = mode }
            }
            if (ux.browseBeside == BrowseBeside.BOTH) Row(Modifier.fillMaxWidth().height(36.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Browser side · swipe rows to A / B", Modifier.weight(1f), Ink.muted, 11)
                Key("LEFT", Modifier.width(72.dp).fillMaxHeight(), Ink.accent, engaged = !ux.browseBothRight, description = "Browser on the left", textSize = 10, style = KeyStyle.PILL) { ux.browseBothRight = false }
                Key("RIGHT", Modifier.width(72.dp).fillMaxHeight(), Ink.accent, engaged = ux.browseBothRight, description = "Browser on the right", textSize = 10, style = KeyStyle.PILL) { ux.browseBothRight = true }
            }
            Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Column(Modifier.weight(1f)) { Text("Preview brightness", bold = true); Text("Browser previews + minimaps, on top of desktop's minimap dim.", color = Ink.muted, size = 11) }
                Key("−", Modifier.width(44.dp).fillMaxHeight(), Ink.accent, ux.overviewBrightness > .31f, description = "Preview brightness down", textSize = 14, style = KeyStyle.PILL) { ux.overviewBrightness -= .05f }
                Text("${(ux.overviewBrightness * 100 + .5f).toInt()}%", Modifier.width(48.dp), Ink.text, 13, true)
                Key("+", Modifier.width(44.dp).fillMaxHeight(), Ink.accent, ux.overviewBrightness < .99f, description = "Preview brightness up", textSize = 14, style = KeyStyle.PILL) { ux.overviewBrightness += .05f }
            }
            Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Column(Modifier.weight(1f)) { Text("Jog sensitivity", bold = true); Text("Pitch-panel jog strip nudge strength.", color = Ink.muted, size = 11) }
                Key("−", Modifier.width(44.dp).fillMaxHeight(), Ink.accent, ux.jogSensitivity > .55f, description = "Jog sensitivity down", textSize = 14, style = KeyStyle.PILL) { ux.jogSensitivity -= .1f }
                Text("×%.1f".format(ux.jogSensitivity), Modifier.width(48.dp), Ink.text, 13, true)
                Key("+", Modifier.width(44.dp).fillMaxHeight(), Ink.accent, ux.jogSensitivity < 2.95f, description = "Jog sensitivity up", textSize = 14, style = KeyStyle.PILL) { ux.jogSensitivity += .1f }
            }
            Toggle("Crossfader", "Off hides the crossfader (both decks play through).", ux.crossfaderEnabled) {
                ux.crossfaderEnabled = !ux.crossfaderEnabled
                if (!ux.crossfaderEnabled) model.updateCrossfade(.5)
            }
            Toggle("Preview pending controls", "EQ, filter, Beat FX, loops, stems move visually but make no sound until the engine lands them.", ux.previewPending) { ux.previewPending = !ux.previewPending }
            Toggle("Output readout", "Show the native output stats line.", ux.outputDebug) { ux.outputDebug = !ux.outputDebug }
            Text("Waveform zoom (or pinch a waveform)", bold = true)
            Row(Modifier.fillMaxWidth().height(40.dp)) { for (s in listOf(6.0, 8.0, 12.0, 16.0, 24.0)) Key("${s.toInt()}s", Modifier.weight(1f).fillMaxHeight(), Ink.accent, engaged = kotlin.math.abs(ux.waveSeconds - s) < .5, textSize = 12) { ux.chooseWaveSeconds(s) } }
            Key("OUTPUT / ROUTING", Modifier.fillMaxWidth().height(44.dp), Ink.accent, icon = Glyph.Headphones) { ux.settings = false; model.outputPanel = true }
            Key("SESSIONS · REPLAY", Modifier.fillMaxWidth().height(44.dp), Ink.accent, icon = Glyph.Play) { ux.settings = false; ux.sessions = true }
            LibrarySync(ux)
            FilterSettingsPanel(model)
            Text("manadj Android · UI #371 · engine #369/#370", color = Ink.muted, size = 10)
        }
    }
}

@Composable fun ReplaceDialog(model: PlayerModel, ux: UiModel) {
    ux.confirmLoad?.let { (deck, id) -> return ConfirmReplace(deck, { ux.confirmLoad = null }) { ux.loadRow(model, deck, id, confirmed = true) } }
    val (deck, _) = model.replace ?: return
    ConfirmReplace(deck, { model.replace = null }) { model.confirmReplacement() }
}

@Composable private fun ConfirmReplace(deck: DeckId, keep: () -> Unit, replace: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .75f)).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}, contentAlignment = Alignment.Center) {
        Card(deckColor(deck), Modifier.widthIn(max = 420.dp).fillMaxWidth()) {
            Text("$deck IS PLAYING", color = deckColor(deck), size = 20, bold = true)
            Text("Replace this deck with the selected track?", lines = 2)
            Row(Modifier.fillMaxWidth().height(52.dp)) { Key("KEEP PLAYING", Modifier.weight(1f).fillMaxHeight(), Ink.play, action = keep); Key("REPLACE", Modifier.weight(1f).fillMaxHeight(), Ink.warning, action = replace) }
        }
    }
}

/** Transient notice (pending controls) and latched engine failures. */
@Composable fun Banners(model: PlayerModel, ux: UiModel, modifier: Modifier) {
    Column(modifier) {
        model.failure?.let { error ->
            Row(Modifier.fillMaxWidth().background(Ink.panel).border(2.dp, Ink.warning).padding(6.dp), verticalAlignment = Alignment.CenterVertically) { Text(error, Modifier.weight(1f), Ink.warning, 12, lines = 3); Key("OK", Modifier.size(44.dp), Ink.warning) { model.dismissFailure() } }
        }
        ux.notice?.let { Text(it, Modifier.fillMaxWidth().background(Ink.panel).border(1.5.dp, Ink.pending).padding(8.dp), Ink.pending, 12, true, 3) }
    }
}

fun visibleOther(id: DeckId) = if (id == DeckId.A) DeckId.B else DeckId.A

/**
 * Desktop library (#372-#376): zero-typing pairing (DNS-SD discovery → approve on the desktop, match code shown
 * big), manual address as a collapsed fallback, SYNC (dot = unsynced phone edits), bulk offline download.
 */
@Composable private fun LibrarySync(ux: UiModel) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val holder = dev.manadj.app.library.LibraryHolder
    var url by remember { mutableStateOf(ux.repo.baseUrl) }
    var pair by remember { mutableStateOf(holder.pairCode(context)) }
    var manual by remember { mutableStateOf(false) }
    var paired by remember { mutableStateOf(holder.isPaired(context)) }
    var pairing by remember { mutableStateOf<dev.manadj.library.PairingState>(dev.manadj.library.PairingState.Idle) }
    val discovery = remember { dev.manadj.app.library.DesktopDiscovery(context) }
    DisposableEffect(Unit) { discovery.start(); onDispose { discovery.stop() } }
    val found by discovery.found.collectAsState()
    val searching by discovery.searching.collectAsState()
    val bulk by ux.repo.bulk.collectAsState()
    val st = ux.syncState
    @Composable fun Field(value: String, hint: String, m: Modifier, onChange: (String) -> Unit) =
        Box(m.fillMaxHeight().clip(RoundedCornerShape(50)).background(Ink.crust).border(1.dp, Ink.surface, RoundedCornerShape(50)).padding(horizontal = 12.dp), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) Text(hint, color = Ink.muted, size = 13)
            androidx.compose.foundation.text.BasicTextField(value, onChange, Modifier.fillMaxWidth(), singleLine = true, textStyle = androidx.compose.ui.text.TextStyle(color = Ink.text, fontSize = androidx.compose.ui.unit.TextUnit(13f, androidx.compose.ui.unit.TextUnitType.Sp), fontFamily = Mono), cursorBrush = androidx.compose.ui.graphics.SolidColor(Ink.accent))
        }
    Text("Desktop library", bold = true)
    when (val p = pairing) {
        is dev.manadj.library.PairingState.AwaitingApproval -> {
            Text("Check that ${p.desktop} shows", color = Ink.muted, size = 12)
            Text(p.matchCode, color = Ink.warning, size = 40, bold = true)
            Text("then approve there.", color = Ink.muted, size = 12)
        }
        is dev.manadj.library.PairingState.Requesting -> Text("Asking the desktop…", color = Ink.muted, size = 12)
        is dev.manadj.library.PairingState.Failed -> Text(p.reason, color = Ink.warning, size = 12, lines = 2)
        is dev.manadj.library.PairingState.Paired -> Text("Paired with ${p.desktop}", color = Ink.play, size = 12, bold = true)
        else -> {}
    }
    if (paired) Row(Modifier.fillMaxWidth().height(36.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("Paired · ${ux.repo.baseUrl}", Modifier.weight(1f), Ink.play, 12, true)
        Key("UNPAIR", Modifier.width(84.dp).fillMaxHeight(), Ink.muted, textSize = 11, style = KeyStyle.PILL) { holder.unpair(context); paired = false; pairing = dev.manadj.library.PairingState.Idle }
    } else {
        Text(if (found.isEmpty()) (if (searching) "Looking for manadj desktops on this network…" else "No desktop found — open manadj on the desktop (same Wi-Fi).") else "Desktops on this network:", color = Ink.muted, size = 11, lines = 2)
        for (d in found) Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text(d.name, bold = true); Text(d.url, color = Ink.muted, size = 10) }
            Key("PAIR", Modifier.width(84.dp).fillMaxHeight(), Ink.accent, pairing !is dev.manadj.library.PairingState.Requesting, style = KeyStyle.PILL, textSize = 12) {
                holder.pair(context, d) { s -> pairing = s; if (s is dev.manadj.library.PairingState.Paired) { paired = true; url = d.url } }
            }
        }
    }
    Row(Modifier.fillMaxWidth().height(36.dp), verticalAlignment = Alignment.CenterVertically) {
        Key(if (manual) "▾ Enter address manually" else "▸ Enter address manually", Modifier.weight(1f).fillMaxHeight(), Ink.muted, textSize = 11, style = KeyStyle.BARE) { manual = !manual }
        Box {
            Key(if (st.running) "SYNCING" else "SYNC", Modifier.width(96.dp).height(36.dp), Ink.accent, !st.running, st.running, style = KeyStyle.PILL) { ux.sync() }
            if (st.pendingEdits > 0) Box(Modifier.align(Alignment.TopEnd).size(10.dp).clip(RoundedCornerShape(50)).background(Ink.warning))
        }
    }
    if (manual) {
        Text("Desktop › Settings › Library › Phone sync shows the URL and pairing code. Over USB: adb reverse tcp:8127 → http://127.0.0.1:8127.", color = Ink.muted, size = 11, lines = 3)
        Row(Modifier.fillMaxWidth().height(40.dp)) { Field(url, "http://<desktop ip>:48127", Modifier.weight(1f)) { url = it; holder.setUrl(context, it) } }
        Row(Modifier.fillMaxWidth().height(40.dp)) { Field(pair, "Pairing code", Modifier.weight(1f)) { pair = it; holder.setPairCode(context, it) } }
    }
    Text(when {
        st.running -> "${st.phase ?: "Syncing"} ${st.progress?.let { "${(it * 100).toInt()}%" } ?: ""}"
        st.error != null -> "Error: ${st.error}"
        st.lastSynced != null -> "${st.trackCount} tracks · ${st.previewCount} waveforms · ${st.audioCount} on phone" + if (st.pendingEdits > 0) " · ${st.pendingEdits} edits to sync" else ""
        else -> "Not synced — the track list shows a fixture."
    }, color = if (st.error != null) Ink.warning else Ink.muted, size = 11, lines = 2)
    if (ux.synced != null) BulkDownload(ux, null)
}

/** Bulk offline download for the whole library ([playlistId] null) or one playlist; progress + cancel. */
@Composable fun BulkDownload(ux: UiModel, playlistId: Int?, compact: Boolean = false) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val bulk by ux.repo.bulk.collectAsState()
    val mine = bulk.running && bulk.playlistId == playlistId
    // "with stems": also fetch the four stems (audio + waveforms) for tracks the desktop has separated.
    var stems by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(false) }
    val notify = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { dev.manadj.app.library.LibraryHolder.downloadAll(context, playlistId, stems) }
    fun start() {
        if (android.os.Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) notify.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        else dev.manadj.app.library.LibraryHolder.downloadAll(context, playlistId, stems)
    }
    val height = if (compact) 30.dp else 36.dp
    if (mine) {
        Row(Modifier.fillMaxWidth().height(height), verticalAlignment = Alignment.CenterVertically) {
            Text("${bulk.tracksDone}/${bulk.tracksTotal} · ${dev.manadj.library.formatBytes(bulk.bytesDone)}/${dev.manadj.library.formatBytes(bulk.bytesTotal)}" + (bulk.current?.let { " · $it" } ?: ""), Modifier.weight(1f), Ink.muted, 10)
            Key("CANCEL", Modifier.width(76.dp).fillMaxHeight(), Ink.warning, textSize = 10, style = KeyStyle.PILL) { dev.manadj.app.library.LibraryHolder.cancelDownloadAll(context) }
        }
        Box(Modifier.fillMaxWidth().height(3.dp).background(Ink.surface)) { Box(Modifier.fillMaxWidth(bulk.progress ?: 0f).fillMaxHeight().background(Ink.play)) }
    } else {
        val plan = remember(playlistId, stems, ux.synced, ux.downloads) { runCatching { ux.repo.bulkPlan(playlistId, stems) }.getOrNull() }
        val todo = plan != null && plan.tracks.isNotEmpty()
        // Stem sizes aren't in the snapshot: the byte figure covers full mixes only.
        val label = plan?.let { if (!todo) "ALL ON PHONE" else "DOWNLOAD ${if (playlistId == null) "LIBRARY" else "PLAYLIST"}" + (if (it.remainingBytes > 0) " · ${dev.manadj.library.formatBytes(it.remainingBytes)}" else "") + if (stems) " + STEMS" else "" } ?: "DOWNLOAD"
        Row(Modifier.fillMaxWidth().height(height), verticalAlignment = Alignment.CenterVertically) {
            Key(label, Modifier.weight(1f).fillMaxHeight(), Ink.play, todo && plan!!.fits && !bulk.running, textSize = 10, style = KeyStyle.PILL) { start() }
            Key("STEMS", Modifier.width(76.dp).fillMaxHeight().testTag("bulk-stems"), Ink.accent, engaged = stems, description = "download with stems", textSize = 10, style = KeyStyle.PILL) { stems = !stems }
        }
        if (plan != null && !plan.fits) Text("Not enough space: needs ${dev.manadj.library.formatBytes(plan.remainingBytes)}, ${dev.manadj.library.formatBytes(plan.freeBytes)} free", color = Ink.warning, size = 10)
        if (bulk.finished && bulk.playlistId == playlistId && bulk.failed > 0) Text("${bulk.failed} tracks could not be downloaded", color = Ink.warning, size = 10)
    }
}

/**
 * Output latency L for HEARD quantize (#382), per route: Android-reported until calibrated. Nudge by ms,
 * mic-loopback CALIBRATE (6 chirps), or TAP along to a playing gridded deck; FORGET returns to reported.
 */
@Composable fun HeardLatency(model: PlayerModel) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val mic = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { if (it) model.calibrateLatency() }
    val ms = model.heardLatency * 1000
    // Route kind (#100, engine classification + per-route override): only HEADPHONES hints; UNKNOWN never blocks.
    val kind = model.routeKind
    val headphones = kind == dev.manadj.audio.RouteKind.HEADPHONES
    val btPermission = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { model.refreshRoute() }
    // Beats at the playing deck's tempo: how far off a quantized launch would land uncorrected.
    val deck = model.visibleDecks.map { model.decks.getValue(it) }.firstOrNull { it.snapshot?.playing == true && it.snapshot?.bpm != null }
    val beats = deck?.snapshot?.bpm?.let { model.heardLatency * it * tempoRate(deck) / 60 }
    Column(Modifier.fillMaxWidth().border(1.dp, Ink.surface, RoundedCornerShape(8.dp)).padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("OUTPUT LATENCY", Modifier.weight(1f), Ink.muted, 10, true)
            Text(model.heardRoute ?: "this output", color = Ink.muted, size = 10)
        }
        // Speaker / Headphones: one-tap override remembered per route (tap the lit one again for automatic).
        Row(Modifier.fillMaxWidth().height(32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(when { model.routeKindOverridden -> "set by you"; kind == dev.manadj.audio.RouteKind.UNKNOWN -> "type unknown"; else -> "detected" }, Modifier.weight(1f), Ink.muted, 10)
            for ((k, label) in listOf(dev.manadj.audio.RouteKind.SPEAKER to "SPEAKER", dev.manadj.audio.RouteKind.HEADPHONES to "HEADPHONES"))
                Key(label, Modifier.width(96.dp).fillMaxHeight(), Ink.accent, engaged = kind == k, description = "This output is a $label", textSize = 10, style = KeyStyle.PILL) {
                    model.overrideRouteKind(if (kind == k && model.routeKindOverridden) null else k)
                }
        }
        if (model.routeKindNeedsBluetoothPermission && kind == dev.manadj.audio.RouteKind.UNKNOWN && !model.routeKindOverridden && android.os.Build.VERSION.SDK_INT >= 31)
            Row(Modifier.fillMaxWidth().height(32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Allow Bluetooth access to tell speakers from headphones.", Modifier.weight(1f), Ink.muted, 10, lines = 2)
                Key("ALLOW", Modifier.width(72.dp).fillMaxHeight(), Ink.accent, description = "Allow Bluetooth access", textSize = 10, style = KeyStyle.PILL) { btPermission.launch(android.Manifest.permission.BLUETOOTH_CONNECT) }
            }
        Row(verticalAlignment = Alignment.Bottom) {
            Text("%.0f ms".format(ms), color = Ink.text, size = 22, bold = true)
            Spacer(Modifier.width(8.dp))
            Text((if (model.heardLatencyCalibrated) "calibrated" else "Android-reported") + (beats?.let { " · %.2f beats".format(it) } ?: ""), Modifier.padding(bottom = 3.dp), if (model.heardLatencyCalibrated) Ink.play else Ink.muted, 11)
        }
        Row(Modifier.fillMaxWidth().height(36.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (step in listOf(-10, -1, 1, 10)) Key((if (step > 0) "+" else "−") + "${kotlin.math.abs(step)}", Modifier.weight(1f).fillMaxHeight(), Ink.accent, description = "Latency ${step} ms", textSize = 11, style = KeyStyle.PILL) {
                model.setHeardLatency((model.heardLatency + step / 1000.0).coerceIn(0.0, 2.0))
            }
            Key("FORGET", Modifier.weight(1.4f).fillMaxHeight(), Ink.warning, model.heardLatencyCalibrated, textSize = 10, style = KeyStyle.PILL) { model.setHeardLatency(null) }
        }
        // tapCalibrating isn't snapshot state (engine-owned PlayerModel): poll it while this panel is shown.
        val tapping by produceState(model.tapCalibrating) { while (true) { value = model.tapCalibrating; kotlinx.coroutines.delay(50) } }
        val busy = model.calibrating || tapping || model.reactionPrePass || model.earAligning
        Row(Modifier.fillMaxWidth().height(40.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Key(if (model.calibrating) "LISTENING…" else "MIC", Modifier.weight(1f).fillMaxHeight(), Ink.play, !busy && !headphones, engaged = model.calibrating, description = "Calibrate latency with the microphone", textSize = 11, style = KeyStyle.PILL) {
                if (context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) model.calibrateLatency()
                else mic.launch(android.Manifest.permission.RECORD_AUDIO)
            }
            Key("TAP ALONG", Modifier.weight(1f).fillMaxHeight(), Ink.accent, !busy, engaged = tapping || model.reactionPrePass, description = "Tap along to calibration clicks", textSize = 11, style = KeyStyle.PILL) {
                if (model.heardLatencyCalibrated) model.startTapCalibration() else model.startReactionPrePass()
            }
            Key("BY EAR", Modifier.weight(1f).fillMaxHeight(), Ink.accent, !busy, engaged = model.earAligning, description = "Align by ear", textSize = 11, style = KeyStyle.PILL) { model.startEarAlign() }
        }
        when {
            model.reactionPrePass || tapping -> TapAlong(model)
            model.earAligning -> EarAlign(model)
        }
        val last = model.lastCalibration
        // Recovery: reopen the output stream (a calibration on a Bluetooth route could leave it silent).
        if (last != null && !busy) Key("RESTART AUDIO OUTPUT", Modifier.fillMaxWidth().height(36.dp), Ink.warning, description = "Restart audio output", textSize = 10, style = KeyStyle.PILL) {
            model.restartOutput()
        }
        if (!busy || model.calibrating) Text(when {
            model.calibrating -> "Volume up, quiet room: 8 chirps at full level."
            headphones -> "Headphones: the phone mic can't hear them — TAP ALONG or BY EAR (wrong? set SPEAKER above)."
            last?.seconds != null -> "Saved %.0f ms%s.".format(last.seconds!! * 1000, if (last.spreadMillis > 0) " (spread %.1f ms)".format(last.spreadMillis) else "")
            last != null -> (last.reason ?: "no clear chirps").let { r -> "Calibration failed: $r" + if (!r.contains("tap", ignoreCase = true)) " — try TAP ALONG." else "" }
            else -> "MIC listens to the speaker. TAP ALONG and BY EAR work on any output."
        }, color = if (last != null && last.seconds == null && !model.calibrating) Ink.warning else Ink.muted, size = 11, lines = 2)
    }
}
