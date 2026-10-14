package dev.manadj.app

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.manadj.audio.*

/** TRIM / HIGH / MID / LOW / FILTER column + headphone cue. TRIM and PFL are engine-backed; EQ/filter pending. */
@Composable fun KnobColumn(ui: DeckUi, ux: UiModel, model: PlayerModel, modifier: Modifier, knob: Dp = 38.dp) {
    val e = ux.extras.getValue(ui.id)
    val eq = model.supports("eq"); val filter = model.supports("filter")
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.SpaceEvenly) {
        Knob("TRIM", KnobKind.TRIM, ui.trim, ux, model, ui.id, Modifier.weight(1f), model.supports("trim"), knob * .82f) { v, id -> model.updateTrim(ui.id, v, id) }
        // Engine-backed when supported (ui.eq / ui.filter, filter -1..1); otherwise preview-only UI values.
        Knob("HI", KnobKind.EQ_HIGH, if (eq) ui.eq[2] else e.eqHigh, ux, model, ui.id, Modifier.weight(1f), eq, knob) { v, id -> if (eq) model.updateEq(ui.id, 2, v, id) else e.eqHigh = v }
        Knob("MID", KnobKind.EQ_MID, if (eq) ui.eq[1] else e.eqMid, ux, model, ui.id, Modifier.weight(1f), eq, knob) { v, id -> if (eq) model.updateEq(ui.id, 1, v, id) else e.eqMid = v }
        Knob("LOW", KnobKind.EQ_LOW, if (eq) ui.eq[0] else e.eqLow, ux, model, ui.id, Modifier.weight(1f), eq, knob) { v, id -> if (eq) model.updateEq(ui.id, 0, v, id) else e.eqLow = v }
        Knob("FILTER", KnobKind.FILTER, if (filter) (ui.filter + 1) / 2 else e.filter, ux, model, ui.id, Modifier.weight(1f), filter, knob) { v, id -> if (filter) model.updateFilter(ui.id, v * 2 - 1, id) else e.filter = v }
        Key("", Modifier.fillMaxWidth().height(36.dp), deckColor(ui.id), model.supports("pfl"), ui.snapshot?.pfl == true, "${ui.id} headphone cue", Glyph.Headphones, KeyStyle.PILL, textSize = 13) { model.togglePfl(ui.id) }
    }
}

@Composable fun ChannelFader(ui: DeckUi, model: PlayerModel, modifier: Modifier) {
    PhysicalFader("VOL", ui.fader, model, ui.id, modifier, model.supports("fader")) { value, id -> model.updateFader(ui.id, value, id) }
}

@Composable fun Crossfader(model: PlayerModel, ux: UiModel, modifier: Modifier) {
    if (!ux.crossfaderEnabled) { Box(modifier, contentAlignment = Alignment.Center) { Text("XF OFF · SETTINGS", color = Ink.muted, size = 10) }; return }
    PhysicalFader("XF", model.crossfade, model, DeckId.A, modifier, model.supports("crossfade"), horizontal = true, doubleTapCenter = true) { value, id -> model.updateCrossfade(value, id) }
}

/**
 * One central Beat FX section, inline: effect / target / beats are hold-wheels (like jump size), DEPTH a knob,
 * ON a lit pill in the effect's identity color. Audio pending in the engine.
 */
@Composable fun FxSection(ux: UiModel, model: PlayerModel, modifier: Modifier, horizontal: Boolean = false) {
    val fx = ux.fx
    val live = model.supports("beat-fx")
    val usable = live || ux.previewPending
    val tone = Color(fx.effect.color)
    val color = if (usable) tone else Ink.surface2
    val targetColor = when (fx.target) { 0 -> deckColor(DeckId.A); 1 -> deckColor(DeckId.B); else -> Ink.accent }
    @Composable fun Effect(m: Modifier) = ValueWheel("FX effect", FxEffect.entries.map { it.label }, fx.effect.ordinal, ux, model, DeckId.A, m, color, if (horizontal) fx.effect.short else fx.effect.label, Glyph.Fx, live, tagPending = false, onTap = { if (usable) fx.effect = FxEffect.entries[(fx.effect.ordinal + 1) % FxEffect.entries.size] }) { fx.effect = FxEffect.entries[it] }
    @Composable fun Target(m: Modifier) = ValueWheel("FX target", FX_TARGETS, fx.target, ux, model, DeckId.A, m, if (usable) targetColor else Ink.surface2, "→ ${FX_TARGETS[fx.target]}", live = live, tagPending = false, onTap = { if (usable) fx.target = (fx.target + 1) % FX_TARGETS.size }) { fx.target = it }
    @Composable fun Beats(m: Modifier) = ValueWheel("FX beats", FX_BEATS.map(::beatText), fx.beats, ux, model, DeckId.A, m, color, if (fx.effect == FxEffect.REVERB) "∞" else "${beatText(FX_BEATS[fx.beats])} BT", live = live, tagPending = false) { fx.beats = it }
    @Composable fun Depth(m: Modifier) = Knob("DEPTH", KnobKind.FX_DEPTH, fx.depth, ux, model, DeckId.A, m, live, 40.dp, tagPending = false) { v, _ -> fx.depth = v }
    @Composable fun On(m: Modifier) = Key(if (fx.on) "ON" else "OFF", m, color, usable, fx.on && usable, if (fx.on) "FX ON" else "FX OFF", style = KeyStyle.PILL, pulse = if (fx.on && usable) .3f else 0f, textSize = 15) { if (usable) fx.on = !fx.on else ux.pending("Beat FX") }
    val card = Modifier.clip(RoundedCornerShape(10.dp)).background(Brush.verticalGradient(listOf(tone.copy(alpha = if (usable) .10f else .03f), Color.Transparent))).border(1.dp, color.copy(alpha = .35f), RoundedCornerShape(10.dp))
    if (horizontal) Row(modifier.then(card).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        On(Modifier.width(64.dp).fillMaxHeight()); Effect(Modifier.weight(1f).fillMaxHeight()); Target(Modifier.width(72.dp).fillMaxHeight()); Beats(Modifier.width(76.dp).fillMaxHeight()); Depth(Modifier.width(56.dp).fillMaxHeight())
    } else Column(modifier.then(card).padding(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) { Text("BEAT FX", Modifier.weight(1f), color, 11, true); if (!live) PendingTag() }
        Effect(Modifier.fillMaxWidth().height(44.dp))
        Row(Modifier.fillMaxWidth().height(44.dp)) { Target(Modifier.weight(1f).fillMaxHeight()); Beats(Modifier.weight(1f).fillMaxHeight()) }
        Row(Modifier.fillMaxWidth().weight(1f), verticalAlignment = Alignment.CenterVertically) { Depth(Modifier.weight(1f).fillMaxHeight()); On(Modifier.weight(1f).height(52.dp)) }
    }
}
