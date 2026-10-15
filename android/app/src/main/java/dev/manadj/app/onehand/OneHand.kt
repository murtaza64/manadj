package dev.manadj.app.onehand

import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import dev.manadj.app.*
import dev.manadj.app.library.LibraryPanel
import dev.manadj.audio.DeckId
import kotlin.math.*

/**
 * One-handed portrait design spike (android-onehand). Three layouts over the shared engine, selected in
 * Settings › Layout; STANDARD keeps the UI lane's Portrait untouched. Design notes: docs/research/android-onehand-portrait.md.
 */
enum class OneHandLayout(val label: String, val blurb: String) {
    STANDARD("STANDARD", "Two-deck symmetric portrait"),
    FOCUS("A · FOCUS", "One deck under the thumb, vertical mix lever"),
    RINGS("B · RINGS", "Concentric thumb arcs: angle = value, ring = control"),
    CHORDS("C · CHORDS", "Six chord keys; hold + drag opens a palette under the thumb"),
}

/** Spike preferences (own SharedPreferences; nothing in UiModel). */
object OneHand {
    private var prefs: android.content.SharedPreferences? = null
    private val _layout = mutableStateOf(OneHandLayout.STANDARD)
    private val _mirror = mutableStateOf(false)
    private val _reach = mutableStateOf(false)
    fun init(context: Context) {
        if (prefs != null) return
        val p = context.applicationContext.getSharedPreferences("onehand", Context.MODE_PRIVATE)
        prefs = p
        _layout.value = runCatching { OneHandLayout.valueOf(p.getString("layout", null) ?: "") }.getOrDefault(OneHandLayout.STANDARD)
        _mirror.value = p.getBoolean("mirror", false)
        _reach.value = p.getBoolean("reach", false)
    }
    var layout: OneHandLayout get() = _layout.value; set(v) { _layout.value = v; prefs?.edit()?.putString("layout", v.name)?.apply() }
    /** The persisted layout, loading the prefs on first use (PerformanceApp's dispatch runs before any spike composable). */
    fun layout(context: Context): OneHandLayout { init(context); return layout }
    /** Left-hand mirror: the thumb pivot moves to the bottom-left. */
    var mirror: Boolean get() = _mirror.value; set(v) { _mirror.value = v; prefs?.edit()?.putBoolean("mirror", v)?.apply() }
    /** Reach-zone overlay for evaluation. */
    var reach: Boolean get() = _reach.value; set(v) { _reach.value = v; prefs?.edit()?.putBoolean("reach", v)?.apply() }
    /** Focused deck shared by every layout (survives switching between them). */
    var focus by mutableStateOf(DeckId.A)

    // Drawn reach zones per hand (OH2): normalized polygons, null = the default zone.
    private val _zoneRight = mutableStateOf<ReachZone?>(null)
    private val _zoneLeft = mutableStateOf<ReachZone?>(null)
    private var zonesLoaded = false
    private fun loadZones() {
        if (zonesLoaded) return
        zonesLoaded = true
        _zoneRight.value = prefs?.getString("zone-right", null)?.let(ReachZone::parse)
        _zoneLeft.value = prefs?.getString("zone-left", null)?.let(ReachZone::parse)
    }
    /** The reach zone for the current hand: drawn if the human drew one, else [ReachZone.default]. */
    val zone: ReachZone get() { loadZones(); return (if (mirror) _zoneLeft.value else _zoneRight.value) ?: ReachZone.default(mirror) }
    val zoneDrawn: Boolean get() { loadZones(); return (if (mirror) _zoneLeft.value else _zoneRight.value) != null }
    fun saveZone(z: ReachZone?) {
        loadZones()
        val key = if (mirror) "zone-left" else "zone-right"
        if (mirror) _zoneLeft.value = z else _zoneRight.value = z
        prefs?.edit()?.apply { if (z == null) remove(key) else putString(key, z.encode()) }?.apply()
    }
    /** Calibration screen open (Settings › DRAW REACH ZONE). */
    var drawing by mutableStateOf(false)
    /** One-line state for the Settings group list. */
    fun summary(): String = layout.label + (if (layout == OneHandLayout.STANDARD) "" else if (mirror) " · left hand" else " · right hand") + if (zoneDrawn) " · drawn zone" else ""
}

