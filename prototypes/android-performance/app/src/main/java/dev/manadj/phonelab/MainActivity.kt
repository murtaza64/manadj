package dev.manadj.phonelab

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.core.view.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.interaction.*
import androidx.compose.animation.core.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.*
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import kotlinx.coroutines.CancellationException
import kotlin.math.*

class MainActivity : ComponentActivity() {
    private val model by viewModels<DjModel>()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = android.graphics.Color.BLACK
        window.navigationBarColor = android.graphics.Color.BLACK
        window.attributes = window.attributes.apply { layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES }
        immerse(); setContent { PhonePerformance(model) }
    }
    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) immerse() }
    override fun onPause() { model.decks.values.forEach { it.bend = 0f }; super.onPause() }
    private fun immerse() { WindowInsetsControllerCompat(window, window.decorView).apply { systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE; hide(WindowInsetsCompat.Type.systemBars()) } }
}

private val mono = FontFamily(Font(R.font.ubuntu_mono_regular), Font(R.font.ubuntu_mono_bold, FontWeight.Bold))
@Composable fun Label(text: String, modifier: Modifier = Modifier, color: Color = Palette.text, size: Int = 12, bold: Boolean = false, lines: Int = 1) {
    BasicText(text, modifier, style = TextStyle(color = color, fontSize = size.sp, fontFamily = mono, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal), maxLines = lines, overflow = TextOverflow.Ellipsis)
}

@Composable fun Key(text: String, modifier: Modifier = Modifier, color: Color = Palette.muted, engaged: Boolean = false, description: String = text, onClick: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .97f else 1f, tween(if (pressed) 0 else 100), label = "release")
    Box(modifier.graphicsLayer { scaleX = scale; scaleY = scale }.border(1.5.dp, color.copy(alpha = if (engaged || pressed) 1f else .65f)).background(if (engaged || pressed) color.copy(alpha = .24f) else Palette.mantle).semantics { contentDescription = description }.clickable(interactionSource = interaction, indication = null) { haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); onClick() }.padding(horizontal = 3.dp), contentAlignment = Alignment.Center) { Label(text, color = color, size = 13, bold = true) }
}

@Composable private fun CueKey(deck: Deck, model: DjModel, modifier: Modifier) {
    val color = identityColor(deck.id)
    val haptic = LocalHapticFeedback.current
    Box(modifier.border(2.dp, Palette.yellow).background(if (deck.cueHeld) Palette.yellow else Palette.mantle).semantics { contentDescription = "${deck.id} CUE" }.pointerInput(deck) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            down.consume(); model.beginTouch("${deck.id} CUE"); deck.cueDown()
            haptic.performHapticFeedback(HapticFeedbackType.VirtualKey)
            var cancelled = false
            try { while (true) { val own = awaitPointerEvent().changes.firstOrNull { it.id == down.id }; if (own == null || (!own.pressed && own.isConsumed)) cancelled = true; if (own?.pressed != true) break } }
            catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { deck.cueUp(); model.releaseTouch("${deck.id} CUE", cancelled) }
        }
    }, contentAlignment = Alignment.Center) { Label("${deck.id} CUE", color = if (deck.cueHeld) Palette.base else color, bold = true, size = 16) }
}

@Composable private fun Header(model: DjModel) {
    Row(Modifier.fillMaxWidth().height(24.dp), verticalAlignment = Alignment.CenterVertically) {
        Label("0${model.variant + 1} / ${model.active} SELECTED", Modifier.weight(1f).padding(start = 4.dp), identityColor(model.active), 12, true)
        Key("${model.variant + 1}/3", Modifier.width(48.dp).fillMaxHeight(), Palette.accent) { model.chooseVariant((model.variant + 1) % 3) }
        Key("INFO", Modifier.width(48.dp).fillMaxHeight()) { model.info = true }
    }
}

@Composable private fun Pitch(deck: Deck, model: DjModel, modifier: Modifier) {
    RelativeTile("PITCH", ((deck.tempo / deck.bpm - .92f) / .16f).coerceIn(0f, 1f), { deck.updateTempo(deck.bpm * (.92f + it * .16f)) }, model, modifier, horizontal = true, owner = deck.id)
}

