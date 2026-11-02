package dev.manadj.library.group

import org.json.JSONArray
import org.json.JSONObject
import java.nio.file.Files
import java.net.InetSocketAddress
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.runBlocking
import kotlin.test.*

class GroupReplicaTest {
    private val gid = "33333333-3333-4333-8333-333333333333"
    private val a = "11111111-1111-4111-8111-111111111111"
    private val p = "22222222-2222-4222-8222-222222222222"
    private val b = "88888888-8888-4888-8888-888888888888"
    private val sid = "55555555-5555-4555-8555-555555555555"
    private val logical = "66666666-6666-4666-8666-666666666666"
    private val keys = listOf(a, p, b).mapIndexed { i, id -> id to ByteArray(32) { (it + i * 32).toByte() } }.toMap()
    private val root = Files.createTempDirectory("generated-group-replicas").toFile()
    private fun open(id: String) = GroupReplica(root.resolve(id), gid)
    private fun replicas(): Map<String, GroupReplica> = keys.mapValues { (id, seed) ->
        GroupReplica.provision(root.resolve(id), gid, id, seed).also { replica ->
            keys.forEach { (other, otherSeed) -> replica.pinMember(other, GroupWire.publicKey(otherSeed)) }
        }
    }
    private fun bundle(origin: String, session: String = sid, localId: Int = 7): JSONObject {
        val events = JSONArray("""[{"t":0,"kind":"load","channel":"A","trackId":$localId,"bpm":174},{"t":0.25,"kind":"transport","channel":"A","action":"play","playhead":0}]""")
        // Hash an independent canonical event array, not an inferred receiving/local ID mapping.
        val digest = GroupWire.sha256(org.erdtman.jcs.JsonCanonicalizer(events.toString()).encodedUTF8)
        return JSONObject().put("format", "manadj-peer-session").put("version", 1)
            .put("digest_algorithm", "sha256-rfc8785-jcs-v1")
            .put("manifest", JSONObject().put("session_uuid", session).put("origin_replica_id", origin)
                .put("grammar", "capture-events-v1").put("reference_basis", "explicit-current-row-bindings")
                .put("started_at", "2026-01-01T00:00:00Z").put("ended_at", "2026-01-01T00:01:00Z")
                .put("recording_origin", "Synthetic")
                .put("tracks", JSONArray().put(JSONObject().put("source_local_id", localId)
                    .put("logical_track_id", logical).put("asset", JSONObject.NULL)))
                .put("chunk_sha256", JSONArray().put(digest)))
            .put("chunks", JSONArray().put(JSONObject().put("seq", 0).put("events", events)))
    }

    @AfterTest fun cleanup() { root.deleteRecursively() } // generated test directory only

    @Test fun phoneRetainsAndRelaysOriginalEvidenceAcrossRestartWithoutAtoBTransport() {
        val replicas = replicas(); val aa = replicas.getValue(a); val pp = replicas.getValue(p); val bb = replicas.getValue(b)
        val original = aa.issue(bundle(a))
        assertEquals(original, aa.issue(bundle(a)))
        val operationId = GroupWire.parse(GroupWire.decode64(original.bodyBase64, GroupWire.MAX_OPERATION)).getString("operation_id")
        aa.acceptAck(pp.receiveDelivery(aa.delivery(p, operationId)), p)
        assertEquals(original, open(p).evidence().single())
        // A is now absent. Only persisted PHONE and B participate.
        val phoneAfterRestart = open(p)
        phoneAfterRestart.acceptAck(bb.receiveDelivery(phoneAfterRestart.delivery(b, operationId)), b)
        assertEquals(original, open(b).evidence().single())
        assertTrue(phoneAfterRestart.pendingFor(b).isEmpty())
        assertTrue(open(a).pendingFor(p).isEmpty())
        assertEquals(original, open(p).evidence().single())
        val process = ProcessBuilder(java.io.File(System.getProperty("java.home"), "bin/java").path,
            "-cp", System.getProperty("manadj.groupTestClasspath"), ReplicaRestartProbe::class.java.name,
            root.resolve(p).path, gid, b).redirectErrorStream(true).start()
        assertTrue(process.waitFor(30, java.util.concurrent.TimeUnit.SECONDS))
        val output = process.inputStream.bufferedReader().readText()
        assertEquals(0, process.exitValue(), output)
        val restarted = JSONObject(output)
        assertEquals(original, GroupSigned.parse(restarted.getJSONArray("evidence").getJSONObject(0)))
        assertEquals(0, restarted.getJSONArray("pending").length()) // ack survives real process restart
        // Retry after an acknowledgement was lost returns a valid duplicate ack, not a new op.
        val retryAck = bb.receiveDelivery(phoneAfterRestart.delivery(b, operationId))
        phoneAfterRestart.acceptAck(retryAck, b)
        assertEquals(1, bb.evidence().size)
        assertFails { GroupReplica.provision(root.resolve(p), gid, p, keys.getValue(p)) }
    }

