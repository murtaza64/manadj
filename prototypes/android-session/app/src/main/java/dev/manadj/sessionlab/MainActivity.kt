package dev.manadj.sessionlab

import android.app.AlertDialog
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.*
import java.util.Locale
import kotlin.math.*

private val Ink = Color(0xFFEDEDED)
private val Muted = Color(0xFF999999)
private val Line = Color(0xFF272727)
private val Pink = Color(0xFFFF398A)
private val DeckColors = mapOf("A" to Color(0xFF00CCFF), "B" to Color(0xFFFF398A), "C" to Color(0xFF33EE77), "D" to Color(0xFFFFCC00))
private fun clock(seconds: Double): String = "%d:%02d".format(Locale.ROOT, max(0.0, seconds).toInt() / 60, max(0.0, seconds).toInt() % 60)
private fun bpm(value: Double?) = value?.let { "%.1f".format(Locale.ROOT, it) } ?: "—"
// Engine key IDs follow the circle of fifths, alternating major/minor (keyTable.generated.ts).
private fun key(value: Int?) = value?.takeIf { it in 0..23 }?.let { "${(it / 2 + 7) % 12 + 1}${if (it % 2 == 0) "B" else "A"}" } ?: "—"

class PlaybackModel(session: Session, tracks: Map<Int, Track>) {
    var session by mutableStateOf(session); private set
    var tracks by mutableStateOf(tracks)
    var time by mutableDoubleStateOf(session.start); private set
    var playing by mutableStateOf(false)
    var viewStart by mutableDoubleStateOf(session.start)
    var viewWidth by mutableDoubleStateOf(session.end - session.start)
    var follow by mutableStateOf(true)
    var selected by mutableStateOf<String?>(null)
    fun seek(t: Double) { time = t.coerceIn(session.start, session.end); if (time >= session.end) playing = false }
    fun advance(dt: Double) { if (playing) seek(time + dt); if (follow && (time < viewStart || time > viewStart + viewWidth)) viewStart = (time - viewWidth * .25).coerceIn(session.start, max(session.start, session.end - viewWidth)) }
    fun toggle() { if (time >= session.end) seek(session.start); playing = !playing }
    fun select(entry: Appearance) { selected = "${entry.deck}:${entry.start}"; seek(entry.firstSound ?: entry.start); viewStart = (time - viewWidth * .25).coerceIn(session.start, max(session.start, session.end - viewWidth)) }
    fun fit() { viewStart = session.start; viewWidth = session.end - session.start; follow = true }
    fun zoom(factor: Double, anchor: Double = .5) {
        val next = (viewWidth / factor).coerceIn(min(8.0, session.end - session.start), session.end - session.start)
        viewStart = (viewStart + anchor * (viewWidth - next)).coerceIn(session.start, max(session.start, session.end - next)); viewWidth = next
    }
    fun pan(fraction: Double) { follow = false; viewStart = (viewStart + fraction * viewWidth).coerceIn(session.start, max(session.start, session.end - viewWidth)) }
    fun replace(next: Session) { playing = false; session = next; time = next.start; tracks = emptyMap(); selected = null; fit() }
}

class MainActivity : ComponentActivity() {
    lateinit var model: PlaybackModel
    private var sessionText = ""
    private var tracksText = ""
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var importing by mutableStateOf(false)
    private var importKind = "session"
    private val importer = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            importing = true; model.playing = false
            try {
                val text = withContext(Dispatchers.IO) {
                    contentResolver.openInputStream(uri)!!.use { input ->
                        val bytes = input.readNBytes(8 * 1024 * 1024 + 1)
                        require(bytes.size <= 8 * 1024 * 1024) { "JSON exceeds 8 MiB import limit" }
                        bytes.toString(Charsets.UTF_8)
                    }
                }
                if (importKind == "session") {
                    val next = withContext(Dispatchers.Default) { Session.parse(text) }
                    model.replace(next); sessionText = text; tracksText = "[]"
                } else {
                    val next = withContext(Dispatchers.Default) { Session.tracks(text) }
                    model.tracks = model.tracks + next; tracksText = text
                }
            } catch (e: Exception) {
                AlertDialog.Builder(this@MainActivity).setTitle("Import refused").setMessage(e.message ?: "Invalid desktop JSON").setPositiveButton("OK", null).show()
            } finally { importing = false }
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        sessionText = assets.open("session.json").bufferedReader().use { it.readText() }
        tracksText = assets.open("tracks.json").bufferedReader().use { it.readText() }
        model = PlaybackModel(Session.parse(sessionText), Session.tracks(tracksText))
        setContent { SessionScreen(model, importing, onImport = {
            AlertDialog.Builder(this).setTitle("Desktop Session import")
                .setItems(arrayOf("Session JSON · GET /api/sessions/{uuid}", "Track metadata · GET /api/tracks", "Reload four-deck fixture")) { _, which ->
                    if (which == 2) {
                        model.replace(Session.parse(assets.open("session.json").bufferedReader().use { it.readText() }))
                        model.tracks = Session.tracks(assets.open("tracks.json").bufferedReader().use { it.readText() })
                    } else { importKind = if (which == 0) "session" else "tracks"; importer.launch(arrayOf("application/json", "text/plain")) }
                }.show()
        }, onInfo = {
            AlertDialog.Builder(this).setTitle("Session model · not audio")
                .setMessage((model.session.warnings + listOf("Track IDs are desktop-library scoped. Import metadata from the same server. Missing metadata stays unresolved, never substituted.", "Tap timeline: seek all decks. Drag: pan. Pinch or ±: zoom. Tap list occurrence: seek its first recorded sound. Pink line is the Session clock.", "Load/transport/pitch/ticks/loop/preview/control/tenure supported. Scratch, active FX/tails and unknown/versioned formats are refused. PFL/master and bend do not drive replay audio.", "No live performance controls or takeover surface here; pause/seek retain Session ownership. Backgrounding pauses.")).joinToString("\n\n"))
                .setPositiveButton("OK", null).show()
        }) }
    }
    override fun onPause() { super.onPause(); if (::model.isInitialized) model.playing = false }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}