@Composable private fun Jump(deck: Deck, model: DjModel, modifier: Modifier) {
    Row(modifier) {
        Key("−", Modifier.width(48.dp).fillMaxHeight(), identityColor(deck.id), description = "${deck.id} jump backward") { deck.jump(-deck.jumpBeats) }
        ValueWheel("${deck.id} jump size", beatChoices.map { "$it" }, beatChoices.indexOf(deck.jumpBeats), { deck.jumpBeats = beatChoices[it] }, model, Modifier.weight(1f).fillMaxHeight(), identityColor(deck.id), "${deck.jumpBeats} ↔")
        Key("+", Modifier.width(48.dp).fillMaxHeight(), identityColor(deck.id), description = "${deck.id} jump forward") { deck.jump(deck.jumpBeats) }
    }
}

@Composable private fun Transport(deck: Deck, model: DjModel, modifier: Modifier, dense: Boolean = false) {
    Column(modifier.border(if (model.active == deck.id) 2.dp else 1.dp, identityColor(deck.id).copy(alpha = if (model.active == deck.id) 1f else .4f))) {
        Jump(deck, model, Modifier.fillMaxWidth().height(48.dp))
        Row(Modifier.fillMaxWidth().weight(1f)) {
            CueKey(deck, model, Modifier.weight(1f).fillMaxHeight())
            Key("${deck.id} ${if (deck.playing) "Ⅱ" else "▶"}", Modifier.weight(1f).fillMaxHeight(), Palette.success, deck.playing) { deck.playToggle() }
            if (dense) Key("±", Modifier.width(48.dp).fillMaxHeight(), identityColor(deck.id), description = "${deck.id} pitch drawer") { model.openDrawer("PITCH", deck.id) }
            Key("LOAD", Modifier.width(48.dp).fillMaxHeight(), Palette.yellow, description = "${deck.id} browse tracks") { model.browse(); model.loadTarget = deck.id }
        }
    }
}

@Composable private fun Footer(model: DjModel, modifier: Modifier, selected: Boolean = false, wide: Boolean = false) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (deck in if (selected) listOf(model.selected) else model.decks.values.toList()) Column(Modifier.weight(1f).fillMaxHeight()) {
            if (wide) {
                Jump(deck, model, Modifier.fillMaxWidth().height(48.dp))
                Row(Modifier.fillMaxWidth().weight(1f)) {
                    CueKey(deck, model, Modifier.width(64.dp).fillMaxHeight())
                    Key("${deck.id} ${if (deck.playing) "Ⅱ" else "▶"}", Modifier.width(64.dp).fillMaxHeight(), Palette.success, deck.playing) { deck.playToggle() }
                    BendStrip(deck, model, Modifier.weight(1f).fillMaxHeight())
                    Key("±", Modifier.width(48.dp).fillMaxHeight(), identityColor(deck.id), description = "${deck.id} pitch drawer") { model.openDrawer("PITCH", deck.id) }
                    Key("LOAD", Modifier.width(48.dp).fillMaxHeight(), Palette.yellow, description = "${deck.id} browse tracks") { model.browse(); model.loadTarget = deck.id }
                }
            } else {
            Row(Modifier.fillMaxWidth().height(48.dp)) {
                BendStrip(deck, model, Modifier.weight(1f).fillMaxHeight())
                if (selected) Key("${"%+.1f".format((deck.tempo / deck.bpm - 1) * 100)}%", Modifier.width(72.dp).fillMaxHeight(), identityColor(deck.id), description = "${deck.id} pitch drawer") { model.openDrawer("PITCH", deck.id) }
            }
            Transport(deck, model, Modifier.fillMaxWidth().weight(1f))
            }
        }
    }
}

@Composable private fun Pads(deck: Deck, model: DjModel, modifier: Modifier, columns: Int = 4) {
    Column(modifier.border(2.dp, identityColor(deck.id).copy(alpha = if (model.active == deck.id) 1f else .4f))) {
        repeat(8 / columns) { row -> Row(Modifier.weight(1f).fillMaxWidth()) { repeat(columns) { col -> Hotcue(deck, row * columns + col, model, Modifier.weight(1f).fillMaxHeight()) } } }
    }
}

