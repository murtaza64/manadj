package dev.manadj.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.manadj.audio.FilterModel
import dev.manadj.audio.FilterSettings
import kotlin.math.log10
import kotlin.math.pow

private val LABELS = mapOf(
    "resonance" to "Resonance dB", "compensation" to "Compensation", "curve" to "Sweep curve", "deadzone" to "Center deadzone",
    "lpMin" to "LP min Hz", "hpMax" to "HP max Hz", "spread" to "Dual spread", "drive" to "Drive dB", "trim" to "Trim dB", "smoothing" to "Smoothing ms",
)

private fun FilterSettings.get(key: String) = when (key) {
    "resonance" -> resonance; "compensation" -> compensation; "curve" -> curve; "deadzone" -> deadzone; "lpMin" -> lpMin
    "hpMax" -> hpMax; "spread" -> spread; "drive" -> drive; "trim" -> trim; else -> smoothing
}
private fun FilterSettings.with(key: String, v: Double) = when (key) {
    "resonance" -> copy(resonance = v); "compensation" -> copy(compensation = v); "curve" -> copy(curve = v); "deadzone" -> copy(deadzone = v)
    "lpMin" -> copy(lpMin = v); "hpMax" -> copy(hpMax = v); "spread" -> copy(spread = v); "drive" -> copy(drive = v); "trim" -> copy(trim = v)
    else -> copy(smoothing = v)
}

/**
 * Settings › Filter (desktop FilterResponse.tsx / filterSettings.ts): model, parameters, response curves at
 * several knob positions. Edits apply live to the engine and journal through the library so they sync back.
 */
@Composable fun FilterSettingsPanel(model: PlayerModel) {
    val context = LocalContext.current
    val s = model.filterSettings
    val live = model.supports("filter-settings")
    fun edit(next: FilterSettings) {
        model.updateFilterSettings(next)
        runCatching { dev.manadj.app.library.LibraryHolder.editSetting(context, dev.manadj.library.PerformanceSettings.FILTER, org.json.JSONObject(next.toJson())) }
    }
    if (!live) Text("Engine pending: edits apply once the engine supports filter settings.", color = Ink.pending, size = 11, lines = 2)
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (m in FilterModel.entries) Chip(m.label, Ink.accent, s.model == m) { edit(s.copy(model = m)) }
    }
    Text(s.model.description, color = Ink.muted, size = 11, lines = 3)
    FilterResponse(model, s, Modifier.fillMaxWidth().height(120.dp))
    for (key in FilterSettings.KEYS) {
        if (key == "spread" && s.model != FilterModel.DUAL) continue
        if (key == "drive" && s.model == FilterModel.CURRENT) continue
        val (lo, hi, step) = FilterSettings.RANGES.getValue(key)
        val v = s.get(key)
        Row(Modifier.fillMaxWidth().height(36.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(LABELS[key] ?: key, Modifier.weight(1f), Ink.text, 12)
            Key("−", Modifier.size(44.dp, 32.dp), Ink.accent, v > lo, description = "$key down", style = KeyStyle.PILL) { edit(s.with(key, (v - step * stepMul(key)).coerceIn(lo, hi))) }
            Text(if (step >= 1) "%.0f".format(v) else if (step >= .1) "%.1f".format(v) else "%.3f".format(v), Modifier.width(64.dp), Ink.text, 12, true)
            Key("+", Modifier.size(44.dp, 32.dp), Ink.accent, v < hi, description = "$key up", style = KeyStyle.PILL) { edit(s.with(key, (v + step * stepMul(key)).coerceIn(lo, hi))) }
        }
    }
    Key("RESET TO DEFAULTS", Modifier.fillMaxWidth().height(36.dp), Ink.warning, textSize = 11, style = KeyStyle.PILL) { edit(FilterSettings()) }
}

/** Coarser taps for wide ranges (Hz). */
private fun stepMul(key: String) = when (key) { "hpMax" -> 5.0; "lpMin" -> 2.0; else -> 1.0 }

/** Magnitude response (desktop sweepResponseDb) at knob positions −1…+1, log frequency, +12…−36 dB. */
@Composable private fun FilterResponse(model: PlayerModel, s: FilterSettings, modifier: Modifier) {
    val freqs = remember { DoubleArray(96) { 20.0 * 1000.0.pow(it / 95.0) } }
    val positions = listOf(-1.0, -.6, -.3, 0.0, .3, .6, 1.0)
    val curves = remember(s, model.output != null) { positions.map { p -> p to model.filterResponseDb(s, p, freqs) } }
    Canvas(modifier.background(Ink.crust)) {
        fun y(db: Double) = (size.height * ((12 - db.coerceIn(-36.0, 12.0)) / 48)).toFloat()
        for (db in listOf(0.0, -12.0, -24.0)) drawLine(Color.White.copy(alpha = .12f), Offset(0f, y(db)), Offset(size.width, y(db)), 1f)
        for ((p, r) in curves) {
            r ?: continue
            val path = Path()
            r.forEachIndexed { i, db -> val x = (log10(freqs[i] / 20) / 3 * size.width).toFloat(); if (i == 0) path.moveTo(x, y(db)) else path.lineTo(x, y(db)) }
            val c = if (p < 0) Ink.accent else if (p > 0) Ink.warning else Ink.text
            drawPath(path, c.copy(alpha = if (p == 0.0) .9f else .4f + .5f * kotlin.math.abs(p).toFloat()), style = Stroke(1.5.dp.toPx()))
        }
    }
}
