package dev.manadj.app

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Settings groups (#396), in list order. */
enum class SettingsPage(val title: String) {
    LIBRARY("Desktop library"),
    TIMING("Quantize & timing"),
    CONTROLS("Controls"),
    DISPLAY("Display"),
    VISUALIZER("Visualizer"), // android-viz #394 spike
    BROWSER("Browser"),
    OUTPUT("Audio output"),
    FILTER("Filter"),
    DEVELOPER("Developer"),
    /** One-handed portrait spike (android-onehand, #386). */
    LAYOUT("Layout (portrait)"),
}

/**
 * Settings takeover (#396), placed like the browser: below the waves in portrait, beside the mixer in landscape.
 * Narrow: a group list that drills into one group (back = up). Wide: group rail + the selected group.
 */
@Composable fun SettingsPanel(model: PlayerModel, ux: UiModel, modifier: Modifier) {
    BoxWithConstraints(modifier.background(Ink.background).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}.testTag("settings")) {
        val wide = maxWidth >= 480.dp
        SideEffect { ux.settingsStacked = !wide }
        if (wide) {
            val page = ux.settingsPage ?: SettingsPage.entries.first()
            Row(Modifier.fillMaxSize()) {
                Column(Modifier.width(176.dp).fillMaxHeight().verticalScroll(rememberScrollState())) {
                    SettingsHeader("SETTINGS", back = null) { ux.settings = false }
                    for (p in SettingsPage.entries) RailEntry(p, p == page, summary(p, model, ux)) { ux.settingsPage = p }
                    About(Modifier.padding(10.dp))
                }
                Box(Modifier.width(1.dp).fillMaxHeight().background(Ink.surface0))
                PageBody(page, model, ux, Modifier.weight(1f).fillMaxHeight(), header = true)
            }
        } else {
            AnimatedContent(ux.settingsPage, Modifier.fillMaxSize(), transitionSpec = {
                val deeper = targetState != null
                (slideInHorizontally(tween(200)) { if (deeper) it / 3 else -it / 3 } + fadeIn(tween(160))) togetherWith
                    (slideOutHorizontally(tween(200)) { if (deeper) -it / 3 else it / 3 } + fadeOut(tween(120)))
            }, label = "settings-page") { page ->
                if (page == null) Column(Modifier.fillMaxSize()) {
                    SettingsHeader("SETTINGS", back = null) { ux.settings = false }
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                        for (p in SettingsPage.entries) GroupRow(p, summary(p, model, ux)) { ux.settingsPage = p }
                        About(Modifier.padding(12.dp))
                    }
                } else Column(Modifier.fillMaxSize()) {
                    SettingsHeader(page.title.uppercase(), back = { ux.settingsPage = null }) { ux.settings = false }
                    PageBody(page, model, ux, Modifier.weight(1f).fillMaxWidth(), header = false)
                }
            }
        }
    }
}

@Composable private fun SettingsHeader(title: String, back: (() -> Unit)?, close: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(44.dp).padding(start = if (back == null) 12.dp else 0.dp), verticalAlignment = Alignment.CenterVertically) {
        if (back != null) Key("‹", Modifier.size(44.dp), Ink.accent, description = "Back to settings", textSize = 22, style = KeyStyle.BARE, action = back)
        Text(title, Modifier.weight(1f), Ink.accent, 15, true)
        Key("", Modifier.size(44.dp), Ink.muted, description = "Close settings", icon = Glyph.Close, style = KeyStyle.BARE, action = close)
    }
}

@Composable private fun GroupRow(page: SettingsPage, summary: String, open: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(58.dp).clickable(onClick = open).semantics { contentDescription = "Settings: ${page.title}" }.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text(page.title, size = 15, bold = true); Text(summary, color = Ink.muted, size = 11) }
        Text("›", color = Ink.muted, size = 22)
    }
    Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).height(1.dp).background(Ink.surface0))
}

@Composable private fun RailEntry(page: SettingsPage, selected: Boolean, summary: String, open: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(44.dp).clickable(onClick = open).background(if (selected) Ink.accent.copy(alpha = .14f) else Color.Transparent)
        .semantics { contentDescription = "Settings: ${page.title}" }, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(if (selected) Ink.accent else Color.Transparent))
        Column(Modifier.weight(1f).padding(horizontal = 9.dp)) {
            Text(page.title, color = if (selected) Ink.accent else Ink.text, size = 13, bold = true)
            Text(summary, color = Ink.muted, size = 10)
        }
    }
}

@Composable private fun About(modifier: Modifier) = Text("manadj Android · UI #371 · engine #369/#370", modifier, Ink.muted, 10)

