package dev.manadj.app.library

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.manadj.app.Ink
import dev.manadj.app.Key
import dev.manadj.app.PlayerModel
import dev.manadj.app.Text
import dev.manadj.app.clock
import dev.manadj.app.deckColor
import dev.manadj.audio.DeckId
import dev.manadj.library.*
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneId.systemDefault())
private val SORTS = listOf(SortColumn.DATE_ADDED, SortColumn.TITLE, SortColumn.ARTIST, SortColumn.BPM, SortColumn.KEY)

/**
 * Reference library browser for the LOAD panel (#372): sync, search, tag
 * filter, Follow suggestions, load-to-deck. The #371 UI lane owns the
 * final track list; this proves the data layer on the phone.
 */
@Composable fun LibraryPanel(model: PlayerModel, target: DeckId, modifier: Modifier, localFiles: () -> Unit) {
    val context = LocalContext.current
    val repo = remember { LibraryHolder.repository(context) }
    val library by repo.library.collectAsState()
    val state by repo.state.collectAsState()
    val downloads by repo.downloads.collectAsState()
    val bulk by repo.bulk.collectAsState()
    val scope = rememberCoroutineScope()
    var search by remember { mutableStateOf("") }
    var tagIds by remember { mutableStateOf(emptySet<Int>()) }
    var playlistId by remember { mutableStateOf<Int?>(null) }
    var sort by remember { mutableStateOf(SortColumn.DATE_ADDED) }
    var follow by remember { mutableStateOf(false) }
    var knownOnly by remember { mutableStateOf(false) }
    var settings by remember { mutableStateOf(false) }
    var url by remember { mutableStateOf(repo.baseUrl) }
    var pair by remember { mutableStateOf(repo.pairCode.orEmpty()) }
    val discovery = remember { DesktopDiscovery(context) }
    val found by discovery.found.collectAsState()
    var pairing by remember { mutableStateOf<PairingState>(PairingState.Idle) }
    DisposableEffect(settings) { if (settings) discovery.start(); onDispose { discovery.stop() } }
    var error by remember { mutableStateOf<String?>(null) }
    /** Track awaiting a second tap because the target deck is playing. */
    var confirm by remember { mutableStateOf<Int?>(null) }

    val references = model.visibleDecks.mapNotNull { LibraryHolder.trackOn(model, it) }
    val targetTrack = LibraryHolder.trackOn(model, target)
    val query = LibraryQuery(playlistId = playlistId, search = search, tagIds = tagIds, sort = sort, descending = sort == SortColumn.DATE_ADDED)
    val lib = library
    val rows: List<Pair<LibraryTrack, FollowRow?>> = remember(lib, query, follow, knownOnly, references) {
        when {
            lib == null -> emptyList()
            follow && references.isNotEmpty() -> lib.follow(references, lib.followParams.copy(knownOnly = knownOnly || lib.followParams.knownOnly), within = query).map { it.track to it }
            else -> lib.query(query).map { it to null }
        }
    }

    Column(modifier.background(Ink.background).border(2.dp, deckColor(target)).padding(6.dp)) {
        Row(Modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("$target / LIBRARY", color = deckColor(target), size = 18, bold = true)
                Text(syncLine(state), color = if (state.error != null) Ink.warning else Ink.muted, size = 11)
            }
            Key(if (state.running) "…" else "SYNC", Modifier.width(64.dp).fillMaxHeight(), Ink.play, !state.running) { scope.launch { repo.sync() } }
            Key("⚙", Modifier.width(48.dp).fillMaxHeight(), engaged = settings, description = "Library settings") { settings = !settings }
            Key("FILES", Modifier.width(56.dp).fillMaxHeight(), description = "Local files") { localFiles() }
            Key("CLOSE", Modifier.width(64.dp).fillMaxHeight()) { model.browser = null }
        }
        if (settings) Column(Modifier.fillMaxWidth().border(1.dp, Ink.edge).padding(6.dp)) {
            Text(if (LibraryHolder.isPaired(context)) "Paired · ${repo.baseUrl}" else "Desktops on this network (Phone sync on)", color = Ink.muted, size = 11)
            for (desktop in found) Row(Modifier.fillMaxWidth().height(44.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("${desktop.name}  ${desktop.host}:${desktop.port}", Modifier.weight(1f), Ink.text, 12)
                Key("PAIR", Modifier.width(72.dp).fillMaxHeight(), Ink.play) { LibraryHolder.pair(context, desktop) { pairing = it } }
            }
            when (val p = pairing) {
                is PairingState.AwaitingApproval -> Text("Approve on ${p.desktop} — code ${p.matchCode}", color = Ink.warning, size = 16, bold = true)
                is PairingState.Paired -> Text("Paired with ${p.desktop}", color = Ink.play, size = 12)
                is PairingState.Failed -> Text(p.reason, color = Ink.warning, size = 12)
                PairingState.Requesting -> Text("Asking…", color = Ink.muted, size = 12)
                PairingState.Idle -> {}
            }
            Text("Desktop URL: http://<desktop ip>:<port> from desktop Settings › Library › Phone sync (or 127.0.0.1:8127 over adb reverse)", color = Ink.muted, size = 11, lines = 2)
            Field(url, Modifier.fillMaxWidth().height(40.dp)) { url = it; LibraryHolder.setUrl(context, it) }
            Text("Pairing code", color = Ink.muted, size = 11)
            Field(pair, Modifier.fillMaxWidth().height(40.dp), placeholder = "XXXXX-XXXXX") { pair = it; LibraryHolder.setPairCode(context, it) }
            val plan = remember(lib, playlistId, bulk.running, state.audioCount) { repo.bulkPlan(playlistId) }
            Text(bulkLine(bulk, plan, lib?.let { l -> playlistId?.let(l::playlist)?.name }), color = if (bulk.error != null || !plan.fits) Ink.warning else Ink.muted, size = 11, lines = 2)
            Row(Modifier.fillMaxWidth().height(48.dp)) {
                if (bulk.running) Key("CANCEL DOWNLOAD", Modifier.weight(1f).fillMaxHeight(), Ink.warning) { LibraryHolder.cancelDownloadAll(context) }
                else Key(if (playlistId != null) "DOWNLOAD PLAYLIST" else "DOWNLOAD ALL", Modifier.weight(1f).fillMaxHeight(), Ink.play, plan.tracks.isNotEmpty() && plan.fits) {
                    LibraryHolder.downloadAll(context, playlistId)
                }
                Key("CLEAR AUDIO", Modifier.weight(1f).fillMaxHeight(), Ink.warning, !state.running && !bulk.running) { scope.launch { repo.clearAudio() } }
            }
        }
        Row(Modifier.fillMaxWidth().height(44.dp), verticalAlignment = Alignment.CenterVertically) {
            Field(search, Modifier.weight(1f).fillMaxHeight(), placeholder = "Search title, artist, file") { search = it }
            Key("FOLLOW", Modifier.width(72.dp).fillMaxHeight(), Ink.accent, references.isNotEmpty(), follow && references.isNotEmpty(), "Follow loaded tracks") { follow = !follow }
            if (follow) Key("KNOWN", Modifier.width(64.dp).fillMaxHeight(), Ink.accent, true, knownOnly, "Known only") { knownOnly = !knownOnly }
            else Key(sortLabel(sort), Modifier.width(64.dp).fillMaxHeight(), description = "Sort") {
                val sorts = if (playlistId != null) listOf(SortColumn.PLAY_ORDER) + SORTS else SORTS
                sort = sorts[(sorts.indexOf(sort) + 1) % sorts.size]
            }
        }
        lib?.takeIf { it.playlists.isNotEmpty() }?.let { l ->
            Row(Modifier.fillMaxWidth().height(32.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Chip("ALL TRACKS", Ink.accent, playlistId == null) { playlistId = null; if (sort == SortColumn.PLAY_ORDER) sort = SortColumn.DATE_ADDED }
                for (playlist in l.playlists) Chip("≡ ${playlist.name} ${playlist.trackIds.size}", playlist.argb?.let(::Color) ?: Ink.accent, playlistId == playlist.id) {
                    playlistId = playlist.id; sort = SortColumn.PLAY_ORDER
                }
            }
        }
        lib?.let { l ->
            Row(Modifier.fillMaxWidth().height(32.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (tag in l.tags) {
                    val on = tag.id in tagIds
                    Chip(tag.name, tag.argb?.let(::Color) ?: Ink.muted, on) { tagIds = if (on) tagIds - tag.id else tagIds + tag.id }
                }
            }
        }
        confirm?.let { id -> Text("$target IS PLAYING · tap ${lib?.track(id)?.title} again to replace", Modifier.fillMaxWidth().clickable { confirm = null }, Ink.warning, 12, true, lines = 2) }
        (error ?: state.error)?.let { Text(it, Modifier.fillMaxWidth().clickable { error = null }, Ink.warning, 11, lines = 2) }
        if (lib == null) Text(
            "No library yet. On the desktop: adb -s <device> reverse tcp:8127 tcp:<backend port>, then SYNC.",
            Modifier.padding(8.dp), Ink.muted, lines = 4,
        )
        else Text("${rows.size} of ${playlistId?.let { lib.playlistTracks(it).size } ?: lib.tracks.size}${if (follow && references.isNotEmpty()) " · following ${references.size}" else ""}", color = Ink.muted, size = 11)
        LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
            var lastSection: String? = null
            for ((track, followRow) in rows) {
                val section = followRow?.label
                if (section != null && section != lastSection) {
                    lastSection = section
                    item(key = "section-$section") { Text(section, Modifier.padding(top = 6.dp, bottom = 2.dp), Ink.accent, 12, true) }
                }
                item(key = track.id) {
                    TrackRow(lib!!, track, followRow, targetTrack, downloads[track.id] ?: repo.audioState(track), deckColor(target)) {
                        if (model.decks.getValue(target).snapshot?.playing == true && confirm != track.id) confirm = track.id
                        else { confirm = null; LibraryHolder.load(context, model, target, track) { error = "Load failed: $it" } }
                    }
                }
            }
        }
    }
}

@Composable private fun TrackRow(lib: Library, track: LibraryTrack, followRow: FollowRow?, deckTrack: Int?, audio: AudioState, accent: Color, load: () -> Unit) {
    val marks = lib.marks(deckTrack, track.id)
    val tags = lib.tagsOf(track)
    Column(
        Modifier.fillMaxWidth().padding(vertical = 2.dp).border(1.dp, Ink.edge)
            .clickable(enabled = audio != AudioState.Unavailable && audio !is AudioState.Downloading, onClick = load)
            .semantics { contentDescription = "Load ${track.title}" }.padding(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val mark = when (marks.transition) { TransitionMark.FAVORITED -> "★ "; TransitionMark.SAVED -> "◆ "; TransitionMark.NONE -> "" } + if (marks.linked) "🔗 " else ""
            Text(mark + track.title, Modifier.weight(1f), Ink.text, 13, true)
            Text(listOfNotNull(track.bpm?.let { "%.1f".format(it) }, track.keyCamelot).joinToString("  "), color = accent, size = 12, bold = true)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(track.artist ?: "—", Modifier.weight(1f), Ink.muted, 11)
            Text(listOfNotNull(track.durationSecs?.let(::clock), track.dateAdded?.let(DATE::format), audioLabel(audio)).joinToString(" · "), color = Ink.muted, size = 11)
        }
        Preview(lib.preview(track), Modifier.fillMaxWidth().height(22.dp))
        if (tags.isNotEmpty() || followRow != null) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            followRow?.let { Text(evidence(it), color = Ink.accent, size = 10) }
            for (tag in tags) {
                val matched = followRow?.matchedTagIds?.contains(tag.id) == true
                Text(tag.name, Modifier.border(1.dp, tag.argb?.let(::Color) ?: Ink.edge).padding(horizontal = 3.dp), if (followRow == null || matched) Ink.text else Ink.muted, 10)
            }
        }
    }
}

