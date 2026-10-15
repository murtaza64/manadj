package dev.manadj.app

import android.app.Application
import android.content.Context
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.manadj.app.browse.*
import dev.manadj.audio.DeckId
import kotlinx.coroutines.*

val BEAT_CHOICES = listOf(1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0, 128.0)
val LOOP_CHOICES = listOf(.0625, .125, .25, .5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0)
fun beatText(v: Double) = when (v) { .0625 -> "1/16"; .125 -> "1/8"; .25 -> "1/4"; .5 -> "1/2"; .75 -> "3/4"; else -> v.toInt().toString() }

/** Desktop BEAT_FX_EFFECTS (GRV6 panel order) with BEAT_FX_COLORS identity colors. */
enum class FxEffect(val label: String, val short: String, val color: Long) {
    ECHO("ECHO", "ECH", 0xffffe600), LOW_CUT_ECHO("LOW CUT ECHO", "LCE", 0xffb8ff00), REVERB("REVERB", "RVB", 0xff39ff14),
    FLANGER("FLANGER", "FLG", 0xffff1f1f), TRANS("TRANS", "TRS", 0xff0050ff), ROLL("ROLL", "ROL", 0xffff00f2),
}
val FX_BEATS = listOf(.0625, .125, .25, .5, .75, 1.0, 2.0, 4.0, 8.0)
val FX_TARGETS = listOf("A", "B", "MST")

/** UI-side values for controls the engine does not back yet (rendered only in preview mode, marked PENDING). */
class DeckExtras {
    var eqLow by mutableDoubleStateOf(.5); var eqMid by mutableDoubleStateOf(.5); var eqHigh by mutableDoubleStateOf(.5)
    var filter by mutableDoubleStateOf(.5)
    var loopIndex by mutableIntStateOf(5); var loopOn by mutableStateOf(false)
    var jumpIndex by mutableIntStateOf(5)
    var keyLock by mutableStateOf(false)
    val stems = mutableStateListOf(true, true, true, true)
    val history = StripHistory()
}

class FxUi {
    var effect by mutableStateOf(FxEffect.ECHO); var target by mutableIntStateOf(0); var on by mutableStateOf(false)
    var depth by mutableDoubleStateOf(0.0) // UI 0..1 maps to desktop -1..+1; double-tap resets dry.
    var beats by mutableIntStateOf(3)
}

/** Hold-wheel feedback: the value strip floating above the held control. */
data class WheelFeedback(val label: String, val choices: List<String>, val index: Int, val anchorX: Float, val anchorY: Float, val color: androidx.compose.ui.graphics.Color)
/** Enlarged knob next to the finger while a knob is held (fine mode). */
data class KnobPopup(val label: String, val kind: KnobKind, val value: Double, val color: androidx.compose.ui.graphics.Color, val fingerX: Float, val fingerY: Float, val reset: () -> Unit, val resetVersion: Int = 0, val anchorR: Float = 0f, val fine: Boolean = false)

/**
 * Landscape BROWSE: LOADING = the load-target deck stays beside the browser; PLAYING = the outgoing deck and mixer
 * stay, the browser replaces the target's side; BOTH = the browser covers both decks from a fixed side, only the
 * mixer stays, loads are explicit swipes.
 */
enum class BrowseBeside { LOADING, PLAYING, BOTH }

val dev.manadj.audio.QuantizeMode.quantized get() = this == dev.manadj.audio.QuantizeMode.GRID || this == dev.manadj.audio.QuantizeMode.HEARD
val dev.manadj.audio.QuantizeMode.heard get() = this == dev.manadj.audio.QuantizeMode.HEARD || this == dev.manadj.audio.QuantizeMode.HEARD_UNQUANTIZED

class UiModel(application: Application) : AndroidViewModel(application) {
    private val prefs = application.getSharedPreferences("ui-settings", Context.MODE_PRIVATE)
    private fun flag(key: String, default: Boolean) = mutableStateOf(prefs.getBoolean(key, default))
    private fun store(key: String, value: Boolean) = prefs.edit().putBoolean(key, value).apply()

