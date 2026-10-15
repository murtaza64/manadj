package dev.manadj.app.viz

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import dev.manadj.app.*
import dev.manadj.audio.DeckId
import org.json.JSONObject
import kotlin.math.*

/**
 * Visualizer backdrop spike (#394): the desktop presets (frontend/src/vizEmbed, built into assets/viz) run in a
 * WebView under the performance UI. The page pulls deck features from [VizHost.frame] once per rendered frame:
 * each deck's desktop waveform bands at the heard position, weighted by its strip (trim · EQ · filter · fader ·
 * crossfader). No engine meter/FFT is involved.
 */
object Viz {
    /** (id, name) best first: assets/viz/presets.json, written by the embed build from frontend/src/vizEmbed/presetList.ts. */
    var PRESETS: List<Pair<String, String>> = listOf("voyage" to "Voyage"); private set
    private fun loadPresets(context: Context) {
        runCatching {
            val a = org.json.JSONArray(context.assets.open("viz/presets.json").bufferedReader().use { it.readText() })
            PRESETS = (0 until a.length()).map { a.getJSONObject(it).let { o -> o.getString("id") to o.getString("name") } }
        }
    }
    private var prefs: android.content.SharedPreferences? = null
    private fun p(context: Context) = prefs ?: context.applicationContext.getSharedPreferences("viz", Context.MODE_PRIVATE).also { prefs = it; loadPresets(context.applicationContext); load(it); VizRatings.init(context.applicationContext) }
    var enabled by mutableStateOf(false); private set
    var preset by mutableStateOf("voyage"); private set
    /** Canvas opacity over black (the UI stays readable). */
    var brightness by mutableFloatStateOf(.7f); private set
    /** Backing-store scale (× CSS px × dpr) and frame cap. */
    var scale by mutableFloatStateOf(.5f); private set
    var fps by mutableIntStateOf(30); private set
    var hud by mutableStateOf(false); private set
    /** Feed level trim (dB) on top of the fader/EQ weighting. */
    var gainDb by mutableFloatStateOf(0f); private set
    /** Last stats the page reported (render ms, fps, size). */
    var stats by mutableStateOf<String?>(null)
    private fun load(sp: android.content.SharedPreferences) {
        enabled = sp.getBoolean("enabled", false); preset = sp.getString("preset", null) ?: "voyage"
        brightness = sp.getFloat("brightness", .7f); scale = sp.getFloat("scale", .5f); fps = sp.getInt("fps", 30)
        hud = sp.getBoolean("hud", false); gainDb = sp.getFloat("gain-db", 0f)
    }
    fun init(context: Context) { p(context) }
    /** Settings group-list summary line. */
    val summary: String get() = if (!enabled) "Off" else PRESETS.firstOrNull { it.first == preset }?.second ?: preset
    fun set(context: Context, enabled: Boolean = this.enabled, preset: String = this.preset, brightness: Float = this.brightness,
            scale: Float = this.scale, fps: Int = this.fps, hud: Boolean = this.hud, gainDb: Float = this.gainDb) {
        this.enabled = enabled; this.preset = preset; this.brightness = brightness.coerceIn(.1f, 1f); this.scale = scale; this.fps = fps
        this.hud = hud; this.gainDb = gainDb.coerceIn(-24f, 24f)
        p(context).edit().putBoolean("enabled", enabled).putString("preset", preset).putFloat("brightness", this.brightness)
            .putFloat("scale", scale).putInt("fps", fps).putBoolean("hud", hud).putFloat("gain-db", this.gainDb).apply()
    }
    fun step(context: Context, by: Int) {
        val i = PRESETS.indexOfFirst { it.first == preset }.coerceAtLeast(0)
        set(context, preset = PRESETS[(i + by + PRESETS.size) % PRESETS.size].first)
    }
}

/** JS bridge (called on the WebView's JavaBridge thread; snapshot-state reads only). */
class VizHost(private val model: PlayerModel, private val ux: UiModel) {
    private val bands = FloatArray(8)