/** 256-bin desktop preview: height = broadband peak, color = additive low/mid/high (desktop default style). */
@Composable private fun Preview(wf: PreviewWaveform?, modifier: Modifier) {
    Canvas(modifier.background(Ink.panel)) {
        if (wf == null || wf.bins == 0) return@Canvas
        val step = size.width / wf.bins
        val mid = size.height / 2
        for (i in 0 until wf.bins) {
            val h = wf.amplitude(i) * mid
            val f = (i.toLong() * wf.bandFrames / wf.bins).toInt().coerceAtMost(wf.bandFrames - 1)
            val lo = wf.low[f]; val mi = wf.mid[f]; val hi = wf.high[f]
            // Hue from the band mix, brightness normalized: saturated at any level.
            val r = lo + .2f * hi; val g = .1f * lo + mi + .45f * hi; val b = .1f * lo + .25f * mi + hi
            val peak = maxOf(r, g, b, 1e-3f)
            val color = Color(r / peak, g / peak, b / peak)
            val x = i * step + step / 2
            drawLine(color, Offset(x, mid - h), Offset(x, mid + h), step.coerceAtLeast(1f))
        }
    }
}

@Composable private fun Chip(label: String, color: Color, on: Boolean, toggle: () -> Unit) {
    Box(Modifier.fillMaxHeight().border(1.dp, color).background(if (on) color.copy(alpha = .35f) else Color.Transparent)
        .clickable(onClick = toggle).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
        Text(label, color = if (on) Ink.text else color, size = 11)
    }
}