/**
 * The human's comfortable thumb area as a closed polygon in normalized screen coordinates (OH2). Layouts place
 * their control block around [centroid] (the middle of the zone, not its edges) and size it from [bbox].
 */
class ReachZone(val points: List<Offset>) {
    val bbox: androidx.compose.ui.geometry.Rect = androidx.compose.ui.geometry.Rect(points.minOf { it.x }, points.minOf { it.y }, points.maxOf { it.x }, points.maxOf { it.y })
    /** Area centroid of the polygon (falls back to the bbox centre for degenerate strokes). */
    val centroid: Offset = run {
        var a = 0f; var cx = 0f; var cy = 0f
        for (i in points.indices) { val p = points[i]; val q = points[(i + 1) % points.size]; val k = p.x * q.y - q.x * p.y; a += k; cx += (p.x + q.x) * k; cy += (p.y + q.y) * k }
        if (abs(a) < 1e-6f) bbox.center else Offset(cx / (3 * a), cy / (3 * a))
    }
    fun contains(p: Offset): Boolean {
        var inside = false
        var j = points.size - 1
        for (i in points.indices) {
            val a = points[i]; val b = points[j]
            if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
            j = i
        }
        return inside
    }
    fun encode(): String = points.joinToString(";") { "%.4f,%.4f".format(it.x, it.y) }
    companion object {
        fun parse(s: String): ReachZone? = runCatching { ReachZone(s.split(";").map { val (x, y) = it.split(","); Offset(x.toFloat(), y.toFloat()) }).takeIf { it.points.size >= 3 } }.getOrNull()
        /**
         * Default until the human draws one: an ellipse centred at (0.66, 0.70) of the screen (mirrored: 0.34),
         * rx 0.40 w, ry 0.24 h — the thumb's comfortable patch sits well above the corner (OH2: controls were too low).
         */
        fun default(mirror: Boolean): ReachZone {
            val cx = if (mirror) .34f else .66f
            return ReachZone((0 until 48).map { i -> val a = i * 2 * Math.PI / 48; Offset(cx + .40f * cos(a).toFloat(), .70f + .24f * sin(a).toFloat()) })
        }
    }
}

/** Cut-only EQ (OH1): gesture g 0..1 → EQ value kill..unity (0..0.5) on a sine ease, finer near both ends. */
fun cutToEq(g: Double): Double = .5 * (1 - cos(g.coerceIn(0.0, 1.0) * PI)) / 2
/** Inverse of [cutToEq]; a boost (v > 0.5) reads as 1 (full travel) — boosts need the deliberate extra gesture. */
fun eqToCut(v: Double): Double = if (v >= .5) 1.0 else acos((1 - 4 * v).coerceIn(-1.0, 1.0)) / PI
/** Boost half (second-finger / deliberate gesture): g 0..1 → unity..max (0.5..1). */
fun boostToEq(g: Double): Double = .5 + .5 * g.coerceIn(0.0, 1.0)