@Composable private fun Label(text: String, modifier: Modifier = Modifier, color: Color = Ink, size: Int = 12, bold: Boolean = false) {
    BasicText(text, modifier, style = TextStyle(color = color, fontSize = size.sp, fontFamily = FontFamily.Monospace, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal), maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable private fun Action(text: String, description: String, modifier: Modifier = Modifier, active: Boolean = false, onClick: () -> Unit) {
    Box(modifier.heightIn(min = 48.dp).background(if (active) Color(0xFF34202A) else Color.Black)
        .semantics { contentDescription = description; role = Role.Button }.clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Label(text, color = if (active) Pink else Ink, size = 14, bold = true)
    }
}

@Composable fun SessionScreen(model: PlaybackModel, importing: Boolean = false, onImport: () -> Unit = {}, onInfo: () -> Unit = {}) {
    LaunchedEffect(model.playing) {
        if (model.playing) {
            var previous = withFrameNanos { it }
            while (model.playing) withFrameNanos { now -> model.advance((now - previous) / 1e9); previous = now }
        }
    }
    val frame = remember(model.session, model.time) { model.session.at(model.time) }
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black).safeDrawingPadding()) {
    val compact = maxHeight < 700.dp
    Column(Modifier.fillMaxSize().testTag("session-screen")) {
        Row(Modifier.fillMaxWidth().height(48.dp).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Label("manadj / SESSION", bold = true, size = 15); Label("${model.session.events.size} EVENTS · A–D", color = Muted, size = 10) }
            Action("IMPORT", "Import desktop Session", Modifier.width(72.dp), onClick = onImport)
            Action("?", "Compatibility and help", Modifier.width(48.dp), onClick = onInfo)
        }
        Row(Modifier.fillMaxWidth().height(if (compact) 18.dp else 24.dp).background(Color(0xFF191319)).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Label(if (importing) "READING DESKTOP JSON…" else "SILENT REPLAY · SYNTHETIC WAVEFORMS", color = Pink, size = 10)
        }
        DECKS.forEach { ch -> DeckStrip(ch, frame, model, compact) }
        Row(Modifier.fillMaxWidth().height(48.dp).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Label("TIMELINE", Modifier.weight(1f), color = Muted, size = 11, bold = true)
            Action("−", "Zoom out", Modifier.width(48.dp)) { model.zoom(.5) }
            Action("+", "Zoom in", Modifier.width(48.dp)) { model.zoom(2.0) }
            Action("FIT", "Fit whole Session", Modifier.width(48.dp)) { model.fit() }
            Action("↦", "Follow playhead", Modifier.width(48.dp), model.follow) { model.follow = !model.follow; model.advance(0.0) }
        }
        Timeline(model, compact)
        Row(Modifier.fillMaxWidth().height(26.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Label("TRACK OCCURRENCES", Modifier.weight(1f), color = Muted, size = 10, bold = true)
            Label("${model.session.appearances.size} · TAP TO SEEK", color = Muted, size = 10)
        }
        LazyColumn(Modifier.fillMaxWidth().weight(1f).testTag("tracklist")) {
            itemsIndexed(model.session.appearances, key = { _, e -> "${e.deck}:${e.start}" }) { index, e ->
                val track = model.tracks[e.trackId]
                val current = model.time >= e.start && model.time < e.end && frame.audible(e.deck)
                val selected = model.selected == "${e.deck}:${e.start}"
                Row(Modifier.fillMaxWidth().heightIn(min = 58.dp).background(if (selected) Color(0xFF20161D) else if (current) Color(0xFF111111) else Color.Black)
                    .testTag("occurrence-$index").semantics { contentDescription = "${e.deck} ${track?.title ?: "Unresolved track ${e.trackId}"}, seek ${clock((e.firstSound ?: e.start) - model.session.start)}" }
                    .clickable { model.select(e) }.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Label(e.deck, Modifier.width(26.dp), DeckColors.getValue(e.deck), 18, true)
                    Column(Modifier.weight(1f)) {
                        Label(track?.title ?: "Unresolved track #${e.trackId}", bold = current)
                        Label("${clock(e.start - model.session.start)}–${clock(e.end - model.session.start)} · ${if (e.firstSound == null) "loaded only" else "recorded"} · #${e.trackId}", color = Muted, size = 10)
                    }
                    Label(if (current) "●" else "›", color = DeckColors.getValue(e.deck), size = 18)
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(Line))
            }
        }
        Row(Modifier.fillMaxWidth().height(26.dp).background(Color(0xFF111111)).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Label(clock(model.time - model.session.start), Modifier.weight(1f).testTag("session-time"), Pink, 15, true)
            Label(if (frame.holder != null && frame.holder != "shared") "GAP · ${frame.holder}" else "${DECKS.count { frame.audible(it) }} RECORDED ACTIVE", color = Muted, size = 10)
            Label(" / ${clock(model.session.end - model.session.start)}", size = 12)
        }
        Row(Modifier.fillMaxWidth().height(56.dp)) {
            Action("|‹", "Session start", Modifier.weight(1f)) { model.seek(model.session.start); model.fit() }
            Action("−10", "Back ten seconds", Modifier.weight(1f)) { model.seek(model.time - 10); model.advance(0.0) }
            Action(if (model.playing) "PAUSE" else "PLAY", if (model.playing) "Pause Session" else "Play Session", Modifier.weight(1.6f).testTag("play"), model.playing) { model.toggle() }
            Action("+10", "Forward ten seconds", Modifier.weight(1f)) { model.seek(model.time + 10); model.advance(0.0) }
        }
    }
    }
}