    @JavascriptInterface fun frame(): String {
        val out = model.output ?: return "{\"decks\":[]}"
        val now = System.nanoTime()
        val j = StringBuilder(512).append("{\"decks\":[")
        var first = true
        var loudest = 0.0; var loudestTrack: Int? = null
        for (id in model.visibleDecks) {
            val ui = model.decks.getValue(id)
            val s = ui.snapshot ?: continue
            val source = ui.source ?: continue
            if (s.sourceId != source.id) continue
            val playing = s.playing || s.previewing
            val pos = out.audibleSeconds(id, now)
            val strip = ux.strip(ui)
            val mix = ux.waves[source.id]
            val wave = mix?.let { ux.stemWave(source.id, it, strip.stems) ?: it }
            if (wave == null) bands.fill(0f) else bandsAt(wave, pos, bands)
            for (k in 0..7) bands[k] *= strip.gain * (if (k < 3) strip.low else if (k < 5) strip.mid else strip.high) * filterGain(s.filter, k)
            val xf = if (!ux.crossfaderEnabled) 1.0 else if (id == DeckId.A) ((1 - model.crossfade) * 2).coerceAtMost(1.0) else (model.crossfade * 2).coerceAtMost(1.0)
            val g = s.fader * xf
            if (playing && g > loudest) { loudest = g; loudestTrack = dev.manadj.app.library.LibraryHolder.trackOn(model, id) }
            if (!first) j.append(',')
            first = false
            j.append("{\"ch\":\"").append(id.name).append("\",\"bands\":[")
            for (k in 0..7) { if (k > 0) j.append(','); j.append(bands[k]) }
            j.append("],\"gain\":").append(s.fader * xf).append(",\"playing\":").append(playing).append(",\"pos\":").append(pos)
                .append(",\"bpm\":").append(s.bpm?.takeIf { it.isFinite() } ?: "null").append(",\"anchor\":").append(s.gridAnchorSeconds)
                .append(",\"rate\":").append(1 + s.pitchPercent / 100)
                .append(",\"eq\":[").append(s.eq.getOrElse(0) { .5 }).append(',').append(s.eq.getOrElse(1) { .5 }).append(',').append(s.eq.getOrElse(2) { .5 })
                .append("],\"fader\":").append(s.fader).append(",\"trackId\":").append(dev.manadj.app.library.LibraryHolder.trackOn(model, id) ?: "null").append('}')
        }
        VizRatings.contextTrackId = loudestTrack
        j.append("],\"panes\":")
        if (Glass.on) Glass.panesJson(j) else j.append("[]")
        return j.append('}').toString()
    }

    @JavascriptInterface fun stats(json: String) {
        android.util.Log.i("manadj-viz", json)
        val o = runCatching { JSONObject(json) }.getOrNull() ?: return
        val line = "%s %dx%d · %.1f fps · render %.1f ms".format(o.optString("preset"), o.optInt("w"), o.optInt("h"), o.optDouble("fps"), o.optDouble("renderMs"))
        android.os.Handler(android.os.Looper.getMainLooper()).post { Viz.stats = line }
    }

    companion object {
        /** Linear band amplitudes at track time [t] (MWF1 frames centred on their STFT window; bytes are amp^½). */
        fun bandsAt(data: WaveformData, t: Double, out: FloatArray) {
            if (data.frames == 0 || t < 0 || t > data.duration) { out.fill(0f); return }
            val x = t * data.framesPerSecond - data.stftWindow * .5 / data.bandHop
            val i0 = floor(x).toInt().coerceIn(0, max(0, data.frames - 1)); val i1 = min(i0 + 1, data.frames - 1)
            val fr = (x - i0).toFloat().coerceIn(0f, 1f)
            for (k in 0..7) {
                val v = ((data.bands[i0 * 8 + k].toInt() and 0xff) * (1 - fr) + (data.bands[i1 * 8 + k].toInt() and 0xff) * fr) / 255f
                out[k] = v * v
            }
        }
        private val CENTRES = FloatArray(8) { sqrt(WaveformData.BAND_EDGES[it] * WaveformData.BAND_EDGES[it + 1]) }
        /** Sweep filter at band [k]'s centre: 2nd-order LPF (position < 0) / HPF (> 0), cutoff log-swept 20 kHz → 60 Hz. */
        fun filterGain(position: Double, k: Int): Float {
            val p = position.coerceIn(-1.0, 1.0)
            if (abs(p) < .02) return 1f
            val f = CENTRES[k].toDouble()
            return if (p < 0) { val fc = 20000 * (60.0 / 20000).pow(-p); (1 / sqrt(1 + (f / fc).pow(4))).toFloat() }
            else { val fc = 20 * (8000.0 / 20).pow(p); (1 / sqrt(1 + (fc / f).pow(4))).toFloat() }
        }
    }
}

