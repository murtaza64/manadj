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
        val frames = 44_100 * 8
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
