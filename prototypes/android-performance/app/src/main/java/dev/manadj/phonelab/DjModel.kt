package dev.manadj.phonelab

import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import kotlin.math.*

/** The envelope is generated once per fixture, never in the drawing loop. */
class DemoTrack(val title: String, val artist: String, val bpm: Int, val key: String, val duration: Double, seed: Int) {
    val waveform = FloatArray(4096) { i ->
        val beat = i * duration / 4096 * bpm / 60
        val section = (beat / 32).toInt()
        val energy = if ((section + seed) % 5 == 2) 0.22 else 0.85
        (0.07 + energy * (0.35 + 0.35 * abs(sin(i * (0.37 + seed * 0.03))) + 0.3 * exp(-((beat % 1) * 6)))).toFloat()
    }
    val bands = Array(8) { band -> FloatArray(waveform.size) { i ->
        (waveform[i] * (.18 + .42 * abs(sin(i * (.009 + band * .003) + seed + band)))).toFloat()
    } }
}

val demoTracks = listOf(
    DemoTrack("NEON DRIVE", "Kinetic Assembly", 124, "8A", 248.0, 1),
    DemoTrack("AFTER HOURS", "Glass Circuit", 128, "9A", 312.0, 2),
    DemoTrack("SUBTERRANEAN", "Phase Archive", 132, "7A", 286.0, 3),
    DemoTrack("SOLAR RETURN", "Signal / Noise", 122, "8B", 224.0, 4),
    DemoTrack("NO SLEEP", "Local Motion", 126, "10A", 338.0, 5),
    DemoTrack("BLUE HOUR", "Parallel Lines", 118, "6A", 264.0, 6),
)

