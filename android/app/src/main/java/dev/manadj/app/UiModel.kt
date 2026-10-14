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
data class KnobPopup(val label: String, val kind: KnobKind, val value: Double, val color: androidx.compose.ui.graphics.Color, val fingerX: Float, val fingerY: Float, val reset: () -> Unit, val resetVersion: Int = 0)

class UiModel(application: Application) : AndroidViewModel(application) {
    private val prefs = application.getSharedPreferences("ui-settings", Context.MODE_PRIVATE)
    private fun flag(key: String, default: Boolean) = mutableStateOf(prefs.getBoolean(key, default))
    private fun store(key: String, value: Boolean) = prefs.edit().putBoolean(key, value).apply()

    private val _quantize = flag("quantize", true)
    var quantize: Boolean get() = _quantize.value; set(v) { _quantize.value = v; store("quantize", v) }
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
    var waveSeconds by mutableDoubleStateOf(prefs.getFloat("wave-seconds", 12f).toDouble())
    fun chooseWaveSeconds(v: Double) { waveSeconds = v; prefs.edit().putFloat("wave-seconds", v.toFloat()).apply() }

    val extras = DeckId.entries.associateWith { DeckExtras() }
    val fx = FxUi()
    var settings by mutableStateOf(false)
    var stemsFor by mutableStateOf<DeckId?>(null)
    var wheel by mutableStateOf<WheelFeedback?>(null)
    var knob by mutableStateOf<KnobPopup?>(null)
    var notice by mutableStateOf<String?>(null)
        private set
    private var noticeJob: Job? = null

    /** A tap on a control the engine cannot honour yet: say so instead of silently doing nothing. */
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
        shiftLatched[deck] = false
        undoCue = Triple(deck, slot, at)
        undoJob?.cancel(); undoJob = viewModelScope.launch { delay(5000); undoCue = null }
    }
    fun undoDelete(model: PlayerModel) {
        val (deck, slot, at) = undoCue ?: return
        model.submit(dev.manadj.audio.AudioCommand.SetHotCueAt(deck, slot, at))
        undoCue = null; undoJob?.cancel()
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
    var filter by mutableStateOf(LibraryFilter())
    val following = mutableStateMapOf<DeckId, Boolean>()
    /** Follow reference per deck: a library Track id (fixture rows until #372 maps loaded files to Tracks). */
    val followRef = mutableStateMapOf<DeckId, Long>()
    var knownOnly by mutableStateOf(false)
    var selectedRow by mutableStateOf<Long?>(null)
    var filtersOpen by mutableStateOf(false)

    init {
        viewModelScope.launch { repo.library.collect { lib -> synced = lib?.let { SyncedLibrary(it, repo) } } }
        viewModelScope.launch { repo.state.collect { syncState = it } }
        viewModelScope.launch { repo.downloads.collect { downloads++ } }
    }

    // Waveform analysis cache by source id.
    val waves = mutableStateMapOf<String, WaveformData>()
    private val analysing = mutableMapOf<String, Job>()
    fun ensureWave(source: LocalSource?) {
        if (source == null || waves[source.id]?.complete == true || analysing[source.id]?.isActive == true) return
        analysing[source.id] = viewModelScope.launch(Dispatchers.Default) {
            WaveformAnalyzer.analyze(getApplication(), source.uri, source.durationSeconds, { !isActive }) { data -> viewModelScope.launch(Dispatchers.Main) { waves[source.id] = data } }
        }
        // Keep at most the four most recent analyses in memory.
        while (waves.size > 4) waves.remove(waves.keys.first())
    }

    /** Live strip for the waveform: engine EQ when the engine applies it, else the preview values. */
    fun strip(deck: DeckUi, engineEq: Boolean = deck.snapshot != null): Strip {
        val e = extras.getValue(deck.id)
        val (lo, mid, hi) = if (engineEq) Triple(deck.eq[0], deck.eq[1], deck.eq[2]) else Triple(e.eqLow, e.eqMid, e.eqHigh)
        return Strip(trimToRelativeGain(deck.trim), eqValueToGain(lo), eqValueToGain(mid), eqValueToGain(hi))
    }
}
