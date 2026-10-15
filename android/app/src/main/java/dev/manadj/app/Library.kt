package dev.manadj.app

import androidx.compose.foundation.*
import androidx.compose.animation.core.animateFloat
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.customActions
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.*
import kotlinx.coroutines.flow.collectLatest
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
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
 * Track browser (#130): tiers Collection / Playlists / Tags / Follow / This session, breadcrumb + back gesture,
 * drill-down in narrow panes, tree + tracks side by side when the pane is wide. Rows load by swipe: left → deck A,
 * right → deck B. [tapTarget]: landscape loads a tapped row into this (visible) deck.
 */
@Composable fun LibraryPanel(model: PlayerModel, ux: UiModel, modifier: Modifier, pick: (DeckId) -> Unit, tapTarget: DeckId? = null, sidebar: Boolean = false) {
    val color = Ink.accent
    androidx.activity.compose.BackHandler(model.browser != null && ux.path.size > 2) { ux.back() }
    LaunchedEffect(ux.filter, ux.selectedRow, ux.path) { ux.saveBrowse() }
    if (sidebar) { SidebarBrowser(model, ux, modifier, pick, tapTarget); return }
    // Hit target over the controls beneath without consuming (a clickable would eat the down and block the sheet drag).
    Column(modifier.background(Ink.background).pointerInput(Unit) { awaitEachGesture { awaitFirstDown(requireUnconsumed = false) } }.padding(horizontal = 8.dp)) {
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
        Crumbs(ux)
        if (ux.filtersOpen) FilterControls(ux)
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val node = ux.node
            if (maxWidth >= 560.dp) Row(Modifier.fillMaxSize()) {
                // Tree column: the current container's entries (a track source highlights within its parent).
                val container = if (node.hasTracks) ux.path.getOrNull(ux.path.size - 2) ?: BrowseNode.Root else node
                NodeList(ux, container, node, Modifier.width(220.dp).fillMaxHeight())
                Spacer(Modifier.width(8.dp))
                if (node.hasTracks) TrackPane(model, ux, node, pick, tapTarget, Modifier.weight(1f).fillMaxHeight())
                else Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) { Text("pick a source", color = Ink.muted, size = 12) }
            } else if (node.hasTracks) TrackPane(model, ux, node, pick, tapTarget, Modifier.fillMaxSize())
            else NodeList(ux, node, null, Modifier.fillMaxSize())
        }
    }
}

/** Breadcrumb: ‹ back + the path; tap a crumb to go there. */
@Composable private fun Crumbs(ux: UiModel) {
    val path = ux.path
    Row(Modifier.fillMaxWidth().height(34.dp).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
        Key("‹", Modifier.width(40.dp).height(30.dp), Ink.accent, path.size > 1, description = "Browser back", textSize = 16, style = KeyStyle.PILL) { ux.back() }
        Spacer(Modifier.width(6.dp))
        path.forEachIndexed { i, n ->
            if (i > 0) Text(" › ", color = Ink.surface2, size = 12, bold = true)
            val last = i == path.lastIndex
            Text(ux.library.title(n).uppercase(), Modifier.clip(RoundedCornerShape(4.dp)).clickable(enabled = !last) { ux.navigate(n) }.padding(horizontal = 4.dp, vertical = 4.dp), if (last) Ink.text else Ink.accent, 12, true)
        }
    }
}

/** A container's entries (tiers, playlists/folders, tag categories, tags) with counts over the current filters. */
@Composable private fun NodeList(ux: UiModel, container: BrowseNode, selected: BrowseNode?, modifier: Modifier) {
    val entries = remember(ux.library, container, ux.filter, ux.played.size, ux.downloads) { ux.library.children(container, ux.filter, ux.played.toList()) }
    androidx.compose.foundation.lazy.LazyColumn(modifier) {
        items(entries, key = { it.node.key }) { e ->
            val on = e.node == selected
            Row(Modifier.fillMaxWidth().height(48.dp).drawBehind { drawRect(if (on) Ink.accent.copy(alpha = .14f) else Ink.background); val t = 1.dp.toPx(); drawRect(Ink.surface0, Offset(0f, size.height - t), androidx.compose.ui.geometry.Size(size.width, t)) }
                .clickable { ux.navigate(e.node) }.semantics { contentDescription = "Browse ${e.title}" }.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                e.color?.let { Box(Modifier.size(10.dp).clip(RoundedCornerShape(50)).background(Color(it))); Spacer(Modifier.width(8.dp)) }
                if (e.node == BrowseNode.Follow) { GlyphIcon(Glyph.Follow, Ink.play, 14.dp); Spacer(Modifier.width(6.dp)) }
                Text(e.title, Modifier.weight(1f), if (on) Ink.text else Ink.text, 14, true)
                e.count?.let { Text("$it", color = Ink.muted, size = 12) }
                if (e.container) Text("  ›", color = Ink.accent, size = 16, bold = true)
            }
        }
    }
}

