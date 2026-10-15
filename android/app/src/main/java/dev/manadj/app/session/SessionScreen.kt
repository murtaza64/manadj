package dev.manadj.app.session

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.manadj.app.*
import dev.manadj.audio.DeckId
import dev.manadj.audio.LoadState
import dev.manadj.library.AudioState
import dev.manadj.library.session.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private fun deckId(d: Int) = DeckId.entries[d]
private fun hms(seconds: Double): String { val s = seconds.coerceAtLeast(0.0).toInt(); return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else clock(s.toDouble()) }

/** Session replay (#378): Session list, then four-deck replay through the shared engine. */
@Composable fun SessionScreen(player: PlayerModel, ux: UiModel, modifier: Modifier) {
    val activity = androidx.compose.ui.platform.LocalContext.current as androidx.activity.ComponentActivity
    val model = remember(activity) { androidx.lifecycle.ViewModelProvider(activity)[SessionModel::class.java] }
    val close = { model.leave(); ux.sessions = false }
    BackHandler { if (model.log != null) model.close() else close() }
    LaunchedEffect(Unit) { if (model.headers.isEmpty() || model.listError == null) model.refresh() }
    // This phone's recordings (#395) appear as the recorder opens/ends them.
    LaunchedEffect(Unit) { while (true) { model.syncRecorded(); kotlinx.coroutines.delay(2000) } }
    // Leaving the screen stops replay; a configuration change (rotation, layout switch) must not: the
    // replay lives in the ViewModel and this composition is only rebuilt.
    DisposableEffect(Unit) { onDispose { if (!activity.isChangingConfigurations) model.leave() } }
    Column(modifier.background(Ink.background).testTag("session-screen")) {
        val log = model.log
        Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Key("", Modifier.size(44.dp), Ink.text, icon = Glyph.Close, description = "Close Sessions") { close() }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(if (log == null) "SESSIONS" else "SESSION · ${model.header?.startedAt?.let(::dateLabel) ?: ""}", bold = true, size = 15)
                Text(if (log == null) "${model.recorded.size} recorded here · ${model.headers.count { h -> model.recorded.none { it.uuid == h.uuid } }} from the desktop · replay on all four decks" else "${hms(log.end - log.activeStart)} · ${log.appearances.size} loads · ${log.events.size} events", color = Ink.muted, size = 10)
            }
            if (log != null) Key("LIST", Modifier.size(64.dp, 40.dp), Ink.accent) { model.close() }
            else Key(if (model.refreshing) "…" else "REFRESH", Modifier.size(88.dp, 40.dp), Ink.accent, enabled = !model.refreshing) { model.refresh() }
        }
        model.notice?.let { n ->
            Row(Modifier.fillMaxWidth().background(Ink.crust).clickable { model.notice = null }.padding(horizontal = 12.dp, vertical = 6.dp)) { Text(n, color = Ink.warning, size = 11, lines = 3) }
        }
        if (log == null) SessionList(model) else Replay(model, player, ux, log)
    }
}

private val dayFormat = java.time.format.DateTimeFormatter.ofPattern("EEE, MMM d, yyyy")
private val timeFormat = java.time.format.DateTimeFormatter.ofPattern("HH:mm")
private fun local(iso: String?) = sessionInstant(iso)?.atZone(java.time.ZoneId.systemDefault())
private fun dateLabel(iso: String): String = local(iso)?.let { "${it.format(dayFormat)} ${it.format(timeFormat)}" } ?: iso

