package dev.manadj.app

import androidx.compose.foundation.*
import androidx.compose.animation.core.animateFloat
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.customActions
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.manadj.app.browse.*
import dev.manadj.audio.DeckId
import java.time.format.DateTimeFormatter

private val ADDED = DateTimeFormatter.ofPattern("dd MMM")

/**
 * Track browser: local files + the synced library, with filters and Follow mode. Rows load by swipe:
 * left → deck A, right → deck B (deck letter/color revealed, haptic at the commit threshold, return cancels).
 */
/** [tapTarget]: landscape loads a tapped row into this (visible) deck; swipe stays an explicit A/B override. */
@Composable fun LibraryPanel(model: PlayerModel, ux: UiModel, modifier: Modifier, pick: (DeckId) -> Unit, tapTarget: DeckId? = null) {
    if (model.browser == null) return
    val color = Ink.accent
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val follow by remember { derivedStateOf {
        val refs = model.visibleDecks.filter { ux.following[it] == true }.mapNotNull { d -> if (ux.synced != null) dev.manadj.app.library.LibraryHolder.trackOn(model, d)?.toLong() else ux.followRef[d] }.toSet()
        if (refs.isEmpty()) null else ux.library.follow(refs, ux.knownOnly).associateBy { it.trackId }
    } }
    val rows = remember(ux.library, ux.filter, follow) { ux.library.query(ux.filter, follow) }
    Column(modifier.background(Ink.background).clickable(interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, indication = null) {}.padding(horizontal = 8.dp)) {
        Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically) {
            if (tapTarget != null) {
                Text("LOAD → $tapTarget", color = deckColor(tapTarget), size = 15, bold = true)
                Spacer(Modifier.width(8.dp))
                // Manual flip: cover the other deck instead (the browser moves sides; loads go to the new visible deck).
                Key("FLIP", Modifier.width(56.dp).height(32.dp), deckColor(other(tapTarget)), description = "Load to ${other(tapTarget)} instead", textSize = 11, style = KeyStyle.PILL) { model.browser = tapTarget }
                Spacer(Modifier.weight(1f))
            } else {
                Text("← A", color = deckColor(DeckId.A), size = 15, bold = true)
                Text("  SWIPE A TRACK TO LOAD  ", Modifier.weight(1f), Ink.muted, 11, true)
                Text("B →", color = deckColor(DeckId.B), size = 15, bold = true)
                Spacer(Modifier.width(8.dp))
            }
            BrowseKey(model, ux, Modifier.width(84.dp).height(36.dp))
        }
        // Search + filter toggle.
        Row(Modifier.fillMaxWidth().height(44.dp).padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(50)).background(Ink.crust).border(1.dp, Ink.surface, RoundedCornerShape(50)).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                GlyphIcon(Glyph.Search, Ink.muted, 14.dp); Spacer(Modifier.width(8.dp))
                Box(Modifier.weight(1f)) {
                    if (ux.filter.text.isEmpty()) Text("title, artist, tag", color = Ink.surface2, size = 14)
                    BasicTextField(ux.filter.text, { ux.filter = ux.filter.copy(text = it) }, Modifier.fillMaxWidth().semantics { contentDescription = "Search library" }, singleLine = true, textStyle = TextStyle(color = Ink.text, fontSize = 14.sp, fontFamily = Mono), cursorBrush = SolidColor(color))
                }
            }
            Key("FILTER", Modifier.width(84.dp).fillMaxHeight(), Ink.accent, engaged = ux.filtersOpen || ux.filter.tags.isNotEmpty() || ux.filter.bpmCenter != null, textSize = 12, style = KeyStyle.PILL) { ux.filtersOpen = !ux.filtersOpen }
        }
        PlaylistNav(ux)
        ux.filter.playlist?.let { if (ux.synced != null) BulkDownload(ux, it.toInt(), compact = true) }
        if (ux.filtersOpen) FilterControls(ux, model)
        FollowControls(model, ux, follow != null)
        // Local files: the only rows the engine can load today.
        Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("ON THIS PHONE", Modifier.weight(1f), Ink.muted, 10, true)
            Text("FILE →", color = Ink.muted, size = 10, bold = true)
            for (id in model.visibleDecks) { Spacer(Modifier.width(4.dp)); Key(id.name, Modifier.width(52.dp).fillMaxHeight(), deckColor(id), model.supports("play"), description = "Choose audio file for $id", style = KeyStyle.PILL) { pick(id) } }
        }
        // Remember the view per source (#55): restore by row key (nearest index when the row is gone).
        val source = ux.filter.playlist?.toString() ?: "collection"
        val listState = key(source) {
            val (k, idx, off) = remember { ux.scrollAnchor(source) }
            val restored = k?.removePrefix("lib:")?.toLongOrNull()?.let { id -> rows.indexOfFirst { it.id == id }.takeIf { it >= 0 }?.let { it + model.sources.size + 1 } } ?: idx
            androidx.compose.foundation.lazy.rememberLazyListState(restored.coerceAtLeast(0), off)
        }
        LaunchedEffect(listState, source) {
            snapshotFlow { listState.isScrollInProgress }.collect { scrolling ->
                if (!scrolling) { val first = listState.layoutInfo.visibleItemsInfo.firstOrNull(); ux.saveScroll(source, first?.key as? String, listState.firstVisibleItemIndex, listState.firstVisibleItemScrollOffset) }
            }
        }
        LaunchedEffect(ux.filter, ux.selectedRow) { ux.saveBrowse() }
        // Play-order numbers precomputed once per list (not an indexOf per row while scrolling).
        // Row decorations from a small state map (not per-frame): which deck holds each track, playing, played.
        val onDecks by remember { derivedStateOf {
            model.visibleDecks.mapNotNull { d -> dev.manadj.app.library.LibraryHolder.trackOn(model, d)?.toLong()?.let { it to (d to audible(mixOf(model, ux, d))) } }.toMap()
        } }
        val reference by remember { derivedStateOf {
            val loaded = model.visibleDecks.filter { dev.manadj.app.library.LibraryHolder.trackOn(model, it) != null }
            val from = if (loaded.size == 2) coveredDeck(mixOf(model, ux, DeckId.A), mixOf(model, ux, DeckId.B)) else loaded.firstOrNull()
            from?.let { d -> dev.manadj.app.library.LibraryHolder.trackOn(model, d)?.toLong()?.let { id -> ux.library.tracks().firstOrNull { it.id == id }?.key } }
        } }
        val playOrder = remember(ux.library, ux.filter.playlist) { ux.filter.playlist?.let { id -> ux.library.playlists().firstOrNull { it.id == id }?.trackIds?.withIndex()?.associate { (i, t) -> t to i + 1 } } }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState) {
            items(model.sources, key = { "local:" + it.id }, contentType = { "local" }) { source ->
                SwipeToLoad(source.title, Modifier.fillMaxWidth(), { model.requestImport(it, source.uri) }) {
                    Row(Modifier.fillMaxWidth().height(48.dp).then(if (tapTarget != null) Modifier.clickable { model.requestImport(tapTarget, source.uri) } else Modifier).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(6.dp).clip(RoundedCornerShape(50)).background(Ink.warning)); Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) { Text(source.title, bold = true); Text(source.artist.ifBlank { "local file" } + (source.durationSeconds?.let { " · " + clock(it) } ?: ""), color = Ink.muted, size = 11) }
                    }
                }
            }
            item(key = "header", contentType = "header") {
                val scope = ux.filter.playlist?.let { id -> ux.library.playlists().firstOrNull { it.id == id }?.name } ?: "COLLECTION"
                Row(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 4.dp)) { Text("$scope · ${ux.library.label}" + when { ux.syncState.running || ux.syncState.cacheStale -> " · syncing…"; ux.syncState.lastSynced != null -> " · " + java.time.format.DateTimeFormatter.ofPattern("HH:mm").withZone(java.time.ZoneId.systemDefault()).format(ux.syncState.lastSynced); else -> "" }, Modifier.weight(1f), Ink.muted, 10, true); Text("${rows.size} TRACKS · ${ux.filter.sort.label}", color = Ink.muted, size = 10) }
            }
            items(rows, key = { "lib:" + it.id }, contentType = { "track" }) { track ->
                val order = playOrder?.get(track.id)
                SwipeToLoad(track.title, Modifier.fillMaxWidth(), { ux.loadRow(model, it, track.id) }) { TrackRow(track, follow?.get(track.id), ux, order, onDecks[track.id], track.id in ux.played, keyRelation(reference, toOpenKey(track.key))) { dev.manadj.app.library.LibraryHolder.prefetch(ctx, track.id.toInt()); if (tapTarget != null) ux.loadRow(model, tapTarget, track.id) else ux.selectedRow = track.id } }
            }
        }
    }
}