    private val _quantize = flag("quantize", true)
    var quantize: Boolean get() = _quantize.value; set(v) { _quantize.value = v; store("quantize", v) }
    private val _beside = mutableStateOf(runCatching { BrowseBeside.valueOf(prefs.getString("browse-beside", null) ?: "") }.getOrDefault(BrowseBeside.LOADING))
    /** Landscape BROWSE layout (#93/#94). */
    var browseBeside: BrowseBeside get() = _beside.value; set(v) { _beside.value = v; prefs.edit().putString("browse-beside", v.name).apply() }
    /** Mobile-only overview dim (previews + minimaps) on top of the desktop minimap brightness (#98). */
    var overviewBrightness: Float get() = OverviewDim.phone; set(v) { OverviewDim.phone = v.coerceIn(.3f, 1f); prefs.edit().putFloat("overview-brightness", OverviewDim.phone).apply() }
    init { OverviewDim.phone = prefs.getFloat("overview-brightness", .8f) }
    /** Jog-strip nudge gain (#134): bend multiplier on desktop's mouse jog curve; default 1.5. */
    var jogSensitivity: Float get() = JogFeel.gain; set(v) { JogFeel.gain = (kotlin.math.round(v * 10) / 10).coerceIn(.5f, 3f); prefs.edit().putFloat("jog-sensitivity", JogFeel.gain).apply() }
    init { JogFeel.gain = prefs.getFloat("jog-sensitivity", JogFeel.DEFAULT) }
    private val _bothRight = flag("browse-both-right", true)
    /** [BrowseBeside.BOTH]: the browser's fixed side (right by default). */
    var browseBothRight: Boolean get() = _bothRight.value; set(v) { _bothRight.value = v; store("browse-both-right", v) }
    private val _heard = flag("quantize-heard", false)
    /** Quantize reads the heard instant (#382 HEARD) instead of the render position (GRID). */
    var quantizeHeard: Boolean get() = _heard.value; set(v) { _heard.value = v; store("quantize-heard", v) }
    /** (quantize, heard) → engine mode; lag compensation is independent of quantize (#122). */
    val quantizeMode get() = when { quantize && quantizeHeard -> dev.manadj.audio.QuantizeMode.HEARD; quantize -> dev.manadj.audio.QuantizeMode.GRID; quantizeHeard -> dev.manadj.audio.QuantizeMode.HEARD_UNQUANTIZED; else -> dev.manadj.audio.QuantizeMode.OFF }
    /** Persist + push the quantize preference ([on] / [heard]; null keeps the current value). */
    fun setQuantize(model: PlayerModel, on: Boolean? = null, heard: Boolean? = null) {
        on?.let { quantize = it }; heard?.let { quantizeHeard = it }
        if (model.supports("quantize")) model.setQuantizeMode(quantizeMode)
    }
    private val _xf = flag("crossfader", true)
    var crossfaderEnabled: Boolean get() = _xf.value; set(v) { _xf.value = v; store("crossfader", v) }
    private val _preview = flag("preview-pending", false)
    /** Lets the human try controls whose audio is still pending; they move visuals only and stay marked. */
    var previewPending: Boolean get() = _preview.value; set(v) { _preview.value = v; store("preview-pending", v) }
    private val _haptics = flag("haptics", true)
    var haptics: Boolean get() = _haptics.value; set(v) { _haptics.value = v; store("haptics", v) }
    private val _debug = flag("output-debug", false)
    var outputDebug: Boolean get() = _debug.value; set(v) { _debug.value = v; store("output-debug", v) }
    /** Detail-wave window (shared by both decks). Pinch writes it live; chooseWaveSeconds persists. */
    /** VINYL per deck (pitch panel): one-finger waveform drag scratches instead of scrubbing (#107). */
    val vinyl = mutableStateMapOf<DeckId, Boolean>()
    var waveSeconds by mutableDoubleStateOf(prefs.getFloat("wave-seconds", 12f).toDouble())
    fun chooseWaveSeconds(v: Double) { waveSeconds = v; prefs.edit().putFloat("wave-seconds", v.toFloat()).apply() }

