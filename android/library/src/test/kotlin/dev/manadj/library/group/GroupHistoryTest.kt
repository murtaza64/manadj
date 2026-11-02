package dev.manadj.library.group

import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import kotlin.test.*

class GroupHistoryTest {
    private val gid = "33333333-3333-4333-8333-333333333333"
    private val a = "11111111-1111-4111-8111-111111111111"
    private val p = "22222222-2222-4222-8222-222222222222"
    private val sid = "55555555-5555-4555-8555-555555555555"
    private val root = Files.createTempDirectory("generated-group-history").toFile()
    private val fixture = JSONObject(File("../../tests/fixtures/group_session_v1.json").readText())
    private val operation = GroupSigned(GroupWire.encode64(fixture.getString("body_utf8").toByteArray()), fixture.getString("signature_b64"))
    private fun receive(): GroupReplica {
        val replica = GroupReplica.provision(File(root, "device-groups/$gid"), gid, p, ByteArray(32) { (it+32).toByte() })
        replica.pinMember(a, GroupWire.publicKey(ByteArray(32) { it.toByte() }), "Laptop A")
        val delivery = GroupWire.sign(JSONObject().put("format", GroupWire.FORMAT).put("group_id", gid)
            .put("origin_device_id", a).put("kind", "deliver").put("recipient_device_id", p).put("operation", operation.json()), ByteArray(32) { it.toByte() })
        replica.receiveDelivery(delivery)
        return replica
    }
    @AfterTest fun cleanup() { root.deleteRecursively() } // generated-only files

    @Test fun validatedFullSessionProjectsIdempotentlyAndKeepsMetadataSeparateFromReplay() {
        receive()
        val history = GroupHistory(root)
        val pending = history.snapshot()
        assertEquals(setOf(sid), pending.knownUuids)
        assertEquals("projection-pending", pending.items.single().status)
        history.project()
        val view = GroupHistory(root).snapshot().items.single()
        assertEquals(fixture.getString("sha256"), view.operationSha256)
        assertEquals("Laptop A", view.origin.label)
        assertEquals("unbound", view.status)
        assertTrue(view.projected); assertFalse(view.playable); assertFalse(view.editable)
        assertEquals(2, view.tracks.size); assertTrue(view.tracks.all { it.assetState == "unbound" && it.expectedAsset != null })
        assertEquals("manadj-group-session-view/v1", view.json().getString("format"))
        history.project()
        assertEquals(view, GroupHistory(root).snapshot().items.single())
        assertTrue(File(root, "group-history/projections.json").delete()) // generated derived cache only
        assertEquals(setOf(sid), history.snapshot().knownUuids)
        assertFalse(history.snapshot().items.single().projected)
        history.project()
        assertEquals(view, history.snapshot().items.single())
    }

    @Test fun corruptLocalDeviceIdCannotPromoteReceivedEvidenceIntoOwnSourceAuthority() = corruptLocalAuthority("device")
    @Test fun corruptLocalSeedRefusesHistoryReplayAndSigningWithoutErasingEvidence() = corruptLocalAuthority("seed")
    @Test fun corruptLocalPinnedKeyRefusesHistoryReplayAndSigningWithoutErasingEvidence() = corruptLocalAuthority("pin")
    @Test fun missingLocalIdentityRefusesHistoryReplayAndSigningWithoutErasingEvidence() = corruptLocalAuthority("missing")
    private fun corruptLocalAuthority(kind: String) {
        val replica=receive();val view=GroupHistory(root).project().items.single()
        val file=File(root,"device-groups/$gid/replica.json");val original=file.readText()
        val state=JSONObject(original)
        when(kind) {
            "device" -> state.put("device_id",a)
            "seed" -> state.put("private_seed_b64",GroupWire.encode64(ByteArray(32) { (it+64).toByte() }))
            "pin" -> state.getJSONObject("members").getJSONObject(p).put("public_key_b64",GroupWire.encode64(GroupWire.publicKey(ByteArray(32) { (it+64).toByte() })))
            "missing" -> state.getJSONObject("members").remove(p)
        }
        file.writeText(state.toString()) // generated corruption only; never real group identity
        val snapshot=GroupHistory(root).snapshot()
        assertNull(snapshot.knownUuids)
        assertTrue(snapshot.ownIssuedClaims.isEmpty())
        assertNotNull(snapshot.error)
        val repo=dev.manadj.library.LibraryRepository(root,"http://127.0.0.1:1")
        assertFalse(repo.rawSessionAllowed(sid,allowOwnIssued=true))
        assertFalse(repo.rawSessionUploadAllowed(sid))
        assertNotEquals("candidate-exact",repo.groupReplay().readiness(view).state)
        assertFails { replica.pullRequest(a) }
        assertEquals(state.toString(),file.readText())
        file.writeText(original)
        assertEquals(setOf(sid),GroupHistory(root).snapshot().knownUuids)
        assertTrue(GroupHistory(root).snapshot().ownIssuedClaims.isEmpty())
        assertTrue(replica.evidence().isNotEmpty())
    }