/** Settings › Layout (portrait) page body (SettingsPage.LAYOUT in SettingsPanel). */
@Composable fun OneHandSettings() {
    OneHand.init(LocalContext.current)
    Text("One-hand spike (#386): pick a layout; STANDARD is the stock two-deck portrait.", color = Ink.muted, size = 11, lines = 2)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (l in OneHandLayout.entries) Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Key(l.label, Modifier.width(118.dp).fillMaxHeight(), Ink.accent, engaged = OneHand.layout == l, description = "Layout ${l.label}", textSize = 10, style = KeyStyle.PILL) { OneHand.layout = l }
            Text(l.blurb, Modifier.weight(1f), Ink.muted, 11, lines = 2)
        }
    }
    Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Key("REACH ZONE", Modifier.width(118.dp).fillMaxHeight(), Ink.warning, engaged = OneHand.reach, description = "Reach overlay", textSize = 10, style = KeyStyle.PILL) { OneHand.reach = !OneHand.reach }
        Key("LEFT HAND", Modifier.width(118.dp).fillMaxHeight(), Ink.accent, engaged = OneHand.mirror, description = "Mirror for the left hand", textSize = 10, style = KeyStyle.PILL) { OneHand.mirror = !OneHand.mirror }
        Text(if (OneHand.zoneDrawn) "Overlay: your drawn zone (dot = its centre)" else "Overlay: default zone (dot = centre); draw yours below", Modifier.weight(1f), Ink.muted, 10, lines = 2)
    }
    Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Key("DRAW REACH ZONE", Modifier.width(150.dp).fillMaxHeight(), Ink.play, description = "Draw the thumb reach zone", textSize = 10, style = KeyStyle.PILL) { OneHand.drawing = true }
        if (OneHand.zoneDrawn) Key("USE DEFAULT", Modifier.width(110.dp).fillMaxHeight(), Ink.muted, description = "Forget the drawn zone", textSize = 10, style = KeyStyle.PILL) { OneHand.saveZone(null) }
        Text("Trace the area your thumb reaches comfortably (per hand); the one-hand layouts centre their controls in it.", Modifier.weight(1f), Ink.muted, 10, lines = 3)
    }
}

/** The reach zone polygon (drawn or default) with its centroid dot. */
fun DrawScope.drawReach(zone: ReachZone, alpha: Float = 1f, color: Color = Ink.warning) {
    val w = size.width; val h = size.height
    val path = androidx.compose.ui.graphics.Path().apply { zone.points.forEachIndexed { i, p -> if (i == 0) moveTo(p.x * w, p.y * h) else lineTo(p.x * w, p.y * h) }; close() }
    drawPath(path, color.copy(alpha = .07f * alpha))
    drawPath(path, color.copy(alpha = .8f * alpha), style = Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f))))
    val c = Offset(zone.centroid.x * w, zone.centroid.y * h)
    drawCircle(color.copy(alpha = alpha), 5.dp.toPx(), c)
    drawCircle(color.copy(alpha = .6f * alpha), 14.dp.toPx(), c, style = Stroke(1.5.dp.toPx()))
}

@Composable fun ReachOverlay(modifier: Modifier, shown: Boolean = true) {
    val on by animateFloatAsState(if (OneHand.reach && shown) 1f else 0f, tween(200), label = "reach")
    if (on <= 0f) return
    Canvas(modifier) { drawReach(OneHand.zone, on) }
    Box(modifier) {
        Text(if (OneHand.zoneDrawn) "REACH · drawn zone · ● centre" else "REACH · default zone · ● centre", Modifier.align(if (OneHand.mirror) Alignment.TopEnd else Alignment.TopStart).padding(top = 48.dp, start = 6.dp, end = 6.dp).background(Color.Black.copy(alpha = .6f)).padding(horizontal = 4.dp), Ink.warning.copy(alpha = on), 10, true)
    }
}

/** Entry from PerformanceApp: picks the layout; mirror flips Row order via RTL (ring geometry mirrors itself). */
@Composable fun OneHandApp(model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit, modifier: Modifier, band: Dp) {
    OneHand.init(LocalContext.current)
    val dir = if (OneHand.mirror) LayoutDirection.Rtl else LayoutDirection.Ltr
    Box(modifier) {
        CompositionLocalProvider(LocalLayoutDirection provides dir) {
            when (OneHand.layout) {
                OneHandLayout.FOCUS -> FocusLayout(model, ux, pick, Modifier.fillMaxSize(), band)
                OneHandLayout.RINGS -> RingsLayout(model, ux, pick, Modifier.fillMaxSize(), band)
                OneHandLayout.CHORDS -> ChordsLayout(model, ux, pick, Modifier.fillMaxSize(), band)
                OneHandLayout.STANDARD -> {}
            }
        }
        // The overlay is for evaluating a layout: it hides while Settings (hosted inside the scaffold, under it) is open.
        ReachOverlay(Modifier.fillMaxSize(), shown = !ux.settings)
        // The calibration screen covers the layout; Settings (hosted inside the scaffold) closes when it opens.
        LaunchedEffect(OneHand.drawing) { if (OneHand.drawing) ux.settings = false }
        if (OneHand.drawing) DrawReachScreen(Modifier.fillMaxSize())
    }
}