@Composable private fun Hotcue(deck: Deck, slot: Int, model: DjModel, modifier: Modifier) {
    var pressed by remember { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    val glow by animateFloatAsState(if (pressed) .5f else .06f, tween(if (pressed) 0 else 120), label = "cue release")
    Box(modifier.border(1.5.dp, Palette.cues[slot]).background(Palette.cues[slot].copy(alpha = glow)).semantics { contentDescription = "${deck.id} hotcue ${slot + 1}"; onClick { deck.hotCueDown(slot); deck.hotCueUp(slot); true } }.pointerInput(deck, slot) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val owner = "${deck.id} HOTCUE $slot"
            down.consume(); model.beginTouch(owner); pressed = true; deck.hotCueDown(slot)
            haptic.performHapticFeedback(HapticFeedbackType.VirtualKey)
            var cancelled = false
            try { while (true) { val own = awaitPointerEvent().changes.firstOrNull { it.id == down.id }; if (own == null || (!own.pressed && own.isConsumed)) cancelled = true; if (own?.pressed != true) break } }
            catch (cancel: CancellationException) { cancelled = true; throw cancel }
            finally { deck.hotCueUp(slot); pressed = false; model.releaseTouch(owner, cancelled) }
        }
    }, contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Label("${slot + 1}", color = Palette.cues[slot], size = 16, bold = true); Label(cueNames[slot], color = Palette.cues[slot], size = 10) } }
}

private val loopChoices = listOf(.125f, .25f, .5f, 1f, 2f, 4f, 8f, 16f, 32f, 64f, 128f)
private fun beatText(value: Float) = when (value) { .125f -> "⅛"; .25f -> "¼"; .5f -> "½"; else -> value.toInt().toString() }
@Composable private fun Loops(deck: Deck, model: DjModel, modifier: Modifier) {
    Row(modifier) {
        Key("½", Modifier.width(48.dp).fillMaxHeight(), description = "${deck.id} halve loop") { deck.resizeLoop(.5) }
        ValueWheel("${deck.id} loop size", loopChoices.map(::beatText), loopChoices.indexOf(deck.loopBeats), { deck.setLoopLength(loopChoices[it]) }, model, Modifier.weight(1f).fillMaxHeight(), if (deck.loopOn) Palette.success else identityColor(deck.id), "L ${beatText(deck.loopBeats)}", onTap = deck::toggleLoop)
        Key("×2", Modifier.width(48.dp).fillMaxHeight(), description = "${deck.id} double loop") { deck.resizeLoop(2.0) }
    }
}

@Composable private fun FxControls(model: DjModel, modifier: Modifier, horizontal: Boolean = false) {
    val fx = model.fx
    val effects = listOf("—", "ECHO", "REVERB", "FLANGER")
    @Composable fun Effect(mod: Modifier) { ValueWheel("FX effect", effects, effects.indexOf(fx.effect), { fx.effect = effects[it]; if (fx.effect == "—") fx.on = false }, model, mod, Palette.accent) }
    @Composable fun Gate(mod: Modifier) { Key(if (fx.on) "FX ON" else "FX OFF", mod, Palette.success, fx.on) { if (fx.effect != "—") fx.on = !fx.on } }
    @Composable fun Length(mod: Modifier) {
        if (fx.effect == "REVERB") Box(mod, contentAlignment = Alignment.Center) { Label("∞", size = 20) }
        else ValueWheel("FX length", fx.lengths, fx.lengthIndex, { fx.lengthIndex = it }, model, mod, Palette.accent, "${fx.lengths[fx.lengthIndex]}${if (fx.effect == "FLANGER") "bar" else "bt"}")
    }
    @Composable fun Depth(mod: Modifier) { RelativeTile("DEPTH", fx.depth, { fx.depth = it }, model, mod, neutral = 0f, owner = "FX") }
    @Composable fun Route(mod: Modifier) { Key("→ ${fx.target}", mod, identityColor(fx.target), description = "FX routing") { model.openDrawer("FX ROUTE") } }
    if (horizontal) Row(modifier) { Gate(Modifier.width(56.dp).fillMaxHeight()); Effect(Modifier.weight(1f).fillMaxHeight()); Length(Modifier.width(56.dp).fillMaxHeight()); Depth(Modifier.width(48.dp).fillMaxHeight()); Route(Modifier.width(64.dp).fillMaxHeight()) }
    else Column(modifier) {
        Row(Modifier.weight(1f).fillMaxWidth()) { Effect(Modifier.weight(1f).fillMaxHeight()); Gate(Modifier.width(64.dp).fillMaxHeight()) }
        Length(Modifier.fillMaxWidth().weight(1f))
        Row(Modifier.weight(1f).fillMaxWidth()) { Depth(Modifier.width(56.dp).fillMaxHeight()); Route(Modifier.weight(1f).fillMaxHeight()) }
    }
}