    @Test fun revocationCollisionStorageOmissionAndProjectionFailureNeverRestoreRawAuthority() {
        val replica = receive(); val history = GroupHistory(root)
        val directory = File(root, "group-history").apply { mkdirs() }
        File(directory, ".lock").writeText("")
        Files.setPosixFilePermissions(directory.toPath(), java.nio.file.attribute.PosixFilePermissions.fromString("r-x------"))
        try {
            org.junit.jupiter.api.Assumptions.assumeTrue(!Files.isWritable(directory.toPath()))
            assertFailsWith<java.io.IOException> { history.project() }
            assertEquals(setOf(sid), history.snapshot().knownUuids)
            assertEquals("projection-pending", history.snapshot().items.single().status)
        } finally { Files.setPosixFilePermissions(directory.toPath(), java.nio.file.attribute.PosixFilePermissions.fromString("rwx------")) }
        history.project()
        assertEquals("conflicted", history.snapshot(setOf(sid)).items.single().status)
        replica.revoke(a)
        assertEquals("revoked", history.snapshot().items.single().status)
        assertEquals(setOf(sid), history.snapshot().knownUuids)
        val group = File(root, "device-groups/$gid")
        val moved = File(root, "retained-decoy-group")
        assertTrue(group.renameTo(moved)) // generated data retained, not deleted
        assertEquals(setOf(sid),history.snapshot().knownUuids)
        assertNotNull(history.snapshot().error)
        assertTrue(moved.renameTo(group))
        assertEquals(setOf(sid), GroupHistory(root).snapshot().knownUuids)
    }

