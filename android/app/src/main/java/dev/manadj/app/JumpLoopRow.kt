package dev.manadj.app

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.manadj.audio.*

/** Beat jump + loop keys for one deck (engine-backed; placeholder until the #371 UI port). */
@Composable fun JumpLoopRow(ui: DeckUi, model: PlayerModel, modifier: Modifier) {
    val snap = ui.snapshot
    val ready = ui.ready
    val loop = snap?.loop
    val gridded = snap?.bpm != null
    val color = deckColor(ui.id)
    fun beats(b: Double) = if (b >= 1) "%.0f".format(b) else "1/%.0f".format(1 / b)
    // Narrow decks (portrait) stack jump and loop keys in two rows.
    BoxWithConstraints(modifier) {
        val stacked = maxWidth < 320.dp
        @Composable fun jumps(m: Modifier) = Row(m) {
            Key("◀${beats(ui.jumpBeats)}", Modifier.weight(1.3f).fillMaxHeight(), color, ready && model.supports("beat-jump"), description = "${ui.id} jump back") { model.jump(ui.id, -1) }
            Key("÷", Modifier.weight(.7f).fillMaxHeight(), color, description = "${ui.id} jump size halve") { model.resizeJump(ui.id, .5) }
            Key("×", Modifier.weight(.7f).fillMaxHeight(), color, description = "${ui.id} jump size double") { model.resizeJump(ui.id, 2.0) }
            Key("${beats(ui.jumpBeats)}▶", Modifier.weight(1.3f).fillMaxHeight(), color, ready && model.supports("beat-jump"), description = "${ui.id} jump forward") { model.jump(ui.id, 1) }
        }
        @Composable fun loops(m: Modifier) = Row(m) {
            Key("½", Modifier.weight(1f).fillMaxHeight(), Ink.play, model.supports("loop"), description = "${ui.id} loop halve") { model.resizeLoop(ui.id, LoopChange.HALVE) }
            Key(if (!gridded) "NO BPM" else "⟳${beats(loop?.beats ?: snap.pendingLoopBeats)}", Modifier.weight(1.6f).fillMaxHeight(), Ink.play, ready && gridded && model.supports("loop"), loop != null, "${ui.id} loop") { model.toggleLoop(ui.id) }
            Key("2×", Modifier.weight(1f).fillMaxHeight(), Ink.play, model.supports("loop"), description = "${ui.id} loop double") { model.resizeLoop(ui.id, LoopChange.DOUBLE) }
        }
        if (stacked) Column(Modifier.fillMaxSize()) { jumps(Modifier.weight(1f).fillMaxWidth()); loops(Modifier.weight(1f).fillMaxWidth()) }
        else Row(Modifier.fillMaxSize()) { jumps(Modifier.weight(4f).fillMaxHeight()); loops(Modifier.weight(3f).fillMaxHeight()) }
    }
}