@Composable private fun Knobs(deck: Deck, model: DjModel, modifier: Modifier, trim: Boolean = true) {
    Column(modifier) {
        if (trim) RelativeTile("TRIM", deck.trim, { deck.trim = it }, model, Modifier.weight(1f).fillMaxWidth(), owner = deck.id)
        RelativeTile("HIGH", deck.high, { deck.high = it }, model, Modifier.weight(1f).fillMaxWidth(), owner = deck.id)
        RelativeTile("MID", deck.mid, { deck.mid = it }, model, Modifier.weight(1f).fillMaxWidth(), owner = deck.id)
        RelativeTile("LOW", deck.low, { deck.low = it }, model, Modifier.weight(1f).fillMaxWidth(), owner = deck.id)
        RelativeTile("FILTER", deck.filter, deck::updateFilter, model, Modifier.weight(1f).fillMaxWidth(), owner = deck.id)
    }
}
@Composable private fun Volume(deck: Deck, model: DjModel, modifier: Modifier) { RelativeTile("VOL", deck.gain, deck::updateGain, model, modifier, neutral = 1f, owner = deck.id) }

@Composable private fun Mixer(model: DjModel, modifier: Modifier, selected: Boolean = false, compact: Boolean = false) {
    Column(modifier) {
        Row(Modifier.weight(1f).fillMaxWidth()) {
            Knobs(model.a, model, Modifier.width(48.dp).fillMaxHeight(), !selected || !compact)
            Volume(model.a, model, Modifier.width(48.dp).fillMaxHeight())
            if (selected) Column(Modifier.weight(1f).fillMaxHeight()) { TrackWave(model.selected, model, Modifier.fillMaxWidth().height(48.dp)); FxControls(model, Modifier.weight(1f).fillMaxWidth()) }
            else Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) { Label("A  MIX  B", color = Palette.muted, size = 12, bold = true) }
            Volume(model.b, model, Modifier.width(48.dp).fillMaxHeight())
            Knobs(model.b, model, Modifier.width(48.dp).fillMaxHeight(), !selected || !compact)
        }
        RelativeTile("XF", model.cross, model::updateCross, model, Modifier.fillMaxWidth().height(48.dp), horizontal = true, owner = "MASTER")
    }
}

@Composable private fun Workspace(model: DjModel, modifier: Modifier, landscape: Boolean) {
    Column(modifier) {
        Row(Modifier.fillMaxWidth().height(48.dp)) { for (tab in listOf("PADS", "MIX", "LOOP", "FX")) Key(tab, Modifier.weight(1f).fillMaxHeight(), Palette.accent, model.bank == tab) { model.chooseBank(tab) } }
        when (model.bank) {
            "MIX" -> if (landscape) Column(Modifier.weight(1f).fillMaxWidth()) { Label("VERTICAL MIXER · USE DENSE LANDSCAPE", color = Palette.muted, lines = 2); Key("03 / DENSE", Modifier.fillMaxWidth().height(48.dp), Palette.accent) { model.chooseVariant(2) } } else Mixer(model, Modifier.weight(1f).fillMaxWidth())
            "FX" -> FxControls(model, Modifier.weight(1f).fillMaxWidth(), landscape)
            else -> Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (deck in model.decks.values) Column(Modifier.weight(1f).fillMaxHeight()) {
                    Pads(deck, model, Modifier.fillMaxWidth().weight(1f), if (landscape) 4 else 2)
                    if (!landscape) Loops(deck, model, Modifier.fillMaxWidth().height(48.dp))
                    if (!landscape) Key("${deck.id} PITCH ${"%+.1f".format((deck.tempo / deck.bpm - 1) * 100)}% / SYNC", Modifier.fillMaxWidth().height(48.dp), identityColor(deck.id), description = "${deck.id} pitch drawer") { model.openDrawer("PITCH", deck.id) }
                }
            }
        }
    }
}

