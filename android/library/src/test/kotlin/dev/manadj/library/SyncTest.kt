package dev.manadj.library

import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.runBlocking
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** Repository against a fake desktop serving the device-sync wire format. */
class SyncTest {
    private lateinit var server: HttpServer
    private lateinit var root: File
    private val audio = ByteArray(200_000) { (it % 251).toByte() }
    private var previewRequests = 0
    private var audioRequests = 0
    @Volatile private var previewRev = "p1"
    @Volatile private var requiredCode: String? = null

    private fun snapshotJson() = """
        {"version":1,"generated_at":"2026-10-14T12:00:00+00:00",
         "tag_categories":[{"id":1,"name":"Genre","display_order":0,"color":"#ff0000"}],
         "tags":[{"id":7,"name":"Neuro","category_id":1,"display_order":0,"color":null}],
         "tracks":[
          {"id":10,"title":"Decoy","artist":"Synth","file_name":"decoy.mp3","bpm":174.0,"key":15,"key_openkey":"8m","key_camelot":"3A",
           "energy":4,"duration_secs":300.0,"date_added":"2026-10-01T00:00:00","main_cue":0.5,"codec":"mp3","filesize_bytes":200000,
           "audio_rev":"r1","preview_rev":"$previewRev","tag_ids":[7],"hot_cues":[{"slot":1,"time":12.5,"label":null,"color":"#00ff00"}],
           "grid":{"origin":"analyzed","anchor_time":0.5,"tempo_changes":[{"start_time":0.5,"bpm":174.0,"time_signature_num":4,"bar_position":1}]}},
          {"id":11,"title":null,"artist":null,"file_name":"untitled.flac","bpm":null,"key":null,"key_openkey":null,"key_camelot":null,
           "energy":null,"duration_secs":null,"date_added":null,"main_cue":null,"codec":null,"filesize_bytes":null,
           "audio_rev":null,"preview_rev":null,"tag_ids":[],"hot_cues":[],"grid":null}],
         "playlists":[{"id":3,"name":"Set","color":null,"display_order":0,"track_ids":[11,10]}],
         "links":[[10,11]],"transitions":[{"a":10,"b":11,"count":2,"favorite":true}],
         "cameos":[],"takes":[{"a":11,"b":10,"count":2,"last_at":"2026-10-02T00:00:00"}]}
    """.trimIndent()

    @BeforeTest fun start() {
        root = Files.createTempDirectory("library-sync").toFile()
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/device-sync/snapshot") { ex ->
            if (requiredCode != null && ex.requestHeaders.getFirst(PAIR_HEADER) != requiredCode) {
                ex.sendResponseHeaders(401, -1); ex.close(); return@createContext
            }
            val body = snapshotJson().toByteArray()
            ex.sendResponseHeaders(200, body.size.toLong()); ex.responseBody.use { it.write(body) }
        }
        server.createContext("/api/device-sync/previews") { ex ->
            previewRequests++
            val requested = ex.requestBody.readBytes().decodeToString()
            val blob = mwf1()
            val out = ByteArrayOutputStream()
            out.write("MPK1".toByteArray())
            val ids = if ("10" in requested) listOf(10) else emptyList()
            out.write(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(ids.size).array())
            for (id in ids) {
                out.write(ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putInt(id).putInt(blob.size).array())
                out.write(blob)
            }
            val body = out.toByteArray()
            ex.sendResponseHeaders(200, body.size.toLong()); ex.responseBody.use { it.write(body) }
        }
        server.createContext("/api/device-sync/tracks/10/audio") { ex ->
            audioRequests++
            ex.sendResponseHeaders(200, audio.size.toLong()); ex.responseBody.use { it.write(audio) }
        }
        server.start()
    }

    @AfterTest fun stop() {
        server.stop(0)
        root.deleteRecursively()
    }

    private fun repo() = LibraryRepository(root, "http://127.0.0.1:${server.address.port}/")

    @Test fun syncsThenWorksOffline() = runBlocking {
        val repo = repo()
        val library = repo.sync().getOrThrow()
        assertEquals(listOf(10, 11), library.tracks.map { it.id })
        val decoy = library.track(10)!!
        assertEquals("8m", decoy.keyOpenKey)
        assertEquals("#ff0000", library.tagsOf(decoy).single().color) // category color fallback
        assertEquals("untitled", library.track(11)!!.title)
        assertNotNull(library.preview(decoy))
        assertEquals(RowMarks(TransitionMark.FAVORITED, true), library.marks(10, 11))
        assertEquals(1, repo.state.value.previewCount)
        assertEquals(listOf(11, 10), library.playlistTracks(3).map { it.id })

        server.stop(0) // desktop gone: a fresh repository opens the cache
        val offline = repo()
        val reopened = offline.open()!!
        assertEquals(2, reopened.tracks.size)
        assertNotNull(reopened.preview(reopened.track(10)!!))
        assertTrue(offline.sync().isFailure)
        assertTrue(offline.state.value.error!!.startsWith("Desktop unreachable"))
        assertEquals(2, offline.library.value!!.tracks.size) // cache survives failure
    }

    @Test fun previewsOnlyRefetchWhenRevChanges() = runBlocking {
        val repo = repo()
        repo.sync().getOrThrow()
        repo.sync().getOrThrow()
        assertEquals(1, previewRequests)
        previewRev = "p2"
        repo.sync().getOrThrow()
        assertEquals(2, previewRequests)
        assertEquals(listOf("10-p2.mwf"), repo.store.previewDir.list()!!.toList())
    }

    @Test fun audioDownloadsOnceAndCaches() = runBlocking {
        val repo = repo()
        repo.sync().getOrThrow()
        val track = repo.library.value!!.track(10)!!
        assertEquals(AudioState.Remote, repo.audioState(track))
        val file = repo.audioFile(10)
        assertTrue(file.readBytes().contentEquals(audio))
        assertEquals(file, repo.audioFile(10))
        assertEquals(1, audioRequests)
        assertEquals(AudioState.Cached, repo.audioState(track))
        assertEquals(AudioState.Unavailable, repo.audioState(repo.library.value!!.track(11)!!))
        assertTrue(runCatching { repo.audioFile(11) }.isFailure)
    }

    @Test fun pairingCodeSentToLanListener() = runBlocking {
        requiredCode = "ABCDE-FGHJK"
        val repo = repo()
        assertTrue(repo.sync().isFailure)
        assertTrue(repo.state.value.error!!.startsWith("Pairing code"))
        repo.pairCode = "ABCDE-FGHJK"
        assertEquals(2, repo.sync().getOrThrow().tracks.size)
    }

    @Test fun presyncAudio() = runBlocking {
        val repo = repo()
        repo.sync(audio = true).getOrThrow()
        assertEquals(1, repo.state.value.audioCount)
        assertEquals(1, audioRequests)
    }
}
