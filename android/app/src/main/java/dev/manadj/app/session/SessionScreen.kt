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
    if (log.issues.isNotEmpty()) {
        val counts = log.issues.groupingBy { it.what.substringBefore(" (") }.eachCount()
        Column(Modifier.fillMaxWidth().background(Ink.crust).clickable { issuesOpen = !issuesOpen }.padding(horizontal = 12.dp, vertical = 5.dp)) {
            Text("NOT REPRODUCED: " + counts.entries.joinToString(" · ") { "${it.key} ×${it.value}" }, color = Ink.warning, size = 10, lines = if (issuesOpen) 4 else 1)
            if (issuesOpen) log.issues.take(12).forEach { Text("${hms(it.t - log.activeStart)} ${it.deck?.let(DECKS::get) ?: "–"} ${it.what}", color = Ink.muted, size = 10) }
        }
    }
    val drift = model.recordingDrift
    if (drift.isNotEmpty()) {
        // Bad recording data, not a replay fault: replay follows the recorded rates and never corrects toward ticks.
        Text("RECORDING DRIFT: ${drift.size} tick${if (drift.size == 1) "" else "s"} off by > 5 ms (worst %.0f ms) · not corrected".format(drift.maxOf { kotlin.math.abs(it.seconds) } * 1000),
            Modifier.fillMaxWidth().background(Ink.crust).padding(horizontal = 12.dp, vertical = 4.dp).testTag("session-drift"), Ink.warning, 10)
    }
    for (d in 0..3) DeckStrip(d, model, player, ux, frame, log)
    Row(Modifier.fillMaxWidth().height(40.dp).padding(start = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("TIMELINE", Modifier.weight(1f), Ink.muted, 11, bold = true)
        Key("−", Modifier.size(44.dp, 36.dp), Ink.text, description = "Zoom out") { model.zoom(.5) }
        Key("+", Modifier.size(44.dp, 36.dp), Ink.text, description = "Zoom in") { model.zoom(2.0) }
        Key("FIT", Modifier.size(48.dp, 36.dp), Ink.text) { model.fit() }
        Key("", Modifier.size(44.dp, 36.dp), Ink.accent, engaged = model.follow, icon = Glyph.Follow, description = "Follow playhead") { model.follow = !model.follow }
    }
    Timeline(model, player, log)
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
            val current = model.time >= a.start && model.time < a.end && frame.audible(a.deck)
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).background(if (current) Ink.crust else Ink.background)
                .clickable { model.seek(a.firstSound ?: a.start, player) }.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(DECKS[a.deck], Modifier.width(24.dp), deckColor(deckId(a.deck)), 17, true)
                Column(Modifier.weight(1f)) {
                    Text(t?.title ?: "Track #${a.trackId} (not in Library)", color = if (t == null) Ink.warning else Ink.text, bold = current)
                    Text("${hms(a.start - log.activeStart)}–${hms(a.end - log.activeStart)}${t?.artist?.let { " · $it" } ?: ""}${if (a.firstSound == null) " · loaded only" else ""}", color = Ink.muted, size = 10)
                }
                if (current) Text("●", color = deckColor(deckId(a.deck)), size = 16)
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.edge))
        }
    }
    Row(Modifier.fillMaxWidth().height(26.dp).background(Ink.crust).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(hms(model.time - log.activeStart), Modifier.weight(1f).testTag("session-time"), Ink.playhead, 15, true)
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
        Text(" / ${hms(log.end - log.activeStart)}", size = 12)
    }
    Row(Modifier.fillMaxWidth().height(56.dp).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Key("|‹", Modifier.weight(1f).fillMaxHeight(), Ink.text, description = "Session start") { model.seek(log.activeStart, player); model.fit() }
        Key("−10", Modifier.weight(1f).fillMaxHeight(), Ink.text) { model.seek(model.time - 10, player) }
        val active = model.playing || model.preparing
        Key(if (model.preparing) "LOADING" else if (model.playing) "PAUSE" else "PLAY", Modifier.weight(1.6f).fillMaxHeight().testTag("session-play"), Ink.play, engaged = active,
            icon = if (active) Glyph.Pause else Glyph.Play, description = if (active) "Pause Session" else "Play Session") { model.toggle(player) }
        Key("+10", Modifier.weight(1f).fillMaxHeight(), Ink.text) { model.seek(model.time + 10, player) }
    }
}

@Composable private fun DeckStrip(d: Int, model: SessionModel, player: PlayerModel, ux: UiModel, frame: SessionState, log: SessionLog) {
    val id = deckId(d)
    val ui = player.decks.getValue(id)
    val s = frame.decks[d]
    val track = model.track(s.trackId)
    val audible = frame.audible(d)
    val color = deckColor(id)
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
    Row(Modifier.fillMaxWidth().height(50.dp).testTag("session-deck-${DECKS[d]}").semantics { contentDescription = "Deck ${DECKS[d]}: ${track?.title ?: "empty"}, $status" }
        .padding(horizontal = 8.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(DECKS[d], Modifier.width(22.dp), if (s.trackId == null) Ink.surface2 else color, 19, true)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(track?.title ?: s.trackId?.let { "Track #$it (not in Library)" } ?: "—", Modifier.weight(1f), if (audible) Ink.text else Ink.muted, 11, audible)
                val bpm = (track?.bpm ?: s.bpm)?.let { "%.1f".format(it * (1 + s.pitch / 100)) } ?: "—"
                Text(" $bpm · ${track?.keyCamelot ?: "—"} · ${hms(s.playhead)} ", color = Ink.muted, size = 10)
                Text(status, color = if (status == "FAILED") Ink.pending else color, size = 9, bold = true)
            }
            Spacer(Modifier.height(2.dp))
            if (engineHolds) {
                val moving = ui.snapshot.let { it?.playing == true || it?.previewing == true }
                val tick = frameNanos(moving)
                WaveView(ux.waves[ui.source!!.id], { val out = player.output; if (out != null && tick.value != 0L && ui.snapshot?.sourceId == ui.source?.id) out.audibleSeconds(id, tick.value) else position(ui) },
                    ui.durationSeconds, marksOf(ui), Modifier.fillMaxWidth().height(26.dp), windowSeconds = 8.0, accent = color, live = { ux.strip(ui) })
            } else {
                val error = model.deckErrors[d]
                Box(Modifier.fillMaxWidth().height(26.dp).background(Ink.crust), contentAlignment = Alignment.CenterStart) {
                    Text(error ?: if (s.trackId == null) "" else if (model.playing || model.preparing) "loading…" else "loads when you press PLAY", Modifier.padding(horizontal = 6.dp), if (error != null) Ink.pending else Ink.muted, 10)
                }
            }
        }
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.edge))
}

