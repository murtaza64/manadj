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
    val hotcues = mutableStateListOf<Double?>(null, null, null, null, null, null, null, null)
    val generation = AtomicLong()
    var pendingLoadCommandId: Long? = null
    val pendingControls = mutableMapOf<String, Long>()
    val durationSeconds get() = snapshot?.durationSeconds?.takeIf { snapshot?.sourceId == source?.id } ?: source?.durationSeconds
    val ready get() = pendingLoadCommandId == null && snapshot?.loadState == LoadState.READY && source?.id == snapshot?.sourceId
}

class PlayerModel(application: Application) : AndroidViewModel(application) {
    val decks = DeckId.entries.associateWith(::DeckUi)
    val visibleDecks = listOf(DeckId.A, DeckId.B)
    var selected by mutableStateOf(DeckId.A)
        private set
    var layout by mutableIntStateOf(0)
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
    var crossfade by mutableDoubleStateOf(.5)
    var lastReceipt by mutableStateOf<CommandReceipt?>(null)
        private set
    val sources = mutableStateListOf<LocalSource>()
    private val catalog = MediaSources(application)
    private var service: PlaybackService? = null
    private var bound = false
    private val releases = linkedMapOf<String, () -> Unit>()
    private var pendingSelection: DeckId? = null
    private var pendingLayout: Int? = null
    private var gestureSequence = 0L
    private val clientId = UUID.randomUUID().toString()
    private var cancelledGesture = false
    private var pendingCrossfade: Long? = null
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) { service = (binder as PlaybackService.LocalBinder).service }
        override fun onServiceDisconnected(name: ComponentName?) { service = null; output = null; failure = "Audio service disconnected" }
    }

    init {
        sources.addAll(catalog.remembered())
        bound = application.bindService(Intent(application, PlaybackService::class.java), connection, Context.BIND_AUTO_CREATE)
        if (!bound) failure = "Cannot bind the audio service"
        viewModelScope.launch {
            while (isActive) {
                val audio = service
                val state = audio?.snapshot()
                if (state != null) {
                    output = state
                    if (pendingCrossfade == null || state.appliedCommandId >= pendingCrossfade!!) { crossfade = state.crossfade; pendingCrossfade = null }
                    state.decks.forEach { (id, snapshot) ->
                        val ui = decks.getValue(id)
                        ui.snapshot = snapshot
                        val load = ui.pendingLoadCommandId
                        if (load != null && state.appliedCommandId >= load && snapshot.sourceId == ui.source?.id && snapshot.loadState in listOf(LoadState.READY, LoadState.ERROR)) ui.pendingLoadCommandId = null
                        if (ui.pendingLoadCommandId == null && !ui.importing && snapshot.sourceId != ui.source?.id) {
                            ui.source = audio?.source(snapshot.sourceId) ?: sources.firstOrNull { it.id == snapshot.sourceId }
                            ui.hotcues.indices.forEach { ui.hotcues[it] = null }
                        }
                        fun applied(control: String, update: () -> Unit) {
                            val pending = ui.pendingControls[control]
                            if (pending == null || state.appliedCommandId >= pending) { update(); ui.pendingControls.remove(control) }
                        }
                        applied("fader") { ui.fader = snapshot.fader }
                        applied("trim") { ui.trim = snapshot.trim }
                        applied("pitch") { ui.pitch = snapshot.pitchPercent }
                        applied("bend") { ui.bend = snapshot.bendPercent }
                    }
                    if (state.outputError != 0) failure = "Native output error ${state.outputError}"
                }
                audio?.failure?.let { failure = it }
                delay(33)
            }
        }
    }

    fun chooseDeck(id: DeckId) { if (releases.isEmpty()) selected = id else pendingSelection = id }
    fun chooseLayout(value: Int) { if (releases.isEmpty()) layout = value else pendingLayout = value }
    fun supports(capability: String) = output?.let { it.outputOpen && it.outputError == 0 && capability in it.supportedCapabilities } == true
    fun submit(command: AudioCommand): CommandReceipt {
        val receipt = service?.submit(command) ?: CommandReceipt(0, false, failure ?: "Audio output is starting")
        lastReceipt = receipt
        if (!receipt.accepted) failure = receipt.reason
        return receipt
    }
    fun dismissFailure() { failure = null }

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

    private fun importSource(deck: DeckId, uri: Uri) {
        releases.keys.filter { it.startsWith("${deck.name}:") }.forEach { id -> releases.remove(id)?.invoke() }
        val ui = decks.getValue(deck)
        val generation = ui.generation.incrementAndGet()
        ui.importing = true; ui.error = null
        viewModelScope.launch {
            try {
                val metadata = withContext(Dispatchers.IO) { catalog.readMetadata(uri) }
                if (ui.generation.get() != generation) return@launch
                withContext(Dispatchers.IO) {
                    getApplication<Application>().contentResolver.openFileDescriptor(uri, "r")?.use { descriptor ->
                        withContext(Dispatchers.Main.immediate) applyLoad@{
                            if (ui.generation.get() != generation) return@applyLoad
                            val receipt = service?.load(deck, metadata, descriptor) ?: CommandReceipt(0, false, "Audio output unavailable")
                            lastReceipt = receipt
                            if (!receipt.accepted) throw IllegalStateException(receipt.reason)
                            ui.source = metadata; ui.pendingLoadCommandId = receipt.id; ui.hotcues.indices.forEach { ui.hotcues[it] = null }
                            sources.removeAll { it.id == metadata.id }; sources.add(0, metadata); catalog.remember(sources)
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
    fun updatePitch(deck: DeckId, value: Double, gesture: String? = null) = control(deck, "pitch", AudioCommand.SetPitch(deck, value, gesture)) { it.pitch = value }
    fun updateBend(deck: DeckId, value: Double, gesture: String? = null) = control(deck, "bend", AudioCommand.SetBend(deck, value, gesture)) { it.bend = value }
    fun updateCrossfade(value: Double, gesture: String? = null) {
        val receipt = submit(AudioCommand.SetCrossfade(value, gesture))
        if (receipt.accepted) { crossfade = value; pendingCrossfade = receipt.id }
    }

    override fun onCleared() {
        cancelGestures()
        if (bound) getApplication<Application>().unbindService(connection)
        super.onCleared()
    }
}