@Composable private fun FilterControls(ux: UiModel, model: PlayerModel) {
    val f = ux.filter
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (tag in ux.library.allTags()) {
                val on = tag.name in f.tags
                Chip(tag.name, Color(tag.color), on) { ux.filter = f.copy(tags = if (on) f.tags - tag.name else f.tags + tag.name) }
            }
        }
        Row(Modifier.fillMaxWidth().height(36.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            val ref = ux.selectedRow?.let { id -> ux.library.tracks().firstOrNull { it.id == id } }
            Chip(if (f.bpmCenter != null) "BPM ${f.bpmCenter.toInt()}±${f.bpmTolerance.toInt()}" else "BPM ≈ SELECTED", Ink.accent, f.bpmCenter != null) { ux.filter = f.copy(bpmCenter = if (f.bpmCenter != null) null else ref?.bpm) }
            Spacer(Modifier.width(6.dp))
            Text("SORT", color = Ink.muted, size = 10, bold = true)
            for (sort in LibrarySort.entries) if (sort != LibrarySort.PLAY_ORDER || f.playlist != null) Chip(sort.label, Ink.accent, f.sort == sort) { ux.filter = f.copy(sort = sort) }
        }
    }
}

@Composable private fun FollowControls(model: PlayerModel, ux: UiModel, active: Boolean) {
    Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        GlyphIcon(Glyph.Follow, if (active) Ink.play else Ink.muted, 16.dp)
        Text("FOLLOW", color = if (active) Ink.play else Ink.muted, size = 11, bold = true)
        for (id in model.visibleDecks) {
            val on = ux.following[id] == true
            Chip(id.name, deckColor(id), on) {
                ux.following[id] = !on
                if (!on) ux.followRef[id] = ux.followRef[id] ?: ux.selectedRow ?: ux.library.tracks().first().id
            }
        }
        Chip("KNOWN ONLY", Ink.play, ux.knownOnly) { ux.knownOnly = !ux.knownOnly }
        Spacer(Modifier.weight(1f))
        val refs = model.visibleDecks.filter { ux.following[it] == true }.mapNotNull { d -> ux.followRef[d]?.let { r -> d to ux.library.tracks().firstOrNull { it.id == r }?.title } }
        if (refs.isNotEmpty()) Text(refs.joinToString(" · ") { "${it.first}:${it.second}" }, color = Ink.muted, size = 10)
    }
}