class Deck(val id: String, initial: DemoTrack) {
    var track by mutableStateOf(initial)
        private set
    val name get() = track.title
    val bpm get() = track.bpm
    var playing by mutableStateOf(false)
    var cueHeld by mutableStateOf(false)
    var cuePoint by mutableDoubleStateOf(0.0)
    var hotCuePreviewSlot by mutableStateOf<Int?>(null)
        private set
    var scratchHeld by mutableStateOf(false)
    var bend by mutableFloatStateOf(0f)
    val running get() = playing || cueHeld || hotCuePreviewSlot != null
    var tempo by mutableFloatStateOf(bpm.toFloat())
    var gain by mutableFloatStateOf(1f)
    var trim by mutableFloatStateOf(0.5f)
    var filter by mutableFloatStateOf(0.5f)
    var low by mutableFloatStateOf(0.5f)
    var mid by mutableFloatStateOf(0.5f)
    var high by mutableFloatStateOf(0.5f)
    var loopOn by mutableStateOf(false)
        private set
    var loopBeats by mutableFloatStateOf(4f)
        private set
    var jumpBeats by mutableIntStateOf(32)
    var loopStart by mutableDoubleStateOf(0.0)
        private set
    var positionSeconds by mutableDoubleStateOf(0.0)
    val cues = mutableStateListOf<Float?>()
    init { setCues() }
    private fun setCues() {
        val phrase = 8.0 * 60 / bpm
        cues.clear(); cues.addAll(List(8) { (floor(it * track.duration / 8 / phrase) * phrase).toFloat() })
    }
    fun beginScrub(): ScrubState {
        scratchHeld = true
        return ScrubState(positionSeconds, loopOn, loopStart, loopBeats)
    }
    fun endScrub(start: ScrubState, cancelled: Boolean) {
        if (cancelled) { positionSeconds = start.position; loopOn = start.loopOn; loopStart = start.loopStart; loopBeats = start.loopBeats }
        scratchHeld = false
    }
    fun load(next: DemoTrack) {
        track = next; tempo = next.bpm.toFloat(); playing = false; cueHeld = false
        positionSeconds = 0.0; cuePoint = 0.0; hotCuePreviewSlot = null; bend = 0f; scratchHeld = false; loopOn = false; setCues()
    }
    fun advance(seconds: Double) {
        if (!running || scratchHeld) return
        positionSeconds += seconds * tempo / bpm * (1 + bend)
        if (loopOn) {
            val length = loopBeats * 60.0 / bpm
            if (positionSeconds >= loopStart + length) positionSeconds = loopStart + (positionSeconds - loopStart) % length
        }
        if (positionSeconds >= track.duration) { positionSeconds = track.duration; playing = false; cueHeld = false; hotCuePreviewSlot = null }
    }
    fun playToggle() {
        if (positionSeconds >= track.duration) positionSeconds = 0.0
        playing = !playing
        if (!playing) { cueHeld = false; hotCuePreviewSlot = null }
    }
    fun cueDown() {
        if (playing) { playing = false; cueHeld = false; hotCuePreviewSlot = null; seek(cuePoint) }
        else if (abs(positionSeconds - cuePoint) < .02) cueHeld = true
        else cuePoint = positionSeconds
    }
    fun cueUp() { if (cueHeld && !playing) seek(cuePoint); cueHeld = false }
    fun seek(seconds: Double) { loopOn = false; positionSeconds = seconds.coerceIn(0.0, track.duration) }
    fun jump(beats: Int) {
        val next = (positionSeconds + beats * 60.0 / bpm).coerceIn(0.0, track.duration)
        if (loopOn) loopStart = (loopStart + next - positionSeconds).coerceAtLeast(0.0)
        positionSeconds = next
    }
    fun triggerCue(index: Int) {
        loopOn = false
        val cue = cues[index]
        if (cue == null) cues[index] = positionSeconds.toFloat() else positionSeconds = cue.toDouble()
    }
    fun hotCueDown(index: Int) {
        val cue = cues[index]
        if (cue == null) { cues[index] = positionSeconds.toFloat(); return }
        seek(cue.toDouble())
        if (!playing) hotCuePreviewSlot = index
    }
    fun hotCueUp(index: Int) {
        if (hotCuePreviewSlot != index) return
        if (!playing) cues[index]?.let { seek(it.toDouble()) }
        hotCuePreviewSlot = null
    }
    fun toggleLoop() {
        if (!loopOn) loopStart = floor(positionSeconds * bpm / 60) * 60 / bpm
        loopOn = !loopOn
    }
    fun resizeLoop(multiplier: Double) { loopBeats = (loopBeats * multiplier).toFloat().coerceIn(.125f, 128f) }
    fun setLoopLength(beats: Float) { loopBeats = beats.coerceIn(.125f, 128f) }
    fun updateGain(v: Float) { gain = v }
    fun updateTempo(v: Float) { tempo = v.coerceIn(bpm * 0.92f, bpm * 1.08f) }
    fun updateFilter(v: Float) { filter = v }
}

/** Desktop BeatFxSectionState contract: one radio target and one bipolar balance. */
class BeatFx {
    var effect by mutableStateOf("ECHO")
    var target by mutableStateOf("A")
    var on by mutableStateOf(false)
    var depth by mutableFloatStateOf(0f) // UI 0..1 maps to desktop -1..+1; reset is dry.
    var lengthIndex by mutableIntStateOf(1)
    var tempoDeck by mutableStateOf("A")
    val lengths = listOf("¼", "½", "¾", "1", "2", "4", "8")
    fun route(id: String) { target = id; if (id != "MASTER") tempoDeck = id }
}