/** The WebView layer: composed only while enabled; paused with the activity. */
@SuppressLint("SetJavaScriptEnabled")
@Composable fun VizBackdrop(model: PlayerModel, ux: UiModel, modifier: Modifier) {
    val context = LocalContext.current
    remember { Viz.init(context) }
    if (!Viz.enabled) return
    val host = remember(model, ux) { VizHost(model, ux) }
    var view by remember { mutableStateOf<WebView?>(null) }
    var loaded by remember { mutableStateOf(false) }
    val lifecycle = androidx.compose.ui.platform.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, view) {
        val observer = LifecycleEventObserver { _, e -> when (e) { Lifecycle.Event.ON_STOP -> view?.onPause(); Lifecycle.Event.ON_START -> view?.onResume(); else -> {} } }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    DisposableEffect(Unit) { onDispose { view?.destroy(); view = null } }
    val js = "manadjViz.setPreset('${Viz.preset}');manadjViz.setOptions('" +
        JSONObject().put("scale", Viz.scale.toDouble()).put("fps", Viz.fps).put("debug", Viz.hud).put("gainDb", Viz.gainDb.toDouble()).put("opacity", Viz.brightness.toDouble()) + "')"
    LaunchedEffect(view, loaded, js) { if (loaded) view?.evaluateJavascript(js, null) }
    AndroidView({ ctx ->
        WebView(ctx).apply {
            setBackgroundColor(android.graphics.Color.BLACK)
            settings.javaScriptEnabled = true
            settings.mediaPlaybackRequiresUserGesture = true
            isFocusable = false; isFocusableInTouchMode = false
            isVerticalScrollBarEnabled = false; isHorizontalScrollBarEnabled = false
            overScrollMode = WebView.OVER_SCROLL_NEVER
            setOnTouchListener { _, _ -> true } // the backdrop never takes input
            addJavascriptInterface(host, "ManadjVizHost")
            webViewClient = object : WebViewClient() { override fun onPageFinished(v: WebView?, url: String?) { loaded = true } }
            loadUrl("file:///android_asset/viz/index.html")
            view = this
        }
    }, modifier.onGloballyPositioned { c -> val p = c.positionInWindow(); Glass.origin = floatArrayOf(p.x, p.y) })
}

