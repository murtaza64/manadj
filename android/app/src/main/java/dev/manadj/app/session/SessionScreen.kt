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
    DisposableEffect(Unit) { onDispose { model.leave() } }
    Column(modifier.background(Ink.background).testTag("session-screen")) {
        val log = model.log
        Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Key("", Modifier.size(44.dp), Ink.text, icon = Glyph.Close, description = "Close Sessions") { close() }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(if (log == null) "SESSIONS" else "SESSION · ${model.header?.startedAt?.let(::dateLabel) ?: ""}", bold = true, size = 15)
                Text(if (log == null) "${model.headers.size} from the desktop · replay on all four decks" else "${hms(log.end - log.activeStart)} · ${log.appearances.size} loads · ${log.events.size} events", color = Ink.muted, size = 10)
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

private fun dateLabel(iso: String): String = iso.replace('T', ' ').take(16)

@Composable private fun SessionList(model: SessionModel) {
    model.listError?.let { Text("Session list: $it${if (model.headers.isNotEmpty()) " · showing the cached list" else ""}", Modifier.padding(12.dp), Ink.warning, 11, lines = 3) }
    if (model.headers.isEmpty() && !model.refreshing) Text("No Sessions yet. Sessions are recorded by the desktop app while you play.", Modifier.padding(12.dp), Ink.muted, 12, lines = 3)
    LazyColumn(Modifier.fillMaxSize().testTag("session-list")) {
        items(model.headers, key = { it.uuid }) { h ->
            val opening = model.opening == h.uuid
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(enabled = model.opening == null) { model.open(h) }.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(h.startedAt?.let(::dateLabel) ?: h.uuid, bold = true)
                    Text(listOfNotNull(sessionLength(h), if (h.takeCount > 0) "${h.takeCount} takes" else null, if (h.endedAt == null) "OPEN" else null, if (model.isCached(h)) "ON PHONE" else null).joinToString(" · "), color = Ink.muted, size = 11)
                }
                Text(if (opening) "LOADING…" else "›", color = Ink.accent, size = if (opening) 11 else 18, bold = true)
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.edge))
        }
    }
}

private fun sessionLength(h: SessionHeader): String? = runCatching {
    val a = java.time.LocalDateTime.parse(h.startedAt!!.take(19)); val b = java.time.LocalDateTime.parse(h.endedAt!!.take(19))
    hms(java.time.Duration.between(a, b).seconds.toDouble())
}.getOrNull()