class DjModel : ViewModel() {
    val decks = linkedMapOf("A" to Deck("A", demoTracks[0]), "B" to Deck("B", demoTracks[1]))
    val a get() = decks.getValue("A")
    val b get() = decks.getValue("B")
    val fx = BeatFx()
    var active by mutableStateOf("A")
    var variant by mutableIntStateOf(0)
    var bank by mutableStateOf("PADS")
    var cross by mutableFloatStateOf(0.5f)
    var info by mutableStateOf(false)
    var browsing by mutableStateOf(false)
    var loadTarget by mutableStateOf("A")
    var pendingTrack by mutableStateOf<DemoTrack?>(null)
    var jumpPicker by mutableStateOf<String?>(null)
    var drawer by mutableStateOf<String?>(null)
    var drawerDeck by mutableStateOf("A")
    val wheels = mutableStateMapOf<String, WheelFeedback>()
    var wheelChooser by mutableStateOf<WheelFeedback?>(null)
    val precision = mutableStateMapOf<String, Precision>()
    val touches = mutableStateMapOf<String, Boolean>()
    var touchOwner by mutableStateOf<String?>(null)
    private var capturedTouches = 0
    private var pendingVariant: Int? = null
    private var pendingBank: String? = null
    private var pendingActive: String? = null
    private var pendingFxTarget: String? = null
    private var hadCancelledTouch = false
    val selected get() = decks.getValue(active)
    fun chooseVariant(next: Int) { if (capturedTouches == 0) variant = next else pendingVariant = next }
    fun chooseBank(next: String) { if (capturedTouches == 0) bank = next else pendingBank = next }
    fun chooseDeck(next: String) { if (capturedTouches == 0) active = next else pendingActive = next }
    fun routeFx(next: String) { if (capturedTouches == 0) fx.route(next) else pendingFxTarget = next }
    fun openDrawer(name: String, deck: String = active) { if (capturedTouches == 0) { drawerDeck = deck; drawer = name } }
    fun closeDrawer() { if (capturedTouches == 0) drawer = null }
    fun browse() { if (capturedTouches == 0) { browsing = !browsing; pendingTrack = null; loadTarget = active } }
    fun requestLoad(track: DemoTrack) {
        if (capturedTouches != 0) return
        val deck = decks.getValue(loadTarget)
        if (deck.running) pendingTrack = track else { deck.load(track); browsing = false }
    }
    fun confirmLoad() {
        if (capturedTouches != 0) return
        pendingTrack?.let { decks.getValue(loadTarget).load(it) }
        pendingTrack = null; browsing = false
    }
    fun beginTouch(label: String) { capturedTouches++; touchOwner = label; touches[label] = true }
    fun showPrecision(feedback: Precision) { precision[feedback.label] = feedback }
    fun updatePrecision(id: String, value: Float) { precision[id]?.let { precision[id] = it.copy(value = value) } }
    fun resetPrecision(id: String) {
        precision[id]?.let { feedback ->
            feedback.reset()
            precision[id] = feedback.copy(value = feedback.neutral, startValue = feedback.neutral, resetVersion = feedback.resetVersion + 1)
        }
    }
    fun releaseTouch(label: String, cancelled: Boolean = false) {
        if (cancelled) hadCancelledTouch = true
        precision.remove(label); wheels.remove(label); touches.remove(label)
        capturedTouches = (capturedTouches - 1).coerceAtLeast(0)
        if (capturedTouches > 0) return
        touchOwner = null
        if (!hadCancelledTouch) {
            pendingVariant?.let { variant = it }; pendingBank?.let { bank = it }; pendingActive?.let { active = it }
            pendingFxTarget?.let { fx.route(it) }
        }
        hadCancelledTouch = false; pendingVariant = null; pendingBank = null; pendingActive = null; pendingFxTarget = null
    }
    fun updateCross(value: Float) { cross = value.coerceIn(0f, 1f) }
}

data class Precision(val label: String, val value: Float, val fingerY: Float, val startValue: Float, val neutral: Float, val reset: () -> Unit, val resetVersion: Int = 0, val anchorX: Float = 0f)

data class WheelFeedback(val label: String, val choices: List<String>, val index: Int, val fingerY: Float, val pick: (Int) -> Unit)
data class ScrubState(val position: Double, val loopOn: Boolean, val loopStart: Double, val loopBeats: Float)