/** Settings › Visualizer (one call from SettingsSheet). */
@Composable fun VizSettings() {
    val context = LocalContext.current
    remember { Viz.init(context) }
    val on = Viz.enabled
    Row(Modifier.fillMaxWidth().height(44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Column(Modifier.weight(1f)) { Text("Visualizer backdrop", bold = true); Text("Desktop presets behind the UI, driven by the decks (spike #394).", color = Ink.muted, size = 11, lines = 2) }
        Key(if (on) "ON" else "OFF", Modifier.width(64.dp).fillMaxHeight(), Ink.accent, engaged = on, description = "Visualizer backdrop", textSize = 12, style = KeyStyle.PILL) { Viz.set(context, enabled = !on) }
    }
    if (!on) return
    // #401: rate what is on screen now (thumbs; queued offline, pushed to the desktop on sync).
    val current = Viz.PRESETS.firstOrNull { it.first == Viz.preset }
    val verdict = VizRatings.latest[Viz.preset]
    Row(Modifier.fillMaxWidth().height(44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Key("‹", Modifier.width(40.dp).fillMaxHeight(), Ink.accent, description = "Previous preset", textSize = 16, style = KeyStyle.PILL) { Viz.step(context, -1) }
        Column(Modifier.weight(1f)) {
            Text(current?.second ?: Viz.preset, bold = true)
            Text("${VizRatings.pending} rating${if (VizRatings.pending == 1) "" else "s"} to sync", color = Ink.muted, size = 10)
        }
        Key("▲", Modifier.width(48.dp).fillMaxHeight(), Ink.play, engaged = verdict == VizRatings.UP, description = "Rate preset up", textSize = 14, style = KeyStyle.PILL) { VizRatings.rate(Viz.preset, VizRatings.UP) }
        Key("▼", Modifier.width(48.dp).fillMaxHeight(), Ink.warning, engaged = verdict == VizRatings.DOWN, description = "Rate preset down", textSize = 14, style = KeyStyle.PILL) { VizRatings.rate(Viz.preset, VizRatings.DOWN) }
        Key("›", Modifier.width(40.dp).fillMaxHeight(), Ink.accent, description = "Next preset", textSize = 16, style = KeyStyle.PILL) { Viz.step(context, 1) }
    }
    for (row in Viz.PRESETS.chunked(3)) Row(Modifier.fillMaxWidth().height(36.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for ((id, name) in row) Key(name.uppercase() + when (VizRatings.latest[id]) { VizRatings.UP -> " ▲"; VizRatings.DOWN -> " ▼"; else -> "" }, Modifier.weight(1f).fillMaxHeight(), Ink.accent, engaged = Viz.preset == id, description = "Visualizer preset $name", textSize = 9, style = KeyStyle.PILL) { Viz.set(context, preset = id) }
        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
    }
    @Composable fun Stepper(label: String, value: String, down: () -> Unit, up: () -> Unit) =
        Row(Modifier.fillMaxWidth().height(36.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, Modifier.weight(1f), Ink.text, 12)
            Key("−", Modifier.width(44.dp).fillMaxHeight(), Ink.accent, description = "$label down", textSize = 14, style = KeyStyle.PILL, action = down)
            Text(value, Modifier.width(64.dp), Ink.text, 12, true)
            Key("+", Modifier.width(44.dp).fillMaxHeight(), Ink.accent, description = "$label up", textSize = 14, style = KeyStyle.PILL, action = up)
        }
    Stepper("Brightness", "${(Viz.brightness * 100 + .5f).toInt()}%", { Viz.set(context, brightness = Viz.brightness - .1f) }) { Viz.set(context, brightness = Viz.brightness + .1f) }
    val scales = listOf(.25f, .35f, .5f, .75f, 1f)
    Stepper("Render scale", "×%.2f".format(Viz.scale), { Viz.set(context, scale = scales.lastOrNull { it < Viz.scale - .01f } ?: scales.first()) }) { Viz.set(context, scale = scales.firstOrNull { it > Viz.scale + .01f } ?: scales.last()) }
    Stepper("Frame cap", "${Viz.fps} fps", { Viz.set(context, fps = if (Viz.fps > 30) 30 else 20) }) { Viz.set(context, fps = if (Viz.fps < 30) 30 else 60) }
    Stepper("Feed gain", "%+.0f dB".format(Viz.gainDb), { Viz.set(context, gainDb = Viz.gainDb - 3) }) { Viz.set(context, gainDb = Viz.gainDb + 3) }
    Row(Modifier.fillMaxWidth().height(36.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(Viz.stats ?: "—", Modifier.weight(1f), Ink.muted, 10)
        Key("HUD", Modifier.width(64.dp).fillMaxHeight(), Ink.accent, engaged = Viz.hud, description = "Visualizer feed HUD", textSize = 11, style = KeyStyle.PILL) { Viz.set(context, hud = !Viz.hud) }
    }
}