/** One-line state of a group, shown under its name. */
private fun summary(page: SettingsPage, model: PlayerModel, ux: UiModel): String = when (page) {
    SettingsPage.LIBRARY -> ux.syncState.let { st ->
        when {
            st.running -> st.phase ?: "Syncing…"
            st.error != null -> "Sync error"
            st.lastSynced != null -> "${st.trackCount} tracks · ${st.audioCount} on phone"
            else -> "Not synced"
        }
    }
    SettingsPage.TIMING -> (model.output?.quantizeMode ?: ux.quantizeMode).let { m ->
        (if (m.quantized) "Quantize on" else "Quantize off") + if (ux.quantizeHeard) " · Heard %.0f ms".format(model.heardLatency * 1000) else ""
    }
    SettingsPage.CONTROLS -> (if (ux.crossfaderEnabled) "Crossfader on" else "Crossfader off") + " · jog ×%.1f".format(ux.jogSensitivity)
    SettingsPage.DISPLAY -> "Zoom ${ux.waveSeconds.let { if (it >= 1) "%.0f".format(it) else "%.2f".format(it) }} s · previews ${(ux.overviewBrightness * 100 + .5f).toInt()}%"
    SettingsPage.VISUALIZER -> dev.manadj.app.viz.Viz.summary
    SettingsPage.BROWSER -> when (ux.browseBeside) {
        BrowseBeside.LOADING -> "Beside the loading deck"
        BrowseBeside.PLAYING -> "Beside the playing deck"
        BrowseBeside.BOTH -> "Over both decks, " + if (ux.browseBothRight) "right" else "left"
    }
    SettingsPage.OUTPUT -> (model.output?.routing?.label ?: "No stream") + " · " + (model.devices.firstOrNull { it.id == model.routingDevice }?.let { it.name.ifEmpty { it.type } } ?: "System default")
    SettingsPage.FILTER -> model.filterSettings.model.label
    SettingsPage.DEVELOPER -> listOfNotNull("pending preview".takeIf { ux.previewPending }, "output readout".takeIf { ux.outputDebug }).joinToString(" · ").ifEmpty { "All off" }
    SettingsPage.LAYOUT -> dev.manadj.app.onehand.OneHand.summary()
}

@Composable private fun PageBody(page: SettingsPage, model: PlayerModel, ux: UiModel, modifier: Modifier, header: Boolean) {
    Column(modifier) {
        if (header) Row(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(page.title.uppercase(), Modifier.weight(1f), Ink.accent, 15, true)
        }
        // Keyed per page: each group keeps its own scroll position.
        key(page) {
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when (page) {
                    SettingsPage.LIBRARY -> LibrarySync(ux)
                    SettingsPage.TIMING -> TimingPage(model, ux)
                    SettingsPage.CONTROLS -> ControlsPage(model, ux)
                    SettingsPage.DISPLAY -> DisplayPage(ux)
                    SettingsPage.VISUALIZER -> dev.manadj.app.viz.VizSettings()
                    SettingsPage.BROWSER -> BrowserPage(ux)
                    SettingsPage.OUTPUT -> OutputRouting(model)
                    SettingsPage.FILTER -> FilterSettingsPanel(model)
                    SettingsPage.DEVELOPER -> DeveloperPage(ux)
                    SettingsPage.LAYOUT -> dev.manadj.app.onehand.OneHandSettings()
                }
            }
        }
    }
}

@Composable private fun TimingPage(model: PlayerModel, ux: UiModel) {
    val mode = model.output?.quantizeMode ?: ux.quantizeMode
    SettingToggle("Quantize", "Snap cues, loops and jumps to the beat grid.", mode.quantized, !model.supports("quantize")) { ux.setQuantize(model, on = !mode.quantized) }
    SettingToggle("Heard (lag compensation)", "Cues and launches line up with what you hear, offset by the output latency below. Works with Quantize on or off. Long-press Q.", ux.quantizeHeard) { ux.setQuantize(model, heard = !ux.quantizeHeard) }
    if (ux.quantizeHeard) HeardLatency(model)
}

@Composable private fun ControlsPage(model: PlayerModel, ux: UiModel) {
    SettingToggle("Crossfader", "Off hides the crossfader (both decks play through).", ux.crossfaderEnabled) {
        ux.crossfaderEnabled = !ux.crossfaderEnabled
        if (!ux.crossfaderEnabled) model.updateCrossfade(.5)
    }
    SettingStepper("Jog sensitivity", "Pitch-panel jog strip nudge strength.", "×%.1f".format(ux.jogSensitivity), ux.jogSensitivity > .55f, ux.jogSensitivity < 2.95f, { ux.jogSensitivity -= .1f }, { ux.jogSensitivity += .1f })
}