@Composable private fun Field(value: String, modifier: Modifier, placeholder: String = "", change: (String) -> Unit) {
    Box(modifier.border(1.dp, Ink.edge).padding(horizontal = 6.dp), contentAlignment = Alignment.CenterStart) {
        if (value.isEmpty()) Text(placeholder, color = Ink.muted, size = 13)
        BasicTextField(value, change, Modifier.fillMaxWidth(), singleLine = true, textStyle = TextStyle(color = Ink.text, fontSize = 14.sp), cursorBrush = SolidColor(Ink.accent))
    }
}

private fun syncLine(s: SyncState) = when {
    s.running -> s.phase ?: "Syncing…"
    s.error != null -> s.error!!
    s.lastSynced == null && s.trackCount == 0 -> "Not synced"
    else -> "${s.trackCount} tracks · ${s.previewCount} waveforms · ${s.audioCount} audio cached" + (s.lastSynced?.let { " · ${DATE.format(it)}" } ?: "")
}

private fun sortLabel(s: SortColumn) = when (s) {
    SortColumn.PLAY_ORDER -> "ORDER"; SortColumn.DATE_ADDED -> "NEW"; SortColumn.TITLE -> "TITLE"; SortColumn.ARTIST -> "ARTST"; SortColumn.BPM -> "BPM"; SortColumn.KEY -> "KEY"
    else -> s.name
}