@Composable fun Chip(text: String, color: Color, on: Boolean, flip: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Box(Modifier.height(30.dp).clip(shape).background(if (on) color.copy(alpha = .25f) else Ink.crust).border(1.dp, if (on) color else Ink.surface, shape).clickable(onClick = flip).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
        Text(text, color = if (on) Ink.text else color.copy(alpha = .85f), size = 11, bold = true)
    }
}

private fun tierColor(t: EvidenceTier) = when (t) { EvidenceTier.KNOWN -> Ink.play; EvidenceTier.OBSERVED -> Ink.warning; EvidenceTier.COMPATIBLE -> Ink.accent }

/** [deck]: the deck holding this track and whether it is audible; [played]: played this session; [relation]: key vs the mix-from deck. */
@Composable private fun TrackRow(track: LibraryTrack, follow: FollowCandidate?, ux: UiModel, playIndex: Int? = null, deck: Pair<DeckId, Boolean>? = null, played: Boolean = false, relation: KeyRelation = KeyRelation.OTHER, tap: () -> Unit) {
    val selected = ux.selectedRow == track.id
    Column(Modifier.fillMaxWidth().background(if (selected) Ink.accent.copy(alpha = .08f) else Ink.panel).clickable(onClick = tap).padding(vertical = 5.dp, horizontal = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            deck?.let { (d, live) -> DeckBadge(d, live); Spacer(Modifier.width(6.dp)) }
            playIndex?.let { Text("%02d".format(it), Modifier.width(26.dp), Ink.muted, 11, true) }
            follow?.let { c ->
                Text(c.tier.label, Modifier.width(62.dp).clip(RoundedCornerShape(3.dp)).background(tierColor(c.tier).copy(alpha = .2f)).padding(horizontal = 3.dp), tierColor(c.tier), 9, true)
                Spacer(Modifier.width(4.dp))
            }
            Column(Modifier.weight(1f)) {
                Text((if (played && deck == null) "✓ " else "") + track.title, color = if (played && deck == null) Ink.muted else Ink.text, bold = true, size = 14)
                Text(track.artist, color = Ink.muted, size = 11)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(track.bpm?.let { "%.1f".format(it) } ?: "—", color = bpmColor(track.bpm) ?: Ink.muted, size = 13, bold = true)
                val ok = toOpenKey(track.key)
                // Harmonic match vs the mix-from deck: chip strength by relation (exact strongest).
                Text(ok ?: "—", Modifier.clip(RoundedCornerShape(3.dp)).background(Ink.play.copy(alpha = .45f * relation.strength)).padding(horizontal = 4.dp), keyColor(ok) ?: Ink.muted, 11, true)
            }
        }
        Row(Modifier.fillMaxWidth().height(22.dp).padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically) {
            (ux.synced?.preview(track.id) ?: track.preview)?.let { PreviewWave(it, Modifier) }
            Spacer(Modifier.width(6.dp))
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                for (tag in track.tags) Text(tag.name, Modifier.clip(RoundedCornerShape(3.dp)).background(Color(tag.color).copy(alpha = .18f)).padding(horizontal = 4.dp), Color(tag.color), 9, true)
            }
            follow?.let { c ->
                c.knownLabel?.let { Text("$it ", color = Ink.play, size = 9, bold = true) }
                if (c.linked && c.knownLabel == null) Text("LINKED ", color = Ink.play, size = 9, bold = true)
                if (c.transitionsFrom > 0) Text("→${c.transitionsFrom} ", color = Ink.play, size = 9, bold = true)
                if (c.transitionsTo > 0) Text("${c.transitionsTo}→ ", color = Ink.play, size = 9, bold = true)
                if (c.takes > 0) Text("${c.takes} TAKES ", color = Ink.warning, size = 9, bold = true)
                c.matchScore?.let { Text("${it.toInt()} ", color = Ink.accent, size = 9, bold = true) }
            }
            Text(track.dateAdded?.format(ADDED) ?: "", color = Ink.muted, size = 9)
            remember(track.id, ux.downloads) { ux.library.audioLabel(track.id) }?.let { Text(" $it", color = if (it == "ON PHONE") Ink.play else Ink.warning, size = 9, bold = true) }
        }
    }
}

