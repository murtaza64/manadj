package dev.manadj.app.session

import android.content.ComponentName
import android.content.Intent
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.manadj.app.*
import dev.manadj.app.library.LibraryHolder
import dev.manadj.library.LibraryRepository
import dev.manadj.library.group.*
import dev.manadj.library.session.*
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.*
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.*
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Job

/** Real normal SessionScreen/SessionModel/repository; only audio output is a host double. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35], shadows=[PeerUiAudio::class])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class GroupSessionUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @get:Rule val testName = org.junit.rules.TestName()
    private val gid = "33333333-3333-4333-8333-333333333333"
    private val a = "11111111-1111-4111-8111-111111111111"
    private val p = "22222222-2222-4222-8222-222222222222"
    private val b = "88888888-8888-4888-8888-888888888888"
    private val sid = "55555555-5555-4555-8555-555555555555"
    private val safeSid = "77777777-7777-4777-8777-777777777777"
    private lateinit var server: ServerSocket
    private lateinit var serverThread: Thread
    private lateinit var repo: LibraryRepository
    private lateinit var model: SessionModel
    private lateinit var player: PlayerModel
    private lateinit var phone: RecordedSessions
    private lateinit var replica: GroupReplica
    private lateinit var original: String
    private lateinit var service: org.robolectric.android.controller.ServiceController<PlaybackService>
    private val pushed = mutableListOf<String>()
    private lateinit var incomingDelivery: GroupSigned
    private var actualPayloadReady = false
    private var expectedRows = 1
    private var markerOnly = false
    @Volatile private var markerOmitted = false
    @Volatile private var markerOverride: String? = null

    @Before fun start() {
        RuntimeEnvironment.setQualifiers("w600dp-h900dp-mdpi")
        markerOnly = testName.methodName == "pairedDenyOnlyClaimWithoutEnrollmentNeverCreatesAFakeSessionAndSurvivesOmission"
        val markerText = File("../../tests/fixtures/group_session_deny_v1.json").readText()
        server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        serverThread = Thread({
            while(!server.isClosed) try { server.accept().use { socket ->
                val input = socket.getInputStream().bufferedReader()
                val path = input.readLine().split(' ')[1].substringBefore('?')
                var length = 0
                while(true) {
                    val line = input.readLine() ?: break
                    if(line.isEmpty()) break
                    if(line.startsWith("Content-Length:", true)) length = line.substringAfter(':').trim().toInt()
                }
                repeat(length) { input.read() }
                val text = when {
                    path == "/api/device-sync/sessions" -> "[]"
                    path == "/api/device-sync/peer-sessions" -> markerOverride ?: if(markerOnly && !markerOmitted) markerText else """{"version":1,"items":[]}"""
                    else -> { synchronized(pushed) { pushed += path }; "{}" }
                }
                val bytes = text.toByteArray()
                val status = if(path.startsWith("/api/device-sync/sessions/")) 409 else 200
                socket.getOutputStream().apply {
                    write("HTTP/1.1 $status Fixture\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray()); write(bytes); flush()
                }
            } } catch(e: java.io.IOException) { if(!server.isClosed) throw e }
        }, "generated-group-ui-fixture").apply { isDaemon=true; start() }
        val app = RuntimeEnvironment.getApplication()
        repo = LibraryRepository(File(app.cacheDir, "group-ui"), "http://127.0.0.1:${server.localPort}")
        repo.store.writeSnapshotText("""{"version":1,"settings":{},"tag_categories":[],"tags":[],"links":[],"transitions":[],"cameos":[],"takes":[],"playlists":[],"tracks":[{"id":7,"title":"Unrelated receiver seven","file_name":"wrong.wav","audio_rev":"r7","tag_ids":[],"hot_cues":[]},{"id":77,"title":"Safe unrelated phone track","file_name":"safe.wav","audio_rev":"r77","tag_ids":[],"hot_cues":[]}]}""")
        runBlocking { repo.open(); repo.peerSessions.refresh() }
        for(id in listOf(7,77)) repo.store.audioFile(repo.library.value!!.track(id)!!)!!.also { it.parentFile!!.mkdirs(); it.writeBytes(ByteArray(1000) { 1 }) }
        phone = RecordedSessions(File(app.filesDir, "sessions-cache/recorded"))
        SessionRecording::class.java.getDeclaredField("store").apply { isAccessible=true }.set(null, phone)
        SessionRecording::class.java.getDeclaredField("app").apply { isAccessible=true }.set(null, app)
        for((uuid, track) in listOf(sid to 7, safeSid to 77)) if(phone.meta(uuid) == null) {
            phone.open(uuid, "2026-01-01T00:00:00Z")
            phone.append(uuid, 0, JSONArray("""[{"t":0,"kind":"load","channel":"A","trackId":$track,"bpm":120},{"t":0.25,"kind":"transport","channel":"A","action":"play","playhead":0},{"t":6,"kind":"transport","channel":"A","action":"pause","playhead":6}]"""))
            phone.end(uuid, "2026-01-01T00:01:00Z")
        }
        original = phone.detail(sid)
        val fixture = JSONObject(File("../../tests/fixtures/group_session_v1.json").readText())
        val op = GroupSigned(GroupWire.encode64(fixture.getString("body_utf8").toByteArray()), fixture.getString("signature_b64"))
        incomingDelivery = GroupWire.sign(JSONObject().put("format", GroupWire.FORMAT).put("group_id", gid)
            .put("origin_device_id", b).put("kind", "deliver").put("recipient_device_id", p).put("operation", op.json()), ByteArray(32) { (it+64).toByte() })
        val actualSource = File("../../.lane-app/455/generated-full-session-phone/device-groups/$gid/replica.json")
        actualPayloadReady = System.getenv("MANADJ_GROUP_HISTORY_FIXTURE_URL") != null && actualSource.isFile
        val target = File(repo.store.root, "device-groups/$gid")
        if(markerOnly) {
            expectedRows=0 // paired denial is not group enrollment or a verified Session projection
        } else if(testName.methodName == "actualTransportedFullSessionsAppearInNormalComposeHistory" && actualPayloadReady) {
            // Clone ONLY the retained generated public-test-key ledger into this disposable UI
            // fixture. No transport/enrollment runs from the clone; issuer/proof bytes stay exact.
            target.mkdirs(); File(target,"replica.json").writeBytes(actualSource.readBytes())
            replica = GroupReplica(target, gid); expectedRows=2
        } else {
            replica = GroupReplica.provision(target, gid, p, ByteArray(32) { (it+32).toByte() })
            replica.pinMember(a, GroupWire.publicKey(ByteArray(32) { it.toByte() }), "Laptop A")
            replica.pinMember(b, GroupWire.publicKey(ByteArray(32) { (it+64).toByte() }), "Laptop B")
            if(testName.methodName == "aNewForeignClaimStopsAnAlreadyOpenLegacyReplayWithoutDeletingIt") expectedRows=0
            else replica.receiveDelivery(incomingDelivery)
        }
        repo.groupHistory.project()
        LibraryHolder::class.java.getDeclaredField("instance").apply { isAccessible=true }.set(null, repo)
        PeerUiAudio.loads=0; PeerUiAudio.sources.clear(); PeerUiAudio.loadIds.clear()
        service = Robolectric.buildService(PlaybackService::class.java).create()
        shadowOf(app).setComponentNameAndServiceForBindService(ComponentName(app, PlaybackService::class.java), service.get().onBind(Intent()))
        val provider = ViewModelProvider(compose.activity, ViewModelProvider.AndroidViewModelFactory(app))
        player=provider[PlayerModel::class.java]; model=provider[SessionModel::class.java]
        val ux=provider[UiModel::class.java]
        compose.setContent { SessionScreen(player, ux, Modifier.fillMaxSize()) }
        waitFor { !model.refreshing && model.groupItems.size == expectedRows }
    }
    private fun waitFor(condition: () -> Boolean) = compose.waitUntil(15000) {
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(20)); condition()
    }
    @After fun finish() {
        compose.runOnUiThread { model.close(); compose.activity.viewModelStore.clear() }
        service.destroy(); server.close(); serverThread.join(2000)
        LibraryHolder::class.java.getDeclaredField("instance").apply { isAccessible=true }.set(null, null)
    }
    @Test fun realNormalHistoryShowsHumanOriginRelayAndExpandableNonplayableEvidence() {
        compose.onNodeWithText(sid, substring=true).assertDoesNotExist()
        capture("group-normal-history.png")
        compose.onNodeWithText("From Laptop A · via Laptop B").assertExists().performClick()
        compose.onNodeWithTag("group-session-info").assertExists()
        compose.onNodeWithText("Evidence only · playback unavailable").assertExists()
        capture("group-evidence-human.png")
        compose.onNodeWithText("TECHNICAL EVIDENCE").performClick()
        compose.onNodeWithText(sid, substring=true).assertExists()
        compose.onNodeWithText("66666666-6666-4666-8666-666666666666", substring=true).assertExists()
        capture("group-evidence-technical.png")
        assertNull(model.log); assertFalse(model.playing); assertEquals(0, PeerUiAudio.loads)
        assertEquals(original, phone.detail(sid))
    }
    @Test fun exactLocalGroupBindingUsesExplicitControlsThenExistingReplayAndRefusesRevokedResume() = exerciseGroupReplay("revoke")
    @Test fun sameBytesReplacementStopsGroupReplayAndRefusesCachedDecodedResume() = exerciseGroupReplay("replace")
    @Test fun staleDecodedLoadStopsGroupReplayAndRequiresANewVerifiedAttempt() = exerciseGroupReplay("decoded")
    @Test fun actualTransportedGroupControlsBindDecodeAndStopOnStorageFailure() = exerciseGroupReplay("transport")
    @Test fun delayedGroupOpenCannotReplaceNewLocalPlaybackAfterClose() = exerciseGroupReplay("pending-local")
    @Test fun delayedGroupOpenCannotReopenAfterClose() = exerciseGroupReplay("pending-close")
    @Test fun delayedGroupOpenCannotOverrideANewerGroupInspection() = exerciseGroupReplay("pending-group")
    @Test fun delayedGroupOpenCannotOverrideANewerRejectedIntent() = exerciseGroupReplay("pending-rejected")
    @Test fun cancelledGroupOpenCannotPublishAfterBlockedIoReturns() = exerciseGroupReplay("pending-cancel")
    @Test fun delayedGroupOpenCannotPublishAfterLeavingSessions() = exerciseGroupReplay("pending-leave")
    private fun exerciseGroupReplay(refusal: String) {
        val fixture=JSONObject(File("../../tests/fixtures/group_replay_v1.json").readText())
        val body=JSONObject(fixture.getString("body_utf8")); val group=body.getString("group_id")
        val target=File(repo.store.root,"device-groups/$group")
        val r=if(refusal == "transport") {
            val source=System.getenv("MANADJ_GROUP_REPLAY_PHONE_DIR")?.let { File(it,"device-groups/$group/replica.json") }
            Assume.assumeTrue("Requires actual NEW transported #456 phone",source?.isFile == true)
            assertTrue(target.mkdirs());File(target,"replica.json").writeBytes(source!!.readBytes())
            GroupReplica(target,group)
        } else GroupReplica.provision(target,group,p,ByteArray(32) { (it+32).toByte() }).also { replica ->
            replica.pinMember(a,GroupWire.publicKey(ByteArray(32) { it.toByte() }),"Laptop A")
            val signed=GroupSigned(GroupWire.encode64(fixture.getString("body_utf8").toByteArray()),fixture.getString("signature_b64"))
            replica.receiveDelivery(GroupWire.sign(JSONObject().put("format",GroupWire.FORMAT).put("group_id",group).put("origin_device_id",a)
                .put("kind","deliver").put("recipient_device_id",p).put("operation",signed.json()),ByteArray(32) { it.toByte() }))
        }
        val rows=JSONArray().put(JSONObject("""{"id":77,"title":"Safe unrelated phone track","file_name":"safe.wav","audio_rev":"r77","tag_ids":[],"hot_cues":[]}"""))
        for(i in 0..1) {
            val asset=fixture.getJSONArray("assets").getJSONObject(i); val recipe=asset.getJSONObject("recipe")
            val row=JSONObject().put("id",73+i).put("title","Generated local tone $i").put("file_name",asset.getString("file_name"))
                .put("audio_rev","generated456").put("tag_ids",JSONArray()).put("hot_cues",JSONArray())
            rows.put(row)
            val n=recipe.getInt("sample_frames"); val rate=recipe.getInt("sample_rate"); val period=recipe.getInt("period_frames"); val amp=recipe.getInt("amplitude")
            val wav=java.nio.ByteBuffer.allocate(44+2*n).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            wav.put("RIFF".toByteArray()).putInt(36+2*n).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1)
                .putInt(rate).putInt(rate*2).putShort(2).putShort(16).put("data".toByteArray()).putInt(2*n)
            repeat(n) { wav.putShort((if(it%period<period/2) amp else -amp).toShort()) }
            File(repo.store.audioDir,"${73+i}-generated456/${asset.getString("file_name")}").apply { parentFile!!.mkdirs(); writeBytes(wav.array()) }
        }
        repo.store.writeSnapshotText(JSONObject("""{"version":1,"tag_categories":[],"tags":[],"links":[],"transitions":[],"cameos":[],"takes":[],"settings":{}}""").put("tracks",rows).toString())
        runBlocking { repo.open() }; repo.groupHistory.project()
        compose.runOnUiThread { model.refreshGroupHistory() }
        waitFor { model.groupItems.any { it.groupId == group } }
        val view=model.groupItems.single { it.groupId == group }
        compose.runOnUiThread { model.open(SessionHeader(view.sessionUuid,view.startedAt,view.endedAt,0,group=view)) }
        waitFor { model.groupReplayReadiness?.state == "unbound" }
        compose.onNodeWithText("SELECT LOCAL AUDIO 1").performClick()
        compose.onNodeWithText("USE Generated local tone 0").performClick()
        waitFor { !model.groupReplayBusy }
        compose.onNodeWithText("SELECT LOCAL AUDIO 2").performClick()
        compose.onNodeWithText("USE Generated local tone 1").performClick()
        waitFor { model.groupReplayReadiness?.state == "candidate-exact" }
        assertFalse(view.playable); assertEquals(0,PeerUiAudio.loads)
        if(refusal.startsWith("pending-")) { exercisePendingGroupOpen(view,refusal);return }
        compose.onNodeWithText("OPEN GUARDED REPLAY").performClick()
        waitFor { model.groupReplaySource != null && model.log != null }
        compose.runOnUiThread { model.play(player) }
        waitFor { PeerUiAudio.loads >= 2 && model.playing }
        assertTrue(PeerUiAudio.sources.values.all { it.startsWith("group:") && ":attempt:" in it })
        val initialSourceA=PeerUiAudio.sources[dev.manadj.audio.DeckId.A]
        if(refusal == "transport") {
            compose.runOnUiThread { model.stop() }
            waitFor { !model.playing && !model.preparing }
            capture("group-exact-local-playback.png") // paused actual guarded source, not a fake playing raster
            compose.runOnUiThread { model.play(player) }
            waitFor { model.playing }
        }
        if(refusal == "revoke") r.revoke(a)
        else if(refusal == "decoded") { PeerUiAudio.loadIds[dev.manadj.audio.DeckId.A]=9999L }
        else if(refusal == "transport") {
            val file=File(repo.store.root,"group-replay/bindings/bindings.json")
            assertTrue(file.renameTo(File(repo.store.root,"retained-generated-456-bindings.json")))
            assertTrue(file.mkdir()) // generated local storage failure; original evidence retained
        }
        else {
            val file=File(repo.store.audioDir,"73-generated456/tone-a.wav")
            val retained=File(repo.store.root,"retained-generated-456-audio.wav")
            assertTrue(file.renameTo(retained)); file.writeBytes(retained.readBytes())
        }
        waitFor { !model.playing && !model.preparing }
        compose.runOnUiThread { model.play(player) }
        if(refusal == "decoded") waitFor { PeerUiAudio.loads >= 3 && model.playing &&
            PeerUiAudio.sources[dev.manadj.audio.DeckId.A] != initialSourceA && player.decks.getValue(dev.manadj.audio.DeckId.A).snapshot?.loadId != 9999L }
        else waitFor { !model.groupReplayBusy && !model.playing && !model.preparing }
        assertEquals(original,phone.detail(sid))
    }
    private fun exercisePendingGroupOpen(view: GroupSessionView,mode: String) {
        val adapter=SessionModel::class.java.getDeclaredField("groupAdapter").apply { isAccessible=true }.get(model) as GroupReplay
        val other=model.groupItems.single { it.groupId == gid }
        val disk=GroupReplay::class.java.getDeclaredField("disk").apply { isAccessible=true }.get(adapter)
        @Suppress("UNCHECKED_CAST")
        val locks=disk.javaClass.getDeclaredField("locks").apply { isAccessible=true }.get(null) as ConcurrentHashMap<String,Any>
        val mutex=locks.getValue(File(repo.store.root,"group-replay/bindings").canonicalPath)
        val held=CountDownLatch(1);val release=CountDownLatch(1)
        val gate=Thread { synchronized(mutex) { held.countDown();release.await(15,TimeUnit.SECONDS) } }.apply { start() }
        try {
            assertTrue(held.await(5,TimeUnit.SECONDS))
            val before=model.viewModelScope.coroutineContext[Job]!!.children.toSet()
            compose.runOnUiThread { model.openGroupReplay(view) }
            val pending=model.viewModelScope.coroutineContext[Job]!!.children.single { it !in before }
            val priorNotice=model.notice
            when(mode) {
                "pending-local" -> {
                    compose.runOnUiThread { model.close();model.open(model.sessions.single { it.uuid == safeSid }) }
                    waitFor { model.log?.uuid == safeSid }
                    compose.mainClock.autoAdvance=false
                    compose.runOnUiThread { model.play(player) }
                    waitFor { model.playing && PeerUiAudio.loads>0 }
                }
                "pending-close" -> compose.runOnUiThread { model.close() }
                "pending-group" -> compose.runOnUiThread { model.open(SessionHeader(other.sessionUuid,other.startedAt,other.endedAt,0,group=other)) }
                "pending-rejected" -> compose.runOnUiThread { model.open(SessionHeader(view.sessionUuid,view.startedAt,view.endedAt,0,local=true)) }
                "pending-cancel" -> pending.cancel()
                "pending-leave" -> compose.runOnUiThread { model.leave() }
            }
            val newerNotice=model.notice
            release.countDown();gate.join(5000)
            waitFor { pending.isCompleted }
            assertNull(model.groupReplaySource)
            assertFalse(model.groupReplayBusy)
            if(mode == "pending-local") { assertEquals(safeSid,model.log?.uuid);assertTrue(model.playing) }
            else { assertNull(model.log);assertFalse(model.playing) }
            if(mode == "pending-group") {
                waitFor { model.groupReplayReadiness != null }
                assertEquals(other.key,model.groupInfo?.key)
            }
            assertEquals(newerNotice,model.notice) // old success/error/finally cannot overwrite context
            if(mode == "pending-close" || mode == "pending-cancel") assertEquals(priorNotice,model.notice)
            assertEquals(original,phone.detail(sid))
        } finally { release.countDown();gate.join(5000) }
    }
    @Test fun groupUuidCannotOpenOrSummarizeRawPhoneOrCacheAndNeverPushesRawCollision() {
        compose.runOnUiThread { model.open(SessionHeader(sid, null, null, 0, local=true)); model.summarize(SessionHeader(sid,null,null,0,local=true)) }
        waitFor { model.opening == null }
        assertNull(model.log); assertFalse(model.playing); assertNull(model.audibleTracks[sid])
        assertEquals(0, PeerUiAudio.loads); assertEquals(original, phone.detail(sid))
        synchronized(pushed) { assertFalse(pushed.any { it.endsWith(sid) }) }
        compose.runOnUiThread {
            org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
                runBlocking { model.show(SessionHeader(sid,null,null,0,local=true), SessionLog.parse(original.reader())) }
            }
        }
    }
    @Test fun unrelatedRetainedPhoneRecordingStillOpensAndReplays() {
        compose.runOnUiThread { model.open(model.sessions.single { it.uuid == safeSid }) }
        waitFor { model.log?.uuid == safeSid }
        compose.mainClock.autoAdvance=false
        compose.runOnUiThread { model.play(player) }
        waitFor { PeerUiAudio.loads > 0 }
        assertTrue(PeerUiAudio.sources.values.any { it.startsWith("library:77:") })
        assertFalse(PeerUiAudio.sources.values.any { it.startsWith("library:7:") })
        assertEquals(original, phone.detail(sid))
        val loads=PeerUiAudio.loads
        compose.runOnUiThread {
            val group=model.groupItems.single()
            model.open(SessionHeader(group.sessionUuid,group.startedAt,group.endedAt,0,group=group))
        }
        assertNull(model.log); assertFalse(model.playing); assertNotNull(model.groupInfo)
        compose.onNodeWithTag("session-play").assertDoesNotExist() // inspection cannot inherit old Play controls
        assertEquals(loads,PeerUiAudio.loads)
    }
    @Test fun revokedOrMissingProjectionCannotRestoreRawReplayAndRetainsOriginalEvidence() {
        waitFor { model.groupItems.isNotEmpty() }
        val projection = File(repo.store.root, "group-history/projections.json")
        assertTrue(projection.isFile); assertTrue(projection.delete()) // generated derived history only
        compose.runOnUiThread { model.refreshGroupHistory() }
        waitFor { model.groupItems.single().projected == false }
        compose.runOnUiThread { model.open(SessionHeader(sid,null,null,0,local=false)) }
        assertNull(model.log); assertEquals(0, PeerUiAudio.loads)
        replica.revoke(a)
        compose.runOnUiThread { model.refreshGroupHistory() }
        waitFor { model.groupItems.single().status == "revoked" }
        compose.onNodeWithText("Source revoked · playback unavailable").assertExists()
        capture("group-revoked-history.png")
        assertEquals(original, phone.detail(sid))
        compose.runOnUiThread { model.open(SessionHeader(sid,null,null,0,local=true)) }
        assertNull(model.log); assertFalse(model.playing); assertEquals(0, PeerUiAudio.loads)
    }
    @Test fun aNewForeignClaimStopsAnAlreadyOpenLegacyReplayWithoutDeletingIt() {
        compose.runOnUiThread { model.open(model.sessions.single { it.uuid == sid }) }
        waitFor { model.log?.uuid == sid }
        compose.mainClock.autoAdvance=false
        compose.runOnUiThread { model.play(player) }
        waitFor { PeerUiAudio.loads > 0 && model.playing }
        val loads = PeerUiAudio.loads
        replica.receiveDelivery(incomingDelivery)
        waitFor { !model.playing && !model.preparing }
        compose.runOnUiThread { model.play(player); model.seek(1.0, player) }
        assertFalse(model.playing); assertNull(model.track(7)); assertEquals(loads, PeerUiAudio.loads)
        compose.runOnUiThread { model.refreshGroupHistory(project=true) }
        waitFor { model.log == null && model.groupItems.size == 1 }
        assertEquals(original, phone.detail(sid))
    }
    @Test fun actualTransportedFullSessionsAppearInNormalComposeHistory() {
        org.junit.Assume.assumeTrue("Requires prior opt-in actual Python↔Kotlin full Session transport", actualPayloadReady)
        val originalOps = replica.evidence().associate { signed ->
            val raw=GroupWire.decode64(signed.bodyBase64,GroupWire.MAX_OPERATION)
            GroupWire.parse(raw).getString("operation_id") to GroupWire.sha256(raw)
        }
        assertEquals(originalOps, model.groupItems.associate { it.operationId to it.operationSha256 })
        compose.onNodeWithText("From Laptop A").assertExists()
        compose.onNodeWithText("From Laptop B").assertExists()
        compose.onNodeWithText("Waiting for track bindings").assertExists()
        capture("actual-full-session-history.png")
        compose.onNodeWithText("From Laptop A").performClick()
        compose.onNodeWithTag("group-session-info").assertExists()
        compose.onNodeWithText("Evidence only · playback unavailable").assertExists()
        capture("actual-full-session-evidence.png")
        assertNull(model.log); assertEquals(0, PeerUiAudio.loads)
        assertEquals(original, phone.detail(sid))
    }
    @Test fun pairedDenyOnlyClaimWithoutEnrollmentNeverCreatesAFakeSessionAndSurvivesOmission() {
        compose.onNodeWithTag("group-deny-only-status").assertExists().performClick()
        compose.onNodeWithTag("peer-session-info").assertExists()
        compose.onNodeWithTag("group-session-row").assertDoesNotExist()
        compose.onNodeWithText(sid,substring=true).assertDoesNotExist()
        assertTrue(model.groupItems.isEmpty()); assertFalse(File(repo.store.root,"device-groups").exists())
        capture("group-paired-deny-only.png")
        compose.runOnUiThread { model.open(SessionHeader(sid,null,null,0,local=true)) }
        assertNull(model.log); assertEquals(0,PeerUiAudio.loads)
        markerOmitted=true
        compose.runOnUiThread { model.refresh() }
        waitFor { !model.refreshing && model.peerItems.isEmpty() }
        compose.runOnUiThread { model.open(SessionHeader(sid,null,null,0,local=false)) }
        assertNull(model.log); assertEquals(original,phone.detail(sid))
        val reopened=LibraryRepository(repo.store.root,repo.baseUrl)
        assertFalse(reopened.rawSessionAllowed(sid)); assertFalse(File(repo.store.root,"device-groups").exists())
    }
    @Test fun exactOwnIssuedClaimSelectsOriginalRecordingNeverForeignCacheAndConflictingHashClosesIt() {
        val ownSid="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        val bundle=JSONObject(JSONObject(File("../../tests/fixtures/group_session_v1.json").readText()).getString("body_utf8")).getJSONObject("bundle")
        bundle.getJSONObject("manifest").put("session_uuid",ownSid).put("origin_replica_id",p)
        val m=bundle.getJSONObject("manifest")
        phone.open(ownSid,m.getString("started_at"))
        val chunks=bundle.getJSONArray("chunks")
        for(i in 0 until chunks.length()) phone.append(ownSid,chunks.getJSONObject(i).getInt("seq"),chunks.getJSONObject(i).getJSONArray("events"))
        phone.end(ownSid,m.getString("ended_at"))
        val originalOwn=phone.detail(ownSid)
        val ownOperation=replica.issue(bundle)
        val raw=GroupWire.decode64(ownOperation.bodyBase64,GroupWire.MAX_OPERATION)
        val op=GroupWire.parse(raw)
        val claim=JSONObject().put("group_id",gid).put("operation_id",op.getString("operation_id")).put("origin_device_id",p).put("operation_sha256",GroupWire.sha256(raw))
        val marker=JSONObject(File("../../tests/fixtures/group_session_deny_v1.json").readText()).getJSONArray("items").getJSONObject(0)
            .put("session_uuid",ownSid).put("origin_replica_id",p).put("group_claims",JSONArray().put(claim))
        markerOverride=JSONObject().put("version",1).put("items",JSONArray().put(marker)).toString()
        val foreignCache=File(compose.activity.filesDir,"sessions-cache/sessions/$ownSid.json")
        foreignCache.parentFile!!.mkdirs()
        val fake=JSONObject(originalOwn).put("events",JSONArray("""[{"t":0,"kind":"load","channel":"A","trackId":77,"bpm":120}]""")).toString()
        foreignCache.writeText(fake)
        compose.runOnUiThread { model.refresh() }
        waitFor { !model.refreshing && model.peerItems.singleOrNull()?.groupManaged == true }
        compose.runOnUiThread { model.open(SessionHeader(ownSid,null,null,0,local=false)) }
        waitFor { model.log?.uuid == ownSid }
        assertTrue(model.header!!.local)
        assertEquals(SessionLog.parse(originalOwn).events,model.log!!.events)
        assertEquals(fake,foreignCache.readText())
        compose.runOnUiThread {
            org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
                runBlocking { model.show(SessionHeader(ownSid,null,null,0,local=false),SessionLog.parse(fake)) }
            }
            org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
                runBlocking { model.show(SessionHeader(ownSid,null,null,0,local=true),SessionLog.parse(fake)) }
            }
        }
        compose.mainClock.autoAdvance=false
        compose.runOnUiThread { model.play(player) }
        waitFor { model.playing && PeerUiAudio.loads>0 }
        claim.put("operation_sha256","0".repeat(64))
        markerOverride=JSONObject().put("version",1).put("items",JSONArray().put(marker.put("group_claims",JSONArray().put(claim)))).toString()
        compose.runOnUiThread { model.refresh() }
        waitFor { !model.refreshing && model.log == null && !model.playing }
        assertEquals(originalOwn,phone.detail(ownSid)); assertEquals(fake,foreignCache.readText())
        synchronized(pushed) { assertFalse(pushed.any { it.endsWith(ownSid) }) }
    }
    private fun capture(name: String) {
        val output = System.getProperty("manadj.groupScreenshots") ?: return
        require(File(output).mkdirs() || File(output).isDirectory)
        compose.runOnIdle {
            val view = compose.activity.window.decorView
            val bitmap = android.graphics.Bitmap.createBitmap(view.width, view.height, android.graphics.Bitmap.Config.ARGB_8888)
            view.draw(android.graphics.Canvas(bitmap))
            File(output, name).outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
    }
}