/** Per-deck audibility sampled across the whole Session (bit d = deck d audible). */
private class AudibleTrace(val start: Double, val step: Double, val bits: ByteArray)

@Composable private fun Timeline(model: SessionModel, player: PlayerModel, log: SessionLog) {
    val trace by produceState<AudibleTrace?>(null, log) {
        value = withContext(Dispatchers.Default) {
            val span = log.end - log.activeStart
            val step = maxOf(.25, span / 20000)
            val n = (span / step).toInt()
            AudibleTrace(log.activeStart, step, ByteArray(n + 1) { i -> val s = log.at(log.activeStart + i * step); (0..3).fold(0) { m, d -> if (s.audible(d)) m or (1 shl d) else m }.toByte() })
        }
    }
    val marks = remember(log) {
        log.events.filterIsInstance<CaptureEvent.Transport>().filter { it.action in setOf("hotCue", "jumpBeats", "cue", "seek") }.map { it.t to it.deck }
    }
    val label = remember { android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG) }
    Column {
        Row(Modifier.fillMaxWidth().height(16.dp).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(hms(model.viewStart - log.activeStart), color = Ink.muted, size = 10)
            Text("${hms(model.viewWidth)} WINDOW", color = Ink.muted, size = 10)
            Text(hms(model.viewStart + model.viewWidth - log.activeStart), color = Ink.muted, size = 10)
        }
        Canvas(Modifier.fillMaxWidth().height(112.dp).testTag("session-timeline")
            .semantics { contentDescription = "Four deck Session timeline; tap to seek, drag to pan, pinch to zoom" }
            .pointerInput(log) { detectTapGestures { p -> model.seek(model.viewStart + p.x / size.width * model.viewWidth, player) } }
            .pointerInput(log) { detectTransformGestures { centroid, pan, zoom, _ -> if (zoom != 1f) model.zoom(zoom.toDouble(), (centroid.x / size.width).toDouble()); if (pan.x != 0f) model.pan((-pan.x / size.width).toDouble()) } }) {
            val lane = size.height / 4
            fun x(t: Double) = ((t - model.viewStart) / model.viewWidth * size.width).toFloat()
            for (d in 0..3) {
                val c = deckColor(deckId(d))
                drawRect(c.copy(alpha = .06f), Offset(0f, lane * d), Size(size.width, lane - 2))
                drawRect(c, Offset(0f, lane * d), Size(3f, lane - 2))
            }
            // Loaded spans (dim) with the recorded-audible stretches bright.
            label.textSize = 9.sp.toPx(); label.color = android.graphics.Color.WHITE
            for (a in log.appearances) {
                val l = x(a.start).coerceIn(0f, size.width); val r = x(a.end).coerceIn(0f, size.width)
                if (r <= l) continue
                val c = deckColor(deckId(a.deck)); val y = lane * a.deck
                drawRect(c.copy(alpha = .18f), Offset(l, y + 2), Size(r - l, lane - 6))
                drawRect(c, Offset(l, y + 2), Size(1.5f, lane - 6))
            }
            trace?.let { tr ->
                val cols = size.width.toInt().coerceAtLeast(1)
                for (px in 0 until cols step 2) {
                    val t = model.viewStart + px.toDouble() / size.width * model.viewWidth
                    val i = ((t - tr.start) / tr.step).toInt()
                    if (i !in tr.bits.indices) continue
                    val bits = tr.bits[i].toInt()
                    for (d in 0..3) if (bits and (1 shl d) != 0) drawRect(deckColor(deckId(d)).copy(alpha = .75f), Offset(px.toFloat(), lane * d + lane * .3f), Size(2f, lane * .4f - 2))
                }
            }
            for (a in log.appearances) {
                val l = x(a.start).coerceAtLeast(0f); val r = x(a.end).coerceAtMost(size.width)
                if (r - l < 40) continue
                clipRect(l, lane * a.deck, r, lane * (a.deck + 1)) {
                    drawContext.canvas.nativeCanvas.drawText(model.track(a.trackId)?.title ?: "#${a.trackId}", l + 5, lane * a.deck + label.textSize + 2, label)
                }
            }
            for ((t, d) in marks) {
                val px = x(t)
                if (px in 0f..size.width) drawLine(Ink.orange, Offset(px, lane * d + lane * .7f), Offset(px, lane * (d + 1) - 2), 2f)
            }
            val p = x(model.time)
            if (p in 0f..size.width) drawLine(Ink.playhead, Offset(p, 0f), Offset(p, size.height), 3f)
        }
    }
}

