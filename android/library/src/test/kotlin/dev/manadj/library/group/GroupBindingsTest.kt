package dev.manadj.library.group

import dev.manadj.library.LibraryStore
import dev.manadj.library.SnapshotJson
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import kotlin.test.*

class GroupBindingsTest {
    private val root = Files.createTempDirectory("generated-group-binding-").toFile()
    private val store = LibraryStore(root)
    private val row = JSONObject("""{"id":73,"title":"Generated tone","file_name":"tone.wav","audio_rev":"generated-v1","tag_ids":[],"hot_cues":[]}""")
    private val snapshot = JSONObject("""{"version":1,"tag_categories":[],"tags":[],"links":[],"transitions":[],"cameos":[],"takes":[],"settings":{}}""")
        .put("tracks", JSONArray().put(row)).toString()
    private fun audio(): File = requireNotNull(store.audioFile(SnapshotJson.track(row)))
    @AfterTest fun cleanup() { root.deleteRecursively() }

    @Test fun explicitSelectionSurvivesRestartButIdenticalSnapshotRewriteInvalidatesIt() {
        store.writeSnapshotText(snapshot)
        audio().apply { parentFile.mkdirs(); writeBytes(byteArrayOf(1,2,3,4)) }
        val selected = GroupBindings(root).select(73)
        assertEquals("73",selected.receiverKey)
        assertEquals(selected,GroupBindings(root).current(selected.selectionId))
        store.writeSnapshotText(snapshot)
        assertFails { GroupBindings(root).current(selected.selectionId) }
        assertTrue(File(root,"group-replay/selections.json").isFile)
        assertContentEquals(byteArrayOf(1,2,3,4),audio().readBytes())
    }
    @Test fun sameBytesReplacementAndInPlaceChangeNeverReuseAnOldSelection() {
        store.writeSnapshotText(snapshot)
        audio().apply { parentFile.mkdirs(); writeBytes(byteArrayOf(1,2,3,4)) }
        val old=GroupBindings(root).select(73)
        val retained=File(root,"retained-generated-audio")
        assertTrue(audio().renameTo(retained))
        audio().writeBytes(retained.readBytes())
        assertFails { GroupBindings(root).current(old.selectionId) }
        val next=GroupBindings(root).select(73)
        assertNotEquals(old.incarnation,next.incarnation)
        audio().writeBytes(byteArrayOf(4,3,2,1))
        assertFails { GroupBindings(root).current(next.selectionId) }
        assertTrue(retained.isFile)
    }
    @Test fun missingFileAndFailedSelectionCommitNeverProduceUsableAuthority() {
        store.writeSnapshotText(snapshot)
        assertFails { GroupBindings(root).select(73) }
        audio().apply { parentFile.mkdirs(); writeBytes(byteArrayOf(1,2,3,4)) }
        val blocked=File(root,"group-replay/selections.json").apply { mkdirs() }
        assertTrue(blocked.isDirectory)
        assertFails { GroupBindings(root).select(73) }
        assertTrue(blocked.isDirectory)
        assertContentEquals(byteArrayOf(1,2,3,4),audio().readBytes())
    }
    @Test fun missingPartialAndChangedAssetsReportTruthfulRefusalStates() {
        store.writeSnapshotText(snapshot)
        audio().apply { parentFile.mkdirs();writeBytes(byteArrayOf(1,2,3,4)) }
        val selected=GroupBindings(root).select(73)
        audio().writeBytes(byteArrayOf(1,2))
        assertEquals("partial",assertFailsWith<GroupSelectionException> { GroupBindings(root).current(selected.selectionId) }.state)
        audio().writeBytes(byteArrayOf(4,3,2,1))
        assertEquals("changed",assertFailsWith<GroupSelectionException> { GroupBindings(root).current(selected.selectionId) }.state)
        assertTrue(audio().delete()) // generated decoy only
        assertEquals("missing",assertFailsWith<GroupSelectionException> { GroupBindings(root).current(selected.selectionId) }.state)
    }
    @Test fun copyingCurrentFileFactsIntoOldRecordCannotRestoreAnOldIncarnation() = corruptMutableFacts("file")
    @Test fun copyingCurrentSnapshotFactsIntoOldRecordCannotRestoreAnOldIncarnation() = corruptMutableFacts("snapshot")
    private fun corruptMutableFacts(field: String) {
        store.writeSnapshotText(snapshot)
        audio().apply { parentFile.mkdirs();writeBytes(byteArrayOf(1,2,3,4)) }
        val bindings=GroupBindings(root);val old=bindings.select(73)
        if(field == "file") {
            val retained=File(root,"retained-generated-old-file")
            assertTrue(audio().renameTo(retained));audio().writeBytes(retained.readBytes())
        } else store.writeSnapshotText(snapshot)
        assertFails { bindings.current(old.selectionId) }
        val next=bindings.select(73)
        val file=File(root,"group-replay/selections.json");val records=JSONObject(file.readText())
        val oldRecord=records.getJSONObject(old.selectionId)
        oldRecord.put(field,records.getJSONObject(next.selectionId).getString(field))
        assertEquals(old.json().toString(),oldRecord.getJSONObject("selection").toString())
        file.writeText(records.toString()) // generated corruption; embedded old grant untouched
        assertFails { GroupBindings(root).current(old.selectionId) }
        assertEquals(next,GroupBindings(root).current(next.selectionId))
    }
}