    val extras = DeckId.entries.associateWith { DeckExtras() }
    val fx = FxUi()
    var settings by mutableStateOf(false)
    /** Session replay screen (#378) open. */
    var sessions by mutableStateOf(false)
    var stemsFor by mutableStateOf<DeckId?>(null)
    var wheel by mutableStateOf<WheelFeedback?>(null)
    /** Held knobs' popups, one per pointer/knob (#126): a second touch never closes or steals the first. */
    val knobs = mutableStateMapOf<String, KnobPopup>()
    /** The first held knob's popup (tests / single-touch readers). */
    val knob: KnobPopup? get() = knobs.values.firstOrNull()
    var notice by mutableStateOf<String?>(null)
        private set
    private var noticeJob: Job? = null

    /** A tap on a control the engine cannot honour yet: say so instead of silently doing nothing. */
    fun say(text: String) { notice = text; noticeJob?.cancel(); noticeJob = viewModelScope.launch { delay(2600); notice = null } }
    fun pending(what: String) {
        notice = "$what — engine pending (#370). Settings › Preview pending controls to try the UI."
        noticeJob?.cancel(); noticeJob = viewModelScope.launch { delay(2600); notice = null }
    }

    // Library: the synced desktop Library (#372) when present, else the fixture.
    val repo = dev.manadj.app.library.LibraryHolder.repository(application)
    var synced by mutableStateOf<SyncedLibrary?>(null)
        private set
    var syncState by mutableStateOf(dev.manadj.library.SyncState())
        private set
    /** Bumps when per-track download state changes (row labels re-read it). */
    var downloads by mutableIntStateOf(0)
        private set
    val library: LibrarySource get() = synced ?: FixtureLibrary
    fun sync() = viewModelScope.launch { repo.sync() }
    /** Minimap drag position per deck (detail waves follow it live). */
    val seekPreview = mutableStateMapOf<DeckId, Double>()
    /** Library track ids played this session (browser dims them). */
    val played = mutableStateListOf<Long>()
    /** Monotonic load time per deck (landscape BROWSE picks the least recently loaded as outgoing). */
    val loadedAt = mutableMapOf<DeckId, Long>()
    /** SHIFT per deck: held = momentary, short tap = latched for one pad press. */
    val shiftHeld = mutableStateMapOf<DeckId, Boolean>()
    val shiftLatched = mutableStateMapOf<DeckId, Boolean>()
    fun shifted(deck: DeckId) = shiftHeld[deck] == true || shiftLatched[deck] == true

    /** Last deleted hot cue (deck, slot, seconds), offered as UNDO for a few seconds. */
    var undoCue by mutableStateOf<Triple<DeckId, Int, Double>?>(null)
        private set
    private var undoJob: Job? = null
    /** SHIFT + pad: clear the cue (engine ClearHotCue, desktop useHotCueActions remove) and offer UNDO. */
    fun deleteCue(model: PlayerModel, deck: DeckId, slot: Int) {
        val at = model.decks.getValue(deck).hotCues[slot] ?: return
        model.submit(dev.manadj.audio.AudioCommand.ClearHotCue(deck, slot))
        journalCue(model, deck, slot, null)
        shiftLatched[deck] = false
        undoCue = Triple(deck, slot, at)
        undoJob?.cancel(); undoJob = viewModelScope.launch { delay(5000); undoCue = null }
    }
    fun undoDelete(model: PlayerModel) {
        val (deck, slot, at) = undoCue ?: return
        model.submit(dev.manadj.audio.AudioCommand.SetHotCueAt(deck, slot, at))
        journalCue(model, deck, slot, at)
        undoCue = null; undoJob?.cancel()
    }