@Composable private fun DisplayPage(ux: UiModel) {
    Text("Waveform zoom", bold = true)
    Text("Or pinch a waveform.", color = Ink.muted, size = 11)
    Row(Modifier.fillMaxWidth().height(40.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (s in listOf(6.0, 8.0, 12.0, 16.0, 24.0)) Key("${s.toInt()}s", Modifier.weight(1f).fillMaxHeight(), Ink.accent, engaged = kotlin.math.abs(ux.waveSeconds - s) < .5, textSize = 12, style = KeyStyle.PILL) { ux.chooseWaveSeconds(s) }
    }
    SettingStepper("Preview brightness", "Browser previews + minimaps, on top of desktop's minimap dim.", "${(ux.overviewBrightness * 100 + .5f).toInt()}%", ux.overviewBrightness > .31f, ux.overviewBrightness < .99f, { ux.overviewBrightness -= .05f }, { ux.overviewBrightness += .05f })
}

@Composable private fun BrowserPage(ux: UiModel) {
    Text("Browse beside (landscape)", bold = true)
    Text("Which deck stays on screen next to the browser.", color = Ink.muted, size = 11)
    Row(Modifier.fillMaxWidth().height(40.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for ((mode, label) in listOf(BrowseBeside.LOADING to "LOADING DECK", BrowseBeside.PLAYING to "PLAYING DECK", BrowseBeside.BOTH to "BOTH DECKS"))
            Key(label, Modifier.weight(1f).fillMaxHeight(), Ink.accent, engaged = ux.browseBeside == mode, description = "Browse beside: $label", textSize = 10, style = KeyStyle.PILL) { ux.browseBeside = mode }
    }
    if (ux.browseBeside == BrowseBeside.BOTH) Row(Modifier.fillMaxWidth().height(36.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Browser side · swipe rows to A / B", Modifier.weight(1f), Ink.muted, 11)
        Key("LEFT", Modifier.width(72.dp).fillMaxHeight(), Ink.accent, engaged = !ux.browseBothRight, description = "Browser on the left", textSize = 10, style = KeyStyle.PILL) { ux.browseBothRight = false }
        Key("RIGHT", Modifier.width(72.dp).fillMaxHeight(), Ink.accent, engaged = ux.browseBothRight, description = "Browser on the right", textSize = 10, style = KeyStyle.PILL) { ux.browseBothRight = true }
    }
}

@Composable private fun DeveloperPage(ux: UiModel) {
    SettingToggle("Preview pending controls", "EQ, filter, Beat FX, loops, stems move visually but make no sound until the engine lands them.", ux.previewPending) { ux.previewPending = !ux.previewPending }
    SettingToggle("Output readout", "Show the native output stats line.", ux.outputDebug) { ux.outputDebug = !ux.outputDebug }
}

/** Label + detail with a switch; the whole row toggles. */
@Composable fun SettingToggle(label: String, detail: String, on: Boolean, pending: Boolean = false, flip: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = flip).semantics { contentDescription = "$label ${if (on) "on" else "off"}" }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Row { Text(label, bold = true); if (pending) { Spacer(Modifier.width(6.dp)); PendingTag() } }; Text(detail, color = Ink.muted, size = 11, lines = 3) }
        Spacer(Modifier.width(8.dp))
        Box(Modifier.size(52.dp, 28.dp).clip(RoundedCornerShape(50)).background(if (on) Ink.accent.copy(alpha = .35f) else Ink.crust).border(1.5.dp, if (on) Ink.accent else Ink.surface, RoundedCornerShape(50)), contentAlignment = if (on) Alignment.CenterEnd else Alignment.CenterStart) {
            Box(Modifier.padding(4.dp).size(20.dp).clip(RoundedCornerShape(50)).background(if (on) Ink.accent else Ink.surface2))
        }
    }
}

/** Label + detail with − value + steps. */
@Composable fun SettingStepper(label: String, detail: String, value: String, canDown: Boolean, canUp: Boolean, down: () -> Unit, up: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Column(Modifier.weight(1f)) { Text(label, bold = true); Text(detail, color = Ink.muted, size = 11, lines = 2) }
        Key("−", Modifier.size(44.dp, 40.dp), Ink.accent, canDown, description = "$label down", textSize = 14, style = KeyStyle.PILL, action = down)
        Text(value, Modifier.width(48.dp), Ink.text, 13, true)
        Key("+", Modifier.size(44.dp, 40.dp), Ink.accent, canUp, description = "$label up", textSize = 14, style = KeyStyle.PILL, action = up)
    }
}
