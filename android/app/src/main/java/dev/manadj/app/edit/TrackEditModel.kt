package dev.manadj.app.edit

import android.content.Context
import androidx.compose.runtime.*
import androidx.lifecycle.viewModelScope
import dev.manadj.app.PlayerModel
import dev.manadj.app.UiModel
import dev.manadj.app.library.LibraryHolder
import dev.manadj.app.position
import dev.manadj.audio.AudioCommand
import dev.manadj.audio.DeckId
import dev.manadj.audio.Routing
import dev.manadj.library.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

/** Which Track the edit view is open on, and the deck it auditions on (null = the spare edit deck). */
data class EditRequest(val trackId: Int, val deck: DeckId? = null)

/** App-wide open state for the single-track edit view (#379); entry points set it. */
object TrackEditNav {
    var request by mutableStateOf<EditRequest?>(null)
    fun open(trackId: Int, deck: DeckId? = null) { request = EditRequest(trackId, deck) }
}

/** Audition deck when the edit view is not opened from a live deck: an engine deck the performance UI never shows. */
val EDIT_DECK = DeckId.D

/**
 * One Track's edit session: local drafts over the synced Library track (shown at once, pushed to any deck
 * holding the Track at once) committed to the #375 edit journal after a short settle, so a burst of nudges
 * journals one edit. Desktop semantics live in [GridMath] / [LadderProjection].
 */
class TrackEditModel(private val context: Context, val trackId: Int, val deck: DeckId, private val model: PlayerModel, private val ux: UiModel) {
    val ui get() = model.decks.getValue(deck)
    val library: LibraryTrack? get() = ux.synced?.lib?.track(trackId)

    private var gridDraft by mutableStateOf<Draft<Beatgrid?>?>(null)
    private var marksDraft by mutableStateOf<List<Double>?>(null)
    private val cueDrafts = mutableStateMapOf<Int, Draft<HotCue?>>()
    private var mainCueDraft by mutableStateOf<Draft<Double?>?>(null)
    var titleDraft by mutableStateOf<String?>(null)
    var artistDraft by mutableStateOf<String?>(null)
    /** Wrapper so a draft of "cleared" (null) differs from "no draft". */
    data class Draft<T>(val value: T)

    val grid: Beatgrid? get() = gridDraft?.let { it.value } ?: library?.grid
    val bpm: Double? get() = grid?.tempoChanges?.let { GridMath.dominantBpm(it, duration) } ?: library?.bpm
    val changes: List<TempoChange>? get() = GridMath.base(grid, library?.bpm)
    val marks: List<Double> get() = marksDraft ?: library?.ladder?.resetMarks.orEmpty()
    val arities: List<Int> get() = library?.ladder?.arities.orEmpty()
    fun cue(slot: Int): HotCue? = cueDrafts[slot]?.let { it.value } ?: library?.hotCues?.firstOrNull { it.slot == slot }
    val mainCue: Double? get() = mainCueDraft?.let { it.value } ?: library?.mainCue
    val duration: Double get() = ui.durationSeconds ?: library?.durationSecs ?: 0.0
    val variable: Boolean get() = (changes?.size ?: 0) > 1
    /** Placeholder = no saved grid (computed from BPM, not saved info). */
    val placeholder: Boolean get() = grid == null

    /** Beats + downbeats + ladder for the current (draft) grid; recomputed only when they change. */
    val expansion by derivedStateOf { changes?.let { GridMath.expand(it, duration.coerceAtLeast(1.0)) } }
    val ladder by derivedStateOf { expansion?.let { e -> LadderProjection.resolve(changes!!, e.downbeats, marks, arities) } }
    val markTimes by derivedStateOf { expansion?.let { LadderProjection.resolvedMarkTimes(it.downbeats, marks) }.orEmpty() }

    val playhead: Double get() = position(ui)
    val ready: Boolean get() = ui.ready && LibraryHolder.trackOn(model, deck) == trackId

    private val jobs = mutableMapOf<String, Pair<Job, () -> Unit>>()
    private fun commit(key: String, settleMs: Long = 600, write: () -> Unit) {
        jobs.remove(key)?.first?.cancel()
        val job = ux.viewModelScope.launch { delay(settleMs); jobs.remove(key); write() }
        jobs[key] = job to write
    }
    /** Write every pending draft now (leaving the view). */
    fun flush() { jobs.values.toList().forEach { (job, write) -> job.cancel(); write() }; jobs.clear() }
    private fun journal(edit: TrackEdit) = LibraryHolder.edit(context, trackId, edit)