/** Follow reference decks (#133): pinned deck(s), or AUTO = the audible / outgoing deck (re-targets as the mix moves). */
private fun followDecks(model: PlayerModel, ux: UiModel): List<DeckId> {
    fun loaded(d: DeckId) = dev.manadj.app.library.LibraryHolder.trackOn(model, d) != null
    return when (ux.followPin) {
        FollowPin.A -> listOf(DeckId.A); FollowPin.B -> listOf(DeckId.B); FollowPin.BOTH -> listOf(DeckId.A, DeckId.B)
        FollowPin.AUTO -> {
            val l = model.visibleDecks.filter(::loaded)
            if (l.size == 2) listOf(coveredDeck(mixOf(model, ux, DeckId.A), mixOf(model, ux, DeckId.B))) else l
        }
    }
}

/** One track source's rows and Follow state, shared by the portrait pane and the landscape sidebar. */
private class BrowseData(val decks: List<DeckId>, val refs: List<Long>, val followById: Map<Long, FollowCandidate>?, val rows: List<LibraryTrack>, val downloadedIds: Set<Long>)

@Composable private fun rememberBrowseData(model: PlayerModel, ux: UiModel, node: BrowseNode): BrowseData {
    val isFollow = node == BrowseNode.Follow
    val decks by remember { derivedStateOf { followDecks(model, ux) } }
    val refs = decks.mapNotNull { d -> dev.manadj.app.library.LibraryHolder.trackOn(model, d)?.toLong() }.distinct()
    // Follow rows off the main thread; the followed tracks pin on top as "Following" (desktop groupLabelFor).
    val follow by produceState<List<FollowCandidate>?>(null, isFollow, ux.library, refs, ux.followSeed) {
        value = if (!isFollow || refs.isEmpty()) null else kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
            refs.map { FollowCandidate(it, EvidenceTier.KNOWN, "Following", null) } + ux.library.follow(refs.toSet()).filter { it.trackId !in refs }
        }
    }
    val followById = remember(follow) { follow?.associateBy { it.trackId } }
    val all = remember(ux.library, node, ux.filter, follow, ux.played.size, ux.downloads) { if (!node.hasTracks) emptyList() else ux.library.rows(node, ux.filter, follow, ux.played.toList(), ignoreDownloaded = true) }
    val downloadedIds = remember(all, ux.downloads) { all.filter { ux.library.downloaded(it.id) }.mapTo(HashSet()) { it.id } }
    val rows = if (ux.filter.downloadedOnly) all.filter { it.id in downloadedIds } else all
    return BrowseData(decks, refs, followById, rows, downloadedIds)
}