    @Test fun ownIssuedRecordingKeepsOriginalAuthorityUntilAForeignClaimCollides() {
        val replica = GroupReplica.provision(File(root, "device-groups/$gid"), gid, a, ByteArray(32) { it.toByte() })
        val body = GroupWire.parse(GroupWire.decode64(operation.bodyBase64, GroupWire.MAX_OPERATION))
        replica.issue(body.getJSONObject("bundle"))
        val history = GroupHistory(root)
        history.project(setOf(sid))
        assertEquals(emptySet(), history.snapshot(setOf(sid)).knownUuids)
        assertTrue(history.snapshot(setOf(sid)).items.isEmpty())
        val foreign = "88888888-8888-4888-8888-888888888888"
        val seed = ByteArray(32) { (it+64).toByte() }
        replica.pinMember(foreign, GroupWire.publicKey(seed), "Laptop B")
        body.put("origin_device_id", foreign).put("operation_id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        body.getJSONObject("bundle").getJSONObject("manifest").put("origin_replica_id", foreign)
        val other = GroupWire.sign(body, seed)
        replica.receiveDelivery(GroupWire.sign(JSONObject().put("format", GroupWire.FORMAT).put("group_id", gid)
            .put("origin_device_id", foreign).put("kind", "deliver").put("recipient_device_id", a).put("operation", other.json()), seed))
        history.project(setOf(sid))
        assertEquals(setOf(sid), history.snapshot(setOf(sid)).knownUuids)
        assertEquals("conflicted", history.snapshot(setOf(sid)).items.single().status)
    }

    @Test fun invalidOrGenericStoredEvidenceNeverCreatesAFakeNormalSessionOrRestoresFallback() {
        receive(); val history = GroupHistory(root); history.project()
        val file = File(root, "device-groups/$gid/replica.json")
        val original = file.readText()
        val corrupted = JSONObject(original)
        corrupted.getJSONArray("operations").getJSONObject(0).getJSONObject("signed").put("signature_b64", GroupWire.encode64(ByteArray(64)))
        file.writeText(corrupted.toString()) // generated local corruption only
        val invalid = history.snapshot()
        assertTrue(invalid.items.isEmpty()); assertEquals(1, invalid.invalidEvidence); assertNull(invalid.knownUuids)
        assertFails { history.project() }
        assertEquals(corrupted.toString(), file.readText()) // read/project did not repair or erase evidence
        val generic = JSONObject(original)
        val row = generic.getJSONArray("operations").getJSONObject(0)
        val body = JSONObject(fixture.getString("body_utf8")).put("kind", "metadata-note")
        val signed = GroupWire.sign(body, ByteArray(32) { it.toByte() })
        row.put("signed", signed.json()).put("sha256", GroupWire.sha256(GroupWire.decode64(signed.bodyBase64, GroupWire.MAX_OPERATION)))
        file.writeText(generic.toString())
        assertTrue(history.snapshot().items.isEmpty()); assertNull(history.snapshot().knownUuids)
        file.writeText(original)
        assertEquals(setOf(sid), history.snapshot().knownUuids)
        assertEquals(1, history.snapshot().items.size)
    }

    @Test fun mutableBookkeepingOrMissingOperationsBeforeProjectionCannotHideReceivedUuidAuthority() {
        receive()
        val file=File(root,"device-groups/$gid/replica.json"); val original=file.readText()
        val repo=dev.manadj.library.LibraryRepository(root,"http://unused.invalid")
        assertFalse(repo.rawSessionAllowed(sid))
        val badOrigin=JSONObject(original)
        badOrigin.getJSONArray("operations").getJSONObject(0).put("origin_device_id",p).put("session_uuid","77777777-7777-4777-8777-777777777777")
        file.writeText(badOrigin.toString())
        assertFalse(repo.rawSessionAllowed(sid)); assertFalse(dev.manadj.library.LibraryRepository(root,"http://unused.invalid").rawSessionAllowed(sid))
        val missing=JSONObject(original).put("operations",org.json.JSONArray())
        file.writeText(missing.toString()) // supplier proof and independent received-UUID fence remain
        assertFalse(repo.rawSessionAllowed(sid)); assertTrue(repo.groupHistory.snapshot().items.isEmpty())
        val erased=JSONObject(original).put("operations",org.json.JSONArray()).put("possessions",JSONObject())
        file.writeText(erased.toString()) // received UUID was committed with the original metadata ack
        assertFalse(repo.rawSessionAllowed(sid)); assertNull(repo.groupHistory.snapshot().knownUuids)
        file.writeText(original)
        assertEquals(setOf(sid),repo.groupHistory.snapshot().knownUuids)
        assertEquals(1,repo.groupHistory.snapshot().items.size)
    }

    @Test fun supplierProofAliasToUnrelatedValidOwnRowCannotCoverTheOriginalForeignClaim() {
        val replica=receive()
        val body=JSONObject(fixture.getString("body_utf8"))
        val ownBundle=body.getJSONObject("bundle")
        ownBundle.getJSONObject("manifest").put("session_uuid","77777777-7777-4777-8777-777777777777").put("origin_replica_id",p)
        val own=replica.issue(ownBundle)
        val ownBody=GroupWire.parse(GroupWire.decode64(own.bodyBase64,GroupWire.MAX_OPERATION))
        val ownId=ownBody.getString("operation_id")
        val file=File(root,"device-groups/$gid/replica.json"); val original=file.readText()
        val corrupted=JSONObject(original)
        val rows=corrupted.getJSONArray("operations")
        val ownRow=(0 until rows.length()).map { rows.getJSONObject(it) }.single { it.getString("operation_id")==ownId }
        corrupted.put("operations",org.json.JSONArray().put(ownRow))
        val proofs=corrupted.getJSONObject("possessions")
        val proofKey=proofs.keys().asSequence().single()
        val record=proofs.getJSONObject(proofKey)
        val signedProof=GroupSigned.parse(record.getJSONObject("proof"))
        val altered=GroupWire.parse(GroupWire.decode64(signedProof.bodyBase64,GroupWire.MAX_BODY))
        val foreign=GroupSigned.parse(altered.getJSONObject("operation"))
        val foreignBody=GroupWire.parse(GroupWire.decode64(foreign.bodyBase64,GroupWire.MAX_OPERATION)).put("operation_id",ownId)
        altered.put("operation",foreign.copy(bodyBase64=GroupWire.encode64(GroupWire.canonical(foreignBody))).json())
        record.put("proof",signedProof.copy(bodyBase64=GroupWire.encode64(GroupWire.canonical(altered))).json())
        file.writeText(corrupted.toString())
        val repo=dev.manadj.library.LibraryRepository(root,"http://unused.invalid")
        assertFalse(repo.rawSessionAllowed(sid)); assertNull(repo.groupHistory.snapshot().knownUuids)
        assertTrue(repo.groupHistory.snapshot().items.isEmpty())
        assertFalse(dev.manadj.library.LibraryRepository(root,"http://unused.invalid").rawSessionAllowed(sid))
        // Even a valid supplier signature cannot make an aliased inner operation cover an
        // unrelated valid own row; identity, exact bytes and raw hash must all agree.
        val resigned=GroupWire.sign(altered,ByteArray(32) { it.toByte() })
        record.put("proof",resigned.json()).put("sha256",GroupWire.sha256(GroupWire.decode64(GroupSigned.parse(altered.getJSONObject("operation")).bodyBase64,GroupWire.MAX_OPERATION)))
        corrupted.put("possessions",JSONObject().put("$a:$ownId",record))
        file.writeText(corrupted.toString())
        assertFalse(repo.rawSessionAllowed(sid)); assertNull(repo.groupHistory.snapshot().knownUuids)
        assertTrue(repo.groupHistory.snapshot().items.isEmpty())
        file.writeText(original)
        assertEquals(setOf(sid),repo.groupHistory.snapshot().knownUuids)
    }

    @Test fun acknowledgedGroupUnavailableBeforeFirstProjectionStaysDeniedWithOrWithoutSibling() = kotlinx.coroutines.runBlocking {
        for(sibling in listOf(false,true)) {
            val caseRoot=File(root,if(sibling) "with-sibling" else "sole")
            val groupRoot=File(caseRoot,"device-groups/$gid")
            val replica=GroupReplica.provision(groupRoot,gid,p,ByteArray(32) { (it+32).toByte() })
            replica.pinMember(a,GroupWire.publicKey(ByteArray(32) { it.toByte() }),"Laptop A")
            val delivery=GroupWire.sign(JSONObject().put("format",GroupWire.FORMAT).put("group_id",gid).put("kind","deliver")
                .put("origin_device_id",a).put("recipient_device_id",p).put("operation",operation.json()),ByteArray(32) { it.toByte() })
            replica.receiveDelivery(delivery)
            if(sibling) {
                val other="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
                GroupReplica.provision(File(caseRoot,"device-groups/$other"),other,p,ByteArray(32) { (it+32).toByte() })
            }
            val repo=dev.manadj.library.LibraryRepository(caseRoot,"http://unused.invalid")
            assertFalse(File(caseRoot,"group-history/authority.json").exists())
            assertFalse(repo.rawSessionAllowed(sid))
            val retained=File(caseRoot,"retained-generated-group")
            assertTrue(groupRoot.renameTo(retained))
            assertFalse(repo.rawSessionAllowed(sid)); assertFalse(dev.manadj.library.LibraryRepository(caseRoot,repo.baseUrl).rawSessionAllowed(sid))
            assertTrue(repo.rawSessionAllowed("77777777-7777-4777-8777-777777777777")) // unrelated legacy authority unaffected
            val cache=File(caseRoot,"legacy/sessions/$sid.json").apply { parentFile.mkdirs();writeText("""{"uuid":"$sid","events":[{"t":0,"kind":"load","channel":"A","trackId":1}]}""") }
            val raw=dev.manadj.library.session.SessionStore(cache.parentFile.parentFile,{dev.manadj.library.SyncClient(repo.baseUrl)},uuidAllowed={repo.rawSessionAllowed(it)})
            assertFails { raw.log(dev.manadj.library.session.SessionHeader(sid,null,"ended",0)) }
            assertTrue(groupRoot.let { retained.renameTo(it) })
            assertEquals("unbound",repo.groupHistory.project().items.single().status)
            assertFalse(repo.rawSessionAllowed(sid)); assertTrue(cache.isFile)
            val inventory=File(caseRoot,"group-authority/inventory.json")
            val saved=File(caseRoot,"retained-generated-inventory.json")
            assertTrue(inventory.renameTo(saved)) // missing anchor is unknown, never an empty registry
            assertFalse(repo.rawSessionAllowed(sid)); assertNull(repo.groupHistory.snapshot().knownUuids)
            assertFails { replica.receiveDelivery(delivery) }
            assertTrue(saved.renameTo(inventory))
            replica.receiveDelivery(delivery)
            assertFalse(repo.rawSessionAllowed(sid)); assertEquals(1,replica.evidence().size)
        }
    }

    @Test fun outsideAuthoritySurvivesMetadataCommitFailureAndRetryWithoutProjection() {
        val groupRoot=File(root,"device-groups/$gid")
        val replica=GroupReplica.provision(groupRoot,gid,p,ByteArray(32) { (it+32).toByte() })
        replica.pinMember(a,GroupWire.publicKey(ByteArray(32) { it.toByte() }),"Laptop A")
        val message=GroupWire.sign(JSONObject().put("format",GroupWire.FORMAT).put("group_id",gid).put("kind","deliver")
            .put("origin_device_id",a).put("recipient_device_id",p).put("operation",operation.json()),ByteArray(32) { it.toByte() })
        Files.setPosixFilePermissions(groupRoot.toPath(),java.nio.file.attribute.PosixFilePermissions.fromString("r-x------"))
        try {
            org.junit.jupiter.api.Assumptions.assumeTrue(!Files.isWritable(groupRoot.toPath()))
            assertFailsWith<java.io.IOException> { replica.receiveDelivery(message) }
        } finally { Files.setPosixFilePermissions(groupRoot.toPath(),java.nio.file.attribute.PosixFilePermissions.fromString("rwx------")) }
        assertTrue(replica.evidence().isEmpty())
        val repo=dev.manadj.library.LibraryRepository(root,"http://unused.invalid")
        assertFalse(repo.rawSessionAllowed(sid)); assertTrue(repo.groupHistory.snapshot().items.isEmpty())
        assertFalse(dev.manadj.library.LibraryRepository(root,repo.baseUrl).rawSessionAllowed(sid))
        replica.receiveDelivery(message)
        assertEquals(1,replica.evidence().size)
        assertEquals("unbound",repo.groupHistory.project().items.single().status)
    }
}
