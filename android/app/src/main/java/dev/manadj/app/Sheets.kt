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

/** Compact pitch popup: varispeed (engine), key lock + sync + grid edit (pending, marked). */
@Composable fun PitchPopup(model: PlayerModel, ux: UiModel, modifier: Modifier) {
    val target = model.pitchDrawer ?: return
    val ui = model.decks.getValue(target)
    val e = ux.extras.getValue(target)
    val color = deckColor(target)
    val varispeed = model.supports("varispeed")
    Card(color, modifier) {
        CardHeader("$target · PITCH", color) { model.pitchDrawer = null }
        Row(verticalAlignment = Alignment.Bottom) {
            Text("%+.2f%%".format(ui.pitch), color = color, size = 28, bold = true)
            Spacer(Modifier.width(12.dp))
            Column { Text(ui.snapshot?.bpm?.let { "%.2f BPM".format(it * (1 + ui.pitch / 100)) } ?: "BPM —", color = if (ui.snapshot?.bpm != null) Ink.text else Ink.muted, size = 12, bold = true); Text("KEY —", color = Ink.muted, size = 12) }
        }
        PhysicalFader("PITCH", ((ui.pitch + 8) / 16).coerceIn(0.0, 1.0), model, target, Modifier.fillMaxWidth().height(52.dp), varispeed, horizontal = true, doubleTapCenter = true, color = color) { v, id -> model.updatePitch(target, v * 16 - 8, id) }
        Row(Modifier.fillMaxWidth().height(40.dp)) {
            Key("−0.05", Modifier.weight(1f).fillMaxHeight(), color, varispeed, textSize = 12) { model.updatePitch(target, (ui.pitch - .05).coerceAtLeast(-8.0)) }
            Key("0", Modifier.weight(1f).fillMaxHeight(), color, varispeed, description = "$target pitch reset") { model.updatePitch(target, 0.0) }
            Key("+0.05", Modifier.weight(1f).fillMaxHeight(), color, varispeed, textSize = 12) { model.updatePitch(target, (ui.pitch + .05).coerceAtMost(8.0)) }
        }
        Spacer(Modifier.height(4.dp))
        val keyLock = model.supports("key-lock")
        val bpm = ui.snapshot?.bpm
        val other = model.decks.getValue(visibleOther(target))
        val otherBpm = other.snapshot?.bpm?.let { it * (1 + other.pitch / 100) }
        Row(Modifier.fillMaxWidth().height(40.dp)) {
            // Engine key lock: requested state from the snapshot; label says WAIT until the whole track is decoded.
            val requested = if (keyLock) ui.snapshot?.keyLock == true else e.keyLock
            val waiting = keyLock && requested && ui.snapshot?.keyLockActive != true && ui.ready
            Key(if (waiting) "KEY LOCK…" else "KEY LOCK", Modifier.weight(1f).fillMaxHeight(), color, keyLock || ux.previewPending, requested, icon = Glyph.Lock, textSize = 12, pending = !keyLock) { if (keyLock) model.setKeyLock(ui.id, !requested) else if (ux.previewPending) e.keyLock = !e.keyLock else ux.pending("Key lock") }
        }
        // Sync (desktop performance-sync.md via the engine's SyncGroup): SYNC joins/leaves the group, MATCH is one-shot.
        val canSync = model.supports("sync")
        val status = model.syncState.decks[target] ?: dev.manadj.audio.SyncStatus.OFF
        var refused by remember(target) { mutableStateOf(false) }
        Row(Modifier.fillMaxWidth().height(40.dp)) {
            val label = when (status) { dev.manadj.audio.SyncStatus.SYNCED -> "SYNC ●"; dev.manadj.audio.SyncStatus.OUT_OF_LOCK -> "SYNC ⚠"; dev.manadj.audio.SyncStatus.WAITING -> "SYNC …"; else -> if (refused) "OUT OF REACH" else "SYNC" }
            Key(label, Modifier.weight(1f).fillMaxHeight(), if (status == dev.manadj.audio.SyncStatus.OUT_OF_LOCK || refused) Ink.warning else color, canSync && bpm != null, status != dev.manadj.audio.SyncStatus.OFF, description = "$target sync", textSize = 12, pending = !canSync) {
                refused = model.toggleSync(target) == dev.manadj.audio.BpmMatch.OutOfReach
            }
            if (canSync) Key("MATCH", Modifier.weight(1f).fillMaxHeight(), color, bpm != null, description = "$target match", textSize = 12) { refused = model.match(target) == dev.manadj.audio.BpmMatch.OutOfReach }
            else Key("MATCH ${visibleOther(target)}", Modifier.weight(1f).fillMaxHeight(), color, varispeed && bpm != null && otherBpm != null, textSize = 12) { model.updatePitch(target, ((otherBpm!! / bpm!! - 1) * 100).coerceIn(-8.0, 8.0)) }
        }
        val grid = model.supports("grid") && ui.ready
        val anchor = ui.snapshot?.gridAnchorSeconds ?: 0.0
        var taps by remember(target) { mutableStateOf(listOf<Long>()) }
        Row(verticalAlignment = Alignment.CenterVertically) { Text("GRID", color = Ink.muted, size = 10, bold = true); Spacer(Modifier.width(8.dp)); Text(bpm?.let { "%.2f BPM · 1.1 @ %.3fs".format(it, anchor) } ?: "no grid — tap the tempo", color = Ink.muted, size = 10) }
        Row(Modifier.fillMaxWidth().height(40.dp)) {
            Key("◄", Modifier.weight(1f).fillMaxHeight(), color, grid && bpm != null, description = "$target grid earlier") { model.setGrid(target, bpm!!, anchor - .01) }
            Key("►", Modifier.weight(1f).fillMaxHeight(), color, grid && bpm != null, description = "$target grid later") { model.setGrid(target, bpm!!, anchor + .01) }
            Key("½×", Modifier.weight(1f).fillMaxHeight(), color, grid && bpm != null, description = "$target BPM halve", textSize = 12) { model.setGrid(target, bpm!! / 2, anchor) }
            Key("2×", Modifier.weight(1f).fillMaxHeight(), color, grid && bpm != null, description = "$target BPM double", textSize = 12) { model.setGrid(target, bpm!! * 2, anchor) }
            Key("1.1", Modifier.weight(1f).fillMaxHeight(), color, grid && bpm != null, description = "$target set downbeat here", textSize = 12) { model.setGrid(target, bpm!!, position(ui)) }
            Key("TAP", Modifier.weight(1.2f).fillMaxHeight(), color, grid, description = "$target tap tempo", textSize = 12) {
                val now = System.currentTimeMillis()
                taps = (taps.filter { now - it < 2500 } + now).takeLast(9)
                if (taps.size >= 4) {
                    val beat = (taps.last() - taps.first()) / 1000.0 / (taps.size - 1)
                    model.setGrid(target, 60 / beat, position(ui))
                }
            }
        }
        Text("±8% varispeed · double-tap the slider to centre · TAP 4+ beats to grid a file without BPM.", color = Ink.muted, size = 10, lines = 2)
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
            Toggle("Quantize", "Snap cues, loops and jumps to the beat grid.", mode != QuantizeMode.OFF, !model.supports("quantize")) { ux.setQuantize(model, on = mode == QuantizeMode.OFF) }
            Toggle("Heard quantize", "Align to the beat you hear (output latency below), not the one being rendered. Long-press Q.", ux.quantizeHeard) { ux.setQuantize(model, heard = !ux.quantizeHeard) }
            if (ux.quantizeHeard) HeardLatency(model)
            // Landscape BROWSE parity: which deck stays on screen next to the browser.
            Text("Browse beside (landscape)", bold = true)
            Row(Modifier.fillMaxWidth().height(40.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Key("LOADING DECK", Modifier.weight(1f).fillMaxHeight(), Ink.accent, engaged = ux.browseBesideLoading, description = "Browse beside: Loading deck", textSize = 11, style = KeyStyle.PILL) { ux.browseBesideLoading = true }
                Key("PLAYING DECK", Modifier.weight(1f).fillMaxHeight(), Ink.accent, engaged = !ux.browseBesideLoading, description = "Browse beside: Playing deck", textSize = 11, style = KeyStyle.PILL) { ux.browseBesideLoading = false }
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
    // Beats at the playing deck's tempo: how far off a quantized launch would land uncorrected.
    val deck = model.visibleDecks.map { model.decks.getValue(it) }.firstOrNull { it.snapshot?.playing == true && it.snapshot?.bpm != null }
    val beats = deck?.snapshot?.bpm?.let { model.heardLatency * it * tempoRate(deck) / 60 }
    Column(Modifier.fillMaxWidth().border(1.dp, Ink.surface, RoundedCornerShape(8.dp)).padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("OUTPUT LATENCY", Modifier.weight(1f), Ink.muted, 10, true)
            Text(model.heardRoute ?: "this output", color = Ink.muted, size = 10)
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
        Row(Modifier.fillMaxWidth().height(40.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Key(if (model.calibrating) "LISTENING…" else "CALIBRATE", Modifier.weight(1f).fillMaxHeight(), Ink.play, !model.calibrating, engaged = model.calibrating, description = "Calibrate latency with the microphone", textSize = 11, style = KeyStyle.PILL) {
                if (context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) model.calibrateLatency()
                else mic.launch(android.Manifest.permission.RECORD_AUDIO)
            }
            TapAlong(model, deck, Modifier.weight(1f).fillMaxHeight())
        }
        val last = model.lastCalibration
        Text(when {
            model.calibrating -> "Volume up, quiet room: 6 chirps at full level (~7 s)."
            last?.seconds != null -> "Measured %.0f ms (spread %.1f ms, %d chirps).".format(last.seconds!! * 1000, last.spreadMillis, last.samples.size)
            last != null -> "Calibration failed: ${last.reason ?: "no clear chirps"}."
            deck == null -> "CALIBRATE uses the mic. TAP needs a playing deck with a beat grid."
            else -> "TAP along to the beat you hear on deck ${deck.id} (8+ taps)."
        }, color = if (last != null && last.seconds == null && !model.calibrating) Ink.warning else Ink.muted, size = 11, lines = 2)
    }
}

/**
 * Tap-along fallback: each tap reads the render position at the tap instant; the heard beat was rendered L
 * earlier, so L = (render position − anchor) mod beat ÷ speed. Median of 8+ taps (first dropped) is applied.
 */
@Composable private fun TapAlong(model: PlayerModel, deck: DeckUi?, modifier: Modifier) {
    val taps = remember { mutableStateListOf<Double>() }
    LaunchedEffect(deck?.id) { taps.clear() }
    // Abandon a run after 3 s without a tap.
    LaunchedEffect(taps.size) { if (taps.isNotEmpty()) { kotlinx.coroutines.delay(3000); taps.clear() } }
    Key(if (taps.isEmpty()) "TAP" else "TAP ${taps.size}", modifier, Ink.accent, deck != null, engaged = taps.isNotEmpty(), description = "Tap along to the beat", textSize = 11, style = KeyStyle.PILL) {
        val now = System.nanoTime()
        val out = model.output ?: return@Key
        val d = deck?.let { out.decks[it.id] } ?: return@Key
        val bpm = d.bpm ?: return@Key
        if (!d.playing) return@Key
        val speed = (1 + d.pitchPercent / 100) * (1 + d.bendPercent / 100)
        val render = d.sourceSeconds + (now - out.snapshotNanos) / 1e9 * speed
        val beat = 60.0 / bpm
        val phase = ((render - d.gridAnchorSeconds) % beat + beat) % beat
        taps.add(phase / speed)
        if (taps.size >= 9) {
            val sorted = taps.drop(1).sorted()
            model.setHeardLatency(sorted[sorted.size / 2])
            taps.clear()
        }
    }
}