/** A track source: header, sort + downloaded toggle, Follow bar, rows. */
@Composable private fun TrackPane(model: PlayerModel, ux: UiModel, node: BrowseNode, pick: (DeckId) -> Unit, tapTarget: DeckId?, modifier: Modifier) {
    val data = rememberBrowseData(model, ux, node)
    val isFollow = node == BrowseNode.Follow
    val rows = data.rows; val downloadedIds = data.downloadedIds; val decks = data.decks
    Column(modifier) {
        Row(Modifier.fillMaxWidth().padding(top = 2.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(ux.library.title(node).uppercase() + " · ${rows.size}" + when { ux.syncState.running || ux.syncState.cacheStale -> " · syncing…"; ux.syncState.lastSynced != null -> " · " + java.time.format.DateTimeFormatter.ofPattern("HH:mm").withZone(java.time.ZoneId.systemDefault()).format(ux.syncState.lastSynced); else -> "" }, Modifier.weight(1f), Ink.muted, 10, true)
            Text("${ux.filter.sort.label} ${if (ux.filter.descending) "▼" else "▲"}", color = Ink.accent, size = 10, bold = true)
        }
        Row(Modifier.fillMaxWidth().height(34.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Chip("● ON PHONE ${downloadedIds.size}", Ink.play, ux.filter.downloadedOnly) { ux.filter = ux.filter.copy(downloadedOnly = !ux.filter.downloadedOnly) }
            Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (sort in LibrarySort.entries) if (node.allows(sort)) {
                    val on = ux.filter.sort == sort
                    Chip(if (on) "${sort.label} ${if (ux.filter.descending) "▼" else "▲"}" else sort.label, Ink.accent, on) { ux.chooseSort(sort) }
                }
            }
        }
        if (isFollow) FollowBar(model, ux, decks)
        if (node is BrowseNode.Playlist && ux.synced != null) BulkDownload(ux, node.id.toInt(), compact = true)
        if (node == BrowseNode.Collection) Row(Modifier.fillMaxWidth().height(36.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("ON THIS PHONE", Modifier.weight(1f), Ink.muted, 10, true)
            Text("FILE →", color = Ink.muted, size = 10, bold = true)
            for (id in model.visibleDecks) { Spacer(Modifier.width(4.dp)); Key(id.name, Modifier.width(52.dp).fillMaxHeight(), deckColor(id), model.supports("play"), description = "Choose audio file for $id", style = KeyStyle.PILL) { pick(id) } }
        }
        TrackList(model, ux, node, data, tapTarget, Modifier.weight(1f).fillMaxWidth())
    }
}

/** The rows of a track source (scroll position remembered per source, Follow section headers in rank order). */
@Composable private fun TrackList(model: PlayerModel, ux: UiModel, node: BrowseNode, data: BrowseData, tapTarget: DeckId?, modifier: Modifier, dense: Boolean = false) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val isFollow = node == BrowseNode.Follow
    val rows = data.rows; val downloadedIds = data.downloadedIds; val followById = data.followById; val refs = data.refs
    val local = node == BrowseNode.Collection
        // Remember the view per source (#55/U20): restore by row key (nearest index when the row is gone).
        val source = node.key
        val localCount = if (local) model.sources.size else 0
        val listState = key(source) {
            val (k, idx, off) = remember { ux.scrollAnchor(source) }
            val restored = k?.removePrefix("lib:")?.toLongOrNull()?.let { id -> rows.indexOfFirst { it.id == id }.takeIf { it >= 0 }?.let { it + localCount } } ?: idx
            androidx.compose.foundation.lazy.rememberLazyListState(restored.coerceAtLeast(0), off)
        }
        LaunchedEffect(listState, source) {
            snapshotFlow { listState.isScrollInProgress }.collect { scrolling ->
                if (!scrolling) { val first = listState.layoutInfo.visibleItemsInfo.firstOrNull(); ux.saveScroll(source, first?.key as? String, listState.firstVisibleItemIndex, listState.firstVisibleItemScrollOffset) }
            }
        }
        ScrollFrameMeter(listState, "browser")
        // Row decorations from a small state map (not per-frame): which deck holds each track, playing, played.
        val onDecks by remember { derivedStateOf {
            model.visibleDecks.mapNotNull { d -> dev.manadj.app.library.LibraryHolder.trackOn(model, d)?.toLong()?.let { it to (d to audible(mixOf(model, ux, d))) } }.toMap()
        } }
        val reference by remember { derivedStateOf {
            val loaded = model.visibleDecks.filter { dev.manadj.app.library.LibraryHolder.trackOn(model, it) != null }
            val from = if (loaded.size == 2) coveredDeck(mixOf(model, ux, DeckId.A), mixOf(model, ux, DeckId.B)) else loaded.firstOrNull()
            from?.let { d -> dev.manadj.app.library.LibraryHolder.trackOn(model, d)?.toLong()?.let { id -> ux.library.tracks().firstOrNull { it.id == id }?.key } }
        } }
        // Play-order numbers precomputed once per list (not an indexOf per row while scrolling).
        val playOrder = remember(ux.library, node) { (node as? BrowseNode.Playlist)?.let { n -> ux.library.playlists().firstOrNull { it.id == n.id }?.trackIds?.withIndex()?.associate { (i, t) -> t to i + 1 } } }
        // Follow section headers (desktop rankLabel) while the list is in rank order.
        val sections = isFollow && ux.filter.sort == LibrarySort.RANK
        // Row → LazyColumn item index (leading items + Follow section headers), for the scrubber (#166).
        val hint = ux.synced != null && !ux.editHintSeen
        val rowItems = remember(rows, sections, followById, localCount, hint, refs.isEmpty()) {
            var idx = localCount + (if (hint) 1 else 0) + (if (isFollow && refs.isEmpty()) 1 else 0)
            IntArray(rows.size) { i ->
                val c = followById?.get(rows[i].id)
                if (sections && c != null && (i == 0 || followById[rows[i - 1].id]?.label != c.label)) idx++
                idx++
            }
        }
        Box(modifier) {
        LazyColumn(Modifier.fillMaxSize(), state = listState) {
            if (local) items(model.sources, key = { "local:" + it.id }, contentType = { "local" }) { source ->
                SwipeToLoad(source.title, Modifier.fillMaxWidth(), { model.requestImport(it, source.uri) }) {
                    Row(Modifier.fillMaxWidth().height(48.dp).then(if (tapTarget != null) Modifier.clickable { model.requestImport(tapTarget, source.uri) } else Modifier).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(6.dp).clip(RoundedCornerShape(50)).background(Ink.warning)); Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) { Text(source.title, bold = true); Text(source.artist.ifBlank { "local file" } + (source.durationSeconds?.let { " · " + clock(it) } ?: ""), color = Ink.muted, size = 11) }
                    }
                }
            }
            if (ux.synced != null && !ux.editHintSeen) item(key = "edit-hint") {
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(6.dp)).background(Ink.accent.copy(alpha = .12f)).clickable { ux.editHintSeen = true }.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Long-press a track (or tap ✎) to edit it", Modifier.weight(1f), Ink.accent, 11, true)
                    Text("✕", color = Ink.muted, size = 12, bold = true)
                }
            }
            if (isFollow && refs.isEmpty()) item(key = "follow-empty") { Text("Load a library track to follow it.", Modifier.padding(12.dp), Ink.muted, 12) }
            rows.forEachIndexed { i, track ->
                val c = followById?.get(track.id)
                if (sections && c != null && (i == 0 || followById[rows[i - 1].id]?.label != c.label)) item(key = "section:${c.label}:$i", contentType = "section") {
                    Text(c.label.uppercase(), Modifier.fillMaxWidth().background(Ink.background).padding(top = 8.dp, bottom = 3.dp, start = 4.dp), if (c.label == "Following") Ink.accent else if (c.tier == EvidenceTier.KNOWN) Ink.play else Ink.muted, 10, true)
                }
                item(key = "lib:" + track.id, contentType = "track") {
                    SwipeToLoad(track.title, Modifier.fillMaxWidth(), { ux.loadRow(model, it, track.id) }) {
                        TrackRow(track, c?.takeIf { it.label != "Following" }, ux, playOrder?.get(track.id), onDecks[track.id], track.id in ux.played, keyRelation(reference, toOpenKey(track.key)), track.id in downloadedIds, dense) {
                            dev.manadj.app.library.LibraryHolder.prefetch(ctx, track.id.toInt()); if (tapTarget != null) ux.loadRow(model, tapTarget, track.id) else ux.selectedRow = track.id
                        }
                    }
                }
            }
        }
        ScrubOverlay(listState, rows, ux.filter.sort, { r -> rowItems.getOrElse(r) { 0 } },
            { item -> var lo = 0; var hi = rowItems.size - 1; while (lo < hi) { val m = (lo + hi + 1) / 2; if (rowItems[m] <= item) lo = m else hi = m - 1 }; lo },
            Modifier.matchParentSize())
        }
}

