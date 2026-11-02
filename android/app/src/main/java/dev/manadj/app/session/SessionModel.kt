package dev.manadj.app.session

import android.app.Application
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.manadj.app.PlayerModel
import dev.manadj.app.library.LibraryHolder
import dev.manadj.audio.*
import dev.manadj.library.LibraryTrack
import dev.manadj.library.SyncClient
import dev.manadj.library.group.*
import dev.manadj.library.session.*
import kotlinx.coroutines.*
import java.io.File
import kotlin.math.abs

/**
 * Session replay (#378): desktop Sessions (device sync) replayed through the shared engine on all four decks.
 * Sample-exact: [ReplayScript] turns the log into ops stamped with Session time; one [ReplayEpoch] maps them
 * to engine output frames and the callback applies each at its frame. Nothing here chases positions.
 */
class SessionModel(application: Application) : AndroidViewModel(application) {
    private val repo = LibraryHolder.repository(application)
    private val groupAdapter = repo.groupReplay { (recorded + headers).map { it.uuid.lowercase() }.toSet() }
    var groupReplaySource by mutableStateOf<GroupReplaySource?>(null)
        private set
    var groupReplayReadiness by mutableStateOf<GroupReplayReadiness?>(null)
        private set
    var groupReplayBusy by mutableStateOf(false)
        private set
    var selectingGroupTrack by mutableStateOf<String?>(null)
    private var groupValidation: Job? = null
    private data class GroupDecodedProof(val attempt: GroupLoadAttempt,val requestGeneration: Long,var loadId: Long? = null,var validated: Boolean = false,var verifying: Boolean = false)
    private val groupDecoded=mutableMapOf<Int,GroupDecodedProof>()
    private val store = SessionStore(File(application.filesDir, "sessions-cache"), {
        SyncClient(repo.baseUrl, repo.pairCode, deviceToken = repo.deviceToken, deviceId = repo.deviceId, deviceName = repo.deviceName)
    }, uuidAllowed=repo::rawSessionAllowed)

    var headers by mutableStateOf(store.cached())
        private set
    var peerItems by mutableStateOf(repo.peerSessions.cached())
        private set
    var peerListError by mutableStateOf<String?>(null)
        private set
    var peerInfo by mutableStateOf<PeerSessionItem?>(null)
    var groupItems by mutableStateOf<List<GroupSessionView>>(emptyList())
        private set
    var groupInfo by mutableStateOf<GroupSessionView?>(null)
    var groupError by mutableStateOf<String?>(null)
        private set
    private var groupRead: Job? = null
    var peerReplay by mutableStateOf<PeerReplay?>(null)
        private set
    var peerChecking by mutableStateOf(false)
        private set
    private var peerValidation: Job? = null
    private val peerLoads = arrayOfNulls<Job>(4)
    private data class PeerDecodedProof(val sourceId: String, val requestGeneration: Long, var loadId: Long? = null)
    /** Exact-file load provenance, independent of a reused receiver ID or unchanged source label. */
    private val peerDecoded = mutableMapOf<Int, PeerDecodedProof>()
    var listError by mutableStateOf<String?>(null)
        private set
    var refreshing by mutableStateOf(false)
        private set
    var opening by mutableStateOf<String?>(null)
        private set
    var header by mutableStateOf<SessionHeader?>(null)
        private set
    var log by mutableStateOf<SessionLog?>(null)
        private set
    private var driver: ReplayDriver? = null
    /** The running replay's epoch (identity changes only when replay restarts: seek, play). */
    val replayEpoch get() = driver?.epoch
    /** Recorded ticks the replay reference disagrees with by > 5 ms: bad recording data, shown, never corrected. */
    var recordingDrift by mutableStateOf<List<SessionLog.Divergence>>(emptyList())
        private set
    /** Session clock (capture seconds). */
    var time by mutableDoubleStateOf(0.0)
        private set
    var playing by mutableStateOf(false)
        private set
    /** Tracks loading/decoding before the clock may start. */
    var preparing by mutableStateOf(false)
        private set
    var notice by mutableStateOf<String?>(null)
    /** Per-deck load failure (track missing from the Library, download failed). */
    val deckErrors = mutableStateListOf<String?>(null, null, null, null)
    /** Last measured engine − reference offset per deck (ms; null = not sounding), and late frame-stamped ops. */
    val engineOffsetMs = mutableStateListOf<Double?>(null, null, null, null)
    var lateOps by mutableLongStateOf(0L)
        private set
    /** Timeline view window (capture seconds). */
    var viewStart by mutableDoubleStateOf(0.0)
    var viewWidth by mutableDoubleStateOf(1.0)
    var follow by mutableStateOf(true)
    /** Narrowest window the timeline allows (its max zoom, set from its width). */
    var minViewWidth = 8.0
    /** A manual pan holds follow-scroll off until this nanoTime (desktop: 20 s). */
    var followHeldUntil by mutableLongStateOf(0L)
    /** Timeline model (waveform runs, mix, marks) of the open Session. */
    var timeline by mutableStateOf<SessionTimeline?>(null)
        private set
    /** Timeline waveforms per library track (desktop detail waveform + display fill gain). */
    val waves = mutableStateMapOf<Int, TimelineWave>()
    /** Session clock extrapolated to the display frame (smooth playhead + follow at the display rate). */
    var displayTime by mutableDoubleStateOf(0.0)
        private set
    private var timeNanos = 0L
    /** Track occurrence spotlighted by a label tap, until [focusUntil] (nanoTime). */
    var focus by mutableStateOf<Appearance?>(null)
        private set
    var focusUntil = 0L
        private set

    private var player: PlayerModel? = null
    private var loop: Job? = null
    private var userCrossfade: Double? = null
    /** Load failures reported by the library path (download/missing), per deck. */
    private val loadFailure = arrayOfNulls<String>(4)