/**
 * Desktop preview strip (minimap style, bottom-anchored), pre-rendered off the main thread into a cached
 * bitmap (LRU by preview + style + size) so scrolling only blits.
 */
@Composable fun PreviewWave(p: WaveformPreview, modifier: Modifier, width: androidx.compose.ui.unit.Dp = 110.dp, height: androidx.compose.ui.unit.Dp = 19.dp) {
    // Fixed size (no BoxWithConstraints subcomposition per row).
    Box(modifier.size(width, height).background(Ink.crust)) {
        val density = androidx.compose.ui.platform.LocalDensity.current
        val w = with(density) { width.roundToPx() }; val h = with(density) { height.roundToPx() }
        val style = WaveStyle.minimap ?: WaveStyle.MINIMAP
        val key = Triple(p, style, w * 100_000 + h)
        val bitmap by produceState(PreviewBitmaps.get(key), key) {
            if (value == null && w > 0 && h > 0) value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { renderPreview(p, w, h, style) }.also { PreviewBitmaps.put(key, it) }
        }
        bitmap?.let { androidx.compose.foundation.Image(it, null, Modifier.fillMaxSize()) }
    }
}

private object PreviewBitmaps {
    private val lru = object : LinkedHashMap<Any, androidx.compose.ui.graphics.ImageBitmap>(128, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Any, androidx.compose.ui.graphics.ImageBitmap>) = size > 600
    }
    @Synchronized fun get(k: Any) = lru[k]
    @Synchronized fun put(k: Any, v: androidx.compose.ui.graphics.ImageBitmap) { lru[k] = v }
}