@Composable private fun FilterControls(ux: UiModel) {
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
        }
    }
}

/** Follow (#133/#140/#142): who it follows + pin, known-only, Temperature, Reroll — desktop params, synced back. */
@Composable private fun FollowBar(model: PlayerModel, ux: UiModel, decks: List<DeckId>) {
    val settings = ux.library.followSettings
    Column(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(Modifier.fillMaxWidth().height(32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            GlyphIcon(Glyph.Follow, Ink.play, 14.dp)
            val following = decks.mapNotNull { d -> dev.manadj.app.library.LibraryHolder.trackOn(model, d)?.toLong()?.let { id -> d to (ux.library.tracks().firstOrNull { it.id == id }?.title ?: "#$id") } }
            Row(Modifier.weight(1f)) {
                if (following.isEmpty()) Text("nothing loaded", color = Ink.muted, size = 11)
                following.forEachIndexed { i, (d, t) -> if (i > 0) Text(" + ", color = Ink.muted, size = 11); Text("$d ", color = deckColor(d), size = 11, bold = true); Text(t, color = Ink.text, size = 11) }
            }
            for (pin in FollowPin.entries) Chip(when (pin) { FollowPin.AUTO -> "AUTO"; FollowPin.BOTH -> "A+B"; else -> pin.name }, when (pin) { FollowPin.A -> deckColor(DeckId.A); FollowPin.B -> deckColor(DeckId.B); else -> Ink.play }, ux.followPin == pin) { ux.pinFollow(pin) }
        }
        Row(Modifier.fillMaxWidth().height(32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Chip("KNOWN ONLY", Ink.play, settings.knownOnly) { ux.editFollow(knownOnly = !settings.knownOnly) }
            Spacer(Modifier.weight(1f))
            Text("TEMP", color = Ink.muted, size = 10, bold = true)
            Key("−", Modifier.width(36.dp).fillMaxHeight(), Ink.accent, settings.temperature > 0, description = "Temperature down", textSize = 14, style = KeyStyle.PILL) { ux.editFollow(temperature = kotlin.math.round((settings.temperature - .1) * 10) / 10) }
            Text("%.1f".format(settings.temperature), Modifier.width(30.dp), Ink.text, 12, true)
            Key("+", Modifier.width(36.dp).fillMaxHeight(), Ink.accent, settings.temperature < 1, description = "Temperature up", textSize = 14, style = KeyStyle.PILL) { ux.editFollow(temperature = kotlin.math.round((settings.temperature + .1) * 10) / 10) }
            Key("REROLL", Modifier.width(72.dp).fillMaxHeight(), Ink.accent, settings.temperature > 0, description = "Reroll Follow", textSize = 10, style = KeyStyle.PILL) { ux.rerollFollow() }
        }
    }
}

/**
 * Landscape browser (#149): a narrow sidebar holds search, the source tree and every control (sort, ON PHONE,
 * filters, Follow, local files), so the track list keeps full height under a one-line header. Tapping the selected
 * sidebar entry hides the sidebar (list goes full width); tapping the source label in the header brings it back.
 * Remembered ([UiModel.browseSidebar]).
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable private fun SidebarBrowser(model: PlayerModel, ux: UiModel, modifier: Modifier, pick: (DeckId) -> Unit, tapTarget: DeckId?) {
    val node = ux.node
    val data = rememberBrowseData(model, ux, node)
    BoxWithConstraints(modifier.background(Ink.background).pointerInput(Unit) { awaitEachGesture { awaitFirstDown(requireUnconsumed = false) } }) {
        val sideWidth = (maxWidth * .38f).coerceIn(150.dp, 210.dp)
        Row(Modifier.fillMaxSize()) {
            if (ux.browseSidebar) {
                Sidebar(model, ux, node, data, pick, Modifier.width(sideWidth).fillMaxHeight())
                Box(Modifier.width(1.dp).fillMaxHeight().background(Ink.surface0))
            }
            Column(Modifier.weight(1f).fillMaxHeight().padding(horizontal = 6.dp)) {
                // One-line header: source (toggles the sidebar) · count · sort; load target + FLIP.
                Row(Modifier.fillMaxWidth().height(30.dp), verticalAlignment = Alignment.CenterVertically) {
                    val label = (if (ux.browseSidebar) "◂ " else "☰ ") + ux.library.title(node).uppercase()
                    Text(label, Modifier.clip(RoundedCornerShape(4.dp)).clickable { ux.browseSidebar = !ux.browseSidebar }.semantics { contentDescription = "Toggle browser sidebar" }.padding(horizontal = 4.dp, vertical = 5.dp), Ink.accent, 12, true)
                    Text(if (node.hasTracks) " ${data.rows.size} · ${ux.filter.sort.label} ${if (ux.filter.descending) "▼" else "▲"}" else "", Modifier.weight(1f), Ink.muted, 10, true)
                    if (tapTarget != null) {
                        Text("→ $tapTarget ", color = deckColor(tapTarget), size = 12, bold = true)
                        Chip("FLIP", deckColor(other(tapTarget)), false, small = true) { model.browser = tapTarget }
                    }
                }
                when {
                    node.hasTracks -> TrackList(model, ux, node, data, tapTarget, Modifier.weight(1f).fillMaxWidth(), dense = true)
                    !ux.browseSidebar -> NodeList(ux, node, null, Modifier.weight(1f).fillMaxWidth())
                    else -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text("pick a source", color = Ink.muted, size = 12) }
                }
            }
        }
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable private fun Sidebar(model: PlayerModel, ux: UiModel, node: BrowseNode, data: BrowseData, pick: (DeckId) -> Unit, modifier: Modifier) {
    val container = if (node.hasTracks) ux.path.getOrNull(ux.path.size - 2) ?: BrowseNode.Root else node
    val entries = remember(ux.library, container, ux.filter, ux.played.size, ux.downloads) { ux.library.children(container, ux.filter, ux.played.toList()) }
    val f = ux.filter
    val gap = Arrangement.spacedBy(4.dp)
    androidx.compose.foundation.lazy.LazyColumn(modifier.padding(start = 6.dp, end = 4.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        item(key = "search") {
            Row(Modifier.fillMaxWidth().padding(top = 3.dp).height(32.dp).clip(RoundedCornerShape(50)).background(Ink.crust).border(1.dp, Ink.surface, RoundedCornerShape(50)).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                GlyphIcon(Glyph.Search, Ink.muted, 12.dp); Spacer(Modifier.width(6.dp))
                Box(Modifier.weight(1f)) {
                    if (f.text.isEmpty()) Text("search", color = Ink.surface2, size = 12)
                    BasicTextField(f.text, { ux.filter = ux.filter.copy(text = it) }, Modifier.fillMaxWidth().semantics { contentDescription = "Search library" }, singleLine = true, textStyle = TextStyle(color = Ink.text, fontSize = 12.sp, fontFamily = Mono), cursorBrush = SolidColor(Ink.accent))
                }
            }
        }
        item(key = "crumb") {
            Row(Modifier.fillMaxWidth().height(28.dp), verticalAlignment = Alignment.CenterVertically) {
                Key("‹", Modifier.width(34.dp).height(26.dp), Ink.accent, ux.path.size > 1, description = "Browser back", textSize = 14, style = KeyStyle.PILL) { ux.back() }
                Text("  " + ux.library.title(container).uppercase(), Modifier.weight(1f), Ink.muted, 10, true)
            }
        }
        items(entries, key = { "e:" + it.node.key }) { e ->
            val on = e.node == node
            Row(Modifier.fillMaxWidth().height(34.dp).clip(RoundedCornerShape(4.dp)).background(if (on) Ink.accent.copy(alpha = .16f) else Ink.panel)
                // Tapping the selected entry hides the sidebar (#149).
                .clickable { if (on) ux.browseSidebar = false else ux.navigate(e.node) }.semantics { contentDescription = "Browse ${e.title}" }.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                e.color?.let { Box(Modifier.size(8.dp).clip(RoundedCornerShape(50)).background(Color(it))); Spacer(Modifier.width(6.dp)) }
                if (e.node == BrowseNode.Follow) { GlyphIcon(Glyph.Follow, Ink.play, 12.dp); Spacer(Modifier.width(4.dp)) }
                Text(e.title, Modifier.weight(1f), Ink.text, 12, true)
                e.count?.let { Text("$it", color = Ink.muted, size = 10) }
                if (e.container) Text(" ›", color = Ink.accent, size = 13, bold = true)
            }
        }
        if (node.hasTracks) {
            item(key = "sort") {
                Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("SORT", color = Ink.muted, size = 9, bold = true)
                    FlowRow(horizontalArrangement = gap, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        for (sort in LibrarySort.entries) if (node.allows(sort)) {
                            val on = f.sort == sort
                            Chip(if (on) "${sort.label} ${if (f.descending) "▼" else "▲"}" else sort.label, Ink.accent, on, small = true) { ux.chooseSort(sort) }
                        }
                    }
                }
            }
            item(key = "filters") {
                Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    FlowRow(horizontalArrangement = gap, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Chip("● ON PHONE ${data.downloadedIds.size}", Ink.play, f.downloadedOnly, small = true) { ux.filter = ux.filter.copy(downloadedOnly = !ux.filter.downloadedOnly) }
                        Chip("FILTER", Ink.accent, ux.filtersOpen || f.tags.isNotEmpty() || f.bpmCenter != null, small = true) { ux.filtersOpen = !ux.filtersOpen }
                    }
                    if (ux.filtersOpen) FlowRow(horizontalArrangement = gap, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        val ref = ux.selectedRow?.let { id -> ux.library.tracks().firstOrNull { it.id == id } }
                        Chip(if (f.bpmCenter != null) "BPM ${f.bpmCenter.toInt()}±${f.bpmTolerance.toInt()}" else "BPM ≈ SEL", Ink.accent, f.bpmCenter != null, small = true) { ux.filter = f.copy(bpmCenter = if (f.bpmCenter != null) null else ref?.bpm) }
                        for (tag in ux.library.allTags()) {
                            val on = tag.name in f.tags
                            Chip(tag.name, Color(tag.color), on, small = true) { ux.filter = f.copy(tags = if (on) f.tags - tag.name else f.tags + tag.name) }
                        }
                    }
                }
            }
        }
        if (node == BrowseNode.Follow) item(key = "follow") {
            val settings = ux.library.followSettings
            Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("FOLLOW " + data.decks.joinToString("+") { it.name }.ifEmpty { "—" }, color = Ink.play, size = 9, bold = true)
                FlowRow(horizontalArrangement = gap, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    for (pin in FollowPin.entries) Chip(when (pin) { FollowPin.AUTO -> "AUTO"; FollowPin.BOTH -> "A+B"; else -> pin.name }, when (pin) { FollowPin.A -> deckColor(DeckId.A); FollowPin.B -> deckColor(DeckId.B); else -> Ink.play }, ux.followPin == pin, small = true) { ux.pinFollow(pin) }
                    Chip("KNOWN", Ink.play, settings.knownOnly, small = true) { ux.editFollow(knownOnly = !settings.knownOnly) }
                }
                Row(Modifier.height(28.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = gap) {
                    Text("T", color = Ink.muted, size = 10, bold = true)
                    Key("−", Modifier.width(28.dp).fillMaxHeight(), Ink.accent, settings.temperature > 0, description = "Temperature down", textSize = 12, style = KeyStyle.PILL) { ux.editFollow(temperature = kotlin.math.round((settings.temperature - .1) * 10) / 10) }
                    Text("%.1f".format(settings.temperature), color = Ink.text, size = 11, bold = true)
                    Key("+", Modifier.width(28.dp).fillMaxHeight(), Ink.accent, settings.temperature < 1, description = "Temperature up", textSize = 12, style = KeyStyle.PILL) { ux.editFollow(temperature = kotlin.math.round((settings.temperature + .1) * 10) / 10) }
                    Key("↻", Modifier.width(32.dp).fillMaxHeight(), Ink.accent, settings.temperature > 0, description = "Reroll Follow", textSize = 13, style = KeyStyle.PILL) { ux.rerollFollow() }
                }
            }
        }
        if (node is BrowseNode.Playlist && ux.synced != null) item(key = "bulk") { BulkDownload(ux, node.id.toInt(), compact = true) }
        if (node == BrowseNode.Collection) item(key = "files") {
            Row(Modifier.padding(top = 4.dp).height(28.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = gap) {
                Text("FILE →", color = Ink.muted, size = 9, bold = true)
                for (id in model.visibleDecks) Key(id.name, Modifier.width(36.dp).fillMaxHeight(), deckColor(id), model.supports("play"), description = "Choose audio file for $id", style = KeyStyle.PILL, textSize = 11) { pick(id) }
            }
        }
        item(key = "end") { Spacer(Modifier.height(8.dp)) }
    }
}

@Composable fun Chip(text: String, color: Color, on: Boolean, small: Boolean = false, flip: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Box(Modifier.height(if (small) 24.dp else 30.dp).clip(shape).background(if (on) color.copy(alpha = .25f) else Ink.crust).border(1.dp, if (on) color else Ink.surface, shape).clickable(onClick = flip).padding(horizontal = if (small) 7.dp else 10.dp), contentAlignment = Alignment.Center) {
        Text(text, color = if (on) Ink.text else color.copy(alpha = .85f), size = if (small) 10 else 11, bold = true)
    }
}

/**
 * [deck]: the deck holding this track and whether it is audible; [played]: played this session; [relation]: key vs
 * the mix-from deck; [downloaded]: audio cached on the phone (leading ● / ○ mark). [follow]: Match score (tap for the
 * breakdown) and desktop's dimming of unmatched key / tags.
 */
@Composable private fun TrackRow(track: LibraryTrack, follow: FollowCandidate?, ux: UiModel, playIndex: Int? = null, deck: Pair<DeckId, Boolean>? = null, played: Boolean = false, relation: KeyRelation = KeyRelation.OTHER, downloaded: Boolean = false, dense: Boolean = false, tap: () -> Unit) {
    val selected = ux.selectedRow == track.id
    // Background + 1dp desktop --surface0 divider in one draw (no extra layout node; scroll-cheap).
    // Black rows on the black browser (UH15): no grey inset cards; dividers separate rows.
    val bg = if (selected) Ink.accent.copy(alpha = .10f) else Ink.background
    Column(Modifier.fillMaxWidth().drawBehind { drawRect(bg); val t = 1.dp.toPx(); drawRect(Ink.surface0, androidx.compose.ui.geometry.Offset(0f, size.height - t), androidx.compose.ui.geometry.Size(size.width, t)) }.combinedClickable(onLongClickLabel = "Edit track", onLongClick = { if (ux.synced != null) { dev.manadj.app.edit.TrackEditNav.open(track.id.toInt()); ux.editHintSeen = true } }, onClick = tap).padding(top = if (dense) 3.dp else 5.dp, bottom = if (dense) 3.dp else 5.dp, start = 4.dp, end = 24.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            deck?.let { (d, live) -> DeckBadge(d, live); Spacer(Modifier.width(6.dp)) }
            playIndex?.let { Text("%02d".format(it), Modifier.width(26.dp), Ink.muted, 11, true) }
            DownloadMark(track.id, downloaded, ux)
            Spacer(Modifier.width(6.dp))
            // BPM + key left of the title (UH8): the right edge belongs to the fast-scroll scrubber.
            Column(Modifier.width(46.dp), horizontalAlignment = Alignment.Start) {
                Text(track.bpm?.let { "%.1f".format(it) } ?: "—", color = bpmColor(track.bpm) ?: Ink.muted, size = 13, bold = true)
                val ok = toOpenKey(track.key)
                // Harmonic match vs the mix-from deck: chip strength by relation (exact strongest); Follow dims an unmatched key.
                val keyAlpha = if (follow != null && !follow.keyMatched) .4f else 1f
                Text(ok ?: "—", Modifier.clip(RoundedCornerShape(3.dp)).background(Ink.play.copy(alpha = .45f * relation.strength)).padding(horizontal = 4.dp), (keyColor(ok) ?: Ink.muted).copy(alpha = keyAlpha), 11, true)
            }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text((if (played && deck == null) "✓ " else "") + track.title, color = if (played && deck == null) Ink.muted else Ink.text, bold = true, size = 14)
                Text(track.artist, color = Ink.muted, size = 11)
            }
            follow?.displayScore?.let { score ->
                Text("${kotlin.math.round(score).toInt()}", Modifier.clip(RoundedCornerShape(4.dp)).clickable { ux.breakdownRow = if (ux.breakdownRow == track.id) null else track.id }.background(Ink.accent.copy(alpha = .15f)).padding(horizontal = 6.dp, vertical = 2.dp), Ink.accent, 13, true)
                Spacer(Modifier.width(6.dp))
            }
        }
        Row(Modifier.fillMaxWidth().height(if (dense) 19.dp else 22.dp).padding(top = if (dense) 2.dp else 3.dp), verticalAlignment = Alignment.CenterVertically) {
            (ux.synced?.preview(track.id) ?: track.preview)?.let { PreviewWave(it, Modifier, height = if (dense) 17.dp else 19.dp) }
            Spacer(Modifier.width(6.dp))
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                for (tag in track.tags) {
                    val a = if (follow != null && tag.name !in follow.matchedTags) .4f else 1f
                    Text(tag.name, Modifier.clip(RoundedCornerShape(3.dp)).background(Color(tag.color).copy(alpha = .18f * a)).padding(horizontal = 4.dp), Color(tag.color).copy(alpha = a), 9, true)
                }
            }
            Text(track.dateAdded?.format(ADDED) ?: "", color = Ink.muted, size = 9)
            // Visible EDIT entry (#379): opens the track editor on the spare deck.
            if (ux.synced != null) Text("✎", Modifier.padding(start = 6.dp).clip(RoundedCornerShape(4.dp)).clickable { dev.manadj.app.edit.TrackEditNav.open(track.id.toInt()); ux.editHintSeen = true }.semantics { contentDescription = "Edit ${track.title}" }.padding(horizontal = 6.dp), Ink.accent, 13, true)
        }
        if (follow?.breakdown != null && ux.breakdownRow == track.id) follow.breakdown.let { b ->
            Text("key %s %.0f · tags %d %.0f · artist %.0f · energy %.0f · bpm %.0f = %.0f".format(b.keyRelation.lowercase(), b.key, b.sharedTags, b.tags, b.artist, b.energy, b.bpm, b.total), Modifier.padding(top = 3.dp), Ink.accent, 10, lines = 2)
        }
    }
}

