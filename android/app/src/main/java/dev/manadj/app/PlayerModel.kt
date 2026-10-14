package dev.manadj.app

import android.app.Application
import android.content.*
import android.net.Uri
import android.os.IBinder
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.manadj.audio.*
import kotlinx.coroutines.*
import java.util.concurrent.atomic.AtomicLong
import java.util.UUID

/** UI state is a projection of engine snapshots; no method advances playback time. */
class DeckUi(val id: DeckId) {
    var source by mutableStateOf<LocalSource?>(null)
    var snapshot by mutableStateOf<DeckSnapshot?>(null)
    var importing by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var fader by mutableDoubleStateOf(1.0)
    var trim by mutableDoubleStateOf(.5)
    var pitch by mutableDoubleStateOf(0.0)
    var bend by mutableDoubleStateOf(0.0)
    /** EQ knobs 0..1 (low, mid, high) and filter -1..1: optimistic until the callback applies them. */
    val eq = mutableStateListOf(.5, .5, .5)
    var filter by mutableDoubleStateOf(0.0)
    /** Beat-jump size (desktop beatjump.ts: 1..128, default 32); a UI preference, not engine state. */
    var jumpBeats by mutableDoubleStateOf(32.0)
    val generation = AtomicLong()
    /** Observable: `ready` derives from it, and it can clear on a tick whose snapshot is structurally unchanged. */
    var pendingLoadCommandId by mutableStateOf<Long?>(null)
    val pendingControls = mutableMapOf<String, Long>()
    val durationSeconds get() = snapshot?.durationSeconds?.takeIf { snapshot?.sourceId == source?.id } ?: source?.durationSeconds
    val ready get() = pendingLoadCommandId == null && snapshot?.loadState == LoadState.READY && source?.id == snapshot?.sourceId
    /** Hot cues live in the engine (captured at apply time); empty when the snapshot is for another source. */
    val hotCues: List<Double?> get() = snapshot?.takeIf { it.sourceId == source?.id }?.hotCues ?: List(AudioEngine.HOT_CUES) { null }
}

/** v1 performance layouts (layout 2, the mirrored dual mixer, is deprecated). */
enum class Layout(val label: String) { PORTRAIT("L1"), DENSE("L3") }