    @Test fun foregroundExchangeRelaysBothDirectionsAndRestartsScansWithoutEcho() {
        val r = replicas(); val aa = r.getValue(a); val pp = r.getValue(p); val bb = r.getValue(b)
        val fromA = aa.issue(bundle(a)); val fromB = bb.issue(bundle(b, "99999999-9999-4999-8999-999999999999", 7))
        fun transport(peer: GroupReplica) = object : GroupTransport {
            override fun deliver(message: GroupSigned) = peer.receiveDelivery(message)
            override fun pull(message: GroupSigned) = peer.page(message)
            override fun acknowledge(message: GroupSigned) { peer.acceptAck(message, p) }
        }
        GroupExchange(open(p)).sync(a, transport(aa))
        GroupExchange(open(p)).sync(b, transport(bb))
        GroupExchange(open(p)).sync(a, transport(aa))
        val expected = setOf(fromA, fromB)
        for(id in listOf(a, p, b)) assertEquals(expected, open(id).evidence().toSet())
        assertTrue(open(p).pendingFor(a).isEmpty()); assertTrue(open(p).pendingFor(b).isEmpty())
        assertEquals(GroupExchangeResult(0, 0), GroupExchange(open(p)).sync(a, transport(aa)))
        assertEquals(GroupExchangeResult(0, 0), GroupExchange(open(p)).sync(b, transport(bb)))
    }

    private fun body(signed: GroupSigned) = GroupWire.parse(GroupWire.decode64(signed.bodyBase64, GroupWire.MAX_BODY))
    private fun id(signed: GroupSigned) = body(signed).getString("operation_id")
    private fun alter(signed: GroupSigned, signer: String, edit: (JSONObject) -> Unit): GroupSigned =
        GroupWire.sign(body(signed).also(edit), keys.getValue(signer))

    @Test fun unknownRevokedForgedAndWrongRecipientFailWithoutTrustImport() {
        val r = replicas(); val aa = r.getValue(a); val pp = r.getValue(p); val bb = r.getValue(b)
        val op = aa.issue(bundle(a)); val delivery = aa.delivery(p, id(op))
        val unknown = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        assertFails { pp.receiveDelivery(alter(delivery, a) { it.put("origin_device_id", unknown) }) }
        assertFails { pp.receiveDelivery(delivery.copy(signatureBase64 = GroupWire.encode64(ByteArray(64)))) }
        assertFails { pp.receiveDelivery(aa.delivery(b, id(op))) }
        assertFails { pp.receiveDelivery(alter(delivery, a) { it.put("group_id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") }) }
        assertTrue(pp.evidence().isEmpty())
        pp.receiveDelivery(delivery)
        bb.receiveDelivery(aa.delivery(b, id(op)))
        pp.revoke(a)
        assertFails { open(p).receiveDelivery(delivery) }
        assertFails { open(p).receiveDelivery(bb.delivery(p, id(op))) } // trusted relay, revoked origin
        assertFails { open(p).delivery(b, id(op)) }
        assertTrue(open(p).pendingFor(b).isEmpty())
        assertEquals(listOf(op), open(p).evidence()) // evidence retained, not reset/deleted
        assertFails { pp.pinMember(a, GroupWire.publicKey(keys.getValue(a))) }
        assertFails { pp.pinMember(b, GroupWire.publicKey(keys.getValue(a))) }
        // An unknown relay is rejected even when the original operation has a trusted signer.
        aa.revoke(b)
        assertFails { aa.receiveDelivery(bb.delivery(a, id(op))) }
    }

    @Test fun acknowledgementsAndPagesBindPeerRecipientRequestAndOperationHash() {
        val r = replicas(); val aa = r.getValue(a); val pp = r.getValue(p)
        val op = aa.issue(bundle(a)); val ack = pp.receiveDelivery(aa.delivery(p, id(op)))
        assertFails { aa.acceptAck(ack, b) }
        assertFails { aa.acceptAck(alter(ack, p) { it.put("operation_sha256", "0".repeat(64)) }, p) }
        assertFails { aa.acceptAck(alter(ack, p) { it.put("recipient_device_id", b) }, p) }
        assertEquals(listOf(id(op)), aa.pendingFor(p))
        val pull = pp.pullRequest(a)
        val page = aa.page(pull)
        assertFails { pp.receivePage(page, pp.pullRequest(a)) }
        assertFails { pp.receivePage(alter(page, a) { it.put("next_after", 0) }, pull) }
        assertFails { pp.receivePage(alter(page, a) { it.put("next_after", 1.5) }, pull) }
        assertFails { pp.receivePage(alter(page, a) { it.put("more", "true") }, pull) }
        pp.receivePage(page, pull).acknowledgements.forEach { aa.acceptAck(it, p) }
        assertTrue(aa.pendingFor(p).isEmpty())
    }