/** Desktop SessionsListView: local-day sections (newest first), longest Session first, 5 per day until expanded. */
@OptIn(ExperimentalFoundationApi::class)
@Composable private fun SessionList(model: SessionModel) {
    model.listError?.let { Text("Session list: $it${if (model.headers.isNotEmpty()) " · showing the cached list" else ""}", Modifier.padding(12.dp), Ink.warning, 11, lines = 3) }
    val all = model.sessions
    if (all.isEmpty() && !model.refreshing) Text("No Sessions yet. Sessions are recorded while you play, here and on the desktop.", Modifier.padding(12.dp), Ink.muted, 12, lines = 3)
    val now = remember(all) { java.time.Instant.now() }
    val days = remember(all) { groupSessionsByDay(all, now = now) }
    val expanded = rememberSaveable(saver = listSaver(save = { it.toList() }, restore = { it.toMutableStateList() })) { mutableStateListOf<String>() }
    LazyColumn(Modifier.fillMaxSize().testTag("session-list"), contentPadding = PaddingValues(bottom = 16.dp)) {
        for (day in days) {
            val key = day.day.toString()
            val open = key in expanded
            stickyHeader(key = "day-$key") {
                Row(Modifier.fillMaxWidth().background(Ink.background).padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 6.dp), verticalAlignment = Alignment.Bottom) {
                    Text(if (day.day == java.time.LocalDate.MIN) "UNDATED" else day.day.format(dayFormat).uppercase(), Modifier.weight(1f).testTag("session-day"), Ink.text, 12, bold = true)
                    Text("${day.sessions.size} ${if (day.sessions.size == 1) "SESSION" else "SESSIONS"}", color = Ink.muted, size = 10)
                }
            }
            items(if (open) day.sessions else day.sessions.take(5), key = { it.uuid }) { h -> SessionRow(model, h, now) }
            if (day.sessions.size > 5) item(key = "more-$key") {
                Text(if (open) "SHOW LESS" else "SHOW MORE (${day.sessions.size - 5})",
                    Modifier.fillMaxWidth().clickable { if (open) expanded.remove(key) else expanded.add(key) }.padding(horizontal = 16.dp, vertical = 12.dp), Ink.accent, 11, bold = true)
            }
        }
    }
}

@Composable private fun SessionRow(model: SessionModel, h: SessionHeader, now: java.time.Instant) {
    val opening = model.opening == h.uuid
    val cached = model.isCached(h)
    LaunchedEffect(h.uuid, cached) { model.summarize(h) }
    val ids = model.audibleTracks[h.uuid]
    val library by model.library.collectAsState()
    Column(Modifier.fillMaxWidth().clickable(enabled = model.opening == null) { model.open(h) }.testTag("session-row")) {
        Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).height(1.dp).background(Ink.surface0))
        Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.width(76.dp)) {
                Text(local(h.startedAt)?.format(timeFormat) ?: "—", color = Ink.text, size = 18, bold = true)
                Text(sessionLengthLabel(sessionSeconds(h, now)), color = Ink.muted, size = 11)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                val titles = ids?.take(3)?.map { library?.track(it)?.title ?: "#$it" }
                Text(when {
                    ids == null -> if (cached) "Reading tracks…" else "Tracks show once opened on the phone"
                    ids.isEmpty() -> "No audible tracks"
                    else -> titles!!.joinToString(" / ") + if (ids.size > 3) "  +${ids.size - 3}" else ""
                }, color = if (ids.isNullOrEmpty()) Ink.muted else Ink.text, size = 12, lines = 2)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(ids?.let { "${it.size} ${if (it.size == 1) "track" else "tracks"}" } ?: "– tracks", color = Ink.muted, size = 10)
                    Text("${h.takeCount} ${if (h.takeCount == 1) "take" else "takes"}", color = if (h.takeCount > 0) Ink.accent else Ink.muted, size = 10)
                    if (h.endedAt == null) Text(if (h.local) "RECORDING" else "LIVE", color = Ink.pending, size = 10, bold = true)
                    // Origin (#395): recorded on this phone (synced to the desktop or not yet) vs on the desktop.
                    when {
                        h.local -> Text(if (h.uuid in model.synced) "PHONE · SYNCED" else "PHONE", color = deckColor(DeckId.A), size = 10, bold = true)
                        h.origin != null -> Text("PHONE · ${h.origin}", color = deckColor(DeckId.A), size = 10, bold = true)
                        else -> Text("DESKTOP", color = Ink.muted, size = 10, bold = true)
                    }
                    if (cached && !h.local) Text("ON PHONE", color = Ink.play, size = 10, bold = true)
                }
            }
            Text(if (opening) "LOADING…" else "›", Modifier.padding(start = 8.dp), Ink.accent, if (opening) 11 else 20, true)
        }
    }
}