@Composable private fun DeckStrip(ch: String, frame: Frame, model: PlaybackModel, compact: Boolean) {
    val d = frame.decks.getValue(ch)
    val track = model.tracks[d.trackId]
    val active = frame.audible(ch)
    Row(Modifier.fillMaxWidth().height(if (compact) 33.dp else 51.dp).testTag("deck-$ch").semantics { contentDescription = "Deck $ch, ${track?.title ?: d.trackId?.let { "unresolved $it" } ?: "idle"}, source ${clock(d.position)}, ${if (active) "recorded active" else "silent"}" }
        .padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Label(ch, Modifier.width(26.dp), DeckColors.getValue(ch), 21, true)
        Column(Modifier.weight(1f)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Label(track?.title ?: d.trackId?.let { "Unresolved #$it" } ?: "Idle deck", Modifier.weight(1f), if (active) Ink else Muted, 11, active)
                Label("${bpm((d.bpm ?: track?.bpm)?.times(1 + d.pitch / 100))} · ${key(track?.key)}", color = Muted, size = 10)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Canvas(Modifier.weight(1f).height(if (compact) 16.dp else 27.dp)) {
                    drawLine(Line, Offset(0f, size.height / 2), Offset(size.width, size.height / 2))
                    if (d.trackId != null) {
                        val duration = track?.duration ?: 240.0
                        val step = 3f
                        var x = 0f
                        while (x < size.width) { wave(x, size.height / 2, size.height * .42f, d.trackId!!, x / size.width * duration, if (active) 1f else .4f); x += step }
                        val px = (d.position / duration * size.width).toFloat().coerceIn(0f, size.width)
                        drawLine(Pink, Offset(px, 0f), Offset(px, size.height), 2f)
                    }
                }
                Column(Modifier.width(56.dp), horizontalAlignment = Alignment.End) {
                    Label(clock(d.position), color = if (active) Ink else Muted, size = 11)
                    if (!compact) Label(if (d.loop != null) "LOOP" else if (d.preview) "PREVIEW" else if (active) "ACTIVE" else if (d.playing) "MUTED" else "IDLE", color = DeckColors.getValue(ch), size = 8)
                }
            }
        }
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(Line))
}