@Composable private fun Dense(model: DjModel, modifier: Modifier) {
    Row(modifier) {
        for (part in 0..2) {
            if (part == 1) Column(Modifier.width(312.dp).fillMaxHeight().padding(horizontal = 4.dp)) {
                Row(Modifier.weight(1f).fillMaxWidth()) {
                    Knobs(model.a, model, Modifier.width(48.dp).fillMaxHeight()); Volume(model.a, model, Modifier.width(48.dp).fillMaxHeight())
                    Column(Modifier.weight(1f).fillMaxHeight()) {
                        Row(Modifier.weight(1f).fillMaxWidth()) { for (deck in model.decks.values) TrackWave(deck, model, Modifier.weight(1f).fillMaxHeight(), vertical = true) }
                        RelativeTile("XF", model.cross, model::updateCross, model, Modifier.fillMaxWidth().height(48.dp), horizontal = true, owner = "MASTER")
                    }
                    Volume(model.b, model, Modifier.width(48.dp).fillMaxHeight()); Knobs(model.b, model, Modifier.width(48.dp).fillMaxHeight())
                }
                FxControls(model, Modifier.fillMaxWidth().height(48.dp), true)
            } else {
                val deck = if (part == 0) model.a else model.b
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    Pads(deck, model, Modifier.weight(1f).fillMaxWidth())
                    Loops(deck, model, Modifier.fillMaxWidth().height(48.dp))
                    BendStrip(deck, model, Modifier.fillMaxWidth().height(48.dp))
                    Transport(deck, model, Modifier.fillMaxWidth().height(96.dp), true)
                }
            }
        }
    }
}

@Composable private fun Browser(model: DjModel, modifier: Modifier) {
    Column(modifier.background(Palette.base).border(2.dp, identityColor(model.loadTarget)).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}.padding(6.dp)) {
        Row(Modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) {
            Label("${model.loadTarget} LOAD", Modifier.weight(1f), identityColor(model.loadTarget), 20, true)
            for (id in model.decks.keys) Key(id, Modifier.size(48.dp), identityColor(id), model.loadTarget == id) { model.loadTarget = id; model.pendingTrack = null }
            Key("×", Modifier.size(48.dp)) { model.browsing = false; model.pendingTrack = null }
        }
        val pending = model.pendingTrack
        if (pending != null) {
            Label("${model.loadTarget} IS PLAYING", color = Palette.yellow, size = 18, bold = true)
            Label("Replace with ${pending.title}?", lines = 2)
            Row(Modifier.fillMaxWidth().height(48.dp)) { Key("KEEP PLAYING", Modifier.weight(1f).fillMaxHeight(), Palette.success) { model.pendingTrack = null }; Key("REPLACE ${model.loadTarget}", Modifier.weight(1f).fillMaxHeight(), Palette.yellow) { model.confirmLoad() } }
        } else Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            for (track in demoTracks) Column(Modifier.fillMaxWidth().height(64.dp).border(1.dp, Palette.surface).clickable { model.requestLoad(track) }.semantics { contentDescription = "Load ${track.title}" }.padding(6.dp)) {
                Label(track.title, size = 16, bold = true); Label("${track.artist} · ${track.bpm} BPM · ${track.key} · ${trackClock(track.duration)}", color = Palette.muted, size = 12)
            }
        }
    }
}