@Composable private fun ColumnScope.Replay(model: SessionModel, player: PlayerModel, ux: UiModel, log: SessionLog) {
    val frame = remember(log, model.time) { log.at(model.time) }
    var issuesOpen by remember(log) { mutableStateOf(false) }
    val drift = model.recordingDrift
    // One warning line (space): not-reproduced vocabulary + recording drift; tap for the issue list.
    if (log.issues.isNotEmpty() || drift.isNotEmpty()) {
        val counts = log.issues.groupingBy { it.what.substringBefore(" (") }.eachCount()
        Column(Modifier.fillMaxWidth().background(Ink.crust).clickable { issuesOpen = !issuesOpen }.padding(horizontal = 12.dp, vertical = 3.dp)) {
            Row {
                if (counts.isNotEmpty()) Text("NOT REPRODUCED: " + counts.entries.joinToString(" · ") { "${it.key} ×${it.value}" } + "   ", color = Ink.warning, size = 10, lines = if (issuesOpen) 4 else 1)
                // Bad recording data, not a replay fault: replay follows the recorded rates and never corrects toward ticks.
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

/** Landscape (primary): each lane's deck panel sits beside its timeline lane; transport along the bottom. */
@Composable private fun LandscapeReplay(model: SessionModel, player: PlayerModel, ux: UiModel, log: SessionLog, tl: SessionTimeline, lanes: IntArray, frame: SessionState, height: androidx.compose.ui.unit.Dp) {
    val bar = 52.dp
    val lane = ((height - bar - RULER - GAP * (lanes.size - 1) - 6.dp) / lanes.size).coerceIn(40.dp, 180.dp)
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().weight(1f).padding(top = 4.dp)) {
            Column(Modifier.width(184.dp)) {
                Spacer(Modifier.height(RULER))
                for ((i, d) in lanes.withIndex()) {
                    if (i > 0) Spacer(Modifier.height(GAP))
                    DeckPanel(d, model, player, ux, frame, Modifier.fillMaxWidth().height(lane))
                }
            }
            SessionTimelineView(model, player, log, tl, lanes, lane, RULER, Modifier.weight(1f).padding(end = 8.dp), GAP)
        }
        Row(Modifier.fillMaxWidth().height(bar).padding(horizontal = 6.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            StatusReadout(model, log, frame, Modifier.width(280.dp).padding(start = 8.dp))
            Spacer(Modifier.weight(1f))
            TimelineKeys(model, Modifier.fillMaxHeight())
            Spacer(Modifier.width(8.dp))
            TransportKeys(model, player, log, Modifier.width(340.dp).fillMaxHeight())
        }
    }
}

/** Portrait (compact): deck strips, the timeline, the track loads list, transport. */
@Composable private fun PortraitReplay(model: SessionModel, player: PlayerModel, ux: UiModel, log: SessionLog, tl: SessionTimeline, lanes: IntArray, frame: SessionState) {
    Column(Modifier.fillMaxSize()) {
        for (d in lanes) DeckStrip(d, model, player, ux, frame)
        Row(Modifier.fillMaxWidth().height(40.dp).padding(start = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("TIMELINE", Modifier.weight(1f), Ink.muted, 11, bold = true)
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

private class DeckView(val track: dev.manadj.library.LibraryTrack?, val status: String, val audible: Boolean, val engineHolds: Boolean, val meta: String)

@Composable private fun deckView(d: Int, model: SessionModel, player: PlayerModel, ux: UiModel, frame: SessionState): DeckView {
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

@Composable private fun DeckWave(d: Int, model: SessionModel, player: PlayerModel, ux: UiModel, v: DeckView, modifier: Modifier) {
    val id = deckId(d)
    val ui = player.decks.getValue(id)
    if (v.engineHolds) {
        val moving = ui.snapshot.let { it?.playing == true || it?.previewing == true }
        val tick = frameNanos(moving)
        WaveView(ux.waves[ui.source!!.id], { val out = player.output; if (out != null && tick.value != 0L && ui.snapshot?.sourceId == ui.source?.id) out.audibleSeconds(id, tick.value) else position(ui) },
            ui.durationSeconds, marksOf(ui), modifier, windowSeconds = 8.0, accent = deckColor(id), live = { ux.strip(ui) })
    } else {
        val error = model.deckErrors[d]
        Box(modifier.background(Ink.crust), contentAlignment = Alignment.CenterStart) {
            Text(error ?: if (v.status == "EMPTY") "" else if (model.playing || model.preparing) "loading…" else "loads on PLAY", Modifier.padding(horizontal = 6.dp), if (error != null) Ink.pending else Ink.muted, 10)
        }
    }
}

@Composable private fun DeckStrip(d: Int, model: SessionModel, player: PlayerModel, ux: UiModel, frame: SessionState) {
    val v = deckView(d, model, player, ux, frame)
    val color = deckColor(deckId(d))
    val s = frame.decks[d]
    Row(Modifier.fillMaxWidth().height(46.dp).testTag("session-deck-${DECKS[d]}").semantics { contentDescription = "Deck ${DECKS[d]}: ${v.track?.title ?: "empty"}, ${v.status}" }
        .padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(DECKS[d], Modifier.width(22.dp), if (s.trackId == null) Ink.surface2 else color, 19, true)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(v.track?.title ?: s.trackId?.let { "Track #$it (not in Library)" } ?: "—", Modifier.weight(1f), if (v.audible) Ink.text else Ink.muted, 11, v.audible)
                Text(" ${v.meta} ", color = Ink.muted, size = 10)
                Text(v.status, color = if (v.status == "FAILED") Ink.pending else color, size = 9, bold = true)
            }
            Spacer(Modifier.height(2.dp))
            DeckWave(d, model, player, ux, v, Modifier.fillMaxWidth().height(24.dp))
        }
    }
}

/** Landscape lane header: deck letter, title, tempo/key/position and status over the deck's live detail wave. */
@Composable private fun DeckPanel(d: Int, model: SessionModel, player: PlayerModel, ux: UiModel, frame: SessionState, modifier: Modifier) {
    val v = deckView(d, model, player, ux, frame)
    val color = deckColor(deckId(d))
    val s = frame.decks[d]
    Row(modifier.testTag("session-deck-${DECKS[d]}").semantics { contentDescription = "Deck ${DECKS[d]}: ${v.track?.title ?: "empty"}, ${v.status}" }.padding(start = 8.dp, end = 6.dp)) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(if (v.audible) color else color.copy(alpha = .25f)))
        Spacer(Modifier.width(6.dp))
        Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(DECKS[d], Modifier.width(16.dp), if (s.trackId == null) Ink.surface2 else color, 15, true)
                Text(v.track?.title ?: s.trackId?.let { "Track #$it" } ?: "—", Modifier.weight(1f), if (v.audible) Ink.text else Ink.muted, 11, v.audible)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(v.meta, Modifier.weight(1f), Ink.muted, 9)
                Text(v.status, color = if (v.status == "FAILED") Ink.pending else color, size = 9, bold = true)
            }
            DeckWave(d, model, player, ux, v, Modifier.fillMaxWidth().weight(1f))
        }
    }
}