    @Test fun sameSessionCreatesAreRetainedButOperationUuidEquivocationAndMalformedBundlesReject() {
        val r = replicas(); val aa = r.getValue(a); val pp = r.getValue(p); val bb = r.getValue(b)
        val op = aa.issue(bundle(a)); val other = bb.issue(bundle(b))
        pp.receiveDelivery(aa.delivery(p, id(op))); pp.receiveDelivery(bb.delivery(p, id(other)))
        assertEquals(setOf(op, other), pp.evidence().toSet())
        val equivocation = alter(op, a) { it.getJSONObject("bundle").getJSONObject("manifest").put("recording_origin", "Changed") }
        val envelope = alter(aa.delivery(p, id(op)), a) { it.put("operation", equivocation.json()) }
        assertFails { pp.receiveDelivery(envelope) }
        assertEquals(setOf(op, other), open(p).evidence().toSet())
        fun badOperation(edit: (JSONObject) -> Unit) {
            val changed = alter(op, a) { it.put("operation_id", java.util.UUID.randomUUID().toString()); edit(it) }
            assertFails { pp.receiveDelivery(alter(aa.delivery(p, id(op)), a) { it.put("operation", changed.json()) }) }
        }
        badOperation { it.put("parents", JSONArray().put("0".repeat(64))) }
        badOperation { it.put("kind", "session-delete") }
        badOperation { it.getJSONObject("bundle").getJSONObject("manifest").put("origin_replica_id", b) }
        badOperation { it.getJSONObject("bundle").getJSONObject("manifest").getJSONArray("chunk_sha256").put(0, "0".repeat(64)) }
        badOperation { it.getJSONObject("bundle").getJSONArray("chunks").getJSONObject(0).getJSONArray("events").getJSONObject(0).put("trackId", 999) }
        fun malformedEvent(edit: (JSONArray) -> Unit) = badOperation { op ->
            val bundle = op.getJSONObject("bundle")
            val events = bundle.getJSONArray("chunks").getJSONObject(0).getJSONArray("events")
            edit(events)
            bundle.getJSONObject("manifest").getJSONArray("chunk_sha256").put(0,
                GroupWire.sha256(org.erdtman.jcs.JsonCanonicalizer(events.toString()).encodedUTF8))
        }
        // Valid signer AND recomputed valid chunk hash: semantic grammar/reference checks must reject.
        malformedEvent { it.getJSONObject(0).put("trackId", 999) }
        malformedEvent { it.getJSONObject(0).put("foreign", JSONObject().put("trackId", 7)) }
        malformedEvent { it.getJSONObject(1).put("t", -1) }
        malformedEvent { it.getJSONObject(1).put("action", "unsupported") }
        malformedEvent { it.getJSONObject(1).put("action", "pause") } // silent evidence
        assertEquals(2, pp.evidence().size)
    }