    /**
     * Phone hot-cue edits on library decks go through the library edit journal (#375: applied locally, pushed
     * on sync, newest-wins on the desktop). Local-file decks stay engine-only. Slots: UI 0..7, library 1..8.
     */
    fun journalCue(model: PlayerModel, deck: DeckId, slot: Int, time: Double?) {
        val id = dev.manadj.app.library.LibraryHolder.trackOn(model, deck) ?: return
        dev.manadj.app.library.LibraryHolder.edit(getApplication(), id, dev.manadj.library.TrackEdit.HotCueSet(slot + 1, time))
    }
    /** A pad SET places the cue engine-side (quantized); journal it once the snapshot shows where. */
    fun journalCueWhenSet(model: PlayerModel, deck: DeckId, slot: Int) = viewModelScope.launch {
        repeat(40) { model.decks.getValue(deck).hotCues[slot]?.let { journalCue(model, deck, slot, it); return@launch }; delay(25) }
    }

    /** Library row waiting for "replace the playing deck?" confirmation. */
    var confirmLoad by mutableStateOf<Pair<DeckId, Long>?>(null)
    /** Library row → deck. Replacing a playing deck asks first (ReplaceDialog). The browser stays open. */
    fun loadRow(model: PlayerModel, deck: DeckId, id: Long, confirmed: Boolean = false) {
        val lib = synced ?: return pending("Library load — fixture row has no file (sync a desktop library in Settings)")
        val track = lib.lib.track(id.toInt()) ?: return
        val playing = model.decks.getValue(deck).snapshot.let { it?.playing == true || it?.previewing == true }
        if (playing && !confirmed) { confirmLoad = deck to id; return }
        confirmLoad = null
        dev.manadj.app.library.LibraryHolder.load(getApplication(), model, deck, track) { pending("Load failed: $it") }
    }
    /** Browser view state (#55): filter/source/search/sort, highlighted row and per-source scroll, persisted. */
    private val browsePrefs = application.getSharedPreferences("browse", Context.MODE_PRIVATE)
    var filter by mutableStateOf(loadFilter())
    private fun loadFilter(): LibraryFilter = runCatching {
        val o = org.json.JSONObject(browsePrefs.getString("filter", null) ?: return LibraryFilter())
        LibraryFilter(
            text = o.optString("text"), tags = o.optJSONArray("tags")?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: emptySet(),
            bpmCenter = o.optDouble("bpm").takeIf { it.isFinite() }, bpmTolerance = o.optDouble("tol", 6.0),
            sort = runCatching { LibrarySort.valueOf(o.optString("sort")) }.getOrDefault(LibrarySort.DATE_ADDED),
            descending = o.optBoolean("desc", true), downloadedOnly = o.optBoolean("downloaded", false),
        )
    }.getOrDefault(LibraryFilter())
    fun saveBrowse() {
        val f = filter
        val o = org.json.JSONObject().put("text", f.text).put("tags", org.json.JSONArray(f.tags.toList())).put("tol", f.bpmTolerance)
            .put("sort", f.sort.name).put("desc", f.descending).put("downloaded", f.downloadedOnly)
        f.bpmCenter?.let { o.put("bpm", it) }
        browsePrefs.edit().putString("filter", o.toString()).putLong("row", selectedRow ?: -1).putString("path", path.joinToString("|") { it.key }).apply()
    }
    /** Browser tier path (#130), root first; the last node is shown. Persisted with the filter. */
    var path by mutableStateOf(browsePrefs.getString("path", null)?.split("|")?.mapNotNull(BrowseNode::parse)?.takeIf { it.firstOrNull() == BrowseNode.Root } ?: listOf(BrowseNode.Root, BrowseNode.Collection))
        private set
    val node: BrowseNode get() = path.last()
    /** Opens [node] (path resolved from the root) and restores its remembered sort (#128). */
    fun navigate(target: BrowseNode) {
        path = library.pathTo(target)
        val (sort, desc) = sortFor(target)
        filter = filter.copy(sort = sort, descending = desc)
    }
    fun back(): Boolean { if (path.size <= 1) return false; navigate(path[path.size - 2]); return true }
    /** Display sort per source node (#128): tap a new sort = its default direction, tap the active one = flip. */
    fun chooseSort(sort: LibrarySort) {
        val f = filter
        val desc = if (f.sort == sort) !f.descending else sort.defaultDescending
        filter = f.copy(sort = sort, descending = desc)
        browsePrefs.edit().putString("sort-${node.key}", "${sort.name}:$desc").apply()
    }
    private fun sortFor(n: BrowseNode): Pair<LibrarySort, Boolean> {
        val saved = browsePrefs.getString("sort-${n.key}", null)?.split(":")
        val sort = saved?.getOrNull(0)?.let { runCatching { LibrarySort.valueOf(it) }.getOrNull() }?.takeIf(n::allows) ?: n.defaultSort
        return sort to (saved?.getOrNull(1)?.toBooleanStrictOrNull()?.takeIf { saved[0] == sort.name } ?: sort.defaultDescending)
    }
    /** Scroll anchor per source (Collection / playlist id): first visible row key + offset (falls back to its index). */
    fun scrollAnchor(source: String): Triple<String?, Int, Int> = Triple(browsePrefs.getString("scroll-key-$source", null), browsePrefs.getInt("scroll-index-$source", 0), browsePrefs.getInt("scroll-offset-$source", 0))
    fun saveScroll(source: String, key: String?, index: Int, offset: Int) { browsePrefs.edit().putString("scroll-key-$source", key).putInt("scroll-index-$source", index).putInt("scroll-offset-$source", offset).apply() }
    /** Follow target (#133): AUTO follows the audible/outgoing deck and re-targets as the mix moves; A/B/BOTH pin. */
    var followPin by mutableStateOf(runCatching { FollowPin.valueOf(browsePrefs.getString("follow-pin", null) ?: "") }.getOrDefault(FollowPin.AUTO))
    fun pinFollow(pin: FollowPin) { followPin = pin; browsePrefs.edit().putString("follow-pin", pin.name).apply() }
    /** Follow Temperature draw seed (desktop session seed, +1 per Reroll); rows recompute when it changes. */
    var followSeed by mutableLongStateOf(0L)
        private set
    fun rerollFollow() = repo.rerollFollow()
    /** Desktop Follow params edit (known-only / Temperature), synced back to the desktop. */
    fun editFollow(knownOnly: Boolean? = null, temperature: Double? = null) = viewModelScope.launch {
        val lib = synced?.lib ?: return@launch
        val p = lib.followParams
        repo.editFollowParams(p.copy(knownOnly = knownOnly ?: p.knownOnly, temperature = (temperature ?: p.temperature).coerceIn(0.0, 1.0)))
    }
    var selectedRow by mutableStateOf(browsePrefs.getLong("row", -1).takeIf { it >= 0 })
    var filtersOpen by mutableStateOf(false)
    /** Follow row whose Match-score breakdown is expanded. */
    var breakdownRow by mutableStateOf<Long?>(null)