/**
 * Calibration (OH2): hold the phone as when DJing and trace the comfortable thumb area in one stroke. The stroke
 * closes on release; SAVE / REDO sit at the stroke's centroid (so they are reachable by construction).
 */
@Composable fun DrawReachScreen(modifier: Modifier) {
    val stroke = remember { mutableStateListOf<Offset>() }
    var done by remember { mutableStateOf(false) }
    var size by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    Box(modifier.background(Color.Black.copy(alpha = .92f)).onGloballyPositioned { size = it.size }.pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown()
            if (done) return@awaitEachGesture
            down.consume(); stroke.clear(); stroke += down.position
            while (true) {
                val c = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                if (!c.pressed) break
                if ((c.position - stroke.last()).getDistance() > 6.dp.toPx()) stroke += c.position
                c.consume()
            }
            if (stroke.size >= 8) { done = true; haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress) } else stroke.clear()
        }
    }) {
        val zone = if (stroke.size >= 3 && size.width > 0) ReachZone(stroke.map { Offset(it.x / size.width, it.y / size.height) }) else null
        Canvas(Modifier.fillMaxSize()) {
            if (zone != null && done) drawReach(zone, 1f, Ink.play)
            else if (stroke.size >= 2) drawPath(androidx.compose.ui.graphics.Path().apply { stroke.forEachIndexed { i, p -> if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) } }, Ink.play, style = Stroke(3.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round, join = androidx.compose.ui.graphics.StrokeJoin.Round))
            if (!done) drawReach(OneHand.zone, .35f)
        }
        Column(Modifier.align(Alignment.TopCenter).padding(top = 56.dp, start = 16.dp, end = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("DRAW YOUR REACH ZONE · ${if (OneHand.mirror) "LEFT" else "RIGHT"} HAND", color = Ink.play, size = 14, bold = true)
            Text("Hold the phone as you DJ. Trace the area your thumb reaches comfortably in one stroke — the loop closes when you lift. Faint = the current zone.", color = Ink.muted, size = 11, lines = 4)
        }
        if (done && zone != null) {
            val density = LocalDensity.current
            val cx = with(density) { (zone.centroid.x * size.width).toDp() }; val cy = with(density) { (zone.centroid.y * size.height).toDp() }
            Row(Modifier.offset(cx - 110.dp, cy - 22.dp).width(220.dp).height(44.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Key("REDO", Modifier.weight(1f).fillMaxHeight(), Ink.warning, style = KeyStyle.PILL, textSize = 12) { stroke.clear(); done = false }
                Key("SAVE", Modifier.weight(1f).fillMaxHeight(), Ink.play, style = KeyStyle.PILL, textSize = 12) { OneHand.saveZone(zone); OneHand.reach = true; OneHand.drawing = false }
            }
        }
        Key("", Modifier.align(Alignment.TopEnd).padding(8.dp).size(40.dp), Ink.muted, description = "Cancel", icon = Glyph.Close, style = KeyStyle.BARE) { OneHand.drawing = false }
    }
}

/** Where a layout's control block sits (dp in the scaffold), derived from the reach zone (OH2). */
class ReachFrame(val zone: ReachZone, val screen: DpSize, val left: Dp, val top: Dp, val width: Dp, val height: Dp) {
    /** Zone bbox / centroid in dp. */
    val bbox get() = androidx.compose.ui.unit.DpRect(screen.width * zone.bbox.left, screen.height * zone.bbox.top, screen.width * zone.bbox.right, screen.height * zone.bbox.bottom)
    val centre get() = androidx.compose.ui.unit.DpOffset(screen.width * zone.centroid.x, screen.height * zone.centroid.y)
}

