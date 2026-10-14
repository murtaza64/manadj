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
    @Volatile private var deviceToken: String? = null
    @Volatile private var pairPolls = 0
    private val pushed = mutableListOf<String>()
    private val received = mutableListOf<String>()
    @Volatile private var deskTitle = "Decoy"
    @Volatile private var waveformRequests = 0
    @Volatile private var deskMinimapMaster = 1.16
    @Volatile private var snapshotRequests = 0
    @Volatile private var twoWay = true
    private val stemRequests = java.util.Collections.synchronizedList(mutableListOf<String>())
    @Volatile private var dropAudioAfter: Int? = null
    @Volatile private var onAudioRequest: () -> Unit = {}
    private val ranges = mutableListOf<String?>()

    private fun snapshotJson() = """
        {"version":1,"generated_at":"2026-10-14T12:00:00+00:00",
         "tag_categories":[{"id":1,"name":"Genre","display_order":0,"color":"#ff0000"}],
         "tags":[{"id":7,"name":"Neuro","category_id":1,"display_order":0,"color":null}],
         "tracks":[
          {"id":10,"title":"$deskTitle","artist":"Synth","file_name":"decoy.mp3","bpm":174.0,"key":15,"key_openkey":"8m","key_camelot":"3A",
           "energy":4,"duration_secs":300.0,"date_added":"2026-10-01T00:00:00","main_cue":0.5,"codec":"mp3","filesize_bytes":200000,
           "audio_rev":"r1","preview_rev":"$previewRev","waveform_rev":"w1","stems_rev":"s1","tag_ids":[7],"hot_cues":[{"slot":1,"time":12.5,"label":null,"color":"#00ff00"}],
           "grid":{"origin":"analyzed","anchor_time":0.5,"tempo_changes":[{"start_time":0.5,"bpm":174.0,"time_signature_num":4,"bar_position":1}]}},
          {"id":11,"title":null,"artist":null,"file_name":"untitled.flac","bpm":null,"key":null,"key_openkey":null,"key_camelot":null,
           "energy":null,"duration_secs":null,"date_added":null,"main_cue":null,"codec":null,"filesize_bytes":null,
           "audio_rev":null,"preview_rev":null,"waveform_rev":null,"tag_ids":[],"hot_cues":[],"grid":null}],
         "playlists":[{"id":3,"name":"Set","color":null,"display_order":0,"track_ids":[11,10]}],
         "links":[[10,11]],"transitions":[{"a":10,"b":11,"count":2,"favorite":true}],
         "cameos":[],"takes":[{"a":11,"b":10,"count":2,"last_at":"2026-10-02T00:00:00"}],
         "settings":{
          "manadj.waveformStyles":{"value":{"version":1,"full":{"styleId":"additive-soft","params":{"master":1}},"minimap":{"styleId":"additive-soft","params":{"master":$deskMinimapMaster}}},"updated_at":"2026-10-14T12:00:00"},
          "manadj-filter-settings":{"value":{"model":"res48","resonance":99,"drive":"x"},"updated_at":null}}}
    """.trimIndent()

    @BeforeTest fun start() {
        root = Files.createTempDirectory("library-sync").toFile()
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/device-sync/snapshot") { ex ->
            val tokenOk = deviceToken != null && ex.requestHeaders.getFirst(DEVICE_TOKEN_HEADER) == deviceToken
            if (requiredCode != null && !tokenOk && ex.requestHeaders.getFirst(PAIR_HEADER) != requiredCode) {
                ex.sendResponseHeaders(401, -1); ex.close(); return@createContext
            }
            snapshotRequests++
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
            ranges += ex.requestHeaders.getFirst("Range")
            onAudioRequest()
            val from = ex.requestHeaders.getFirst("Range")?.let { Regex("bytes=(\\d+)-").find(it)!!.groupValues[1].toInt() }
            val body = if (from != null) audio.copyOfRange(from, audio.size) else audio
            ex.responseHeaders.add("Accept-Ranges", "bytes")
            ex.sendResponseHeaders(if (from != null) 206 else 200, body.size.toLong())
            try {
                ex.responseBody.use { out ->
                    if (dropAudioAfter != null) {
                        out.write(body, 0, dropAudioAfter!!); out.flush()
                        dropAudioAfter = null
                        ex.close() // connection drops mid-file
                    } else out.write(body)
                }
            } catch (_: java.io.IOException) {
            }
        }
        server.createContext("/api/device-sync/tracks/") { ex ->
            val path = ex.requestURI.path
            val id = path.split("/")[4].toInt()
            if ("/stems/" in path && id == 10) {
                stemRequests += path.substringAfter("/stems/")
                val body = if (path.endsWith("/waveform")) mwf1(ByteArray(500) { 9 }) else ByteArray(3000) { path.length.toByte() }
                ex.sendResponseHeaders(200, body.size.toLong()); ex.responseBody.use { it.write(body) }
            } else if (path.endsWith("/waveform") && id == 10) {
                waveformRequests++
                val body = mwf1(ByteArray(2000) { (it % 200).toByte() }, duration = 5.8)
                ex.responseHeaders.add("X-Waveform-Rev", "w1")
                ex.sendResponseHeaders(200, body.size.toLong()); ex.responseBody.use { it.write(body) }
            } else {
                ex.sendResponseHeaders(404, -1); ex.close()
            }
        }
        server.createContext("/api/device-sync/edits") { ex ->
            if (!twoWay) { ex.sendResponseHeaders(404, -1); ex.close(); return@createContext }
            val body = ex.requestBody.readBytes().decodeToString()
            pushed += body
            val uuids = Regex("\"uuid\":\"([^\"]+)\"").findAll(body).map { it.groupValues[1] }.toList()
            val out = """{"batch_id":"b","outcomes":{${uuids.joinToString(",") { "\"$it\":\"applied\"" }}}}""".toByteArray()
            ex.sendResponseHeaders(200, out.size.toLong()); ex.responseBody.use { it.write(out) }
        }
        server.createContext("/api/device-sync/received") { ex ->
            if (!twoWay) { ex.sendResponseHeaders(404, -1); ex.close(); return@createContext }
            received += ex.requestBody.readBytes().decodeToString()
            val out = """{"batch_id":"r"}""".toByteArray()
            ex.sendResponseHeaders(200, out.size.toLong()); ex.responseBody.use { it.write(out) }
        }
        server.createContext("/api/device-pair/request") { ex ->
            val body = if (ex.requestMethod == "POST") {
                assertTrue(ex.requestBody.readBytes().decodeToString().contains("\"device_name\":\"Pixel\""))
                """{"id":"t1","match_code":"0427","expires_s":30}"""
            } else {
                pairPolls++
                if (pairPolls < 2) """{"status":"pending"}""" else """{"status":"approved","token":"tok-1"}"""
            }.toByteArray()
            ex.sendResponseHeaders(200, body.size.toLong()); ex.responseBody.use { it.write(body) }
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
        assertEquals("additive-soft", library.waveformStyles.full.styleId)
        assertEquals(1.16f, library.waveformStyles.minimap.master)
        assertEquals(99, org.json.JSONObject(library.settingJson(PerformanceSettings.FILTER)!!).getInt("resonance")) // raw: the engine sanitizes

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
        assertTrue(repo.state.value.error!!.startsWith("Not paired"))
        repo.pairCode = "ABCDE-FGHJK"
        assertEquals(2, repo.sync().getOrThrow().tracks.size)
    }

    @Test fun approveOnDesktopPairing() = runBlocking {
        requiredCode = "ABCDE-FGHJK"
        deviceToken = "tok-1"
        val states = mutableListOf<PairingState>()
        val url = "http://127.0.0.1:${server.address.port}"
        val token = PairingClient(url).pair("device-0001", "Pixel", "manaDJ on desk", pollMs = 10) { states += it }
        assertEquals("tok-1", token)
        assertEquals(PairingState.AwaitingApproval("manaDJ on desk", "0427"), states[1])
        assertEquals(PairingState.Paired("manaDJ on desk"), states.last())
        val repo = repo()
        repo.deviceToken = token
        assertEquals(2, repo.sync().getOrThrow().tracks.size) // token alone suffices, no typed code
        repo.deviceToken = "revoked"
        assertTrue(repo.sync().isFailure)
        assertTrue(repo.state.value.error!!.contains("unpaired"))
    }

    @Test fun editsApplyLocallyPushThenReceivedDiff() = runBlocking {
        val repo = repo()
        repo.deviceId = "phone-x"
        repo.sync().getOrThrow()
        assertTrue(repo.edit(10, TrackEdit.HotCueSet(2, 30.5, "drop")))
        assertTrue(repo.edit(10, TrackEdit.TagSet(7, false)))
        assertTrue(repo.edit(10, TrackEdit.Key(1)))
        val local = repo.library.value!!.track(10)!!
        assertEquals(listOf(1, 2), local.hotCues.map { it.slot })
        assertEquals(emptyList(), local.tagIds)
        assertEquals("8A", local.keyCamelot)
        assertEquals(3, repo.state.value.pendingEdits)

        // Offline restart keeps the overlay.
        val reopened = repo().also { it.open() }
        assertEquals(listOf(1, 2), reopened.library.value!!.track(10)!!.hotCues.map { it.slot })

        deskTitle = "Decoy (desk edit)"
        repo.sync().getOrThrow()
        assertEquals(1, pushed.size)
        assertTrue(pushed[0].contains("\"field\":\"hot_cue:2\""))
        assertEquals(0, repo.journal.all().size)
        assertEquals(1, received.size) // the desktop's title change reached the phone
        assertTrue(received[0].contains("\"field\":\"title\"") && !received[0].contains("hot_cue"))
        assertEquals(false, repo.edit(10, TrackEdit.Title("Decoy (desk edit)"))) // no-op edit
    }

    @Test fun detailWaveformFetchedOnceAndCachedOffline() = runBlocking {
        val repo = repo()
        repo.sync().getOrThrow()
        val wf = repo.detailWaveform(10)!!
        assertEquals(2000, wf.bins)
        assertEquals(128.0 / 44100, wf.secondsPerPeak)
        assertEquals(512.0 / 44100, wf.secondsPerBand)
        assertEquals(2048, wf.stftWindow)
        assertEquals(wf, repo.detailWaveform(10))
        assertEquals(null, repo.detailWaveform(11)) // no waveform_rev
        repo.audioFile(10) // the offline unit: waveform already stored, not refetched
        assertEquals(1, waveformRequests)

        server.stop(0)
        val offline = repo().also { it.open() }
        assertEquals(2000, offline.detailWaveform(10)!!.bins)
    }

    @Test fun audioDownloadResumesWithRange() = runBlocking {
        val repo = repo()
        repo.sync().getOrThrow()
        dropAudioAfter = 70_000
        assertTrue(runCatching { repo.audioFile(10) }.isFailure)
        val part = partFile(repo.store.audioFile(repo.library.value!!.track(10)!!)!!)
        val partLen = part.length()
        assertTrue(partLen in 1..70_000)
        val file = repo.audioFile(10)
        assertTrue(file.readBytes().contentEquals(audio))
        assertEquals(2, ranges.size)
        assertEquals(null, ranges[0])
        assertEquals("bytes=$partLen-", ranges[1])
        assertTrue(!part.exists())
    }

    @Test fun bulkDownloadsMissingAudioAndWaveforms() = runBlocking {
        val repo = repo()
        repo.sync().getOrThrow()
        val plan = repo.bulkPlan(3)
        assertEquals(listOf(10), plan.tracks.map { it.id })
        assertEquals(200_000, plan.bytes)
        val done = repo.downloadAll(3).getOrThrow()
        assertEquals(1, done.tracksDone)
        assertEquals(200_000, done.bytesDone)
        assertTrue(done.finished && !done.running)
        assertEquals("Set", done.scopeName)
        assertTrue(repo.store.hasWaveform(repo.library.value!!.track(10)!!))
        assertEquals(1, repo.state.value.audioCount)
        assertEquals(emptyList(), repo.bulkPlan(null).tracks) // everything cached: a re-run is a no-op
        assertEquals(0, repo.downloadAll().getOrThrow().tracksTotal)
        assertEquals(1, audioRequests)
    }

    @Test fun bulkCancelKeepsPartialForResume() = runBlocking {
        val repo = repo()
        repo.sync().getOrThrow()
        onAudioRequest = { repo.cancelBulk() }
        val stopped = repo.downloadAll().getOrThrow()
        assertTrue(stopped.cancelled && !stopped.finished)
        assertEquals(0, stopped.tracksDone)
        onAudioRequest = {}
        val done = repo.downloadAll().getOrThrow()
        assertEquals(1, done.tracksDone)
        assertEquals(1, repo.state.value.audioCount)
    }

    @Test fun bulkPlanRefusesWhenSpaceShort() {
        val plan = BulkPlan(emptyList(), bytes = 10L shl 30, remainingBytes = 10L shl 30, freeBytes = 4L shl 30)
        assertTrue(!plan.fits)
        assertTrue(BulkPlan(emptyList(), 0, 0, LibraryRepository.SPACE_MARGIN_BYTES).fits)
    }

    @Test fun settingsEditsOverlayPushAndReceivedDiff() = runBlocking {
        val repo = repo()
        repo.sync().getOrThrow()
        val filterKey = PerformanceSettings.FILTER
        fun filter(r: LibraryRepository) = org.json.JSONObject(r.library.value!!.settingJson(filterKey)!!)
        val edited = filter(repo).put("resonance", 12.0)
        assertTrue(repo.editSetting(filterKey, edited))
        assertEquals(false, repo.editSetting(filterKey, org.json.JSONObject(edited.toString()))) // no-op
        assertEquals(12.0, filter(repo).getDouble("resonance"))
        assertEquals("res48", filter(repo).getString("model"))
        val styles = repo.library.value!!.waveformStyles
        assertTrue(repo.editWaveformStyles(styles.copy(full = styles.full.copy(coreWhite = 0.32f))))
        assertEquals(0.32f, repo.library.value!!.waveformStyles.full.coreWhite)
        assertEquals(2, repo.state.value.pendingEdits)
        assertEquals(12.0, filter(repo().also { it.open() }).getDouble("resonance")) // survives restart

        repo.sync().getOrThrow()
        val push = org.json.JSONObject(pushed.single()).getJSONArray("edits")
        val edits = (0 until push.length()).map(push::getJSONObject).associateBy { it.getString("field") }
        val filter = edits.getValue("setting:manadj-filter-settings")
        assertTrue(filter.isNull("track_id"))
        assertEquals(12.0, filter.getJSONObject("new").getDouble("resonance"))
        assertEquals("x", filter.getJSONObject("new").get("drive")) // untouched raw values round-trip
        val full = edits.getValue("setting:manadj.waveformStyles").getJSONObject("new").getJSONObject("full").getJSONObject("params")
        assertEquals("0.32", full.get("coreWhite").toString())
        assertTrue(!full.has("gains")) // unchanged fields not invented
        assertEquals(0, repo.state.value.pendingEdits)
        assertTrue(received.isEmpty())

        deskMinimapMaster = 2.5 // the desktop changes a setting: reported as received
        repo.sync().getOrThrow()
        assertTrue(received.single().contains("setting:manadj.waveformStyles"))
        assertEquals(2.5f, repo.library.value!!.waveformStyles.minimap.master)
    }

    @Test fun staleCachedSnapshotAutoSyncsAndWaveformFetchedWithoutRev() = runBlocking {
        // A snapshot cached before the desktop served waveform_rev/settings (the 16:25Z phone bug).
        val old = org.json.JSONObject(snapshotJson()).apply {
            remove("settings")
            val tracks = getJSONArray("tracks")
            for (k in 0 until tracks.length()) tracks.getJSONObject(k).remove("waveform_rev")
        }.toString()
        repo().store.writeSnapshotText(old)
        val repo = repo()
        repo.open()!!
        assertTrue(repo.state.value.cacheStale)
        assertEquals(null, repo.library.value!!.track(10)!!.waveformRev)
        // Desktop reachable: the endpoint is tried even without a rev.
        assertEquals(2000, repo.detailWaveform(10)!!.bins)
        assertEquals(1, waveformRequests)
        assertEquals(2000, repo.detailWaveform(10)!!.bins) // cached by the served rev
        assertEquals(1, waveformRequests)

        assertTrue(repo.autoSync())
        assertTrue(!repo.state.value.cacheStale)
        assertEquals("w1", repo.library.value!!.track(10)!!.waveformRev)
        assertEquals(false, repo.autoSync()) // fresh: throttled
        assertEquals(1, snapshotRequests)
        assertEquals(2000, repo.detailWaveform(10)!!.bins)
        assertEquals(1, waveformRequests) // the file stored under w1 is reused

        server.stop(0) // away from the desktop: auto-sync stays quiet
        assertEquals(false, repo.autoSync(minIntervalMs = 0))
        assertEquals(null, repo.state.value.error)
    }

    @Test fun pullWorksAgainstDesktopWithoutTwoWaySync() = runBlocking {
        twoWay = false // desktop on a build without /edits and /received (#375)
        val repo = repo()
        repo.sync().getOrThrow()
        assertTrue(repo.edit(10, TrackEdit.Energy(5)))
        deskTitle = "Changed on desk"
        val library = repo.sync().getOrThrow()
        assertEquals("Changed on desk", library.track(10)!!.title)
        assertEquals(5, library.track(10)!!.energy) // edit kept locally, still journaled
        assertEquals(1, repo.state.value.pendingEdits)
        assertEquals(null, repo.state.value.error)
    }

    @Test fun stemsDownloadOnceCachedOfflineAndInBulk() = runBlocking {
        val repo = repo()
        repo.sync().getOrThrow()
        val files = repo.stemFiles(10)!!
        assertEquals(STEM_NAMES, files.keys.toList())
        assertTrue(files.values.all { it.length() == 3000L })
        assertEquals(null, repo.stemFiles(11)) // no stems on the desktop
        repo.stemFiles(10)
        assertEquals(4, stemRequests.size)
        assertEquals(500, repo.stemWaveform(10, "drums")!!.bins)
        assertEquals(500, repo.stemWaveform(10, "drums")!!.bins)
        assertEquals(5, stemRequests.size)

        repo.clearStems()
        assertTrue(!repo.hasLocalStems(repo.library.value!!.track(10)!!))
        assertEquals(listOf(10), repo.bulkPlan(null, stems = true).tracks.map { it.id })
        repo.downloadAll(null, stems = true).getOrThrow()
        assertTrue(repo.hasLocalStems(repo.library.value!!.track(10)!!))

        server.stop(0)
        assertEquals(STEM_NAMES, repo().also { it.open() }.stemFiles(10)!!.keys.toList()) // offline from cache
    }

    @Test fun presyncAudio() = runBlocking {
        val repo = repo()
        repo.sync(audio = true).getOrThrow()
        assertEquals(1, repo.state.value.audioCount)
        assertEquals(1, audioRequests)
    }
}