private data class WavePoint(val x: Float, val deck: Int, val id: Int, val source: Double, val active: Boolean)

@Composable private fun Timeline(model: PlaybackModel, compact: Boolean) {
    val points = remember(model.session, model.viewStart, model.viewWidth) {
        (0..200).flatMap { i ->
            val s = model.session.at(model.viewStart + model.viewWidth * i / 200)
            DECKS.mapIndexedNotNull { row, ch -> s.decks.getValue(ch).let { d -> d.trackId?.let { WavePoint(i / 200f, row, it, d.position, s.audible(ch)) } } }
        }
    }
    Column {
        Row(Modifier.fillMaxWidth().height(20.dp).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Label(clock(model.viewStart - model.session.start), color = Muted, size = 10)
            Label("${clock(model.viewWidth)} WINDOW", color = Muted, size = 10)
            Label(clock(model.viewStart + model.viewWidth - model.session.start), color = Muted, size = 10)
        }
        Canvas(Modifier.fillMaxWidth().height(if (compact) 64.dp else 124.dp).testTag("timeline").semantics { contentDescription = "Four deck Session timeline; tap to seek, drag to pan, pinch to zoom" }
            .pointerInput(model.session) { detectTapGestures { p -> model.seek(model.viewStart + p.x / size.width * model.viewWidth) } }
            .pointerInput(model.session) { detectTransformGestures { centroid, pan, zoom, _ -> model.zoom(zoom.toDouble(), (centroid.x / size.width).toDouble()); model.pan((-pan.x / size.width).toDouble()) } }) {
            val lane = size.height / 4
            DECKS.forEachIndexed { i, ch ->
                drawRect(DeckColors.getValue(ch).copy(alpha = .055f), Offset(0f, lane * i), Size(size.width, lane - 2))
                drawRect(DeckColors.getValue(ch), Offset(0f, lane * i), Size(3f, lane - 2))
            }
            model.session.appearances.forEach { e ->
                val left = ((e.start - model.viewStart) / model.viewWidth * size.width).toFloat().coerceIn(0f, size.width)
                val right = ((e.end - model.viewStart) / model.viewWidth * size.width).toFloat().coerceIn(0f, size.width)
                val y = DECKS.indexOf(e.deck) * lane
                if (right > left) {
                    drawLine(DeckColors.getValue(e.deck).copy(alpha = .45f), Offset(left, y + 1), Offset(right, y + 1), 1f)
                    if (!compact && right - left > 40) clipRect(left, y, right, y + lane) {
                        val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.LTGRAY; textSize = 8.sp.toPx() }
                        drawContext.canvas.nativeCanvas.drawText("${e.deck} · ${model.tracks[e.trackId]?.title ?: "#${e.trackId}"}", left + 5, y + 9.sp.toPx(), paint)
                    }
                }
            }
            points.forEach { p ->
                if (p.active) wave(p.x * size.width, lane * (p.deck + .5f), lane * .4f, p.id, p.source, 1f)
            }
            model.session.events.forEach { e ->
                val t = e.getDouble("t")
                if (t >= model.viewStart && t <= model.viewStart + model.viewWidth && e.getString("kind") == "transport" && e.getString("action") in setOf("hotCue", "jumpBeats", "cue")) {
                    val x = ((t - model.viewStart) / model.viewWidth * size.width).toFloat()
                    val row = DECKS.indexOf(e.getString("channel"))
                    drawLine(Color(0xFFFF9900), Offset(x, row * lane), Offset(x, (row + 1) * lane), 2f)
                    drawCircle(Color(0xFFFF9900), 3f, Offset(x, row * lane + 4))
                }
            }
            val x = ((model.time - model.viewStart) / model.viewWidth * size.width).toFloat()
            if (x in 0f..size.width) drawLine(Pink, Offset(x, 0f), Offset(x, size.height), 3f)
        }
    }
}

/** Deterministic track-time bands: synthetic analysis, never PCM or unrelated animated noise. */
private fun DrawScope.wave(x: Float, y: Float, height: Float, id: Int, source: Double, alpha: Float) {
    val beat = abs(sin(source * 6.7 + id))
    val low = (.15 + .65 * beat * abs(sin(source * .21 + id))).toFloat()
    val mid = (.12 + .65 * abs(sin(source * 2.3 + id * .3))).toFloat()
    val high = (.1 + .5 * abs(sin(source * 8.9 + id * .7))).toFloat()
    val amplitude = max(low, max(mid, high)) * height
    drawLine(Color((low * 1.1f).coerceAtMost(1f), mid, high, alpha), Offset(x, y - amplitude), Offset(x, y + amplitude), 2f)
}