/**
 * Shared scaffold: the view area (top, out of reach) + the thumb zone, with the UI lane's browser sheet covering
 * everything below the waves and CUE/PLAY for the focused deck at its foot. The control block of [blockSize]
 * (null = everything below the zone's top, for the rings) is centred on the reach zone's centroid and clamped
 * on screen; the view area takes what is left above it.
 */
@Composable fun OneHandScaffold(model: PlayerModel, ux: UiModel, pick: (DeckId) -> Unit, modifier: Modifier, band: Dp, waveHeight: Dp, blockSize: ((ReachZone, DpSize) -> DpSize)?, content: @Composable BoxScope.(ReachFrame) -> Unit) {
    val sheet = rememberBrowserSheet(model, ux)
    var sheetTop by remember { mutableIntStateOf(0) }
    val pad = Modifier.padding(horizontal = Gap)
    BoxWithConstraints(modifier.clipToBounds()) {
        val w = maxWidth; val h = maxHeight
        val zone = OneHand.zone
        val screen = DpSize(w, h)
        val viewMin = maxOf(band, 44.dp) + waveHeight * 2 + 64.dp
        val c = androidx.compose.ui.unit.DpOffset(w * zone.centroid.x, h * zone.centroid.y)
        val frame = if (blockSize != null) {
            val want = blockSize(zone, screen)
            val bw = minOf(want.width, w - 16.dp); val bh = want.height
            val left = (c.x - bw / 2).coerceIn(8.dp, maxOf(8.dp, w - bw - 8.dp))
            val top = (c.y - bh / 2).coerceIn(viewMin + 4.dp, maxOf(viewMin + 4.dp, h - bh - 8.dp))
            ReachFrame(zone, screen, left, top, bw, bh)
        } else {
            val top = maxOf(viewMin + 4.dp, h * zone.bbox.top - 8.dp)
            ReachFrame(zone, screen, 0.dp, top, w, h - top)
        }
        Column(Modifier.fillMaxSize().browserSwipeUp(sheet)) {
            ViewArea(model, ux, pad.fillMaxWidth().height(frame.top - 4.dp), band, waveHeight) { sheetTop = it }
        }
        Box(Modifier.fillMaxWidth().absoluteOffset(y = frame.top).height(h - frame.top).browserSwipeUp(sheet)) { content(frame) }
        val topDp = with(LocalDensity.current) { sheetTop.toDp() }
        BrowserSheet(sheet, Modifier.fillMaxSize().padding(top = topDp)) {
            val f = model.decks.getValue(OneHand.focus)
            Column(Modifier.fillMaxSize().background(Ink.background)) {
                LibraryPanel(model, ux, Modifier.fillMaxWidth().weight(1f), pick, tapTarget = null)
                Row(pad.fillMaxWidth().height(TransportRow).screenSafe(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FocusChip(model, Modifier.width(96.dp).fillMaxHeight())
                    Spacer(Modifier.weight(1f))
                    CueKey(f, model, Modifier.width(110.dp).fillMaxHeight()); PlayKey(f, model, Modifier.width(130.dp).fillMaxHeight())
                }
            }
        }
        // Settings (#396) takes the browser's place below the waves, as in the UI lane's Portrait.
        val settle = androidx.compose.animation.core.spring<androidx.compose.ui.unit.IntOffset>(dampingRatio = 1f, stiffness = 900f)
        androidx.compose.animation.AnimatedVisibility(ux.settings, Modifier.fillMaxSize().padding(top = topDp), enter = androidx.compose.animation.slideInVertically(settle) { it }, exit = androidx.compose.animation.slideOutVertically(settle) { it }) {
            SettingsPanel(model, ux, Modifier.fillMaxSize().padding(top = 3.dp))
        }
    }
}

/**
 * View-only top: deck info in the camera band, both detail waves stacked (focused deck framed), minimaps with
 * the mix state (fader·XF gain bar + LOW/FILTER readouts) between them. Nothing here needs the thumb; waves still
 * scrub/scratch with a second hand.
 */
@Composable fun ViewArea(model: PlayerModel, ux: UiModel, modifier: Modifier, band: Dp, waveHeight: Dp, bottom: (Int) -> Unit) {
    val a = model.decks.getValue(DeckId.A); val b = model.decks.getValue(DeckId.B)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth().height(maxOf(band, 44.dp)), horizontalArrangement = Arrangement.spacedBy(DeckGap)) {
            for (ui in listOf(a, b)) Box(Modifier.weight(1f).fillMaxHeight()) { DeckInfo(ui, model, Modifier.align(Alignment.BottomStart).fillMaxWidth().height(44.dp).screenSafe()) }
        }
        // Waves fill the view area; while the browser or Settings is open they drop to [waveHeight] so the panel gets the room.
        val fill = model.browser == null && !ux.settings
        Column(Modifier.then(if (fill) Modifier.weight(1f) else Modifier).onGloballyPositioned { bottom((it.positionInParent().y + it.size.height).toInt()) }, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            for (ui in listOf(a, b)) Box(Modifier.fillMaxWidth().then(if (fill) Modifier.weight(1f).heightIn(min = waveHeight) else Modifier.height(waveHeight))) {
                DetailWave(ui, model, ux, Modifier.fillMaxSize())
                // Focus frame: a bright edge on the focused deck's wave.
                val focused = OneHand.focus == ui.id
                val edge by animateFloatAsState(if (focused) 1f else 0f, tween(180), label = "focus")
                if (edge > 0f) Box(Modifier.fillMaxHeight().width(3.dp).background(deckColor(ui.id).copy(alpha = edge)))
            }
        }
        if (!fill) Spacer(Modifier.weight(1f))
        Row(Modifier.fillMaxWidth().height(40.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Minimap(a, model, ux.waves[a.source?.id ?: ""], Modifier.weight(1f).fillMaxHeight(), preview = ux.seekPreview, ux = ux)
            MixState(model, ux, Modifier.width(92.dp).fillMaxHeight())
            Minimap(b, model, ux.waves[b.source?.id ?: ""], Modifier.weight(1f).fillMaxHeight(), preview = ux.seekPreview, ux = ux)
        }
    }
}