    /** Decks holding this Track (the audition deck included): live edits land on them immediately. */
    private fun holders() = DeckId.entries.filter { LibraryHolder.trackOn(model, it) == trackId }

    // ── Audition ──

    /** Bring the Track onto the edit deck (when not editing on a live deck) and route it. */
    fun prepare(onError: (String) -> Unit) {
        if (deck != EDIT_DECK || LibraryHolder.trackOn(model, deck) == trackId) return
        val t = library ?: return
        LibraryHolder.load(context, model, deck, t, onError)
    }
    /** Stereo: the edit deck plays on master. Split/4-ch: headphones only (fader down, PFL on). */
    fun route() {
        if (deck != EDIT_DECK) return
        val cueOnly = model.output?.routing?.let { it != Routing.STEREO } == true
        model.updateFader(deck, if (cueOnly) 0.0 else 1.0)
        if ((ui.snapshot?.pfl == true) != cueOnly) model.togglePfl(deck)
    }
    fun leave() {
        flush()
        if (deck == EDIT_DECK && LibraryHolder.trackOn(model, deck) == trackId && ui.snapshot?.playing == true) model.submit(AudioCommand.Pause(deck))
    }
    /** The edit deck is on master while a performance deck plays (stereo routing): the audience hears it. */
    fun otherDeckPlaying() = routedToMaster && model.visibleDecks.any { it != deck && model.decks.getValue(it).snapshot?.playing == true }
    val routedToMaster: Boolean get() = deck != EDIT_DECK || model.output?.routing == Routing.STEREO

    fun playPause() = model.submit(if (ui.snapshot?.playing == true) AudioCommand.Pause(deck) else AudioCommand.Play(deck))
    fun seek(t: Double) = model.submit(AudioCommand.Seek(deck, t.coerceIn(0.0, duration)))
    fun jumpBeats(beats: Double) = model.submit(AudioCommand.BeatJump(deck, beats))

    /** The playhead snapped to the nearest beat when Quantize is on (desktop hot-cue set). */
    fun quantized(t: Double): Double {
        val beats = expansion?.beats ?: return t
        if (!(model.output?.quantize ?: ux.quantize) || beats.isEmpty()) return t
        return beats.minBy { abs(it - t) }
    }

    // ── Grid ──

    private fun setGrid(next: Beatgrid?) {
        if (next == null) return
        gridDraft = Draft(next)
        val first = next.tempoChanges.first()
        val anchor = GridMath.firstDownbeat(next.tempoChanges)
        holders().forEach { model.setGrid(it, first.bpm, anchor) }
        commit("grid") { journal(TrackEdit.Grid(gridDraft?.value)) }
    }
    fun setDownbeatHere() = setGrid(GridMath.setDownbeat(grid, library?.bpm, playhead))
    fun nudgeGrid(ms: Double) = setGrid(GridMath.nudge(grid, library?.bpm, ms, duration))
    fun growShrink(grow: Boolean) { val b = bpm ?: return; retempo(GridMath.growShrink(b, grow)) }
    fun scaleBpm(factor: Double) { val b = bpm ?: return; retempo(Math.round(b * factor).toDouble()) }
    /** False on variable grids (the desktop answers 409: edit the grid instead). */
    fun retempo(newBpm: Double): Boolean {
        val next = GridMath.retempo(grid, library?.bpm, newBpm) ?: return false
        setGrid(next); return true
    }

    /**
     * Drop anchor (glossary): set-downbeat + Reset mark + Hot Cue 4 at the playhead, playhead-exact; the
     * softer rungs 3/2/1 fill only empty slots at -8/-16/-32 bars (skipped before the track start).
     */
    fun dropAnchor() {
        val t = playhead
        val next = GridMath.setDownbeat(grid, library?.bpm, t) ?: return
        setGrid(next)
        if (marks.none { abs(it - t) < 1e-6 }) setMarks(marks + t)
        val tc = next.tempoChanges.first()
        val bar = 60.0 / tc.bpm * tc.timeSignatureNum
        setCue(4, t, keepDecor = true)
        for ((slot, bars) in listOf(3 to 8, 2 to 16, 1 to 32)) {
            val at = t - bars * bar
            if (at >= 0 && cue(slot) == null) setCue(slot, at, keepDecor = true)
        }
    }