    fun track(id: Int?): LibraryTrack? = id?.let {
        val group=groupReplaySource
        if(group != null) return@let group.tracks[it]?.track
        if(log?.uuid?.let { uuid -> !groupUuidAllowed(uuid) } == true) return@let null
        if (peerReplay != null) peerReplay!!.tracks[it]?.track
        else if (log != null && !unscopedUuidAllowed(log!!.uuid)) null else repo.library.value?.track(it)
    }
    fun sourceId(track: LibraryTrack): String = groupReplaySource?.let { it.tracks.getValue(track.id).sourceId(it) }
        ?: peerReplay?.let { it.tracks.getValue(track.id).sourceId(it) } ?: LibraryHolder.sourceId(track)
    fun matchesSource(track: LibraryTrack,source: String): Boolean = groupReplaySource?.let { group ->
        groupDecoded.values.any { it.attempt.source === group && it.attempt.trackId == track.id && it.attempt.sourceId == source }
    } ?: (source == sourceId(track))
    /** The synced Library (collect in composition so titles resolve once it loads). */
    val library get() = repo.library

    /** Sessions recorded on this phone (#395), newest first. */
    var recorded by mutableStateOf<List<SessionHeader>>(emptyList())
        private set
    private var recordedRevision = -1L
    private val recordedStore = SessionRecording.init(application)

    /** Re-read the recorded list when the recorder or a push changed it (cheap header reads). */
    fun syncRecorded() {
        if (SessionRecording.revision == recordedRevision) return
        recordedRevision = SessionRecording.revision
        val name = repo.deviceName ?: "this phone"
        recorded = recordedStore.all().map { SessionHeader(it.uuid, it.startedAt, it.endedAt, 0, name, local = true) }
        synced = recordedStore.all().filter { it.endPushed }.map { it.uuid }.toSet()
    }
    /** Recorded Sessions the desktop holds completely. */
    var synced by mutableStateOf<Set<String>>(emptySet())
        private set

    /** The list: this phone's recordings and the desktop's Sessions (a pushed recording appears once, as local). */
    val sessions: List<SessionHeader> get() {
        val local = recorded.map { it.uuid }.toSet()
        return recorded.filter { unscopedUuidAllowed(it.uuid) } +
            headers.filter { it.uuid !in local && unscopedUuidAllowed(it.uuid) } +
            peerItems.filter { !it.groupManaged && groupUuidAllowed(it.uuid) }.map { it.header() } + groupItems.map {
                SessionHeader(it.sessionUuid, it.startedAt, it.endedAt, 0, it.origin.label, group=it)
            }
    }
    val unscopedUuidCollisions get() = (recorded + headers).map { it.uuid }.filterNot(::unscopedUuidAllowed).distinct()
    val groupDenyItems get() = peerItems.filter { marker -> marker.groupManaged &&
        repo.groupHistory.snapshot().items.none { it.sessionUuid.equals(marker.uuid, ignoreCase=true) } }
    fun ownGroupMarkerAuthority(item: PeerSessionItem) = item.groupManaged && recordedStore.meta(item.uuid) != null && repo.rawSessionAllowed(item.uuid,allowOwnIssued=true)
    private fun groupUuidAllowed(uuid: String) = repo.groupSessionAllowsRaw(uuid,allowOwnIssued=recordedStore.meta(uuid) != null)
    private fun unscopedUuidAllowed(uuid: String) = repo.rawSessionAllowed(uuid,allowOwnIssued=recordedStore.meta(uuid) != null)