/** Collection or a Playlist (folders open in place). Entering a Playlist defaults to Play order. */
@Composable private fun PlaylistNav(ux: UiModel) {
    val lists = ux.library.playlists()
    val current = ux.filter.playlist?.let { id -> lists.firstOrNull { it.id == id } }
    var folder by remember { mutableStateOf<Long?>(current?.parentId) }
    Row(Modifier.fillMaxWidth().height(36.dp).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Chip("COLLECTION", Ink.text, current == null && folder == null) { folder = null; ux.filter = ux.filter.copy(playlist = null, sort = if (ux.filter.sort == LibrarySort.PLAY_ORDER) LibrarySort.DATE_ADDED else ux.filter.sort) }
        if (folder != null) {
            val f = lists.first { it.id == folder }
            Chip("‹ ${f.name}", Ink.warning, true) { folder = f.parentId }
        }
        for (p in lists.filter { it.parentId == folder }) {
            if (p.folder) Chip("${p.name} ›", Ink.warning, false) { folder = p.id }
            else Chip(p.name, Ink.accent, current?.id == p.id) { ux.filter = ux.filter.copy(playlist = p.id, sort = LibrarySort.PLAY_ORDER) }
        }
    }
}

/**
 * Directional swipe-to-load: drag left → A, right → B. The row slides over a deck-colored reveal with the
 * target letter; crossing [threshold] ticks a haptic and arms the load; releasing armed commits, dragging
 * back under the threshold cancels.
 */
@Composable fun SwipeToLoad(title: String, modifier: Modifier, load: (DeckId) -> Unit, content: @Composable () -> Unit) {
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    val density = androidx.compose.ui.platform.LocalDensity.current
    val threshold = with(density) { 88.dp.toPx() }
    var dx by remember { mutableFloatStateOf(0f) }
    val settle by androidx.compose.animation.core.animateFloatAsState(dx, if (dx == 0f) androidx.compose.animation.core.tween(160) else androidx.compose.animation.core.snap(), label = "swipe")
    val deck = if (dx < 0) DeckId.A else DeckId.B
    val armed = kotlin.math.abs(dx) >= threshold
    val current by rememberUpdatedState(load)
    Box(modifier.semantics {
        contentDescription = "Track $title"
        customActions = listOf(androidx.compose.ui.semantics.CustomAccessibilityAction("Load to A") { current(DeckId.A); true }, androidx.compose.ui.semantics.CustomAccessibilityAction("Load to B") { current(DeckId.B); true })
    }) {
        if (settle != 0f) {
            val c = deckColor(deck)
            Row(Modifier.matchParentSize().background(c.copy(alpha = if (armed) .45f else .15f)).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = if (dx < 0) Arrangement.End else Arrangement.Start) {
                Text(if (armed) "LOAD $deck" else "$deck", color = if (armed) Ink.text else c, size = 18, bold = true)
            }
        }
        Box(Modifier.offset { androidx.compose.ui.unit.IntOffset(settle.toInt(), 0) }.pointerInput(Unit) {
            var wasArmed = false
            detectHorizontalDragGestures(
                onDragStart = { wasArmed = false },
                onDragEnd = { if (kotlin.math.abs(dx) >= threshold) current(if (dx < 0) DeckId.A else DeckId.B); dx = 0f },
                onDragCancel = { dx = 0f },
            ) { change, amount ->
                change.consume()
                dx = (dx + amount).coerceIn(-size.width * .6f, size.width * .6f)
                val now = kotlin.math.abs(dx) >= threshold
                if (now != wasArmed) { wasArmed = now; haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress) }
            }
        }) { content() }
    }
}

/** Deck letter in its color; pulses while that deck is audible. */
@Composable private fun DeckBadge(deck: DeckId, live: Boolean) {
    val pulse = if (live) androidx.compose.animation.core.rememberInfiniteTransition(label = "badge").animateFloat(.35f, 1f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(600), androidx.compose.animation.core.RepeatMode.Reverse), label = "badge").value else .6f
    Box(Modifier.size(22.dp).clip(RoundedCornerShape(4.dp)).background(deckColor(deck).copy(alpha = if (live) pulse else .25f)), contentAlignment = Alignment.Center) {
        Text(deck.name, color = if (live) Color.Black else deckColor(deck), size = 12, bold = true)
    }
}