/** Mix state at a glance: per-deck audible gain (fader × XF), LOW and FILTER as tiny bars; XF position below. */
@Composable fun MixState(model: PlayerModel, ux: UiModel, modifier: Modifier) {
    val a = mixOf(model, ux, DeckId.A); val b = mixOf(model, ux, DeckId.B)
    val da = model.decks.getValue(DeckId.A); val db = model.decks.getValue(DeckId.B)
    Canvas(modifier) {
        val w = size.width; val h = size.height
        fun bars(m: DeckMix, ui: DeckUi, x0: Float, right: Boolean) {
            val c = deckColor(m.id)
            val gain = (m.fader * m.xfGain).toFloat()
            val bw = 9.dp.toPx(); val gap = 3.dp.toPx()
            val cols = listOf(gain to c, ui.eq[0].toFloat() to Ink.bands[0], ((ui.filter + 1) / 2).toFloat() to (if (ui.filter >= 0) Ink.filterHpf else Ink.filterLpf))
            cols.forEachIndexed { i, (v, col) ->
                val x = if (right) x0 - (i + 1) * (bw + gap) + gap else x0 + i * (bw + gap)
                val top = h * .78f
                drawRect(Ink.surface.copy(alpha = .5f), Offset(x, 0f), Size(bw, top))
                drawRect(col, Offset(x, top * (1 - v)), Size(bw, top * v))
            }
        }
        bars(a, da, 0f, false); bars(b, db, w, true)
        // Crossfader position.
        val y = h * .9f
        drawLine(Ink.surface, Offset(0f, y), Offset(w, y), 3.dp.toPx())
        val x = (model.crossfade.toFloat() * w).coerceIn(4f, w - 4f)
        drawCircle(if (ux.crossfaderEnabled) Ink.accent else Ink.muted, 4.dp.toPx(), Offset(x, y))
    }
}