private fun audioLabel(a: AudioState) = when (a) {
    AudioState.Cached -> "●"
    AudioState.Remote -> "○"
    AudioState.Unavailable -> "no file"
    is AudioState.Downloading -> a.fraction?.let { "${(it * 100).toInt()}%" } ?: "↓"
}

private fun evidence(row: FollowRow) = row.displayScore?.let { "Match ${it.toInt()}" + (if (row.keyMatched) " · key" else "") + (if (row.sharedArtist) " · artist" else "") } ?: row.label

private fun bulkLine(bulk: BulkState, plan: BulkPlan, playlist: String?): String = when {
    bulk.running -> "Downloading ${bulk.tracksDone}/${bulk.tracksTotal} · ${formatBytes(bulk.bytesDone)} / ${formatBytes(bulk.bytesTotal)}${bulk.current?.let { " · $it" }.orEmpty()}"
    bulk.error != null -> bulk.error!!
    plan.tracks.isEmpty() -> "Offline: ${playlist ?: "whole library"} downloaded"
    !plan.fits -> "Offline: needs ${formatBytes(plan.remainingBytes)}, ${formatBytes(plan.freeBytes)} free"
    else -> "Offline: ${plan.tracks.size} tracks to download (${formatBytes(plan.remainingBytes)}) · ${playlist ?: "whole library"}"
}