@Composable private fun ColumnScope.Replay(model: SessionModel, player: PlayerModel, ux: UiModel, log: SessionLog) {
    val frame = remember(log, model.time) { log.at(model.time) }
    var issuesOpen by remember(log) { mutableStateOf(false) }
    val drift = model.recordingDrift
    // One warning line (space): not-reproduced vocabulary + recording drift; tap for the issue list.
    val decode = model.decodeOffsets.filterKeys { id -> log.appearances.any { it.trackId == id } }.values.mapNotNull { it.engineOffsetMs }
    if (log.issues.isNotEmpty() || drift.isNotEmpty() || decode.any { kotlin.math.abs(it) > .5 }) {
        val counts = log.issues.groupingBy { it.what.substringBefore(" (") }.eachCount()
        Column(Modifier.fillMaxWidth().background(Ink.crust).clickable { issuesOpen = !issuesOpen }.padding(horizontal = 12.dp, vertical = 3.dp)) {
            Row {
                if (counts.isNotEmpty()) Text("NOT REPRODUCED: " + counts.entries.joinToString(" · ") { "${it.key} ×${it.value}" } + "   ", color = Ink.warning, size = 10, lines = if (issuesOpen) 4 else 1)
                // Bad recording data, not a replay fault: replay follows the recorded rates and never corrects toward ticks.
                // Decoder vs desktop placement of the audio (encoder delay / priming): decks would flam by the difference.
                if (decode.any { kotlin.math.abs(it) > .5 }) Text("DECODE vs DESKTOP: %d/%d tracks off, worst %+.1f ms   ".format(decode.count { kotlin.math.abs(it) > .5 }, decode.size, decode.maxBy { kotlin.math.abs(it) }),
                    Modifier.testTag("session-decode"), Ink.warning, 10)
                if (drift.isNotEmpty()) Text("RECORDING DRIFT: ${drift.size} tick${if (drift.size == 1) "" else "s"} > 5 ms (worst %.0f ms) · not corrected".format(drift.maxOf { kotlin.math.abs(it.seconds) } * 1000),
                    Modifier.testTag("session-drift"), Ink.warning, 10)
            }
            if (issuesOpen) log.issues.take(12).forEach { Text("${hms(it.t - log.activeStart)} ${it.deck?.let(DECKS::get) ?: "–"} ${it.what}", color = Ink.muted, size = 10) }
        }
    }
    val tl = model.timeline ?: return
    val lanes = remember(tl) { lanesOf(tl) }
    BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)) {
        if (maxWidth > maxHeight) LandscapeReplay(model, player, ux, log, tl, lanes, frame, maxHeight)
        else PortraitReplay(model, player, ux, log, tl, lanes, frame)
    }
}

private val RULER = 20.dp
private val GAP = 3.dp