class PlayerModel(application: Application) : AndroidViewModel(application) {
    val decks = DeckId.entries.associateWith(::DeckUi)
    val visibleDecks = listOf(DeckId.A, DeckId.B)
    var selected by mutableStateOf(DeckId.A)
        private set
    var layout by mutableStateOf(Layout.PORTRAIT)
        private set
    var workspace by mutableStateOf("PADS")
    var browser by mutableStateOf<DeckId?>(null)
    var pitchDrawer by mutableStateOf<DeckId?>(null)
    var pickerTarget by mutableStateOf<DeckId?>(null)
    var replace by mutableStateOf<Pair<DeckId, Uri>?>(null)
    var output by mutableStateOf<EngineSnapshot?>(null)
        private set
    var failure by mutableStateOf<String?>(null)
        private set
    var outputInfo by mutableStateOf<OutputInfo?>(null)
        private set
    var crossfade by mutableDoubleStateOf(.5)
    var cueMix by mutableDoubleStateOf(0.0)
    private var pendingCueMix: Long? = null
    /** Output devices (hot-plug aware) and the device the stream targets (0 = system default). */
    val devices = mutableStateListOf<OutputDevice>()
    var routingDevice by mutableIntStateOf(0)
        private set
    var outputPanel by mutableStateOf(false)
    private val outputDevices = OutputDevices(application) { devices.clear(); devices.addAll(it) }
    var lastReceipt by mutableStateOf<CommandReceipt?>(null)
        private set
    val sources = mutableStateListOf<LocalSource>()
    private val catalog = MediaSources(application)
    private var service: PlaybackService? = null
    private var bound = false
    private val releases = linkedMapOf<String, () -> Unit>()
    private var pendingSelection: DeckId? = null
    private var pendingLayout: Layout? = null
    private var lastOutputError = 0
    private var outputWasOpen = true
    private var gestureSequence = 0L
    private val clientId = UUID.randomUUID().toString()
    private var cancelledGesture = false
    private var pendingCrossfade: Long? = null
    /** Central Beat FX section (engine-applied, or the last accepted write until it applies). */
    var beatFx by mutableStateOf(BeatFx.DEFAULT)
        private set
    private var pendingBeatFx: Long? = null
    private var quantizeOn = false
    /** Desktop Sync Group: SYNC/MATCH and pitch rides go through it. */
    private val sync = SyncGroup(object : SyncGroup.Actuator {
        override fun setPitch(deck: DeckId, percent: Double) = control(deck, "pitch", AudioCommand.SetPitch(deck, percent)) { it.pitch = percent }
        override fun alignPhase(deck: DeckId, reference: DeckId, ratio: Double) { submit(AudioCommand.PhaseAlign(deck, reference, ratio)) }
        override val quantize get() = quantizeOn
    })
    /** Group Tempo + per-deck OFF / SYNCED / OUT_OF_LOCK / WAITING. */
    var syncState by mutableStateOf(SyncState.NONE)
        private set
    private var sentSyncMembers: AudioCommand.SetSyncMembers? = null
    /** Publishes [syncState]; the engine scopes a member's quantized-launch reference to in-lock members. */
    private fun publishSync() {
        syncState = sync.state
        val members = AudioCommand.SetSyncMembers(
            syncState.decks.filterValues { it != SyncStatus.OFF }.keys, syncState.decks.filterValues { it == SyncStatus.SYNCED }.keys,
        )
        if (members != sentSyncMembers && service?.submit(members)?.accepted == true) sentSyncMembers = members
    }
    /** Desktop sweep-filter settings (synced `manadj-filter-settings`); re-sent until the engine accepts them. */
    var filterSettings by mutableStateOf(FilterSettings.SHIPPED)
        private set
    private var filterSettingsUnsent = false
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) { service = (binder as PlaybackService.LocalBinder).service }
        override fun onServiceDisconnected(name: ComponentName?) { service = null; output = null; sentSyncMembers = null; failure = "Audio service disconnected" }
    }

    init {
        sources.addAll(catalog.remembered())
        devices.addAll(outputDevices.list())
        bound = application.bindService(Intent(application, PlaybackService::class.java), connection, Context.BIND_AUTO_CREATE)
        if (!bound) failure = "Cannot bind the audio service"
        viewModelScope.launch {
            var tick = 0
            while (isActive) {
                val audio = service
                if (tick++ % 30 == 0) outputInfo = audio?.outputInfo()
                val state = audio?.snapshot()
                if (state != null) {
                    output = state
                    if (pendingCrossfade == null || state.appliedCommandId >= pendingCrossfade!!) { crossfade = (state.crossfade + 1) / 2; pendingCrossfade = null }
                    if (pendingCueMix == null || state.appliedCommandId >= pendingCueMix!!) { cueMix = state.cueMix; pendingCueMix = null }
                    if (pendingBeatFx == null || state.appliedCommandId >= pendingBeatFx!!) { beatFx = state.beatFx; pendingBeatFx = null }
                    quantizeOn = state.quantize
                    sync.update(state.decks.mapValues { SyncDeck.of(it.value) }); publishSync()
                    if (filterSettingsUnsent && audio?.submit(AudioCommand.SetFilterSettings(filterSettings))?.accepted == true) filterSettingsUnsent = false
                    state.decks.forEach { (id, snapshot) ->
                        val ui = decks.getValue(id)
                        ui.snapshot = snapshot
                        val load = ui.pendingLoadCommandId
                        if (load != null && state.appliedCommandId >= load && snapshot.sourceId == ui.source?.id && snapshot.loadState in listOf(LoadState.READY, LoadState.ERROR)) ui.pendingLoadCommandId = null
                        if (ui.pendingLoadCommandId == null && !ui.importing && snapshot.sourceId != ui.source?.id) {
                            ui.source = audio?.source(snapshot.sourceId) ?: sources.firstOrNull { it.id == snapshot.sourceId }
                        }
                        fun applied(control: String, update: () -> Unit) {
                            val pending = ui.pendingControls[control]
                            if (pending == null || state.appliedCommandId >= pending) { update(); ui.pendingControls.remove(control) }
                        }
                        applied("fader") { ui.fader = snapshot.fader }
                        applied("trim") { ui.trim = snapshot.trim }
                        applied("pitch") { ui.pitch = snapshot.pitchPercent }
                        applied("bend") { ui.bend = snapshot.bendPercent }
                        for (band in 0..2) applied("eq$band") { ui.eq[band] = snapshot.eq[band] }
                        applied("filter") { ui.filter = snapshot.filter }
                    }
                    // Latch on change so OK dismisses until something new happens.
                    if (state.outputError != lastOutputError) { lastOutputError = state.outputError; if (state.outputError != 0 && !state.outputOpen) failure = "Audio output error ${state.outputError}: reconnecting" }
                    if (state.outputOpen != outputWasOpen) { outputWasOpen = state.outputOpen; failure = if (state.outputOpen) null else "Audio output disconnected: reconnecting" }
                }
                audio?.failure?.let { failure = it }
                audio?.pauseReason?.let { failure = it; audio.pauseReason = null }
                delay(33)
            }
        }
    }

    fun chooseDeck(id: DeckId) { if (releases.isEmpty()) selected = id else pendingSelection = id }
    fun chooseLayout(value: Layout) { if (releases.isEmpty()) layout = value else pendingLayout = value }
    /** Derived so readers recompose only when capabilities change, not on every 33 ms snapshot tick. */
    private val capabilities by derivedStateOf { output?.takeIf { it.outputOpen && it.outputError == 0 }?.supportedCapabilities ?: emptySet() }
    fun supports(capability: String) = capability in capabilities
    fun submit(command: AudioCommand): CommandReceipt {
        val receipt = service?.submit(command) ?: CommandReceipt(0, false, failure ?: "Audio output is starting")
        lastReceipt = receipt
        if (!receipt.accepted) failure = receipt.reason
        return receipt
    }
    fun dismissFailure() { failure = null }
    /** Fresh engine snapshot (not the 33 ms UI poll): Session replay reads its clock from it. */
    fun engineSnapshot(): EngineSnapshot? = service?.snapshot()
    /** Frame-stamped commands (Session replay); UI pending/receipt state is not involved. */
    fun schedule(atFrame: Long, commands: List<AudioCommand>, tag: Long): Boolean {
        val receipts = service?.schedule(atFrame, commands, tag) ?: return false
        receipts.firstOrNull { !it.accepted }?.let { failure = it.reason; return false }
        return true
    }
    fun cancelScheduled(tag: Long) { service?.cancelScheduled(tag) }

    fun beginGesture(deck: DeckId, kind: String, cancel: (String) -> Unit): String {
        val id = "${deck.name}:$clientId:$kind:${++gestureSequence}"
        releases[id] = { cancel(id) }
        return id
    }
    fun finishGesture(id: String, cancelled: Boolean = false) {
        val release = releases.remove(id) ?: return
        if (cancelled) { cancelledGesture = true; release() }
        if (releases.isEmpty()) {
            if (!cancelledGesture) { pendingSelection?.let { selected = it }; pendingLayout?.let { layout = it } }
            pendingSelection = null; pendingLayout = null
            cancelledGesture = false
        }
    }
    fun gestureActive(id: String) = releases.containsKey(id)
    fun cancelGestures() {
        releases.values.toList().forEach { it() }; releases.clear()
        decks.values.forEach { it.bend = 0.0 }
        pendingSelection = null; pendingLayout = null
        cancelledGesture = false
    }

    fun requestImport(deck: DeckId, uri: Uri) {
        val state = decks.getValue(deck).snapshot
        if (state?.playing == true || state?.previewing == true) replace = deck to uri else importSource(deck, uri)
    }
    fun confirmReplacement() { replace?.let { importSource(it.first, it.second) }; replace = null }
    fun pickerResult(uri: Uri?) { val target = pickerTarget; pickerTarget = null; if (target != null && uri != null) requestImport(target, uri) }

    private fun importSource(deck: DeckId, uri: Uri) = loadInto(
        deck, metadata = { catalog.readMetadata(uri) },
        open = { getApplication<Application>().contentResolver.openFileDescriptor(uri, "r") },
        // Grid until a library beatgrid exists: tagged BPM anchored at 0 s (or gridless).
        grid = { it.bpm?.let { bpm -> bpm to 0.0 } }, remember = true,
    )

    /**
     * Library load (#372): a cached regular file plus library metadata and grid. Loads
     * immediately (no replace-while-playing confirmation; the caller's UI decides).
     * [sourceId] must be stable per audio revision, e.g. "library:<trackId>:<audioRev>".
     */
    fun load(
        deck: DeckId, file: java.io.File, sourceId: String, title: String, artist: String,
        durationSeconds: Double?, bpm: Double? = null, firstBeatSeconds: Double? = null,
        mainCueSeconds: Double? = null, hotCues: Map<Int, Double> = emptyMap(),
    ) = loadInto(
        deck, metadata = { LocalSource(sourceId, Uri.fromFile(file), title, artist, durationSeconds, persistentGrant = false, bpm = bpm) },
        open = { android.os.ParcelFileDescriptor.open(file, android.os.ParcelFileDescriptor.MODE_READ_ONLY) },
        grid = { bpm?.takeIf { it > 0 }?.let { it to (firstBeatSeconds ?: 0.0) } }, remember = false,
        cues = { d -> mainCueSeconds?.let { submit(AudioCommand.SetCueAt(d, it)) }; hotCues.forEach { (slot, at) -> submit(AudioCommand.SetHotCueAt(d, slot, at)) } },
    )

    private fun loadInto(
        deck: DeckId, metadata: () -> LocalSource, open: () -> android.os.ParcelFileDescriptor?,
        grid: (LocalSource) -> Pair<Double, Double>?, remember: Boolean, cues: (DeckId) -> Unit = {},
    ) {
        releases.keys.filter { it.startsWith("${deck.name}:") }.forEach { id -> releases.remove(id)?.invoke() }
        val ui = decks.getValue(deck)
        val generation = ui.generation.incrementAndGet()
        ui.importing = true; ui.error = null
        viewModelScope.launch {
            try {
                val source = withContext(Dispatchers.IO) { metadata() }
                if (ui.generation.get() != generation) return@launch
                withContext(Dispatchers.IO) {
                    open()?.use { descriptor ->
                        withContext(Dispatchers.Main.immediate) applyLoad@{
                            if (ui.generation.get() != generation) return@applyLoad
                            val receipt = service?.load(deck, source, descriptor) ?: CommandReceipt(0, false, "Audio output unavailable")
                            lastReceipt = receipt
                            if (!receipt.accepted) throw IllegalStateException(receipt.reason)
                            ui.source = source; ui.pendingLoadCommandId = receipt.id
                            val (bpm, anchor) = grid(source) ?: (0.0 to 0.0)
                            submit(AudioCommand.SetGrid(deck, bpm, anchor)) // After Prepare, which clears grid and cues.
                            cues(deck)
                            if (remember) { sources.removeAll { it.id == source.id }; sources.add(0, source); catalog.remember(sources) }
                            browser = null
                        }
                    } ?: throw IllegalStateException("The document provider did not open this track")
                }
            } catch (cancel: CancellationException) { throw cancel }
            catch (error: Exception) { if (ui.generation.get() == generation) ui.error = "Load failed: ${error.message}" }
            finally { if (ui.generation.get() == generation) ui.importing = false }
        }
    }

    private fun control(deck: DeckId, name: String, command: AudioCommand, preview: (DeckUi) -> Unit) {
        val receipt = submit(command)
        if (receipt.accepted) { val ui = decks.getValue(deck); ui.pendingControls[name] = receipt.id; preview(ui) }
    }
    fun updateFader(deck: DeckId, value: Double, gesture: String? = null) = control(deck, "fader", AudioCommand.SetFader(deck, value, gesture)) { it.fader = value }
    fun updateTrim(deck: DeckId, value: Double, gesture: String? = null) = control(deck, "trim", AudioCommand.SetTrim(deck, value, gesture)) { it.trim = value }
    /** Pitch fader: rides the Group Tempo when [deck] is synced (all members follow), plain pitch otherwise. */
    fun updatePitch(deck: DeckId, value: Double, gesture: String? = null) { sync.setPitch(deck, value); publishSync() }
    /** SYNC: join/leave the Sync Group. Returns OutOfReach when the group tempo is past ±8 % (join refused), null when n/a. */
    fun toggleSync(deck: DeckId): BpmMatch? = sync.toggle(deck).also { publishSync() }
    /** MATCH: one-shot tempo capture of the nearest playing deck (phase too with Quantize on). */
    fun match(deck: DeckId): BpmMatch? = sync.match(deck).also { publishSync() }
    fun updateBend(deck: DeckId, value: Double, gesture: String? = null) = control(deck, "bend", AudioCommand.SetBend(deck, value, gesture)) { it.bend = value }
    /** Grid source for library tracks (#372): constant tempo + first-beat anchor; bpm <= 0 clears. */
    fun setGrid(deck: DeckId, bpm: Double, anchorSeconds: Double) = submit(AudioCommand.SetGrid(deck, bpm, anchorSeconds))
    fun jump(deck: DeckId, direction: Int) = submit(AudioCommand.BeatJump(deck, direction * decks.getValue(deck).jumpBeats))
    fun resizeJump(deck: DeckId, factor: Double) { decks.getValue(deck).let { it.jumpBeats = (it.jumpBeats * factor).coerceIn(1.0, 128.0) } }
    fun toggleLoop(deck: DeckId) = submit(AudioCommand.LoopToggle(deck))
    fun resizeLoop(deck: DeckId, change: LoopChange) = submit(AudioCommand.LoopResize(deck, change))
    fun setQuantize(on: Boolean) = submit(AudioCommand.SetQuantize(on)).also { if (it.accepted) quantizeOn = on }
    /** Key lock per deck; DeckSnapshot.keyLock / keyLockActive report it. */
    fun setKeyLock(deck: DeckId, on: Boolean) = submit(AudioCommand.SetKeyLock(deck, on))
    /** Waveform touch scratch: begin on touch-down, move by signed track seconds per drag event, end on release. */
    fun scratchBegin(deck: DeckId) = submit(AudioCommand.ScratchBegin(deck))
    fun scratchMove(deck: DeckId, deltaSeconds: Double) { if (deltaSeconds != 0.0 && deltaSeconds.isFinite()) submit(AudioCommand.ScratchMove(deck, deltaSeconds)) }
    fun scratchEnd(deck: DeckId) = submit(AudioCommand.ScratchEnd(deck))

    fun updateEq(deck: DeckId, band: Int, value: Double, gesture: String? = null) = control(deck, "eq$band", AudioCommand.SetEq(deck, band, value, gesture)) { it.eq[band] = value }
    fun updateFilter(deck: DeckId, position: Double, gesture: String? = null) = control(deck, "filter", AudioCommand.SetFilter(deck, position, gesture)) { it.filter = position }
    /** [value] is the fader throw 0 (A) .. 1 (B); the engine takes -1..1. */
    fun updateCrossfade(value: Double, gesture: String? = null) {
        val receipt = submit(AudioCommand.SetCrossfade(value * 2 - 1, gesture))
        if (receipt.accepted) { crossfade = value; pendingCrossfade = receipt.id }
    }

    fun updateCueMix(value: Double, gesture: String? = null) {
        val receipt = submit(AudioCommand.SetCueMix(value, gesture))
        if (receipt.accepted) { cueMix = value; pendingCueMix = receipt.id }
    }
    /** Applies sweep-filter settings to every deck (click-free); kept and re-sent if the engine is not up yet. */
    fun updateFilterSettings(settings: FilterSettings) {
        filterSettings = settings.sanitized()
        filterSettingsUnsent = !(service?.submit(AudioCommand.SetFilterSettings(filterSettings))?.accepted ?: false)
    }
    /** Desktop sweepResponseDb for the Settings response graph (null while the engine is starting). */
    fun filterResponseDb(settings: FilterSettings, position: Double, frequencies: DoubleArray) = service?.filterResponseDb(settings, position, frequencies)
    /** Writes the whole Beat FX section; e.g. `updateBeatFx(beatFx.copy(on = true))`. */
    fun updateBeatFx(state: BeatFxState, gesture: String? = null) {
        val receipt = submit(AudioCommand.SetBeatFx(state, gesture))
        if (receipt.accepted) { beatFx = state; pendingBeatFx = receipt.id }
    }
    fun togglePfl(deck: DeckId) { submit(AudioCommand.SetPfl(deck, decks.getValue(deck).snapshot?.pfl != true)) }
    /** Bus routing + device; QUAD only for devices reporting >= 4 channels (the UI gates it). */
    fun configureOutput(routing: Routing, deviceId: Int) {
        val audio = service ?: run { failure = "Audio output is starting"; return }
        audio.configureOutput(routing, deviceId) { result ->
            if (result == 0) routingDevice = deviceId else failure = "Output reconfigure failed ($result); reverting to stereo default"
            if (result != 0) audio.configureOutput(Routing.STEREO, 0) { routingDevice = 0 }
        }
    }

    override fun onCleared() {
        outputDevices.close()
        cancelGestures()
        if (bound) getApplication<Application>().unbindService(connection)
        super.onCleared()
    }
}