@Composable private fun Drawer(model: DjModel, modifier: Modifier) {
    val deck = model.decks.getValue(model.drawerDeck)
    val color = if (model.drawer == "FX ROUTE") identityColor(model.fx.target) else identityColor(deck.id)
    @Composable fun SyncControls(mod: Modifier) {
        Row(mod) {
            Key("SYNC", Modifier.weight(1f).fillMaxHeight(), color) { model.decks.values.firstOrNull { it.id != deck.id }?.let { peer -> deck.updateTempo(peer.tempo); deck.seek(floor(deck.positionSeconds * deck.bpm / 60) * 60 / deck.bpm + (peer.positionSeconds * peer.bpm / 60 % 1) * 60 / deck.bpm) } }
            Key("MATCH BPM", Modifier.weight(1f).fillMaxHeight(), color) { model.decks.values.firstOrNull { it.id != deck.id }?.let { deck.updateTempo(it.tempo) } }
            RelativeTile("TRIM", deck.trim, { deck.trim = it }, model, Modifier.width(64.dp).fillMaxHeight(), owner = deck.id)
        }
    }
    BoxWithConstraints(modifier.background(Palette.base).border(2.dp, color).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}) {
    val short = maxHeight < 280.dp
    Column(Modifier.fillMaxSize().padding(8.dp)) {
        Row(Modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) {
            Label(if (model.drawer == "FX ROUTE") "FX → ${model.fx.target}" else "${deck.id} / PITCH + SYNC", Modifier.weight(1f), color, 20, true)
            Key("CLOSE", Modifier.width(64.dp).fillMaxHeight()) { model.closeDrawer() }
        }
        if (model.drawer == "FX ROUTE") {
            Label("ONE BEAT FX SECTION", color = Palette.muted, size = 14)
            Row(Modifier.fillMaxWidth().height(56.dp)) { for (id in model.decks.keys + "MASTER") Key(id, Modifier.weight(1f).fillMaxHeight(), identityColor(id), model.fx.target == id) { model.routeFx(id) } }
            if (!short) FxControls(model, Modifier.fillMaxWidth().weight(1f))
        } else {
            if (short) Row(Modifier.fillMaxWidth().weight(1f)) {
                Column(Modifier.weight(1f).fillMaxHeight()) { Label("${"%.1f".format(deck.tempo)} BPM  ${"%+.1f".format((deck.tempo / deck.bpm - 1) * 100)}%", color = color, size = 22, bold = true); Pitch(deck, model, Modifier.fillMaxWidth().weight(1f)) }
                SyncControls(Modifier.weight(1f).height(56.dp))
            } else {
                Label("${"%.1f".format(deck.tempo)} BPM   ${"%+.1f".format((deck.tempo / deck.bpm - 1) * 100)}%", color = color, size = 26, bold = true)
                Pitch(deck, model, Modifier.fillMaxWidth().height(64.dp))
                SyncControls(Modifier.fillMaxWidth().height(56.dp))
                Label("±8% · Rail follows finger · TRIM center −6dB", color = Palette.muted, size = 12, lines = 2)
            }
        }
    }
    }
}

@Composable private fun PrecisionOverlay(model: DjModel, precision: Precision) {
    val density = LocalDensity.current
    val reveal = remember(precision.label) { Animatable(0f) }
    LaunchedEffect(precision.label) { reveal.animateTo(1f, tween(140)) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val y = with(density) { (precision.fingerY.toDp() - 140.dp).coerceIn(4.dp, (maxHeight - 124.dp).coerceAtLeast(4.dp)) }
        val color = identityColor(precision.label.substringBefore(" /"))
        Row(Modifier.align(Alignment.TopCenter).offset(y = y).widthIn(max = 320.dp).fillMaxWidth().height(112.dp).graphicsLayer { alpha = reveal.value; scaleX = .96f + .04f * reveal.value; scaleY = scaleX }.background(Palette.base).border(2.dp, color).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Label(precision.label, color = color, size = 16, bold = true); Label("${"%.1f".format(precision.value * 100)}% · FINE", size = 20, bold = true); Key("RESET", Modifier.height(40.dp).fillMaxWidth(), color) { model.resetPrecision(precision.label) } }
            Canvas(Modifier.size(80.dp)) {
                val c = center; val r = size.minDimension * .4f
                drawArc(Palette.surface, 135f, 270f, false, c - Offset(r, r), Size(r * 2, r * 2), style = Stroke(3.dp.toPx()))
                drawArc(color, 135f, precision.value * 270, false, c - Offset(r, r), Size(r * 2, r * 2), style = Stroke(3.dp.toPx()))
                val a = Math.toRadians((135 + precision.value * 270).toDouble())
                drawLine(color, c, c + Offset(cos(a).toFloat(), sin(a).toFloat()) * r * .8f, 3.dp.toPx())
            }
        }
    }
}