/** The focused deck as a chip: deck colour, title, tap = switch focus (shared by every layout). */
@Composable fun FocusChip(model: PlayerModel, modifier: Modifier, textSize: Int = 13) {
    val f = OneHand.focus
    val ui = model.decks.getValue(f)
    val playing = ui.snapshot?.playing == true
    Key("$f ${if (playing) "▶" else "■"} ⇄ ${other(f)}", modifier, deckColor(f), engaged = true, description = "Focused deck $f, tap to switch", style = KeyStyle.PILL, textSize = textSize) { OneHand.focus = other(f) }
}

/** Horizontal flick over a control block switches the focused deck (left = A, right = B; RTL mirrors). */
fun Modifier.focusFlick(): Modifier = pointerInput(Unit) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Final)
        if (down.isConsumed) return@awaitEachGesture
        val t0 = down.uptimeMillis
        while (true) {
            val c = awaitPointerEvent(PointerEventPass.Final).changes.firstOrNull { it.id == down.id } ?: break
            if (c.isConsumed && c.pressed) break
            val dx = c.position.x - down.position.x; val dy = c.position.y - down.position.y
            if (!c.pressed) {
                if (abs(dx) > 90.dp.toPx() && abs(dx) > 2 * abs(dy) && c.uptimeMillis - t0 < 400) OneHand.focus = if (dx < 0) DeckId.A else DeckId.B
                break
            }
        }
    }
}

/** Transition macro shared by FOCUS (lever) and RINGS/CHORDS (XF sweeps): v = 0 all A … 1 all B. */
enum class MixMacro(val label: String, val blurb: String) { XF("XF", "crossfader only"), BASS("XF+LOW", "crossfader + bass swap"), FILTER("XF+FILT", "crossfader + outgoing high-pass") }

fun applyMixMacro(model: PlayerModel, ux: UiModel, macro: MixMacro, v: Double, gesture: String?) {
    if (!ux.crossfaderEnabled) ux.crossfaderEnabled = true
    model.updateCrossfade(v.coerceIn(0.0, 1.0), gesture)
    val toB = ((v - .5) * 2).coerceIn(0.0, 1.0); val toA = ((.5 - v) * 2).coerceIn(0.0, 1.0)
    when (macro) {
        MixMacro.XF -> {}
        // Bass swap: the outgoing deck's LOW falls to kill over the second half of the throw.
        MixMacro.BASS -> { model.updateEq(DeckId.A, 0, .5 * (1 - toB), gesture); model.updateEq(DeckId.B, 0, .5 * (1 - toA), gesture) }
        // Outgoing deck high-passes out (filter +0 .. +0.85).
        MixMacro.FILTER -> { model.updateFilter(DeckId.A, .85 * toB, gesture); model.updateFilter(DeckId.B, .85 * toA, gesture) }
    }
}

/** Small corner glyph-free label used by the spike for "not wired yet" stubs. */
@Composable fun Stub(text: String, modifier: Modifier) {
    Box(modifier.background(Ink.panel).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) { Text("$text · STUB", color = Ink.pending, size = 10, bold = true) }
}

/**
 * Cut-only EQ knob (OH1): the whole travel is kill → unity (the arc fills clockwise up to 0 dB at the end), on a
 * sine ease so the steps are finest near the kill and near unity. Relative drag (up/right = more band); double-tap
 * = kill ↔ unity. A boost is a deliberate extra gesture: a second finger resting on the knob switches the drag to
 * the unity → +12 dB half (shown as a glow past the end); lifting it returns to the cut range.
 */