/** Landscape (primary): deck strips (performance-style, adjacent) over the timeline; transport + crossfader along the bottom. */
@Composable private fun LandscapeReplay(model: SessionModel, player: PlayerModel, ux: UiModel, log: SessionLog, tl: SessionTimeline, lanes: IntArray, frame: SessionState, height: androidx.compose.ui.unit.Dp) {
    val bar = 52.dp
    val timeline = ((height - bar) * .36f).coerceAtLeast(RULER + 24.dp * lanes.size)
    val lane = ((timeline - RULER - GAP * (lanes.size - 1)) / lanes.size).coerceIn(16.dp, 120.dp)
    Column(Modifier.fillMaxSize()) {
        ReplayDeckStack(lanes, model, player, ux, log, frame, Modifier.fillMaxWidth().weight(1f))
        SessionTimelineView(model, player, log, tl, lanes, lane, RULER, Modifier.fillMaxWidth().padding(horizontal = 4.dp), GAP)
        Row(Modifier.fillMaxWidth().height(bar).padding(horizontal = 6.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            StatusReadout(model, log, frame, Modifier.width(280.dp).padding(start = 8.dp))
            Spacer(Modifier.weight(1f))
            ReplayCrossfader(frame, Modifier.width(96.dp))
            Spacer(Modifier.width(8.dp))
            ReplayLinkKey(model, player, ux, log, frame, Modifier.width(84.dp).fillMaxHeight())
            Spacer(Modifier.width(8.dp))
            TimelineKeys(model, Modifier.fillMaxHeight())
            Spacer(Modifier.width(8.dp))
            TransportKeys(model, player, log, Modifier.width(340.dp).fillMaxHeight())
        }
    }
}

/** Portrait (compact): deck strips, the timeline, the track loads list, transport. */
@Composable private fun PortraitReplay(model: SessionModel, player: PlayerModel, ux: UiModel, log: SessionLog, tl: SessionTimeline, lanes: IntArray, frame: SessionState) {
    Column(Modifier.fillMaxSize()) {
        ReplayDeckStack(lanes, model, player, ux, log, frame, Modifier.fillMaxWidth().height(76.dp * lanes.size))
        Row(Modifier.fillMaxWidth().height(40.dp).padding(start = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("TIMELINE", Modifier.weight(1f), Ink.muted, 11, bold = true)
            ReplayCrossfader(frame, Modifier.width(80.dp))
            Spacer(Modifier.width(8.dp))
            ReplayLinkKey(model, player, ux, log, frame, Modifier.width(72.dp).height(36.dp))
            Spacer(Modifier.width(8.dp))
            TimelineKeys(model, Modifier.height(36.dp))
        }
        SessionTimelineView(model, player, log, tl, lanes, when (lanes.size) { 4 -> 46.dp; 3 -> 56.dp; else -> 66.dp }, RULER, Modifier.padding(horizontal = 4.dp), GAP)
        Row(Modifier.fillMaxWidth().height(24.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("TRACK LOADS", Modifier.weight(1f), Ink.muted, 10, bold = true)
            Text("${log.appearances.size} · TAP TO JUMP", color = Ink.muted, size = 10)
        }
        // The list follows the clock: the newest load sounding now stays in view.
        val listState = androidx.compose.foundation.lazy.rememberLazyListState()
        val current = remember(log, frame) { log.appearances.indexOfLast { model.time >= it.start && model.time < it.end && frame.audible(it.deck) } }
        LaunchedEffect(current) { if (current >= 0 && model.follow) listState.animateScrollToItem((current - 1).coerceAtLeast(0)) }
        LazyColumn(Modifier.fillMaxWidth().weight(1f).testTag("session-tracklist"), state = listState) {
            itemsIndexed(log.appearances, key = { _, a -> "${a.deck}:${a.start}" }) { _, a ->
                val t = model.track(a.trackId)
                val now = model.time >= a.start && model.time < a.end && frame.audible(a.deck)
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).background(if (now) Ink.crust else Ink.background)
                    .clickable { model.seek(a.firstSound ?: a.start, player) }.padding(horizontal = 12.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(DECKS[a.deck], Modifier.width(24.dp), deckColor(deckId(a.deck)), 17, true)
                    Column(Modifier.weight(1f)) {
                        Text(t?.title ?: "Track #${a.trackId} (not in Library)", color = if (t == null) Ink.warning else Ink.text, bold = now)
                        Text("${hms(a.start - log.activeStart)}–${hms(a.end - log.activeStart)}${t?.artist?.let { " · $it" } ?: ""}${if (a.firstSound == null) " · loaded only" else ""}", color = Ink.muted, size = 10)
                    }
                    if (now) Text("●", color = deckColor(deckId(a.deck)), size = 16)
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.edge))
            }
        }
        StatusReadout(model, log, frame, Modifier.fillMaxWidth().height(26.dp).background(Ink.crust).padding(horizontal = 12.dp))
        TransportKeys(model, player, log, Modifier.fillMaxWidth().height(56.dp).padding(4.dp))
    }
}

@Composable private fun TimelineKeys(model: SessionModel, modifier: Modifier) {
    val held = model.followHeldUntil > System.nanoTime()
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Key("FIT", Modifier.width(52.dp).fillMaxHeight(), Ink.text, description = "Fit the whole Session") { model.fit() }
        Key("", Modifier.width(48.dp).fillMaxHeight(), Ink.accent, engaged = model.follow && !held, icon = Glyph.Follow, description = "Follow playhead") {
            if (model.follow && held) model.followHeldUntil = 0L else model.follow = !model.follow
        }
    }
}