/** ● cached on the phone, ○ not yet (desktop has it), ↓ n% downloading, × no file. */
@Composable private fun DownloadMark(id: Long, downloaded: Boolean, ux: UiModel) {
    if (downloaded) { Box(Modifier.size(8.dp).clip(RoundedCornerShape(50)).background(Ink.play).semantics { contentDescription = "On phone" }); return }
    val label = remember(id, ux.downloads) { ux.library.audioLabel(id) }
    when {
        label == null -> Spacer(Modifier.size(8.dp))
        label.startsWith("↓") -> Text(label, color = Ink.warning, size = 9, bold = true)
        label == "NO FILE" -> Text("×", color = Ink.warning, size = 11, bold = true)
        else -> Box(Modifier.size(8.dp).clip(RoundedCornerShape(50)).border(1.dp, Ink.muted, RoundedCornerShape(50)).semantics { contentDescription = "Not downloaded" })
    }
}

/**
 * Desktop preview strip (minimap style, bottom-anchored), pre-rendered off the main thread into a cached
 * bitmap (LRU by preview + style + size) so scrolling only blits.
 */
@Composable fun PreviewWave(p: WaveformPreview, modifier: Modifier, width: androidx.compose.ui.unit.Dp = 110.dp, height: androidx.compose.ui.unit.Dp = 19.dp) {
    // Fixed size (no BoxWithConstraints subcomposition per row).
    // Transparent over the row (desktop previewImage `transparent: true`).
    Box(modifier.size(width, height)) {
        val density = androidx.compose.ui.platform.LocalDensity.current
        val w = with(density) { width.roundToPx() }; val h = with(density) { height.roundToPx() }
        val style = WaveStyle.minimap ?: WaveStyle.MINIMAP
        val k = OverviewDim.factor
        val key = listOf(p, style, w * 100_000 + h, k)
        val bitmap by produceState(PreviewBitmaps.get(key), key) {
            if (value == null && w > 0 && h > 0) value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { renderPreview(p, w, h, style, k) }.also { PreviewBitmaps.put(key, it) }
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

/**
 * UH9: per-fling frame-interval stats to logcat (`adb logcat -s manadj-perf`) — passive on-device measurement,
 * no input injection. Janky = interval > 1.5 vsync.
 */
@Composable fun ScrollFrameMeter(state: androidx.compose.foundation.lazy.LazyListState, name: String) {
    val view = androidx.compose.ui.platform.LocalView.current
    LaunchedEffect(state) {
        snapshotFlow { state.isScrollInProgress }.collectLatest { scrolling ->
            if (!scrolling) return@collectLatest
            val vsync = 1e9 / (view.display?.refreshRate ?: 60f)
            val dt = ArrayList<Long>(512)
            var last = withFrameNanos { it }
            try { while (true) { val t = withFrameNanos { it }; dt += t - last; last = t } }
            finally {
                if (dt.size >= 10) {
                    val ms = dt.map { it / 1e6 }.sorted()
                    fun pct(q: Double) = ms[((ms.size - 1) * q).toInt()]
                    val janky = dt.count { it > vsync * 1.5 }
                    val missed = dt.sumOf { kotlin.math.max(0L, kotlin.math.round(it / vsync).toLong() - 1) }
                    android.util.Log.i("manadj-perf", "%s scroll: %d frames @%.0fHz, p50 %.1f p90 %.1f p99 %.1f max %.1f ms, janky %d%%, missed vsyncs %d".format(
                        name, dt.size, 1e9 / vsync, pct(.5), pct(.9), pct(.99), ms.last(), 100 * janky / dt.size, missed))
                }
            }
        }
    }
}