@Composable fun CutKnob(label: String, kind: KnobKind, value: Double, model: PlayerModel, deck: DeckId, modifier: Modifier, enabled: Boolean, size: Dp = 38.dp, set: (Double, String?) -> Unit) {
    val current by rememberUpdatedState(value)
    val setter by rememberUpdatedState(set)
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    var held by remember { mutableStateOf(false) }
    var boosting by remember { mutableStateOf(false) }
    val heat by animateFloatAsState(if (held) 1f else 0f, tween(if (held) 60 else 300), label = "cut")
    val tag = "${deck.name} $label"
    Box(modifier.semantics { contentDescription = "$tag cut control"; stateDescription = knobReadout(kind, value); if (!enabled) disabled() }.pointerInput(tag, enabled) {
        if (!enabled) return@pointerInput
        var lastTap = -1000L
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val first = current
            val id = model.beginGesture(deck, label) { setter(first, it) }
            held = true; down.consume()
            var axisH: Boolean? = null
            fun coord(p: Offset) = if (axisH == true) p.x else -p.y
            var base = first; var baseC = 0f; var moved = false; var cancelled = false; var boost = false; var atUnity = first >= .5
            val span = 200.dp.toPx()
            try {
                while (true) {
                    val event = awaitPointerEvent()
                    val c = event.changes.firstOrNull { it.id == down.id }
                    if (c == null || (!c.pressed && c.isConsumed)) { cancelled = true; break }
                    if (!c.pressed) {
                        if (!moved && c.uptimeMillis - down.uptimeMillis < 250) {
                            if (down.uptimeMillis - lastTap < 320) { setter(doubleTapTarget(kind, first), id); haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress); lastTap = -1000 } else lastTap = c.uptimeMillis
                        }
                        break
                    }
                    if (!model.gestureActive(id)) break
                    val p = c.position
                    if (axisH == null) {
                        val d = p - down.position
                        if (d.getDistance() > 6.dp.toPx()) { axisH = abs(d.x) > abs(d.y); moved = true; baseC = coord(down.position) } else continue
                    }
                    val nowBoost = event.changes.any { it.id != down.id && it.pressed }
                    if (nowBoost != boost) { boost = nowBoost; boosting = boost; base = current; baseC = coord(p); haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.SegmentTick) }
                    val delta = (coord(p) - baseC) / span
                    val next = if (boost) boostToEq(((base - .5) / .5).coerceAtLeast(0.0) + delta) else cutToEq(eqToCut(base) + delta)
                    val unity = next >= .5
                    if (unity != atUnity) { atUnity = unity; haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.SegmentTick) }
                    setter(next, id)
                    event.changes.forEach { if (it.pressed) it.consume() }
                }
            } catch (cancel: kotlinx.coroutines.CancellationException) { cancelled = true; throw cancel }
            finally { held = false; boosting = false; model.finishGesture(id, cancelled) }
        }
    }, contentAlignment = Alignment.Center) {
        val g = eqToCut(value).toFloat()
        val boost = value > .5001
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Canvas(Modifier.size(size).halo(if (boost) Ink.warning else knobColor(kind, value), heat * .6f + if (boost) .35f else 0f, 4.dp, round = true)) { drawKnob(kind, g.toDouble(), this.size.minDimension / 2 - 4.dp.toPx(), enabled) }
            Text(label, color = if (!enabled) Ink.muted else if (held) Ink.text else Ink.muted, size = 9, bold = true)
            Text(if (boosting) "BOOST" else knobReadout(kind, value), color = if (boost || boosting) Ink.warning else Ink.muted, size = 8, bold = boost)
        }
    }
}

/** Two short channel faders side by side (OH3): the UI lane's rail fader, A left and B right. */
@Composable fun FaderPair(model: PlayerModel, modifier: Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        for (id in listOf(DeckId.A, DeckId.B)) Column(Modifier.weight(1f).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
            ChannelFader(model.decks.getValue(id), model, Modifier.fillMaxWidth().weight(1f))
            Text(id.name, color = deckColor(id), size = 10, bold = true)
        }
    }
}
