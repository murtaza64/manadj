package dev.manadj.app

import android.net.Uri
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import dev.manadj.audio.*
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import kotlin.math.sin

class RealPlaybackTest {
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var model: PlayerModel
    private val files = mutableListOf<File>()

    @Before fun openRealApp() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { model = ViewModelProvider(it)[PlayerModel::class.java] }
        await("native output opens") { model.output?.outputSampleRate?.let { it > 0 } == true }
        assertEquals(0, model.output!!.outputError)
    }

    @After fun stopAndRemoveDecoys() {
        if (::model.isInitialized) {
            onMain { DeckId.entries.forEach { model.submit(AudioCommand.Pause(it)) } }
            await("all decks stopped") { model.output?.decks?.values?.none { it.playing || it.previewing } == true }
        }
        if (::scenario.isInitialized) scenario.close()
        files.forEach { it.delete() }
    }

    private fun onMain(action: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(action)
    private fun await(description: String, condition: () -> Boolean) {
        val deadline = System.nanoTime() + 30_000_000_000L
        var delay = 10L
        while (System.nanoTime() < deadline) {
            var passed = false
            onMain { passed = condition() }
            if (passed) return
            Thread.sleep(delay)
            delay = (delay * 2).coerceAtMost(200)
        }
        fail("Timed out: $description; app error=${model.failure}")
    }

    private fun tone(hz: Double): File {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = File(context.cacheDir, "native-app-test-${UUID.randomUUID()}.wav")
        files.add(file)
        val frames = 44_100 * 40 // outlasts the layout sweeps (more layouts than when this was 8 s)
        val dataBytes = frames * 2
        val buffer = ByteBuffer.allocate(44 + dataBytes).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put("RIFF".toByteArray()).putInt(36 + dataBytes).put("WAVEfmt ".toByteArray()).putInt(16)
        buffer.putShort(1).putShort(1).putInt(44_100).putInt(88_200).putShort(2).putShort(16)
        buffer.put("data".toByteArray()).putInt(dataBytes)
        repeat(frames) { frame -> buffer.putShort((sin(frame * hz * 2 * Math.PI / 44_100) * 4096).toInt().toShort()) }
        file.writeBytes(buffer.array())
        return file
    }

    private fun load(deck: DeckId, file: File) {
        onMain { model.requestImport(deck, Uri.fromFile(file)) }
        await("$deck decoded and ready") { model.decks.getValue(deck).ready }
    }

    @Test fun twoRealTracksKeepTheirAudioClockAcrossEveryLayout() {
        load(DeckId.A, tone(220.0)); load(DeckId.B, tone(330.0))
        onMain { DeckId.entries.take(2).forEach { model.updateFader(it, 0.0); model.submit(AudioCommand.Play(it)) } } // Silent on the test host.
        await("A/B output advances") { model.output!!.decks.values.filter { it.playing }.size == 2 && model.decks.getValue(DeckId.A).snapshot!!.sourceFrame > 1000 }
        val epoch = model.output!!.epoch
        for (layout in Layout.entries) {
            val before = model.output!!.outputFrames
            onMain { model.chooseLayout(layout) }
            await("layout $layout preserves output") { model.layout == layout && model.output!!.outputFrames > before }
            assertEquals(epoch, model.output!!.epoch)
            assertTrue(model.decks.getValue(DeckId.A).snapshot!!.playing)
            assertTrue(model.decks.getValue(DeckId.B).snapshot!!.playing)
        }
    }

    /** #399: quantized launches (Grid and Heard) reference the other playing deck without Sync (desktop parity). */
    @Test fun quantizedLaunchReferencesThePlayingDeckWithoutSync() {
        load(DeckId.A, tone(220.0)); load(DeckId.B, tone(330.0))
        for (mode in listOf(QuantizeMode.GRID, QuantizeMode.HEARD)) for (bBpm in listOf(120.0, 126.0)) {
            onMain {
                DeckId.entries.take(2).forEach { model.updateFader(it, 0.0); model.submit(AudioCommand.Pause(it)) }
                model.setGrid(DeckId.A, 120.0, 0.0); model.setGrid(DeckId.B, bBpm, 0.0)
                model.setQuantizeMode(mode); model.setHeardLatency(.2)
                model.submit(AudioCommand.Seek(DeckId.A, .1)); model.submit(AudioCommand.Seek(DeckId.B, 2.0))
            }
            await("$mode: decks parked") { model.output!!.decks.getValue(DeckId.B).let { !it.playing && it.sourceSeconds == 2.0 } && model.output!!.quantizeMode == mode }
            onMain { model.submit(AudioCommand.Play(DeckId.A)) }
            await("$mode: A playing") { model.output!!.decks.getValue(DeckId.A).let { it.playing && it.sourceSeconds > .5 } }
            onMain { DeckId.entries.forEach { if (model.syncState.decks[it] != SyncStatus.OFF) model.toggleSync(it) } }
            assertTrue("no sync", model.syncState.decks.values.all { it == SyncStatus.OFF })
            val before = model.engineSnapshot()!!.decks.getValue(DeckId.B)
            var launched: DeckSnapshot? = null
            onMain { model.submit(AudioCommand.Play(DeckId.B)) }
            await("$mode $bBpm: B play applied") { model.output!!.decks.getValue(DeckId.B).playing.also { if (it) launched = model.output!!.decks.getValue(DeckId.B) } }
            Thread.sleep(800)
            android.util.Log.i("manadj-399", "$mode B bpm $bBpm: before ${before.sourceSeconds} launched $launched")
            // Quantized: B waits for A's beat (launchFrame) or enters ahead of 2.0 — never a plain start at 2.0.
            assertTrue("$mode $bBpm not quantized: $launched", launched!!.launchFrame != null || launched!!.sourceSeconds > 2.0 + 2048.0 / 44100)
        }
    }

    /** #399: SYNC is remembered per deck across app restarts; a remembered deck rejoins once ready with a BPM. */
    @Test fun syncIsRememberedAcrossRestarts() {
        fun restart() {
            scenario.close()
            scenario = ActivityScenario.launch(MainActivity::class.java)
            scenario.onActivity { model = ViewModelProvider(it)[PlayerModel::class.java] }
            await("native output opens") { model.output?.outputSampleRate?.let { it > 0 } == true }
        }
        // The app's own deck restore may still replace A right after launch: re-load until A keeps our source + grid.
        fun loadWithGrid(hz: Double) {
            Thread.sleep(1500)
            val before = model.output!!.decks.getValue(DeckId.A).sourceId
            onMain { model.requestImport(DeckId.A, Uri.fromFile(tone(hz))) }
            await("A replaced and ready") { model.output!!.decks.getValue(DeckId.A).let { it.sourceId != before && it.loadState == LoadState.READY } }
            onMain { model.setGrid(DeckId.A, 120.0, 0.0) }
            await("A has a BPM") { model.output!!.decks.getValue(DeckId.A).bpm == 120.0 }
            Thread.sleep(500)
            assertEquals(120.0, model.output!!.decks.getValue(DeckId.A).bpm)
        }
        for (on in listOf(true, false, true)) {
            loadWithGrid(220.0)
            var result: Any? = "untoggled"
            onMain { if ((model.syncState.decks[DeckId.A] != SyncStatus.OFF) != on) result = model.toggleSync(DeckId.A) }
            assertEquals("on=$on toggle=$result ${model.syncState}", on, model.syncState.decks[DeckId.A] != SyncStatus.OFF)
            restart()
            loadWithGrid(221.0)
            if (on) await("sync on remembered") { model.syncState.decks[DeckId.A] != SyncStatus.OFF }
            else { Thread.sleep(500); assertEquals("sync off remembered", SyncStatus.OFF, model.syncState.decks[DeckId.A]) }
        }
    }

    /** Repro attempt for the unexplained emulator deck-A stop: set + trigger a hot cue while playing, switch layouts. */
    @Test fun hotCueJumpWhilePlayingKeepsPlayingAcrossLayouts() {
        load(DeckId.A, tone(220.0)); load(DeckId.B, tone(330.0))
        onMain { DeckId.entries.take(2).forEach { model.updateFader(it, 0.0); model.submit(AudioCommand.Play(it)) } }
        await("A past 1 s") { model.decks.getValue(DeckId.A).snapshot!!.sourceSeconds > 1.0 }
        onMain { model.submit(AudioCommand.SetHotCue(DeckId.A, 0)) }
        await("hot cue stored") { model.decks.getValue(DeckId.A).hotCues[0] != null }
        Thread.sleep(1500)
        onMain { model.submit(AudioCommand.HotCueDown(DeckId.A, 0, "t")); model.submit(AudioCommand.HotCueUp(DeckId.A, 0, "t")) }
        for (layout in Layout.entries + Layout.entries) { onMain { model.chooseLayout(layout) }; Thread.sleep(700) }
        val a = model.output!!.decks.getValue(DeckId.A)
        assertTrue("A stopped: $a failure=${model.failure}", a.playing)
        assertTrue(model.output!!.decks.getValue(DeckId.B).playing)
    }

    @Test fun libraryLoadCarriesMetadataAndGrid() {
        val file = tone(330.0)
        onMain { model.load(DeckId.B, file, "library:42:1", "Library title", "Artist", 8.0, bpm = 126.0, firstBeatSeconds = .25, mainCueSeconds = 1.5, hotCues = mapOf(3 to 4.0)) }
        await("library track ready with grid") {
            val ui = model.decks.getValue(DeckId.B)
            ui.ready && ui.snapshot?.sourceId == "library:42:1" && ui.snapshot?.bpm == 126.0 && ui.snapshot?.gridAnchorSeconds == .25
        }
        assertEquals("Library title", model.decks.getValue(DeckId.B).source?.title)
        await("parked at the stored main cue") { model.decks.getValue(DeckId.B).snapshot?.let { it.cueSeconds == 1.5 && it.sourceSeconds in 1.49..1.51 && it.hotCues[3] == 4.0 } == true }
        assertTrue(model.sources.none { it.id == "library:42:1" }) // not added to the local-file list
    }

    @Test fun id3TempoTagsParse() {
        fun tag(version: Int, bpm: String): ByteArray {
            val text = byteArrayOf(0) + bpm.toByteArray(Charsets.ISO_8859_1)
            val size = text.size
            val frame = "TBPM".toByteArray() + (if (version == 4) byteArrayOf(0, 0, 0, size.toByte()) else byteArrayOf(0, 0, 0, size.toByte())) + byteArrayOf(0, 0) + text
            val header = "ID3".toByteArray() + byteArrayOf(version.toByte(), 0, 0, 0, 0, 0, frame.size.toByte())
            return header + frame + ByteArray(64)
        }
        assertEquals(128.0, id3Bpm(tag(3, "128").inputStream())!!, 0.0)
        assertEquals(124.5, id3Bpm(tag(4, "124.5").inputStream())!!, 0.0)
        assertNull(id3Bpm("RIFF....WAVE".toByteArray().inputStream()))
    }

    @Test fun beatJumpAndLoopThroughTheModel() {
        load(DeckId.A, tone(220.0))
        onMain { model.setGrid(DeckId.A, 120.0, 0.0); model.submit(AudioCommand.Seek(DeckId.A, 2.0)) }
        await("grid applied") { model.decks.getValue(DeckId.A).snapshot?.bpm == 120.0 && model.decks.getValue(DeckId.A).ready }
        onMain { model.decks.getValue(DeckId.A).jumpBeats = 4.0; model.jump(DeckId.A, 1) }
        await("jumped 2 s") { (model.decks.getValue(DeckId.A).snapshot?.sourceSeconds ?: 0.0) in 3.99..4.01 }
        onMain { model.toggleLoop(DeckId.A) }
        await("loop engaged") { model.decks.getValue(DeckId.A).snapshot?.loop?.beats == 4.0 }
        onMain { model.resizeLoop(DeckId.A, LoopChange.HALVE) }
        await("loop halved") { model.decks.getValue(DeckId.A).snapshot?.loop?.beats == 2.0 }
    }

    @Test fun replacementGenerationAndFailuresRemainVisible() {
        val first = tone(180.0)
        val second = tone(420.0)
        onMain { model.requestImport(DeckId.A, Uri.fromFile(first)); model.requestImport(DeckId.A, Uri.fromFile(second)) }
        await("latest file wins") { model.decks.getValue(DeckId.A).ready && model.decks.getValue(DeckId.A).source?.uri == Uri.fromFile(second) }
        val source = model.decks.getValue(DeckId.A).snapshot!!.sourceId
        onMain { model.requestImport(DeckId.A, Uri.parse("content://invalid.manadj.test/missing")) }
        await("invalid URI error is visible") { model.decks.getValue(DeckId.A).error != null }
        assertEquals(source, model.decks.getValue(DeckId.A).snapshot!!.sourceId)
    }

    @Test fun acceptedMixerChangesAreObservedByTheNativeCallback() {
        load(DeckId.A, tone(220.0))
        onMain { model.updateFader(DeckId.A, .4); model.updateTrim(DeckId.A, .6); model.updateCrossfade(.2); model.updatePitch(DeckId.A, 4.0) }
        val last = model.lastReceipt!!
        assertTrue(last.accepted)
        await("mixer command applied") { model.output!!.appliedCommandId >= last.id }
        assertEquals(.4, model.output!!.decks.getValue(DeckId.A).fader, .0001)
        assertEquals(.6, model.output!!.decks.getValue(DeckId.A).trim, .0001)
        assertEquals(4.0, model.output!!.decks.getValue(DeckId.A).pitchPercent, .0001)
        assertEquals(-.6, model.output!!.crossfade, .0001) // Fader throw .2 => engine -1..1.
        onMain { model.updateBend(DeckId.A, 2.0); model.cancelGestures(); model.updateBend(DeckId.A, 0.0) }
        assertEquals(0.0, model.decks.getValue(DeckId.A).bend, 0.0)
    }
}
