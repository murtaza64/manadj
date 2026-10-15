package dev.manadj.app.session

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.manadj.app.*
import dev.manadj.audio.DeckId
import dev.manadj.library.session.DECKS
import dev.manadj.library.session.SessionLog
import dev.manadj.library.session.SessionState

/**
 * Replay deck strips (#378 SH2–SH5), performance-view style: each deck's detail waveform runs edge to edge
 * (strips adjacent), with deck letter + track info, read-only mini mixer and Beat FX as overlays, and a
 * minimap whose played part is dimmed. Everything follows the replay reference (the Session log), which the
 * engine matches sample-exactly, so strips draw before a track is even loaded.
 */
@Composable fun ReplayDeckStack(lanes: IntArray, model: SessionModel, player: PlayerModel, ux: UiModel, log: SessionLog, frame: SessionState, modifier: Modifier) {
    Column(modifier.testTag("session-decks")) {
        for ((i, d) in lanes.withIndex()) {
            if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.surface0))
            ReplayDeckStrip(d, model, player, ux, log, frame, Modifier.fillMaxWidth().weight(1f))
        }
    }
}

/** Reference strip modulation (desktop timeline/performance: EQ band gains × trim·fader·crossfader; filter thins its side). */
private fun replayStrip(s: SessionState, d: Int): Strip {
    val deck = s.decks[d]
    val f = deck.filter.coerceIn(-1.0, 1.0).toFloat()
    val lpf = (-f).coerceAtLeast(0f); val hpf = f.coerceAtLeast(0f)
    val gain = trimToRelativeGain(deck.trim) * deck.fader.coerceIn(0.0, 1.0).toFloat() * s.crossfaderGain(d).toFloat()
    return Strip(gain, eqValueToGain(deck.low) * (1 - hpf), eqValueToGain(deck.mid) * (1 - .6f * (lpf + hpf)), eqValueToGain(deck.high) * (1 - lpf), deck.stems)
}

@Composable private fun ReplayDeckStrip(d: Int, model: SessionModel, player: PlayerModel, ux: UiModel, log: SessionLog, frame: SessionState, modifier: Modifier) {
    val v = deckView(d, model, player, ux, frame)
    val color = deckColor(DeckId.entries[d])
    val s = frame.decks[d]
    val wave = s.trackId?.let { model.waves[it]?.data }
    val duration = v.track?.durationSecs ?: wave?.duration
    val ref = s.copy()
    // Heard position: the reference deck extrapolated to the display clock, minus the output latency while playing.
    val position = {
        val out = if (model.playing) player.output else null
        ref.playheadAt(model.displayTime - (out?.reportedLatencySeconds() ?: 0.0))
    }
    val strip = remember(frame, d) { replayStrip(frame, d) }
    val tempo = v.track?.grid?.tempoChanges?.firstOrNull()
    val marks = WaveMarks(null, emptyList(), s.loop?.let { it.start..it.end }, tempo?.bpm ?: v.track?.bpm ?: s.bpm, tempo?.startTime ?: 0.0)
    BoxWithConstraints(modifier.testTag("session-deck-${DECKS[d]}").semantics { contentDescription = "Deck ${DECKS[d]}: ${v.track?.title ?: "empty"}, ${v.status}" }) {
        Column(Modifier.fillMaxSize()) {
            if (s.trackId == null) Box(Modifier.fillMaxWidth().weight(1f).background(Ink.background))
            else WaveView(wave, position, duration, marks, Modifier.fillMaxWidth().weight(1f), windowSeconds = 8.0 * s.rate, playheadAt = .35f,
                live = { strip }, accent = color, status = if (wave == null) "no waveform" else null)
            if (s.trackId != null) WaveView(wave, position, duration, WaveMarks(null, emptyList()), Modifier.fillMaxWidth().height(12.dp), overview = true, accent = color)
        }
        // Audible: deck-coloured edge (the strip's letter column is gone).
        Box(Modifier.align(Alignment.CenterStart).width(3.dp).fillMaxHeight().background(if (v.audible) color else color.copy(alpha = .2f)))
        DeckInfoOverlay(d, v, frame, color, Modifier.align(Alignment.TopStart).padding(start = 6.dp, top = 2.dp).widthIn(max = 330.dp))
        // Narrow (portrait): overlays sit over the played side, left of the playhead, so what is coming stays clear.
        // Wide (landscape): the mixer takes the far end, the info the played side.
        val wide = maxWidth > 560.dp
        if (s.trackId != null) MiniMixer(frame, d, color, if (wide) Modifier.align(Alignment.CenterEnd).padding(end = 6.dp, bottom = 10.dp) else Modifier.align(Alignment.BottomStart).padding(start = 6.dp, bottom = 14.dp))
        BeatFxOverlay(frame, d, if (wide) Modifier.align(Alignment.BottomStart).padding(start = 8.dp, bottom = 14.dp) else Modifier.align(Alignment.TopEnd).padding(end = 6.dp, top = 3.dp))
    }
}

@Composable private fun DeckInfoOverlay(d: Int, v: DeckView, frame: SessionState, color: Color, modifier: Modifier) {
    val s = frame.decks[d]
    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(DECKS[d], Modifier.padding(end = 6.dp), if (s.trackId == null) Ink.surface2 else color, 18, true)
            Column(Modifier.background(Color.Black.copy(alpha = .55f), RoundedCornerShape(3.dp)).padding(horizontal = 4.dp, vertical = 1.dp)) {
                Text(v.track?.title ?: s.trackId?.let { "Track #$it (not in Library)" } ?: "—", color = if (v.audible) Ink.text else Ink.muted, size = 12, bold = true)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    v.track?.artist?.let { Text("$it  ", Modifier.weightIfRoom(), Ink.muted, 10) }
                    Text(v.meta, color = Ink.muted, size = 10)
                    Text("  ${v.status}", color = if (v.status == "FAILED") Ink.pending else color, size = 9, bold = true)
                }
            }
        }
    }
}

