package dev.manadj.library.session

import com.sun.net.httpserver.HttpServer
import dev.manadj.library.*
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetSocketAddress
import java.nio.file.Files
import java.security.MessageDigest
import kotlin.test.*

class PeerSessionsTest {
    private val sid = "11111111-1111-4111-8111-111111111111"
    private val origin = "22222222-2222-4222-8222-222222222222"
    private val logical = "33333333-3333-4333-8333-333333333333"
    private val manifest = "a".repeat(64)
    private var generation = "b".repeat(64)
    private val bytes = ByteArray(2400) { (it % 151).toByte() }
    private val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private lateinit var root: java.io.File
    private lateinit var server: HttpServer
    private lateinit var repo: LibraryRepository
    private var state = "ready"
    private var audio = bytes
    private var audioCalls = 0
    private var detailCalls = 0
    private var foreignCalls = 0
    private var conflicts = 0

    private fun item() = JSONObject().put("session_uuid",sid).put("origin_replica_id",origin).put("recording_origin","Original phone")
        .put("manifest_sha256",manifest).put("started_at","2026-11-02T00:00:00Z").put("ended_at","2026-11-02T00:00:06Z")
        .put("materialized",true).put("state",state).put("replay_generation",generation).put("conflict_count",conflicts)
        .put("dependencies",JSONArray().put(JSONObject().put("logical_track_id",logical).put("local_track_id",9).put("asset_state","exact").put("sha256",sha).put("byte_length",bytes.size)))
    private fun detail(): JSONObject {
        val track = JSONObject().put("id",9).put("title","Receiver nine").put("artist","Synthetic").put("bpm",120).put("duration_secs",40)
            .put("main_cue",0).put("hot_cues",JSONArray()).put("grid",JSONObject.NULL).put("audio_rev","receiver-nine")
        val session = JSONObject().put("uuid",sid).put("started_at","2026-11-02T00:00:00Z").put("ended_at","2026-11-02T00:00:06Z")
            .put("replay_generation",generation).put("events",JSONArray("""[
                {"t":0,"kind":"load","channel":"A","trackId":9},
                {"t":0,"kind":"transport","channel":"A","action":"play","playhead":0},
                {"t":6,"kind":"transport","channel":"A","action":"pause","playhead":6}]
            """))
        return JSONObject().put("version",1).put("item",item()).put("session",session).put("tracks",JSONArray().put(
            JSONObject().put("local_track_id",9).put("logical_track_id",logical).put("sha256",sha).put("byte_length",bytes.size).put("track",track)))
    }

    @BeforeTest fun setUp() {
        root = Files.createTempDirectory("peer-native443-").toFile()
        server = HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        server.createContext("/api/device-sync/peer-sessions") { ex ->
            if (ex.requestHeaders.getFirst(DEVICE_TOKEN_HEADER) != "synthetic-paired-token") { ex.sendResponseHeaders(401,-1); ex.close(); return@createContext }
            val path = ex.requestURI.path
            val body = when {
                path == "/api/device-sync/peer-sessions" -> JSONObject().put("version",1).put("items",JSONArray().put(item())).toString().toByteArray()
                ex.requestURI.rawQuery != "generation=$generation" || state != "ready" -> { ex.sendResponseHeaders(409,-1); ex.close(); return@createContext }
                path.endsWith("/audio/9") -> { audioCalls++; audio }
                path == "/api/device-sync/peer-sessions/$sid" -> { detailCalls++; detail().toString().toByteArray() }
                else -> { foreignCalls++; ex.sendResponseHeaders(404,-1); ex.close(); return@createContext }
            }
            ex.sendResponseHeaders(200,body.size.toLong()); ex.responseBody.use { it.write(body) }
        }
        server.createContext("/") { ex -> foreignCalls++; ex.sendResponseHeaders(500,-1); ex.close() }
        server.start()
        repo = LibraryRepository(root,"http://127.0.0.1:${server.address.port}",deviceToken="synthetic-paired-token")
    }
    @AfterTest fun stop() { server.stop(0); root.deleteRecursively() }

    @Test fun pairedResolvedProjectionUsesReceiverIdsAndExactGenerationBytes() = runBlocking {
        val list = repo.peerSessions.refresh(); assertEquals("Original phone",list.single().recordingOrigin)
        val replay = repo.peerSessions.open(list.single())
        assertEquals(listOf(9),replay.log.appearances.map { it.trackId })
        assertEquals("Receiver nine",replay.tracks.getValue(9).track.title)
        val cached = repo.peerSessions.audio(replay,9)
        assertContentEquals(bytes,cached.readBytes()); assertEquals(1,audioCalls)
        repo.peerSessions.audio(replay,9)
        assertEquals(1,audioCalls); assertEquals(3,detailCalls) // every load revalidates, including cache hit
        assertEquals(0,foreignCalls)
        assertTrue(repo.peerSessions.cached().single().checked.not())
        assertFalse(cached.path.contains("library/9"))
    }