    @Test fun reusedLocalIdsAndMissingAssetsNeverAttachOrDeleteOldCacheAndJournal() {
        val cache = root.resolve("legacy").apply { mkdirs() }
        val files = listOf("snapshot.json", "edits.jsonl", "audio/7.wav", "pairing.json")
        files.forEach { cache.resolve(it).apply { parentFile.mkdirs(); writeText("generated sentinel $it") } }
        val before = files.associateWith { cache.resolve(it).readBytes().toList() }
        val r = replicas(); val aa = r.getValue(a); val bb = r.getValue(b)
        val repo = dev.manadj.library.LibraryRepository(cache, "http://old-desktop.invalid", deviceToken="generated-old-token")
        GroupReplica.provision(cache.resolve("device-groups/$gid"), gid, p, keys.getValue(p)).also { replica ->
            keys.forEach { (id, seed) -> replica.pinMember(id, GroupWire.publicKey(seed)) }
        }
        val pp = repo.groupReplica(gid)
        val op = aa.issue(bundle(a, localId=7)); pp.receiveDelivery(aa.delivery(p, id(op)))
        val missingAssets = body(pp.evidence().single()).getJSONObject("bundle").getJSONObject("manifest").getJSONArray("tracks").getJSONObject(0)
        assertTrue(missingAssets.isNull("asset")); assertEquals(logical, missingAssets.getString("logical_track_id"))
        assertEquals(7, missingAssets.getInt("source_local_id")) // foreign reference retained, no receiver binding
        val second = aa.issue(bundle(a, "99999999-9999-4999-8999-999999999999", localId=9))
        pp.receiveDelivery(aa.delivery(p, id(second)))
        for(opId in pp.pendingFor(b)) bb.receiveDelivery(pp.delivery(b, opId))
        assertEquals(2, bb.evidence().size)
        val otherGroup = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        val otherRoot = cache.resolve("device-groups/$otherGroup")
        GroupReplica.provision(otherRoot, otherGroup, p, keys.getValue(p))
        assertEquals(before, files.associateWith { cache.resolve(it).readBytes().toList() })
        assertEquals(setOf(op, second), repo.groupReplica(gid).evidence().toSet())
        assertEquals("http://old-desktop.invalid", repo.baseUrl)
        assertEquals("generated-old-token", repo.deviceToken)
        // A corrupt group state never silently provisions/reset itself.
        otherRoot.resolve("replica.json").writeText("not valid JSON")
        assertFails { repo.groupReplica(otherGroup).evidence() }
        assertFails { GroupReplica.provision(otherRoot, otherGroup, p, keys.getValue(p)) }
    }

    @Test fun repositoryForegroundHttpExchangesWithTwoPeersWithoutLegacyCredentials() = runBlocking {
        val r = replicas(); val aa = r.getValue(a); val bb = r.getValue(b)
        val fromA = aa.issue(bundle(a)); val fromB = bb.issue(bundle(b, "99999999-9999-4999-8999-999999999999"))
        val cache = root.resolve("http-phone")
        val repo = dev.manadj.library.LibraryRepository(cache, "http://legacy.invalid", pairCode="secret-code", deviceToken="secret-token")
        GroupReplica.provision(cache.resolve("device-groups/$gid"), gid, p, keys.getValue(p)).also { replica ->
            keys.forEach { (id, seed) -> replica.pinMember(id, GroupWire.publicKey(seed)) }
        }
        val seen = mutableListOf<String>()
        fun serve(replica: GroupReplica): HttpServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            createContext("/api/device-groups/$gid/") { exchange ->
                try {
                    assertEquals("POST", exchange.requestMethod)
                    assertNull(exchange.requestHeaders.getFirst("X-Manadj-Device-Token"))
                    assertNull(exchange.requestHeaders.getFirst("X-Manadj-Pair"))
                    val message = GroupSigned.parse(GroupWire.parse(exchange.requestBody.readBytes()))
                    val path = exchange.requestURI.path.substringAfterLast('/')
                    val result = when(path) {
                        "deliver" -> replica.receiveDelivery(message).json()
                        "pull" -> replica.page(message).json()
                        "ack" -> { replica.acceptAck(message, p); JSONObject().put("stored", true) }
                        else -> error("Unexpected group route")
                    }
                    synchronized(seen) { seen += path }
                    val bytes = GroupWire.canonical(result)
                    exchange.sendResponseHeaders(200, bytes.size.toLong()); exchange.responseBody.use { it.write(bytes) }
                } catch(t: Throwable) {
                    exchange.sendResponseHeaders(500, -1)
                } finally { exchange.close() }
            }
            start()
        }
        val serverA = serve(aa); val serverB = serve(bb)
        try {
            val urlA = "http://127.0.0.1:${serverA.address.port}"; val urlB = "http://127.0.0.1:${serverB.address.port}"
            repo.syncGroup(gid, a, urlA).getOrThrow()
            repo.syncGroup(gid, b, urlB).getOrThrow()
            // Reopen the production repository/ledger; legacy address/token must remain unchanged.
            val reopened = dev.manadj.library.LibraryRepository(cache, repo.baseUrl, deviceToken=repo.deviceToken)
            reopened.syncGroup(gid, a, urlA).getOrThrow()
            assertEquals(setOf(fromA, fromB), reopened.groupReplica(gid).evidence().toSet())
            assertEquals(setOf(fromA, fromB), aa.evidence().toSet()); assertEquals(setOf(fromA, fromB), bb.evidence().toSet())
            assertTrue(seen.containsAll(listOf("pull", "deliver", "ack")))
            assertEquals("http://legacy.invalid", reopened.baseUrl); assertEquals("secret-token", reopened.deviceToken)
        } finally { serverA.stop(0); serverB.stop(0) }
    }
}