@Composable private fun TransportKeys(model: SessionModel, player: PlayerModel, log: SessionLog, modifier: Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Key("|‹", Modifier.weight(1f).fillMaxHeight(), Ink.text, description = "Session start") { model.seek(log.activeStart, player); model.fit() }
        Key("−10", Modifier.weight(1f).fillMaxHeight(), Ink.text) { model.seek(model.time - 10, player) }
        val active = model.playing || model.preparing
        Key(if (model.preparing) "LOADING" else if (model.playing) "PAUSE" else "PLAY", Modifier.weight(1.6f).fillMaxHeight().testTag("session-play"), Ink.play, engaged = active,
            icon = if (active) Glyph.Pause else Glyph.Play, description = if (active) "Pause Session" else "Play Session") { model.toggle(player) }
        Key("+10", Modifier.weight(1f).fillMaxHeight(), Ink.text) { model.seek(model.time + 10, player) }
    }
}

@Composable private fun StatusReadout(model: SessionModel, log: SessionLog, frame: SessionState, modifier: Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(hms(model.time - log.activeStart), Modifier.testTag("session-time"), Ink.playhead, 15, true)
        Text(" of ${hms(log.end - log.activeStart)}  ", color = Ink.muted, size = 11)
        Spacer(Modifier.weight(1f))
        val offsets = model.engineOffsetMs.filterNotNull()
        if (model.playing && offsets.isNotEmpty()) {
            val worst = offsets.maxOf { kotlin.math.abs(it) }
            // Engine vs reference: sample-exact replay keeps this under one sample (0.02 ms at 48 kHz).
            Text("SYNC %.2f ms%s  ".format(worst, if (model.lateOps > 0) " · ${model.lateOps} late" else ""), Modifier.testTag("session-sync"),
                if (worst < .05 && model.lateOps == 0L) Ink.muted else Ink.warning, 10)
        }
        Text(when {
            model.preparing -> "LOADING DECKS…"
            frame.tenure != null && frame.tenure != "shared" -> "GAP · ${frame.tenure}"
            else -> "${(0..3).count(frame::audible)} AUDIBLE"
        }, color = Ink.muted, size = 10)
    }
}

internal class DeckView(val track: dev.manadj.library.LibraryTrack?, val status: String, val audible: Boolean, val engineHolds: Boolean, val meta: String)

@Composable internal fun deckView(d: Int, model: SessionModel, player: PlayerModel, ux: UiModel, frame: SessionState): DeckView {
    val id = deckId(d)
    val ui = player.decks.getValue(id)
    val s = frame.decks[d]
    val track = model.track(s.trackId)
    val audible = frame.audible(d)
    LaunchedEffect(ui.source?.id) { ux.ensureWave(ui.source, DeckId.entries.mapNotNull { player.decks.getValue(it).source?.id }.toSet()) }
    val engineHolds = ui.source?.id?.let { src -> track?.let { src == dev.manadj.app.library.LibraryHolder.sourceId(it) } } == true
    val downloads by ux.repo.downloads.collectAsState()
    val download = track?.let { downloads[it.id] }
    val status = when {
        s.trackId == null -> "EMPTY"
        model.deckErrors[d] != null -> "FAILED"
        download is AudioState.Downloading -> "↓ ${download.fraction?.let { "${(it * 100).toInt()}%" } ?: "…"}"
        (model.playing || model.preparing) && (!engineHolds || model.isLoading(d)) -> if (ui.snapshot?.fullyDecoded == false && engineHolds) "DECODING" else "LOADING"
        ui.snapshot?.loadState == LoadState.LOADING -> "DECODING"
        s.loop != null && s.playhead >= s.loop!!.start && s.playhead < s.loop!!.end -> "LOOP"
        s.previewing -> "PREVIEW"
        audible -> "AUDIBLE"
        s.playing -> "MUTED"
        else -> "PAUSED"
    }
    val bpm = (track?.bpm ?: s.bpm)?.let { "%.1f".format(it * (1 + s.pitch / 100)) } ?: "—"
    return DeckView(track, status, audible, engineHolds, "$bpm · ${track?.keyCamelot ?: "—"} · ${hms(s.playhead)}")
}
