package dev.manadj.app

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import dev.manadj.app.library.LibraryHolder
import dev.manadj.audio.DeckId

/**
 * Link toggle for the loaded A·B pair (linked-pairs PRD, #398) — desktop
 * PerformancePairLinks/LinkToggle semantics: symmetric, Track-based, one fact
 * per unordered pair (the fact follows the Tracks, not the decks). Disabled
 * without two distinct synced Tracks. Linked = green; the linkable hint
 * (favorited Transition, no Link) pulses toward green and never auto-links.
 * Toggling journals a pair edit that syncs back to the desktop.
 */
@Composable fun LinkKey(model: PlayerModel, ux: UiModel, modifier: Modifier, a: DeckId = DeckId.A, b: DeckId = DeckId.B, textSize: Int = 11, label: Boolean = true) {
    val context = LocalContext.current
    val lib = ux.synced?.lib
    val ta = LibraryHolder.trackOn(model, a)
    val tb = LibraryHolder.trackOn(model, b)
    val togglable = lib != null && ta != null && tb != null && ta != tb && lib.track(ta) != null && lib.track(tb) != null
    val linked = togglable && lib!!.linked(ta!!, tb!!)
    val hint = togglable && !linked && lib!!.linkable(ta!!, tb!!)
    val pulse = if (hint) rememberInfiniteTransition(label = "link-hint").animateFloat(0f, .6f, infiniteRepeatable(tween(1000), RepeatMode.Reverse), label = "link-hint").value else 0f
    val description = when {
        !togglable -> if (ta != null && ta == tb) "$a and $b hold the same Track" else "Load Tracks on $a and $b to link them"
        linked -> "Unlink $a ↔ $b"
        hint -> "$a ↔ $b has a favorited Transition — link them?"
        else -> "Link $a ↔ $b"
    }
    Key(if (label) "$a·$b" else "", modifier, if (linked || hint) Ink.play else Ink.muted, togglable, linked, description, icon = Glyph.Link, style = KeyStyle.PILL, pulse = pulse, textSize = textSize) {
        if (togglable) LibraryHolder.setLinked(context, ta!!, tb!!, !linked)
    }
}