    init {
        viewModelScope.launch { repo.library.collect { lib ->
            synced = lib?.let { SyncedLibrary(it, repo) }
            lib?.waveformStyles?.let { WaveStyle.full = WaveStyle.of(it.full); WaveStyle.minimap = WaveStyle.of(it.minimap) }
        } }
        viewModelScope.launch { repo.state.collect { syncState = it } }
        viewModelScope.launch { repo.downloads.collect { downloads++ } }
        viewModelScope.launch { repo.followSeed.collect { followSeed = it } }
    }

    // Waveform analysis cache by source id.
    val waves = mutableStateMapOf<String, WaveformData>()
    private val analysing = mutableMapOf<String, Job>()
    /**
     * Waveform for a deck's source, owned by the ViewModel (survives rotation / browser): the desktop detail
     * waveform for library tracks (cache/sync, bounded wait), else phone analysis. Failures are retried on the
     * next call; sources on a deck are never evicted.
     */
    fun ensureWave(source: LocalSource?, onDecks: Set<String> = emptySet()) {
        if (source == null || waves[source.id]?.complete == true || analysing[source.id]?.isActive == true) return
        analysing[source.id] = viewModelScope.launch(Dispatchers.Default) {
            val trackId = source.id.takeIf { it.startsWith("library:") }?.removePrefix("library:")?.substringBefore(':')?.toIntOrNull()
            val desktop = trackId?.let { withTimeoutOrNull(4000) { runCatching { dev.manadj.app.library.LibraryHolder.detailWaveform(getApplication(), it) }.getOrNull() } }
            if (desktop != null && desktop.sampleRate > 0 && desktop.bandHop > 0 && desktop.nBands == 8 && desktop.bands.isNotEmpty()) {
                val data = WaveformData(desktop.sampleRate, desktop.durationSecs, desktop.peakHop, desktop.bandHop, desktop.stftWindow, desktop.peaks, desktop.bands, desktop.bands.size / 8)
                withContext(Dispatchers.Main) { waves[source.id] = data; waveSource[source.id] = "desktop" }
                return@launch
            }
            val t0 = System.nanoTime()
            val result = WaveformAnalyzer.analyze(getApplication(), source.uri, source.durationSeconds, { !isActive }) { data -> viewModelScope.launch(Dispatchers.Main) { waves[source.id] = data } }
            android.util.Log.i("ManadjWave", "${source.id}: phone analysis ${if (result == null) "FAILED" else "ok"} in ${(System.nanoTime() - t0) / 1_000_000} ms (desktop waveform ${if (trackId == null) "n/a" else "missing"})")
            withContext(Dispatchers.Main) { waveSource[source.id] = if (result == null) "failed" else "phone" }
        }
        val keep = onDecks + source.id
        while (waves.size > 6) { val victim = waves.keys.firstOrNull { it !in keep } ?: break; waves.remove(victim) }
    }
    /** Where each wave came from (desktop / phone / failed) — diagnostics. */
    val waveSource = mutableStateMapOf<String, String>()

