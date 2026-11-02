package dev.manadj.app.session

import android.content.ComponentName
import android.content.Intent
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import dev.manadj.app.*
import dev.manadj.app.library.LibraryHolder
import dev.manadj.audio.*
import dev.manadj.library.LibraryRepository
import dev.manadj.library.session.RecordedSessions
import dev.manadj.library.session.SessionHeader
import dev.manadj.library.session.SessionLog
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.*
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.*
import java.io.File
import java.net.ServerSocket
import java.net.InetAddress
import java.security.MessageDigest
import java.time.Duration

/** Real SessionScreen/SessionModel/PlayerModel/repository; audio output only is a host double.
 * Separate PeerSessionNativeChainTest checks the real C++ callback with actual received WAV bytes. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],shadows=[PeerUiAudio::class])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PeerSessionUiTest {
    @get:Rule val compose=createAndroidComposeRule<ComponentActivity>()
    @get:Rule val testName=org.junit.rules.TestName()
    private val sid="44444444-4444-4444-8444-444444444444"
    private val origin="55555555-5555-4555-8555-555555555555"
    private val logical="66666666-6666-4666-8666-666666666666"
    private val phoneSid="77777777-7777-4777-8777-777777777777"
    private val generation="b".repeat(64)
    private val audio=ByteArray(1000) { (it%127).toByte() }
    private val sha=MessageDigest.getInstance("SHA-256").digest(audio).joinToString("") { "%02x".format(it) }
    private lateinit var server: ServerSocket
    private lateinit var serverThread: Thread
    private lateinit var model: SessionModel
    private lateinit var player: PlayerModel
    private lateinit var service: org.robolectric.android.controller.ServiceController<PlaybackService>
    @Volatile private var state="ready"
    @Volatile private var peerListFails=false
    @Volatile private var peerOmitted=false
    private var details=0
    private var bareIdCalls=0

    private fun item()=JSONObject().put("session_uuid",sid).put("origin_replica_id",origin).put("recording_origin","Original recorder")
        .put("manifest_sha256","a".repeat(64)).put("started_at","2026-11-02T00:00:00Z").put("ended_at","2026-11-02T00:00:06Z")
        .put("materialized",true).put("state",state).put("replay_generation",generation).put("conflict_count",1)
        .put("dependencies",JSONArray().put(JSONObject().put("logical_track_id",logical).put("local_track_id",9).put("asset_state","exact").put("sha256",sha).put("byte_length",audio.size)))
    private fun detail(): String {
        val track=JSONObject().put("id",9).put("title","Resolved receiver nine").put("artist","Synthetic").put("bpm",120)
            .put("duration_secs",40).put("main_cue",0).put("hot_cues",JSONArray()).put("grid",JSONObject.NULL).put("audio_rev","current-receiver")
        val log=JSONObject().put("uuid",sid).put("replay_generation",generation).put("events",JSONArray("""[
            {"t":0,"kind":"load","channel":"A","trackId":9},
            {"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},
            {"t":6,"kind":"transport","channel":"A","action":"pause","playhead":6}]"""))
        return JSONObject().put("version",1).put("item",item()).put("session",log).put("tracks",JSONArray().put(
            JSONObject().put("local_track_id",9).put("logical_track_id",logical).put("sha256",sha).put("byte_length",audio.size).put("track",track))).toString()
    }
    @Before fun start() {
        RuntimeEnvironment.setQualifiers("w600dp-h900dp-mdpi")
        peerOmitted=testName.methodName=="failedAuthorityWriteClosesAnAlreadyOpenUnscopedPhoneView"
        server=ServerSocket(0,50,InetAddress.getByName("127.0.0.1"))
        serverThread=Thread({
            while(!server.isClosed) try { server.accept().use { socket ->
                val input=socket.getInputStream().bufferedReader()
                val path=input.readLine().split(' ')[1].substringBefore('?')
                while(!input.readLine().isNullOrEmpty()) { }
                var code=200
                val bytes=when {
                path=="/api/device-sync/sessions" -> "[]".toByteArray()
                path.startsWith("/api/device-sync/sessions/") -> {code=409;byteArrayOf()} // retain generated phone evidence, no peer write authority
                path=="/api/device-sync/peer-sessions" -> {
                    if(peerListFails) {code=503;byteArrayOf()} else JSONObject().put("version",1).put("items",if(peerOmitted) JSONArray() else JSONArray().put(item())).toString().toByteArray()
                }
                path.startsWith("/api/device-sync/peer-sessions/$sid") -> {
                    details++
                    if(state!="ready") {code=409;byteArrayOf()} else if(path.endsWith("/audio/9")) audio else detail().toByteArray()
                }
                else -> {bareIdCalls++;code=404;byteArrayOf()}
                }
                socket.getOutputStream().apply {write("HTTP/1.1 $code Fixture\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray());write(bytes);flush()}
            } } catch(e: java.io.IOException) {if(!server.isClosed) throw e}
        },"peer-ui-fixture").apply {isDaemon=true;start()}
        val app=RuntimeEnvironment.getApplication()
        val repo=LibraryRepository(File(app.cacheDir,"peer-ui"),"http://127.0.0.1:${server.localPort}")
        repo.store.writeSnapshotText("""{"version":1,"settings":{},"tag_categories":[],"tags":[],"links":[],"transitions":[],"cameos":[],"takes":[],"playlists":[],"tracks":[
            {"id":1,"title":"Unrelated current receiver one","file_name":"unrelated.wav","audio_rev":null,"tag_ids":[],"hot_cues":[]},
            {"id":77,"title":"Safe noncollision phone track","file_name":"phone.wav","audio_rev":"r77","tag_ids":[],"hot_cues":[]}
        ]}""")
        kotlinx.coroutines.runBlocking {repo.open()}
        repo.store.audioFile(repo.library.value!!.track(77)!!)!!.also {it.parentFile!!.mkdirs();it.writeBytes(audio)}
        // Reset only the test singleton reference to this test's generated public store. Existing
        // files (including an independently injected review fixture) are never deleted/replaced.
        val phone=RecordedSessions(File(app.filesDir,"sessions-cache/recorded"))
        SessionRecording::class.java.getDeclaredField("store").apply {isAccessible=true}.set(null,phone)
        SessionRecording::class.java.getDeclaredField("app").apply {isAccessible=true}.set(null,app)
        fun record(uuid: String,track: Int) {
            if(phone.meta(uuid)!=null) return
            phone.open(uuid,"2026-11-02T00:00:00Z")
            phone.append(uuid,0,JSONArray("""[{"t":0,"kind":"load","channel":"A","trackId":$track},{"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},{"t":6,"kind":"transport","channel":"A","action":"pause","playhead":6}]"""))
            phone.end(uuid,"2026-11-02T00:00:06Z")
        }
        record(sid,1)
        if(testName.methodName=="noncollisionPhoneRecordingStillOpensAndReplays") record(phoneSid,77)
        // A generated source-desktop cache carries the same UUID but foreign Track1.
        val legacy=File(app.filesDir,"sessions-cache").apply {mkdirs()}
        File(legacy,"sessions.json").writeText("""[{"uuid":"$sid","started_at":"2026-11-02T00:00:00Z","ended_at":"2026-11-02T00:00:06Z","take_count":0}]""")
        File(legacy,"sessions").mkdirs()
        File(legacy,"sessions/$sid.json").writeText("""{"uuid":"$sid","events":[{"t":0,"kind":"load","channel":"A","trackId":1}]}""")
        assertEquals(sid,dev.manadj.library.session.SessionStore.parseList(File(legacy,"sessions.json").readText()).single().uuid)
        kotlinx.coroutines.runBlocking {repo.peerSessions.refresh()}
        if(testName.methodName=="failedPeerListDoesNotResurrectLegacySourceUuidCache") peerListFails=true
        LibraryHolder::class.java.getDeclaredField("instance").apply {isAccessible=true}.set(null,repo)
        PeerUiAudio.loads=0;PeerUiAudio.sources.clear();PeerUiAudio.loadIds.clear()
        service=Robolectric.buildService(PlaybackService::class.java).create()
        shadowOf(app).setComponentNameAndServiceForBindService(ComponentName(app,PlaybackService::class.java),service.get().onBind(Intent()))
        // Explicit application avoids AndroidViewModelFactory's process singleton retaining a
        // previous Robolectric test's Application/data root across independent test cases.
        val provider=ViewModelProvider(compose.activity,ViewModelProvider.AndroidViewModelFactory(app))
        player=provider[PlayerModel::class.java]
        model=provider[SessionModel::class.java]
        assertTrue("control: stale source UUID header really was cached",model.headers.any {it.uuid==sid})
        val ux=provider[UiModel::class.java]
        compose.setContent {SessionScreen(player,ux,Modifier.fillMaxSize())}
        waitFor {!model.refreshing && if(peerOmitted) model.headers.none {it.uuid==sid} else model.peerItems.isNotEmpty()}
    }
    @After fun finish() {
        compose.runOnUiThread {model.close();compose.activity.viewModelStore.clear()}
        service.destroy();server.close();serverThread.join(2000)
        LibraryHolder::class.java.getDeclaredField("instance").apply {isAccessible=true}.set(null,null)
    }
    private fun waitFor(condition: () -> Boolean) {
        compose.waitUntil(10000) {shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(20));condition()}
    }
    private fun capture(name: String) {
        System.getProperty("manadj.peerScreenshots")?.let { root ->
            compose.runOnIdle {
                val view=compose.activity.window.decorView
                val bitmap=android.graphics.Bitmap.createBitmap(view.width,view.height,android.graphics.Bitmap.Config.ARGB_8888)
                view.draw(android.graphics.Canvas(bitmap))
                File(root,name).outputStream().use {bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
            }
        }
    }

    @Test fun receivedListAndRealReplayControlsUseGuardedMetadataThenRefuseCachedResume() {
        compose.onNodeWithText("RECEIVED · Original recorder").assertExists()
        compose.onNodeWithText("Received evidence · 1 track dependencies").performClick()
        waitFor {model.log!=null}
        assertEquals("Resolved receiver nine",model.track(9)?.title)
        assertNull(model.track(1))
        compose.onNodeWithTag("peer-session-provenance").assertExists()
        capture("received-replay.png")
        compose.mainClock.autoAdvance=false
        compose.onNodeWithTag("session-play").performClick()
        waitFor {model.playing && PeerUiAudio.loads>0 && model.replayEpoch!=null}
        assertTrue(player.decks.getValue(DeckId.A).source!!.id.startsWith("peer:$sid:$generation:9:"))
        assertEquals(0,bareIdCalls)
        val first=model.replayEpoch
        compose.runOnUiThread {model.seek(.4,player)}
        waitFor {model.playing && model.replayEpoch!=null && model.replayEpoch!==first}
        assertTrue(details>=4)
        compose.runOnUiThread {model.stop()}
        state="assets_unavailable"
        compose.runOnUiThread {model.play(player)}
        waitFor {!model.peerChecking && model.notice?.startsWith("Peer replay unavailable:")==true}
        assertFalse(model.playing);assertFalse(model.preparing)
        assertEquals(1,PeerUiAudio.loads)
    }

    @Test fun partialEvidenceIsInspectableButNeverNormalReplay() {
        state="partial_chunks"
        compose.runOnIdle {model.refresh()}
        waitFor {!model.refreshing && model.peerItems.single().state.name=="PARTIAL_CHUNKS"}
        compose.onNodeWithText("Received evidence · 1 track dependencies").performClick()
        compose.onNodeWithTag("peer-session-info").assertExists()
        compose.onNode(hasText("RECEIVING · 1 CONFLICT RECEIPT(S)") and hasAnyAncestor(hasTestTag("peer-session-info"))).assertExists()
        capture("received-pending.png")
        assertNull(model.log);assertEquals(0,PeerUiAudio.loads);assertEquals(0,details)
    }

    @Test fun failedPeerListDoesNotResurrectLegacySourceUuidCache() {
        // Initial refresh prunes the actual prior foreign-ID header even if peer intake fails503.
        waitFor {model.peerListError!=null}
        assertTrue(model.headers.none {it.uuid==sid})
        assertFalse(model.peerItems.single().checked)
        assertNull(model.log);assertEquals(0,PeerUiAudio.loads)
    }

    @Test fun sameSourceIdReloadCannotMasqueradeAsVerifiedDecodedAudio() {
        compose.onNodeWithText("Received evidence · 1 track dependencies").performClick()
        waitFor {model.log!=null}
        compose.mainClock.autoAdvance=false
        compose.runOnUiThread {model.play(player)}
        waitFor {model.playing && PeerUiAudio.loads==1 && model.replayEpoch!=null}
        compose.runOnUiThread {model.stop()}
        val source=player.decks.getValue(DeckId.A).source!!.id
        // Simulate native decoded replacement retaining the same label and receiver ID. A mere
        // server-current/source-ID check would wrongly reuse this cached-ready deck on resume.
        PeerUiAudio.loadIds[DeckId.A]=99
        waitFor {player.decks.getValue(DeckId.A).snapshot?.loadId==99L}
        assertEquals(source,player.decks.getValue(DeckId.A).source!!.id)
        compose.runOnUiThread {model.play(player)}
        waitFor {model.playing && PeerUiAudio.loads==2 && model.replayEpoch!=null && player.decks.getValue(DeckId.A).ready && player.decks.getValue(DeckId.A).snapshot?.loadId==2L}
        assertNotEquals(99L,player.decks.getValue(DeckId.A).snapshot?.loadId)
        assertTrue(details>=5)
    }

    @Test fun phoneRecordedUuidCollisionDeduplicatesAndStaleLocalHeaderUsesGuardedProjection() {
        val phone=SessionRecording.init(compose.activity)
        val original=phone.detail(sid)
        val rows=model.sessions.filter {it.uuid==sid}
        assertEquals(1,rows.size);assertNotNull(rows.single().peer);assertFalse(rows.single().local)
        compose.onNodeWithTag("session-uuid-collision").assertExists()
        compose.runOnUiThread {model.open(SessionHeader(sid,null,"2026-11-02T00:00:06Z",0,local=true))}
        waitFor {model.log!=null}
        assertNotNull(model.peerReplay);assertFalse(model.header!!.local)
        assertEquals("Resolved receiver nine",model.track(9)?.title);assertNull(model.track(1))
        assertEquals(original,phone.detail(sid));assertNotNull(phone.meta(sid))
    }

    @Test fun directShowAndFailedReceivedValidationNeverFallBackToPhoneEvidence() {
        val phone=SessionRecording.init(compose.activity)
        val original=phone.detail(sid)
        kotlinx.coroutines.runBlocking {
            try {model.show(SessionHeader(sid,null,null,0,local=true),SessionLog.parse(original));fail("Direct local show must refuse a known received UUID")}
            catch(expected: IllegalArgumentException) {assertTrue(expected.message!!.contains("guarded"))}
        }
        state="assets_unavailable"
        compose.runOnUiThread {model.open(SessionHeader(sid,null,null,0,local=true))}
        waitFor {model.opening==null && model.notice?.startsWith("Open failed:")==true}
        assertNull(model.log);assertNull(model.peerReplay);assertEquals(0,PeerUiAudio.loads)
        assertEquals(original,phone.detail(sid));assertNotNull(phone.meta(sid))
    }

    @Test fun noncollisionPhoneRecordingStillOpensAndReplays() {
        val phone=SessionRecording.init(compose.activity)
        val original=phone.detail(phoneSid)
        val h=model.sessions.single {it.uuid==phoneSid}
        assertTrue(h.local);assertNull(h.peer)
        compose.runOnUiThread {model.open(h)}
        waitFor {model.log?.uuid==phoneSid}
        assertNull(model.peerReplay);assertEquals("Safe noncollision phone track",model.track(77)?.title)
        compose.mainClock.autoAdvance=false
        compose.runOnUiThread {model.play(player)}
        waitFor {model.playing && PeerUiAudio.loads==1}
        assertEquals("library:77:r77",player.decks.getValue(DeckId.A).source?.id)
        assertEquals(original,phone.detail(phoneSid));assertNotNull(phone.meta(phoneSid))
    }

    @Test fun failedAuthorityWriteClosesAnAlreadyOpenUnscopedPhoneView() {
        val phone=SessionRecording.init(compose.activity)
        val original=phone.detail(sid)
        compose.runOnUiThread {model.open(model.sessions.single {it.uuid==sid})}
        waitFor {model.log!=null}
        assertNull(model.peerReplay)
        val target=File(compose.activity.cacheDir,"peer-ui/peer-sessions/known-uuids.json")
        require(target.canonicalPath.startsWith(compose.activity.cacheDir.canonicalPath+File.separator))
        assertTrue(target.isFile);assertTrue(target.delete());assertTrue(target.mkdirs())
        File(target,"owned-decoy").writeText("generated")
        peerOmitted=false
        compose.runOnUiThread {model.refresh()}
        waitFor {!model.refreshing && model.peerListError!=null}
        assertNull(model.log);assertFalse(model.playing);assertEquals(0,PeerUiAudio.loads)
        assertTrue(model.notice!!.contains("UUID now conflicts"))
        val repo=LibraryHolder.repository(compose.activity)
        assertTrue(sid in repo.peerSessions.knownUuids!!)
        compose.runOnUiThread {model.open(SessionHeader(sid,null,null,0,local=true))}
        assertNull(model.log);assertTrue(model.notice!!.contains("without a current guarded projection"))
        assertEquals(original,phone.detail(sid));assertNotNull(phone.meta(sid))
    }
}

@Implements(AudioEngine::class)
class PeerUiAudio {
    companion object {
        var loads=0
        val sources=mutableMapOf<DeckId,String>()
        val loadIds=mutableMapOf<DeckId,Long>()
        @JvmStatic @Implementation fun __staticInitializer__() {}
    }
    private var seq=0L
    @Implementation fun __constructor__(offline: Boolean) {}
    @Implementation fun snapshot(): EngineSnapshot {
        val now=SystemClock.uptimeMillis()*48
        return EngineSnapshot(now,48000,2,1,true,0,0.0,Routing.STEREO,.5,false,BeatFx.DEFAULT,emptySet(),0,0,0,seq,seq,
            DeckId.entries.associateWith { d -> emptyDeck().copy(sourceId=sources[d],loadId=loadIds[d] ?: 0,
                loadState=if(sources[d]==null) LoadState.EMPTY else LoadState.READY,durationSeconds=40.0,decodedSeconds=40.0,fullyDecoded=true,fromMemory=true) },emptySet(),clockFrame=now)
    }
    @Implementation fun load(deck: DeckId,sourceId: String,fd: ParcelFileDescriptor,stems: List<ParcelFileDescriptor>?): CommandReceipt {
        loads++;sources[deck]=sourceId;loadIds[deck]=loads.toLong();return CommandReceipt(++seq,true,null)
    }
    @Implementation fun submit(command: AudioCommand)=CommandReceipt(++seq,true,null)
    @Implementation fun schedule(frame: Long,commands: List<AudioCommand>,tag: Long)=commands.map {CommandReceipt(++seq,true,null)}
    @Implementation fun cancelScheduled(tag: Long) {}
    @Implementation fun outputInfo(): OutputInfo?=null
    @Implementation fun lastLaunch(): DoubleArray?=null
    @Implementation fun renderCost()=AudioEngine.RenderCost(0.0,0.0,0,0)
    @Implementation fun close() {}
    private fun emptyDeck()=DeckSnapshot(null,0,LoadState.EMPTY,null,0.0,0,48000,null,1.0,1.0,0.0,0.0,false,false,false,
        listOf(.5,.5,.5),0.0,120.0,0.0,null,4.0,null,null,List(8){null},false,false,0,-1,0,0)
}