@Composable fun PhonePerformance(model: DjModel) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val running = model.decks.values.any { it.running }
    LaunchedEffect(model, lifecycle, running) {
        if (!running) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var last = withFrameNanos { it }
            while (true) { val now = withFrameNanos { it }; model.decks.values.forEach { it.advance((now - last) / 1_000_000_000.0) }; last = now }
        }
    }
    // Immersive transport fills the bottom edge. Only a real cutout consumes layout space.
    BoxWithConstraints(Modifier.fillMaxSize().background(Palette.base).windowInsetsPadding(WindowInsets.displayCutout)) {
        val landscape = maxWidth > maxHeight
        val compact = maxHeight < 740.dp
        val dense = model.variant == 2 && landscape && maxWidth >= 760.dp && maxHeight >= 360.dp
        Column(Modifier.fillMaxSize().padding(horizontal = 4.dp)) {
            if (!dense) Header(model)
            Row(Modifier.fillMaxWidth().height(if (dense || landscape) 72.dp else 88.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) { for (deck in model.decks.values) TrackOverview(deck, model, Modifier.weight(1f).fillMaxHeight(), dense || landscape, dense && deck.id == "A") }
            if (dense) Box(Modifier.weight(1f).fillMaxWidth()) {
                Dense(model, Modifier.fillMaxSize())
                if (model.browsing) Browser(model, Modifier.fillMaxSize().padding(bottom = 96.dp))
                if (model.drawer != null) Drawer(model, Modifier.fillMaxSize().padding(bottom = 96.dp))
            } else {
                if (model.variant == 0 && !landscape) Row(Modifier.fillMaxWidth().height(48.dp)) { for (deck in model.decks.values) TrackWave(deck, model, Modifier.weight(1f).fillMaxHeight()) }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    when (model.variant) {
                        0 -> Workspace(model, Modifier.fillMaxSize(), landscape)
                        1 -> if (!landscape) Column(Modifier.fillMaxSize()) {
                            Mixer(model, Modifier.fillMaxWidth().height(if (compact) 240.dp else 288.dp), true, compact)
                            Pads(model.selected, model, Modifier.weight(1f).fillMaxWidth())
                            Loops(model.selected, model, Modifier.fillMaxWidth().height(48.dp))
                        } else Column(Modifier.fillMaxSize()) { Label("02 MIXER · ROTATE TO PORTRAIT", color = identityColor(model.active), size = 16); Key("03 / DENSE LANDSCAPE", Modifier.fillMaxWidth().height(48.dp), Palette.accent) { model.chooseVariant(2) }; TrackWave(model.selected, model, Modifier.weight(1f).fillMaxWidth()) }
                        else -> Column(Modifier.fillMaxSize()) {
                            Label("DENSE NEEDS 760×360dp · ROTATE", color = Palette.yellow, size = 16, lines = 2)
                            Row(Modifier.fillMaxWidth().height(48.dp)) { Key("01 WORKSPACE", Modifier.weight(1f).fillMaxHeight(), Palette.cyan) { model.chooseVariant(0) }; Key("02 MIXER", Modifier.weight(1f).fillMaxHeight(), Palette.pink) { model.chooseVariant(1) } }
                        }
                    }
                    if (model.browsing) Browser(model, Modifier.fillMaxSize())
                    if (model.drawer != null) Drawer(model, Modifier.fillMaxSize())
                }
                Footer(model, Modifier.fillMaxWidth().height(if (landscape) 96.dp else 144.dp), model.variant == 1, landscape)
            }
        }
        model.precision.values.firstOrNull()?.let { PrecisionOverlay(model, it) }
        WheelOverlays(model)
        if (model.info) Column(Modifier.fillMaxSize().background(Palette.base).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Key("CLOSE INFO", Modifier.fillMaxWidth().height(48.dp), Palette.accent) { model.info = false }
            Label("ITERATION 3 / NATIVE", size = 24, bold = true)
            Label("Fake analysis + visual clock; no audio. Desktop additive RGB bands, grid/cue markers, minimap seek and detail-wave scratch. Bend is momentary rate, not pitch or seek. Release/cancel clears it.", size = 16, lines = 8)
            Label("Rotary knobs: relative drag, double-tap reset, center notch; hold for fine. Full faders: grab thumb or drag rail directly, no fine popup. EQ .5 is unity/0dB; filter .5 bypass; trim .5 is −6dB; FX depth resets dry.", size = 16, lines = 8)
            Label("Hold beat/loop value, slide sideways, lift to commit. Paused hotcues preview while held; PLAY takes over. One central Beat FX routes to A/B/MASTER. Pitch/SYNC is a quick panel. Headphone cue and real DSP are not implemented.", size = 16, lines = 8)
        }
    }
}