    /** Live strip for the waveform: engine EQ when the engine applies it, else the preview values. */
    fun strip(deck: DeckUi, engineEq: Boolean = deck.snapshot != null): Strip {
        val e = extras.getValue(deck.id)
        val (lo, mid, hi) = if (engineEq) Triple(deck.eq[0], deck.eq[1], deck.eq[2]) else Triple(e.eqLow, e.eqMid, e.eqHigh)
        val s = deck.snapshot
        val stems = if (s?.stems == true) s.stemGains.foldIndexed(0) { i, m, g -> if (g > .5) m or (1 shl i) else m } else ALL_STEMS
        return Strip(trimToRelativeGain(deck.trim), eqValueToGain(lo), eqValueToGain(mid), eqValueToGain(hi), stems)
    }

    /** Desktop stem waveforms per source (4, STEM_NAMES order), fetched once the deck has a stem bank. */
    val stemWaves = mutableStateMapOf<String, List<WaveformData>>()
    private val stemFetches = HashMap<String, Job>()
    private val composites = HashMap<Pair<String, Int>, WaveformData?>()
    fun ensureStemWaves(sourceId: String, trackId: Int) {
        if (sourceId in stemWaves || stemFetches[sourceId]?.isActive == true) return
        stemFetches[sourceId] = viewModelScope.launch(Dispatchers.Default) {
            val waves = dev.manadj.audio.AudioEngine.STEM_NAMES.map { name ->
                val d = runCatching { dev.manadj.app.library.LibraryHolder.stemWaveform(getApplication(), trackId, name) }.getOrNull() ?: return@launch
                if (d.nBands != 8 || d.bandHop <= 0) return@launch
                WaveformData(d.sampleRate, d.durationSecs, d.peakHop, d.bandHop, d.stftWindow, d.peaks, d.bands, d.bands.size / 8)
            }
            withContext(Dispatchers.Main) { stemWaves[sourceId] = waves; while (stemWaves.size > 4) stemWaves.remove(stemWaves.keys.first { it != sourceId }) }
        }
    }
    /** The mix as heard with stem [mask] (cached per source + mask); null = draw the plain mix. */
    fun stemWave(sourceId: String, mix: WaveformData, mask: Int): WaveformData? {
        if (mask == ALL_STEMS) return null
        val stems = stemWaves[sourceId] ?: return null
        return composites.getOrPut(sourceId to mask) { if (composites.size > 24) composites.clear(); stemComposite(mix, stems, mask) }
    }
}