    /** Explicit projection commits are separate from immutable metadata receipt. Polls only read. */
    fun refreshGroupHistory(project: Boolean = false) {
        if(groupRead?.isActive == true) { if(!project) return; groupRead?.cancel() }
        val retained = (recorded + headers).map { it.uuid.lowercase() }.toSet()
        groupRead = viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                val failure = if(project) runCatching { repo.groupHistory.project(retained) }.exceptionOrNull() else null
                repo.groupHistory.snapshot(retained) to failure
            }
            groupItems = result.first.items
            groupError = result.first.error ?: result.second?.let { "Received Session projection is pending; original evidence retained" }
            groupInfo = groupInfo?.let { old -> groupItems.singleOrNull { it.key == old.key } }
            if(groupReplaySource != null) { refuseUnscopedReplay() }
            else if(log?.uuid?.let { !groupUuidAllowed(it) || peerReplay != null && repo.peerSessions.groupOwnedClaims?.containsKey(it.lowercase()) != false } == true) {
                close(); notice = "Group Session authority changed; replay closed. Original phone evidence is retained."
            }
        }
    }

    /** Header flags are hints, not authority: every entry source resolves through the same UUID fence. */
    private fun authoritativeHeader(requested: SessionHeader): SessionHeader? {
        if(requested.group != null || !groupUuidAllowed(requested.uuid) ||
            requested.peer?.let { !it.groupManaged && repo.peerSessions.groupOwnedClaims?.containsKey(requested.uuid.lowercase()) != false } == true) {
            notice = "Group Session evidence is not a playback source; original local evidence is retained."
            return null
        }
        if(requested.peer == null && repo.peerSessions.groupOwnedClaims?.containsKey(requested.uuid.lowercase()) == true) {
            // An exact own-issued exception selects the actual original recording, never a
            // requested raw desktop/cache header with coincidentally equal UUID/local integers.
            val original = recordedStore.meta(requested.uuid)
            if(original != null && repo.rawSessionAllowed(requested.uuid,allowOwnIssued=true))
                return SessionHeader(original.uuid,original.startedAt,original.endedAt,0,repo.deviceName,local=true)
            notice = "Group claim does not authorize this raw source; original evidence is retained."
            return null
        }
        val matches = peerItems.filter { it.uuid.equals(requested.uuid, ignoreCase = true) }
        if (repo.peerSessions.knownUuids == null || matches.size > 1) {
            notice = "Session UUID authority is unavailable or ambiguous; replay refused. Local evidence is retained."
            return null
        }
        val peer = matches.singleOrNull()
        if (peer != null) {
            val requestedPeer = requested.peer
            if (requestedPeer != null && (requestedPeer.key != peer.key || requestedPeer.generation != peer.generation)) {
                notice = "Received Session mapping changed; refresh/reopen. Local evidence is retained."
                return null
            }
            return peer.header()
        }
        if (requested.peer != null || !unscopedUuidAllowed(requested.uuid)) {
            notice = "Session UUID conflicts with received evidence without a current guarded projection; replay refused. Local evidence is retained."
            return null
        }
        return requested
    }

    private fun refuseUnscopedReplay(): Boolean {
        groupReplaySource?.let { source ->
            if(runCatching { groupAdapter.validateAuthority(source) }.isSuccess) return false
            stop(); notice="Group replay authority or local incarnation changed; evidence retained. Explicitly revalidate/reopen."
            return true
        }
        if(log?.uuid?.let { !groupUuidAllowed(it) || peerReplay != null && repo.peerSessions.groupOwnedClaims?.containsKey(it.lowercase()) != false } == true) {
            stop(); notice = "Group Session authority prevents replay; original local evidence is retained."
            return true
        }
        if (peerReplay != null || log == null || unscopedUuidAllowed(log!!.uuid)) return false
        stop()
        notice = "Session UUID conflicts with received evidence; reopen its guarded received entry. Local evidence is retained."
        return true
    }

    fun refresh() {
        if (refreshing) return
        recordedRevision = -1L; syncRecorded()
        refreshGroupHistory(project=true)
        refreshing = true
        viewModelScope.launch {
            // Push first, so the desktop list already carries this phone's Sessions.
            withContext(Dispatchers.IO) { runCatching { SessionRecording.pushAll() } }
            recordedRevision = -1L; syncRecorded()
            try { headers = store.refresh(); listError = null }
            catch (e: CancellationException) { throw e }
            catch (e: dev.manadj.library.SyncException) {
                listError = if (e.status == 404) "this desktop has no Session sync yet — update the desktop app" else e.message
            }
            catch (e: Exception) { listError = e.message ?: e.toString() }
            finally {
                try { peerItems = repo.peerSessions.refresh(); peerListError = null }
                catch (e: CancellationException) { throw e }
                catch (e: Exception) {
                    peerItems = peerItems.map { it.copy(checked = false) }
                    peerListError = if (e is dev.manadj.library.SyncException && e.status == 404) "Desktop has no peer Session adapter yet" else e.message
                }
                if(log?.uuid?.let { !groupUuidAllowed(it) || peerReplay != null && repo.peerSessions.groupOwnedClaims?.containsKey(it.lowercase()) != false } == true) {
                    close()
                    notice = "Group Session authority changed; received replay closed and original evidence retained."
                }
                if (peerReplay == null && log != null && !unscopedUuidAllowed(log!!.uuid)) {
                    close()
                    notice = "Session UUID now conflicts with received evidence; unscoped replay closed. Local evidence is retained."
                }
                refreshing = false
            }
        }
    }

    fun isCached(h: SessionHeader) = h.group == null && h.peer == null && (h.local || store.isCached(h.uuid))

    /** List row summaries: audible track ids per cached Session (absent = not on the phone / not read yet). */
    val audibleTracks = mutableStateMapOf<String, List<Int>>()
    private val summarizing = HashSet<String>()
    @OptIn(ExperimentalCoroutinesApi::class) private val summaryIo = Dispatchers.IO.limitedParallelism(1)

    /** Read [h]'s summary in the background once (parses a cached log at most once per Session). */
    fun summarize(h: SessionHeader) {
        if (h.group != null || h.peer != null || !unscopedUuidAllowed(h.uuid)) return // No raw cached/local summary for received UUIDs.
        if (h.uuid in audibleTracks || !isCached(h) || !summarizing.add(h.uuid)) return
        viewModelScope.launch(summaryIo) {
            val ids = if (h.local) runCatching { SessionLog.parse(recordedStore.detail(h.uuid)).audibleTrackIds }.getOrNull() else store.audibleTracks(h)
            ids?.let { audibleTracks[h.uuid] = it }
            if (h.local && h.endedAt == null) summarizing.remove(h.uuid) // still recording: re-read later
        }
    }

    fun open(requested: SessionHeader) {
        if (opening != null) return
        requested.peer?.takeIf { it.groupManaged }?.let { marker ->
            val current = peerItems.singleOrNull { it.key == marker.key && it.groupManaged }
            if(current != null) { close(); peerInfo = current }
            else notice = "Group claim status unavailable; raw UUID fallback remains blocked."
            return
        }
        requested.group?.let { selected ->
            val retained = (recorded + headers).map { it.uuid.lowercase() }.toSet()
            val current = repo.groupHistory.snapshot(retained)
            groupItems = current.items; groupError = current.error
            val selectedItem = current.items.singleOrNull { it.key == selected.key }
            if(selectedItem != null) { close(); groupInfo = selectedItem; refreshGroupReplay(selectedItem) }
            else notice = "Group evidence is unavailable; raw fallback is refused and local evidence retained."
            return
        }
        val h = authoritativeHeader(requested) ?: return
        h.peer?.let { if (!it.canValidate) { peerInfo = it; return } }
        opening = h.key
        viewModelScope.launch {
            try {
                val peer = h.peer?.let { repo.peerSessions.open(it) }
                show(peer?.item?.header() ?: h, peer?.log ?: if (h.local) withContext(Dispatchers.IO) { SessionLog.parse(recordedStore.detail(h.uuid)) } else store.log(h), peer)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { notice = "Open failed: ${e.message ?: e}" }
            finally { opening = null }
        }
    }

    /** Make [parsed] the open Session (also the test entry: no desktop needed). */
    suspend fun show(h: SessionHeader, parsed: SessionLog, peer: PeerReplay? = null, group: GroupReplaySource? = null) = coroutineScope {
        if(group != null) {
            require(peer == null && parsed === group.log && h.group?.key == group.view.key && h.uuid == group.view.sessionUuid)
            withContext(Dispatchers.IO) { groupAdapter.validate(group) }
        } else {
        require(h.group == null && h.peer?.groupManaged != true && groupUuidAllowed(parsed.uuid) &&
            (peer == null || repo.peerSessions.groupOwnedClaims?.containsKey(parsed.uuid.lowercase()) == false)) { "Group evidence cannot enter raw or peer replay" }
        if(peer == null && repo.peerSessions.groupOwnedClaims?.containsKey(parsed.uuid.lowercase()) == true) {
            require(h.local && recordedStore.meta(parsed.uuid) != null && repo.rawSessionAllowed(parsed.uuid,allowOwnIssued=true)) { "Only the original phone recording retains own-issued authority" }
            val original=SessionLog.parse(recordedStore.detail(parsed.uuid))
            require(original.events == parsed.events) { "Own-issued authority cannot reinterpret raw cached foreign events" }
        }
        require(h.uuid == parsed.uuid) { "Session header/evidence UUID mismatch" }
        require(peer != null || unscopedUuidAllowed(parsed.uuid)) { "Received Session UUID requires its guarded projection; local evidence is retained" }
        if (peer != null) {
            val authoritative = authoritativeHeader(h)
            require(authoritative?.peer?.key == peer.item.key && authoritative?.peer?.generation == peer.generation) { "Current authoritative peer mapping required" }
        }
        require(h.peer == null || peer != null && h.peer?.key == peer.item.key && parsed === peer.log) { "Guarded peer projection required" }
        require(if (peer == null) parsed.replayGeneration == null else parsed.replayGeneration == peer.generation) { "Peer Session requires fresh generation validation" }
        }
        require(parsed.events.isNotEmpty() && parsed.duration > 0) { "Session has no recorded duration" }
        stop()
        val timelineJob = async(Dispatchers.Default) { SessionTimeline(parsed) }
        val drift = withContext(Dispatchers.Default) { parsed.tickDivergence() }
        val tl = timelineJob.await()
        peerReplay = peer; groupReplaySource=group; groupInfo=null; groupDecoded.clear(); peerInfo = null; peerDecoded.clear(); waves.clear(); decodeOffsets.clear()
        val displayHeader = peer?.item?.header() ?: h
        header = displayHeader; log = parsed; driver = null; audibleTracks[displayHeader.key] = parsed.audibleTrackIds; recordingDrift = drift; timeline = tl; focus = null
        if (peer == null && group == null) {
            loadWaves(parsed)
            for (id in parsed.appearances.map { it.trackId }.distinct()) track(id)?.let { if (repo.audioState(it) == dev.manadj.library.AudioState.Cached) probe(id) }
        } else wavesJob?.cancel() // No unversioned receiver-ID waveform/audio requests for peer evidence.
        if (drift.isNotEmpty()) android.util.Log.w(TAG, "recording drift: ${drift.size} ticks > 5 ms, worst %.1f ms".format(drift.maxOf { abs(it.seconds) } * 1000))
        moveClock(parsed.activeStart); fit()
        deckErrors.indices.forEach { deckErrors[it] = null }
    }

    fun close() { stop(); log = null; header = null; peerReplay = null; groupReplaySource=null; groupInfo = null; groupReplayReadiness=null; selectingGroupTrack=null; groupDecoded.clear(); peerInfo = null; driver = null; recordingDrift = emptyList(); timeline = null; focus = null; wavesJob?.cancel() }

    private fun refreshGroupReplay(view: GroupSessionView) {
        groupReplayReadiness=null
        viewModelScope.launch { val result=withContext(Dispatchers.IO) { groupAdapter.readiness(view) }
            if(groupInfo?.key == view.key) groupReplayReadiness=result }
    }
    fun bindGroupTrack(view: GroupSessionView,logicalId: String,localId: Int) {
        if(groupReplayBusy) return
        groupReplayBusy=true; selectingGroupTrack=null
        viewModelScope.launch {
            try {
                val ready=withContext(Dispatchers.IO) {
                    val selected=groupAdapter.selections.select(localId)
                    groupAdapter.bind(view,logicalId,selected)
                    groupAdapter.readiness(view)
                }
                if(groupInfo?.key == view.key) groupReplayReadiness=ready
            } catch(e: CancellationException) { throw e }
            catch(_: Exception) { notice="Exact local binding refused; evidence retained. Select current matching local audio explicitly." }
            finally { groupReplayBusy=false }
        }
    }
    fun openGroupReplay(view: GroupSessionView) {
        val generation=groupReplayReadiness?.takeIf { it.state == "candidate-exact" }?.generation ?: return
        if(groupReplayBusy) return
        groupReplayBusy=true
        viewModelScope.launch {
            try {
                val source=withContext(Dispatchers.IO) { groupAdapter.open(view,generation) }
                show(SessionHeader(view.sessionUuid,view.startedAt,view.endedAt,0,group=view),source.log,group=source)
            } catch(e: CancellationException) { throw e }
            catch(_: Exception) { notice="Group replay open refused; evidence retained. Revalidate current bindings." }
            finally { groupReplayBusy=false }
        }
    }

    private var wavesJob: Job? = null
    /** Fetch every Session track's detail waveform (cache first), two at a time. */
    private fun loadWaves(l: SessionLog) {
        wavesJob?.cancel()
        val ids = l.appearances.sortedBy { it.firstSound ?: Double.MAX_VALUE }.map { it.trackId }.distinct().filter { it !in waves }
        wavesJob = viewModelScope.launch {
            val gate = kotlinx.coroutines.sync.Semaphore(2)
            ids.map { id -> launch(Dispatchers.Default) { gate.acquire(); try {
                val w = runCatching { LibraryHolder.detailWaveform(getApplication(), id) }.onFailure { android.util.Log.w(TAG, "timeline waveform $id: $it") }.getOrNull()
                if (w == null) android.util.Log.w(TAG, "timeline waveform $id: none")
                if (w != null && w.sampleRate > 0 && w.bandHop > 0 && w.nBands == 8 && w.bands.isNotEmpty()) {
                    val data = dev.manadj.app.WaveformData(w.sampleRate, w.durationSecs, w.peakHop, w.bandHop, w.stftWindow, w.peaks, w.bands, w.bands.size / 8)
                    val wave = TimelineWave(data, dev.manadj.app.ColumnCache().fillGain(data))
                    withContext(Dispatchers.Main) { waves[id] = wave }
                }
            } finally { gate.release() } } }
        }
    }

    private fun moveClock(t: Double) { time = t; timeNanos = System.nanoTime(); displayTime = t }

    /** Per display frame (timeline): extrapolate the clock, advance follow-scroll, expire the spotlight. */
    fun frame(nanos: Long) {
        val l = log ?: return
        displayTime = if (playing) (time + (nanos - timeNanos) / 1e9).coerceIn(time, minOf(l.end, time + .1)) else time
        if (focus != null && nanos > focusUntil) focus = null
        if (follow && playing && System.nanoTime() > followHeldUntil) {
            val maxStart = maxOf(l.activeStart, l.end - viewWidth)
            viewStart = if (displayTime < viewStart) (displayTime - viewWidth * .1).coerceIn(l.activeStart, maxStart)
                else TimelineLayout.follow(viewStart, viewWidth, displayTime, maxStart)
        }
    }

    /** Tap on a track label: zoom to that occurrence and spotlight it. */
    fun focusOn(a: Appearance) {
        val l = log ?: return
        val (heardFrom, heardTo) = timeline?.playedSpan(a) ?: ((a.firstSound ?: a.start) to a.end)
        val from = maxOf(heardFrom, l.activeStart); val to = minOf(heardTo, l.end)
        val w = ((to - from) * 1.1).coerceIn(minViewWidth, (l.end - l.activeStart).coerceAtLeast(minViewWidth))
        setView(from - (w - (to - from)) / 2, w)
        holdFollow()
        focus = a; focusUntil = System.nanoTime() + 2_600_000_000L
    }

    /** Leaving the Session screen: replay stops, decks keep what they hold. */
    fun leave() = stop()

    fun toggle(player: PlayerModel) { if (playing || preparing || peerChecking) stop() else play(player) }

    private fun driver(player: PlayerModel): ReplayDriver? {
        val l = log ?: return null
        this.player = player
        return driver ?: ReplayDriver(l, engine(player), { notice = it }, timeline ?: SessionTimeline(l)).also { driver = it }
    }

    fun play(player: PlayerModel) {
        if (refuseUnscopedReplay()) return
        if(groupReplaySource != null) { validateGroup { beginPlay(player) }; return }
        if (peerReplay != null) { validatePeer { beginPlay(player) }; return }
        beginPlay(player)
    }

    private fun validateGroup(action: () -> Unit) {
        if(groupReplayBusy) return
        val expected=groupReplaySource ?: return
        groupReplayBusy=true
        groupValidation=viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { groupAdapter.validate(expected) }
                if(groupReplaySource === expected) action()
            } catch(e: CancellationException) { throw e }
            catch(_: Exception) { groupValidation=null; stop(); notice="Group replay refused; source, local binding or exact audio is no longer current." }
            finally { groupReplayBusy=false; groupValidation=null }
        }
    }

    private fun validatePeer(action: () -> Unit) {
        if (peerChecking) return
        val expected = peerReplay ?: return
        if (authoritativeHeader(header ?: return)?.peer?.let { it.key == expected.item.key && it.generation == expected.generation } != true) { stop(); return }
        peerChecking = true
        peerValidation = viewModelScope.launch {
            try {
                val current = repo.peerSessions.open(expected.item)
                if (header?.key != expected.item.key || peerReplay?.generation != expected.generation) return@launch
                peerReplay = current
                action()
            } catch (cancel: CancellationException) { throw cancel }
            catch (e: Exception) {
                peerValidation = null
                stop()
                notice = "Peer replay unavailable: ${e.message ?: e}. Refresh/reopen on the owning desktop; cached evidence is not playback authority."
            } finally { peerChecking = false; peerValidation = null }
        }
    }

    private fun beginPlay(player: PlayerModel) {
        val l = log ?: return
        val r = driver(player) ?: return
        if (time >= l.end) moveClock(l.activeStart)
        if (userCrossfade == null) userCrossfade = player.crossfade
        // Recorded crossfader folds into the faders; the engine crossfader stays centred while replaying.
        player.submit(AudioCommand.SetCrossfade(0.0))
        prefetch(l)
        loadFailure.fill(null)
        lateBase = player.engineSnapshot()?.lateOps ?: 0L; lateOps = 0; reopenBase = -1
        SessionRecording.machine = "session-replay"
        r.prepare(time)
        sync(r)
        loop?.cancel()
        loop = viewModelScope.launch {
            // Op stream off the UI thread: heavy frames (waveforms) delay main-thread ticks, never frame-stamped ops.
            launch(Dispatchers.Default) { while (isActive) { r.pumpAhead(); delay(50) } }
            run(player, r)
        }
    }

    fun stop() {
        groupValidation?.cancel(); groupValidation=null; groupReplayBusy=false
        peerValidation?.cancel(); peerValidation = null; peerChecking = false
        peerLoads.indices.forEach { peerLoads[it]?.cancel(); peerLoads[it] = null }
        SessionRecording.machine = null
        loop?.cancel(); loop = null
        driver?.stop()
        playing = false; preparing = false; displayTime = time
        engineOffsetMs.indices.forEach { engineOffsetMs[it] = null }
        userCrossfade?.let { player?.updateCrossfade(it) }
        userCrossfade = null
    }

    /** Relocate the Session clock; decks follow (parked while paused). */
    fun seek(t: Double, player: PlayerModel) {
        if (refuseUnscopedReplay()) return
        if(groupReplaySource != null) {
            val resume=playing || preparing; stop()
            validateGroup { seekResolved(t,player); if(resume) beginPlay(player) }
            return
        }
        if (peerReplay != null) {
            val resume = playing || preparing
            stop()
            validatePeer { seekResolved(t, player); if (resume) beginPlay(player) }
            return
        }
        seekResolved(t, player)
    }

    private fun seekResolved(t: Double, player: PlayerModel) {
        val l = log ?: return
        val r = driver(player) ?: return
        moveClock(t.coerceIn(l.start, l.end))
        reveal()
        if (playing || preparing) { r.prepare(time); sync(r) } else r.park(time)
    }

    private suspend fun run(player: PlayerModel, r: ReplayDriver) {
        while (currentCoroutineContext().isActive) {
            if(refuseUnscopedReplay()) return
            val wall = System.nanoTime() / 1e9
            val now = r.tick(wall)
            sync(r)
            if ((peerReplay != null || groupReplaySource != null) && (0..3).any { r.decks[it] == ReplayDriver.Deck.LIVE && held(player, it) == null }) {
                stop(); notice = "Peer decoded Track changed; replay stopped. Revalidate and reload exact audio before resuming."
                return
            }
            if (now != null && lastTick != null) {
                val (t, w) = lastTick!!
                if (kotlin.math.abs((now - t) - (wall - w)) > .25) {
                    val snap = player.engineSnapshot()
                    android.util.Log.w(TAG, "clock jump: session %+.3f s over %.3f s wall; output frames=%d rate=%d open=%s".format(now - t, wall - w, snap?.outputFrames, snap?.outputSampleRate, snap?.outputOpen))
                }
            }
            lastTick = now?.let { it to wall }
            if (now != null) {
                moveClock(now)
                if (now - lastMeasure >= MEASURE_SECONDS || now < lastMeasure) { lastMeasure = now; measure(player, r) }
            }
            if (!r.playing && !r.preparing) { stop(); return }
            delay(16)
        }
    }

    private fun sync(r: ReplayDriver) {
        playing = r.playing; preparing = r.preparing
        for (d in 0..3) { val e = r.errors[d] ?: loadFailure[d]; if (deckErrors[d] != e) deckErrors[d] = e }
    }

    private var lastMeasure = Double.NEGATIVE_INFINITY
    private var lastTick: Pair<Double, Double>? = null

    /**
     * Engine vs reference at the snapshot's sampling frame, per sounding deck (logcat ManadjSession): the
     * on-device check that replay is sample-exact (expected |offset| < 0.03 ms, i.e. under one sample).
     */
    private fun measure(player: PlayerModel, r: ReplayDriver) {
        val l = log ?: return
        val e = r.epoch ?: return
        val snap = player.engineSnapshot() ?: return
        val at = e.timeAt(snap.clockFrame)
        val ref = l.replayAt(at)
        val parts = ArrayList<String>()
        for (d in 0..3) {
            val want = ref.decks[d]
            val got = snap.decks[DeckId.entries[d]]
            val offset = if (!r.exact(d, snap.clockFrame) || want.trackId == null || !want.sounding || want.scratching || want.playhead < 0 || got == null) null
                else (got.sourceSeconds - want.playhead) * 1000
            engineOffsetMs[d] = offset
            if (offset != null) parts += "${DECKS[d]} %+.3fms".format(offset) + (if (got?.keyLockActive == true) "(kl)" else "") + (if (got?.fullyDecoded == false) "(dec %.0fs)".format(got.decodedSeconds) else "")
        }
        lateOps = snap.lateOps - lateBase
        val sounding = engineOffsetMs.filterNotNull()
        val spread = if (sounding.size >= 2) " inter-deck %.3fms".format(sounding.max() - sounding.min()) else ""
        if (reopenBase < 0) reopenBase = snap.reopenCount
        val reopened = snap.reopenCount - reopenBase
        if (reopened > 0) {
            // The output restarted (route change, device switch): its frame counter and scheduled ops do not carry
            // over. Re-place every deck on a fresh epoch from here (exact again) instead of drifting.
            android.util.Log.w(TAG, "output reopened during replay: re-placing decks at t=%.3f".format(at))
            reopenBase = snap.reopenCount
            r.prepare(at); sync(r)
            return
        }
        if (parts.isNotEmpty()) android.util.Log.i(TAG, "t=%.1f ".format(at - l.activeStart) + parts.joinToString(" ") + spread +
            " late=$lateOps sched=${snap.scheduledOps} reopen=$reopened xruns=${snap.outputXruns} starved=${snap.starvedDeckFrames} rate=${snap.outputSampleRate}")
    }
    private var lateBase = 0L
    private var reopenBase = -1

    private fun engine(player: PlayerModel) = object : ReplayDriver.Engine {
        private var rate = 48000
        override val sampleRate get() = rate
        override fun outputFrames(): Long? = player.engineSnapshot()?.takeIf { it.outputOpen && it.outputSampleRate > 0 }?.also { rate = it.outputSampleRate }?.outputFrames
        override fun schedule(frame: Long, commands: List<AudioCommand>, tag: Long) =
            if(groupReplaySource?.let { source -> runCatching { groupAdapter.validateAuthority(source) }.isFailure } == true) false
            else player.schedule(frame, commands, tag)
        override fun cancel(tag: Long) = player.cancelScheduled(tag)
        // Driver immediate commands are safety pause/reset; revocation must not prevent stop.
        override fun submit(command: AudioCommand) { player.submit(command) }
        override fun holds(deck: Int): Int? = held(player, deck)
        override fun startLoad(deck: Int, trackId: Int) = issueLoad(player, deck, trackId)
        override fun load(deck: Int, trackId: Int): ReplayDriver.Load {
            loadFailure[deck]?.let { return ReplayDriver.Load.Failed(it) }
            groupReplaySource?.let { source ->
                if(refuseUnscopedReplay()) return ReplayDriver.Load.Failed("Group authority changed")
                val proof=groupDecoded[deck] ?: return ReplayDriver.Load.Pending
                val ui=player.decks.getValue(DeckId.entries[deck]); val snap=ui.snapshot
                if(peerLoads[deck]?.isActive == true || ui.importing) return ReplayDriver.Load.Pending
                if(proof.attempt.source !== source || proof.attempt.trackId != trackId || proof.requestGeneration != ui.generation.get()) return ReplayDriver.Load.Failed("Group load attempt superseded")
                if(ui.error != null || snap?.loadState == LoadState.ERROR) return ReplayDriver.Load.Failed("Group decode failed")
                if(!ui.ready || ui.source?.id != proof.attempt.sourceId || snap?.fullyDecoded != true) return ReplayDriver.Load.Pending
                if(proof.loadId != null && proof.loadId != snap.loadId) return ReplayDriver.Load.Failed("Group decoded incarnation replaced")
                if(!proof.validated) {
                    // This receipt is accepted only AFTER the actual engine reports this exact
                    // unique attempt fully decoded. Persisted candidate JSON is never sufficient.
                    if(!proof.verifying) {
                        proof.verifying=true; val decodedId=snap.loadId
                        peerLoads[deck]=viewModelScope.launch {
                            try {
                                withContext(Dispatchers.IO) { groupAdapter.validateLoad(proof.attempt) }
                                val current=player.decks.getValue(DeckId.entries[deck])
                                require(groupDecoded[deck] === proof && groupReplaySource === source && current.ready &&
                                    current.generation.get() == proof.requestGeneration && current.source?.id == proof.attempt.sourceId &&
                                    current.snapshot?.loadId == decodedId && current.snapshot?.fullyDecoded == true)
                                groupAdapter.validateAuthority(source)
                                proof.loadId=decodedId; proof.validated=true
                            } catch(e: CancellationException) { throw e }
                            catch(_: Exception) { loadFailure[deck]="Group authority or decoded load changed"; stop(); notice=loadFailure[deck] }
                            finally { proof.verifying=false }
                        }
                    }
                    return ReplayDriver.Load.Pending
                }
                return ReplayDriver.Load.Ready
            }
            val t = track(trackId) ?: return ReplayDriver.Load.Failed("Track #$trackId not in the synced Library")
            val want = sourceId(t)
            val ui = player.decks.getValue(DeckId.entries[deck])
            val snap = ui.snapshot
            if (peerReplay != null && (peerLoads[deck]?.isActive == true || ui.importing)) return ReplayDriver.Load.Pending
            if (snap?.loadState == LoadState.ERROR && snap.sourceId == want) return ReplayDriver.Load.Failed(snap.error ?: "decode failed")
            if (peerReplay != null && ui.error != null && !ui.importing) return ReplayDriver.Load.Failed(ui.error!!)
            if (!(ui.ready && ui.source?.id == want)) return ReplayDriver.Load.Pending
            if (peerReplay != null) {
                val proof = peerDecoded[deck] ?: return ReplayDriver.Load.Failed("No verified peer decode receipt")
                if (proof.sourceId != want || proof.requestGeneration != ui.generation.get()) return ReplayDriver.Load.Failed("Peer load was superseded")
                if (proof.loadId == null) proof.loadId = snap?.loadId
                if (proof.loadId != snap?.loadId) return ReplayDriver.Load.Failed("Peer decoded audio was replaced")
            }
            return if (snap?.fullyDecoded == true) ReplayDriver.Load.Ready else ReplayDriver.Load.Partial(snap?.decodedSeconds ?: 0.0)
        }
    }

    private fun issueLoad(player: PlayerModel, deck: Int, trackId: Int) {
        groupReplaySource?.let { source ->
            if(refuseUnscopedReplay()) return
            loadFailure[deck]=null; peerLoads[deck]?.cancel(); groupDecoded.remove(deck)
            peerLoads[deck]=viewModelScope.launch {
                try {
                    val attempt=withContext(Dispatchers.IO) { groupAdapter.audio(source,trackId) }
                    if(groupReplaySource !== source || !(playing || preparing) || refuseUnscopedReplay()) return@launch
                    val t=source.tracks.getValue(trackId).track
                    player.load(DeckId.entries[deck],attempt.file,attempt.sourceId,t.title,t.artist.orEmpty(),t.durationSecs,
                        bpm=t.bpm,firstBeatSeconds=0.0,mainCueSeconds=t.mainCue,hotCues=emptyMap())
                    groupDecoded[deck]=GroupDecodedProof(attempt,player.decks.getValue(DeckId.entries[deck]).generation.get())
                } catch(e: CancellationException) { throw e }
                catch(_: Exception) { loadFailure[deck]="Group exact local load refused"; stop(); notice=loadFailure[deck] }
            }
            return
        }
        if(log?.uuid?.let { !groupUuidAllowed(it) } == true) { stop(); notice = "Group Session load refused; evidence retained"; return }
        loadFailure[deck] = null
        peerReplay?.let { replay ->
            val asset = replay.tracks[trackId]
            if (asset == null) { loadFailure[deck] = "Track is not a member of this peer generation"; return }
            peerLoads[deck]?.cancel()
            peerDecoded.remove(deck)
            peerLoads[deck] = viewModelScope.launch {
                try {
                    val file = repo.peerSessions.audio(replay, trackId)
                    if (peerReplay?.generation != replay.generation || header?.key != replay.item.key || !(playing || preparing) || !groupUuidAllowed(replay.log.uuid)) return@launch
                    val t = asset.track
                    val grid = t.grid?.tempoChanges?.firstOrNull()
                    player.load(DeckId.entries[deck], file, asset.sourceId(replay), t.title, t.artist.orEmpty(), t.durationSecs,
                        bpm = grid?.bpm ?: t.bpm, firstBeatSeconds = grid?.startTime ?: 0.0, mainCueSeconds = t.mainCue,
                        hotCues = t.hotCues.filter { it.slot in 1..8 }.associate { it.slot - 1 to it.time })
                    peerDecoded[deck] = PeerDecodedProof(asset.sourceId(replay), player.decks.getValue(DeckId.entries[deck]).generation.get())
                } catch (cancel: CancellationException) { throw cancel }
                catch (e: Exception) {
                    loadFailure[deck] = "Peer load refused: ${e.message ?: e}"
                    stop()
                    notice = loadFailure[deck]
                }
            }
            return
        }
        val track = track(trackId)
        if (track == null || track.audioRev == null) {
            loadFailure[deck] = if (track == null) "Track #$trackId not in the synced Library" else "No audio file on the desktop"
            return
        }
        LibraryHolder.load(getApplication(), player, DeckId.entries[deck], track) { error -> loadFailure[deck] = error }
    }

    /** Download every track the Session loads, ahead of its load (mid-session loads then only decode). */
    private fun prefetch(l: SessionLog) {
        if(groupReplaySource != null) return // Explicit exact-local files only; never download.
        if (peerReplay != null) return // Peer audio has its own fresh generation/member/byte validation.
        val ids = l.appearances.filter { it.end > time }.map { it.trackId }.distinct()
        viewModelScope.launch(Dispatchers.IO) { for (id in ids) {
            if(!unscopedUuidAllowed(l.uuid)) break
            runCatching { repo.audioFile(id); if(unscopedUuidAllowed(l.uuid)) probe(id) }
        } }
    }

    /** Per track: this phone's decode vs the desktop's, in ms (> 0 = phone late). See [DecodeProbe]. */
    val decodeOffsets = mutableStateMapOf<Int, DecodeProbe.Result>()
    private val probed = HashSet<Int>()
    private val probeDispatcher = Dispatchers.Default.limitedParallelism(1)
    private fun probe(id: Int) {
        if (!probed.add(id)) return
        viewModelScope.launch(probeDispatcher) {
            val t = track(id) ?: return@launch
            val r = runCatching {
                val wave = repo.detailWaveform(id) ?: error("no desktop waveform")
                DecodeProbe.run(repo.audioFile(id), wave)
            }.onFailure { android.util.Log.w(TAG, "decode-probe #$id ${t.title}: $it") }.getOrNull() ?: return@launch
            android.util.Log.i(TAG, "decode-probe #$id %s rate=%d delay=%s pad=%s firstPts=%dus raw=%s engine=%s score=%.3f · %s".format(
                r.mime, r.sampleRate, r.encoderDelay, r.encoderPadding, r.firstPtsUs, r.offsetMs?.let { "%+.2fms".format(it) } ?: "?", r.engineOffsetMs?.let { "%+.2fms".format(it) } ?: "?", r.score, t.title))
            withContext(Dispatchers.Main) { decodeOffsets[id] = r }
        }
    }

    /** Library track the engine deck holds and is ready with (null = other/none). */
    private fun held(player: PlayerModel, d: Int): Int? {
        val ui = player.decks.getValue(DeckId.entries[d])
        groupReplaySource?.let { source ->
            val proof=groupDecoded[d]
            return if(ui.ready && !ui.importing && proof?.validated == true && proof.attempt.source === source &&
                proof.requestGeneration == ui.generation.get() && proof.loadId == ui.snapshot?.loadId && proof.attempt.sourceId == ui.source?.id &&
                runCatching { groupAdapter.validateAuthority(source) }.isSuccess) proof.attempt.trackId else null
        }
        peerReplay?.let { p ->
            val proof = peerDecoded[d]
            return if (ui.ready && !ui.importing && proof != null && proof.requestGeneration == ui.generation.get() && proof.loadId == ui.snapshot?.loadId && proof.sourceId == ui.source?.id)
                p.tracks.values.firstOrNull { it.sourceId(p) == proof.sourceId }?.track?.id else null
        }
        return if (ui.ready) LibraryHolder.trackOn(player, DeckId.entries[d]) else null
    }

    /** Whether replay is waiting on [deck]'s track (UI). */
    fun isLoading(deck: Int) = driver?.decks?.get(deck) == ReplayDriver.Deck.LOADING

    companion object {
        private const val TAG = "ManadjSession"
        const val MEASURE_SECONDS = 1.0
        const val FOLLOW_HOLD_NANOS = 20_000_000_000L
    }

    // ── Timeline view (window over activeStart..end: max zoom [minViewWidth], min zoom = fit) ──
    private val span get() = log?.let { (it.end - it.activeStart).coerceAtLeast(1.0) } ?: 1.0
    /** Fit spans the performance: first sound to the last audio (logs can idle for long after it). */
    fun fit() {
        val l = log ?: return
        val last = timeline?.activeEnd?.let { minOf(l.end, it + SessionLog.LEAD_IN) } ?: l.end
        viewStart = l.activeStart; viewWidth = (last - l.activeStart).coerceIn(minOf(minViewWidth, span), span); follow = true; followHeldUntil = 0L
    }
    fun setView(start: Double, width: Double) {
        val l = log ?: return
        viewWidth = width.coerceIn(minOf(minViewWidth, span), span)
        viewStart = start.coerceIn(l.activeStart, maxOf(l.activeStart, l.end - viewWidth))
    }
    /** Zoom by [factor] keeping the time under [anchor] (fraction of the width) fixed. */
    fun zoom(factor: Double, anchor: Double = .5) {
        val at = viewStart + anchor * viewWidth
        val next = (viewWidth / factor).coerceIn(minOf(minViewWidth, span), span)
        setView(at - anchor * next, next)
    }
    fun pan(fraction: Double) { setView(viewStart + fraction * viewWidth, viewWidth); holdFollow() }
    fun holdFollow() { followHeldUntil = System.nanoTime() + FOLLOW_HOLD_NANOS }
    private fun reveal() {
        if (time < viewStart || time > viewStart + viewWidth) setView(time - viewWidth * .25, viewWidth)
    }

    override fun onCleared() { stop(); super.onCleared() }
}

/** A Session track's detail waveform for the timeline, with its display fill gain (loud passages reach the lane edge). */
class TimelineWave(val data: dev.manadj.app.WaveformData, val fill: Float)