private fun Modifier.weightIfRoom() = this.widthIn(max = 160.dp)

/** Read-only mini mixer: TRIM · HI · MID · LOW · FILTER knobs (desktop knob visuals) and the channel fader. */
@Composable private fun MiniMixer(frame: SessionState, d: Int, color: Color, modifier: Modifier) {
    val deck = frame.decks[d]
    val knob = 17.dp
    Row(modifier.background(Color.Black.copy(alpha = .6f), RoundedCornerShape(4.dp)).padding(horizontal = 3.dp, vertical = 1.dp).testTag("session-mixer-${DECKS[d]}"),
        horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        for ((label, kind, value) in listOf(Triple("TRM", KnobKind.TRIM, deck.trim), Triple("HI", KnobKind.EQ_HIGH, deck.high), Triple("MID", KnobKind.EQ_MID, deck.mid),
            Triple("LOW", KnobKind.EQ_LOW, deck.low), Triple("FLT", KnobKind.FILTER, (deck.filter + 1) / 2))) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Canvas(Modifier.size(knob)) { drawKnob(kind, value, size.minDimension / 2, true) }
                Text(label, color = Ink.muted, size = 7)
            }
        }
        MiniFader(deck.fader, color, Modifier.size(12.dp, knob + 8.dp))
    }
}

@Composable fun MiniFader(value: Double, color: Color, modifier: Modifier, horizontal: Boolean = false) {
    Canvas(modifier) { drawMiniFader(value.toFloat().coerceIn(0f, 1f), color, horizontal) }
}

private fun DrawScope.drawMiniFader(v: Float, color: Color, horizontal: Boolean) {
    val pad = 3.dp.toPx()
    val rail = 3.dp.toPx()
    if (horizontal) {
        val y = size.height / 2
        drawLine(Ink.surface, Offset(pad, y), Offset(size.width - pad, y), rail, StrokeCap.Round)
        drawLine(Ink.muted, Offset(size.width / 2, y - 4.dp.toPx()), Offset(size.width / 2, y + 4.dp.toPx()), 1f)
        val x = pad + (size.width - 2 * pad) * v
        drawRect(Ink.crust, Offset(x - 5.dp.toPx(), y - 5.dp.toPx()), Size(10.dp.toPx(), 10.dp.toPx()))
        drawRect(color, Offset(x - 5.dp.toPx(), y - 5.dp.toPx()), Size(10.dp.toPx(), 10.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(1.5f))
        drawLine(color, Offset(x, y - 3.dp.toPx()), Offset(x, y + 3.dp.toPx()), 1.5f)
    } else {
        val x = size.width / 2
        val top = pad; val bottom = size.height - pad
        val y = bottom - (bottom - top) * v
        drawLine(Ink.surface, Offset(x, top), Offset(x, bottom), rail, StrokeCap.Round)
        drawLine(color.copy(alpha = .35f + .5f * v), Offset(x, y), Offset(x, bottom), rail, StrokeCap.Round)
        drawRect(Ink.crust, Offset(x - 5.dp.toPx(), y - 2.5.dp.toPx()), Size(10.dp.toPx(), 5.dp.toPx()))
        drawRect(color, Offset(x - 5.dp.toPx(), y - 2.5.dp.toPx()), Size(10.dp.toPx(), 5.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(1.5f))
    }
}

/** Beat FX on this deck (desktop target semantics: a deck target, or Master = every deck), with beats/depth and on state. */
@Composable private fun BeatFxOverlay(frame: SessionState, d: Int, modifier: Modifier) {
    val fx = frame.beatFx ?: return
    val effect = fx.selected ?: return
    val target = fx.target.uppercase()
    val master = target != "A" && target != "B" && target != "C" && target != "D"
    if (!master && target != DECKS[d]) return
    if (master && frame.decks[d].trackId == null) return
    val on = fx.on || d in fx.held
    val c = fxColor(effect)
    Row(modifier.clip(RoundedCornerShape(3.dp)).background(if (on) c.copy(alpha = .28f) else Color.Black.copy(alpha = .6f))
        .border(1.dp, if (on) c else c.copy(alpha = .4f), RoundedCornerShape(3.dp)).padding(horizontal = 5.dp, vertical = 1.dp).testTag("session-fx-${DECKS[d]}"),
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(fxShort(effect), color = if (on) c else c.copy(alpha = .6f), size = 10, bold = true)
        Text(if (effect == "reverb") "∞" else "${beatText(fx.beats)} ${if (effect == "flanger") "BAR" else "BT"}", color = Ink.text, size = 9)
        Text("%d%%".format((fx.depth.coerceIn(-1.0, 1.0) * 100).toInt()), color = Ink.muted, size = 9)
        Text(if (on) "ON" else "OFF", color = if (on) c else Ink.muted, size = 9, bold = true)
        if (master) Text("MST", color = Ink.muted, size = 8)
    }
}

/** The one global crossfader (read-only), with the Session's crossfader-enable state. */
@Composable fun ReplayCrossfader(frame: SessionState, modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        MiniFader((frame.crossfader.coerceIn(-1.0, 1.0) + 1) / 2, if (frame.crossfaderEnabled) Ink.accent else Ink.surface2, Modifier.fillMaxWidth().height(16.dp), horizontal = true)
        Text(if (frame.crossfaderEnabled) "XF" else "XF OFF", color = Ink.muted, size = 8)
    }
}