    // ── Metric ladder ──

    private fun setMarks(next: List<Double>) {
        marksDraft = next.sorted()
        commit("marks", 300) { journal(TrackEdit.ResetMarks(marksDraft.orEmpty())) }
    }
    /** Add a Reset mark at the downbeat nearest the playhead (stored snapped, desktop markResetAtPlayhead). */
    fun markHere() {
        val downbeats = expansion?.downbeats ?: return
        if (downbeats.isEmpty()) return
        val snapped = downbeats[LadderProjection.nearestDownbeatOrdinal(downbeats, playhead)]
        if (markTimes.any { abs(it - snapped) < 1e-6 }) return
        setMarks(marks + snapped)
    }
    fun deleteNearestMark() { LadderProjection.nearestMark(marks, playhead)?.let(::deleteMark) }
    fun deleteMark(mark: Double) = setMarks(marks.filter { it != mark })
    /** Bar readout at the playhead ("13 of 16", "+1"); null when gridless. */
    fun barLabel(t: Double = playhead): String? {
        val e = expansion ?: return null; val p = ladder ?: return null
        if (e.downbeats.isEmpty() || t < e.downbeats[0] - .005) return null
        var lo = 0; var hi = e.downbeats.size - 1
        while (lo < hi) { val mid = (lo + hi + 1) / 2; if (e.downbeats[mid] <= t + .005) lo = mid else hi = mid - 1 }
        return p.label(lo)
    }

    // ── Cues ──

    fun setCue(slot: Int, time: Double?, label: String? = cue(slot)?.label, color: String? = cue(slot)?.color, keepDecor: Boolean = false) {
        val existing = cue(slot)
        val next = time?.let { HotCue(slot, it.coerceIn(0.0, duration.takeIf { d -> d > 0 } ?: it), if (keepDecor) existing?.label else label, if (keepDecor) existing?.color else color) }
        cueDrafts[slot] = Draft(next)
        holders().forEach { d -> if (next == null) model.submit(AudioCommand.ClearHotCue(d, slot - 1)) else model.submit(AudioCommand.SetHotCueAt(d, slot - 1, next.time)) }
        commit("cue$slot", 1000) {
            val draft = cueDrafts[slot]; val c = draft?.value
            journal(TrackEdit.HotCueSet(slot, c?.time, c?.label, c?.color))
            // Hand back to the Library once journaled, so pad SET/DEL on the deck (journaled by the pads) show through.
            ux.viewModelScope.launch { delay(1500); if (cueDrafts[slot] === draft) cueDrafts.remove(slot) }
        }
    }
    fun setCueHere(slot: Int) = setCue(slot, quantized(playhead))
    fun nudgeCue(slot: Int, seconds: Double) { val c = cue(slot) ?: return; setCue(slot, c.time + seconds) }
    fun decorate(slot: Int, label: String?, color: String?) { val c = cue(slot) ?: return; setCue(slot, c.time, label?.trim()?.ifEmpty { null }, color) }
    fun clearCue(slot: Int) = setCue(slot, null)

    fun setMainCue(time: Double?) {
        mainCueDraft = Draft(time)
        if (time != null) holders().forEach { model.submit(AudioCommand.SetCueAt(it, time)) }
        commit("main", 400) { journal(TrackEdit.MainCue(mainCueDraft?.value)) }
    }

    // ── Metadata ──

    fun saveTitle(value: String) {
        titleDraft = value
        commit("title", 800) { journal(TrackEdit.Title(value.trim().ifEmpty { null })) }
    }
    fun saveArtist(value: String) {
        artistDraft = value
        commit("artist", 800) { journal(TrackEdit.Artist(value.trim().ifEmpty { null })) }
    }
}

/** Desktop hot-cue palette (theme/tokens.ts HOT_CUE_CSS_COLORS), slot 1..8 defaults. */
val CUE_PALETTE = listOf("#1e90ff", "#ffd400", "#ff8800", "#ff4455", "#2ed573", "#ff5cc8", "#a855f7", "#00cec9")

fun cueHex(slot: Int, stored: String?): String = stored?.takeIf { Regex("^#[0-9a-fA-F]{6}$").matches(it) } ?: CUE_PALETTE[(slot - 1).coerceIn(0, 7)]