    @Test fun staleGenerationAndIdReuseCannotReplayCachedBytes() = runBlocking {
        val replay = repo.peerSessions.open(repo.peerSessions.refresh().single())
        repo.peerSessions.audio(replay,9)
        generation = "c".repeat(64) // same local integer and bytes, new binding incarnation
        val e = assertFailsWith<SyncException> { repo.peerSessions.audio(replay,9) }
        assertEquals(409,e.status); assertEquals(1,audioCalls); assertEquals(0,foreignCalls)
        val next = repo.peerSessions.open(repo.peerSessions.refresh().single())
        assertNotEquals(replay.generation,next.generation)
        assertNotEquals(replay.tracks.getValue(9).sourceId(replay),next.tracks.getValue(9).sourceId(next))
    }

    @Test fun offlineCacheNeverBecomesPlaybackAuthority() = runBlocking<Unit> {
        val replay = repo.peerSessions.open(repo.peerSessions.refresh().single())
        repo.peerSessions.audio(replay,9); server.stop(0)
        val cached = repo.peerSessions.cached().single()
        assertTrue(cached.statusLabel.contains("REVALIDATE"))
        assertFailsWith<SyncException> { repo.peerSessions.open(cached) }
        assertFailsWith<SyncException> { repo.peerSessions.audio(replay,9) }
    }

    @Test fun corruptCachedAudioIsNotTrustedAndWrongDownloadIsRejected() = runBlocking {
        val replay = repo.peerSessions.open(repo.peerSessions.refresh().single())
        val file = repo.peerSessions.audio(replay,9)
        file.writeBytes(ByteArray(bytes.size))
        audio = ByteArray(bytes.size)
        assertFailsWith<SyncException> { repo.peerSessions.audio(replay,9) }
        audio = bytes
        assertContentEquals(bytes,repo.peerSessions.audio(replay,9).readBytes())
        assertEquals(3,audioCalls)
        assertTrue(root.walkTopDown().none { it.name.endsWith(".part") })
    }

    @Test fun foreignOrOverflowingTrackIdsAndUnknownVersionFailClosed() {
        for (id in listOf(1L,4294967305L)) {
            val o = detail(); o.getJSONObject("session").getJSONArray("events").getJSONObject(0).put("trackId",id)
            assertFails { PeerSessions.parseDetail(o.toString()) }
        }
        assertFails { PeerSessions.parseDetail(detail().put("version",2).toString()) }
        val o = detail(); o.getJSONArray("tracks").getJSONObject(0).getJSONObject("track").put("id",1)
        assertFails { PeerSessions.parseDetail(o.toString()) }
    }

    @Test fun partialMissingUnresolvedStaleUnknownNeverEnableNormalReplay() = runBlocking {
        for (s in listOf("partial_chunks","unresolved_references","assets_unavailable","not_materialized","stale_binding","source_invalid","future_state")) {
            state = s
            val row = repo.peerSessions.refresh().single()
            assertFalse(row.canValidate,s)
            assertFails { repo.peerSessions.open(row) }
        }
        assertEquals(0,detailCalls); assertEquals(0,audioCalls)
    }

    @Test fun rejectedConflictReceiptDoesNotRewriteOriginalReadiness() = runBlocking {
        val replay = repo.peerSessions.open(repo.peerSessions.refresh().single())
        conflicts = 1
        assertTrue(repo.peerSessions.refresh().single().statusLabel.contains("1 CONFLICT"))
        assertContentEquals(bytes,repo.peerSessions.audio(replay,9).readBytes())
    }

    @Test fun nonmemberLoadNeverTouchesBareTrackEndpointAndUnpairedFails() = runBlocking {
        val replay = repo.peerSessions.open(repo.peerSessions.refresh().single())
        assertFailsWith<SyncException> { repo.peerSessions.audio(replay,1) }
        repo.deviceToken = "revoked"
        assertTrue(assertFailsWith<SyncException> { repo.peerSessions.refresh() }.unpaired)
        assertEquals(0,foreignCalls)
    }

    @Test fun generationMarkedEndedDetailCannotEnterLegacyOfflineReplay() = runBlocking {
        val legacy=java.io.File(root,"legacy")
        java.io.File(legacy,"sessions").mkdirs()
        java.io.File(legacy,"sessions/$sid.json").writeText(detail().getJSONObject("session").toString())
        val old=SessionStore(legacy,{SyncClient("http://127.0.0.1:${server.address.port}")})
        assertFails {old.log(SessionHeader(sid,null,"2026-11-02T00:00:06Z",0))}
        assertEquals(0,foreignCalls)
    }
}
