package dev.manadj.app.session

import dev.manadj.library.LibraryRepository
import dev.manadj.library.group.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import kotlin.math.abs

/** Real transported GROUP evidence + exact local WAVs through the existing driver/native Engine.
 * No Android MediaCodec/JNI/Oboe/installed lifecycle or physical output claim. */
class GroupSessionNativeChainTest {
    @Test fun exactLocalGroupReplaysSeekResumeAndMatchesIndependentLiteralNativePcm() {
        val phone=System.getenv("MANADJ_GROUP_REPLAY_PHONE_DIR")?.let(::File)
        val binary=System.getenv("MANADJ_NATIVE_REPLAY_BRIDGE")?.let(::File)
        assumeTrue("Requires NEW transported generated phone store and native bridge",phone?.isDirectory == true && binary?.isFile == true)
        val root=Files.createTempDirectory("generated-group-native-proof-").toFile()
        try {
            // Clone a generated proof store; never mutate the retained transport sandbox.
            phone!!.copyRecursively(File(root,"phone"),overwrite=false)
            val repo=LibraryRepository(File(root,"phone"),"http://127.0.0.1:1")
            val view=repo.groupHistory.snapshot().items.single { it.operationId == "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }
            val adapter=repo.groupReplay()
            // Copying creates NEW physical snapshot/file incarnations. Copied bindings must
            // refuse, then this generated control explicitly selects its own local files.
            assertEquals("stale-selection",adapter.readiness(view).state)
            adapter.bind(view,"dddddddd-dddd-4ddd-8ddd-dddddddddddd",adapter.selections.select(509))
            adapter.bind(view,"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",adapter.selections.select(510))
            val ready=adapter.readiness(view); assertEquals("candidate-exact",ready.state); assertFalse(ready.playable)
            val source=adapter.open(view,requireNotNull(ready.generation))
            val a=source.tracks.values.single { it.logicalId == "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }.track.id
            val b=source.tracks.values.single { it.logicalId == "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }.track.id
            val attempts=source.tracks.keys.associateWith { adapter.audio(source,it) }
            assertEquals(2,attempts.values.map { it.attemptId }.toSet().size)
            val actual=File(root,"actual.f32"); val expected=File(root,"reference.f32")
            var compared=0; var worstPosition=0.0
            NativeReplayBridge(binary!!.absolutePath,attempts.mapValues { it.value.file }) { id -> adapter.validateLoad(attempts.getValue(id)) }.use { engine ->
                val driver=ReplayDriver(source.log,engine)
                driver.prepare(0.0)
                driver.tick(engine.outputFrames()/48000.0)
                assertTrue(driver.playing)
                val epoch=requireNotNull(driver.epoch)
                attempts.values.forEach(adapter::validateLoad) // actual native WAV decode succeeded
                NativeReplayBridge(binary.absolutePath,attempts.mapValues { it.value.file }).use { reference ->
                    reference.startLoad(0,a);reference.startLoad(1,b)
                    assertEquals(engine.frames,reference.frames)
                    val f=epoch.frame0
                    reference.send("op $f 1 fx-off 0 0 0 0")
                    for(d in 0..1) {
                        reference.send("op $f 1 fader $d 1 0 0")
                        for(band in 0..2) reference.send("op $f 1 eq $d 0.5 $band 0")
                        reference.send("op $f 1 filter $d 0 0 0")
                        reference.send("op $f 1 pitch $d 0 0 0")
                        reference.send("op $f 1 bend $d 0 0 0")
                    }
                    reference.send("op $f 1 locate 0 -1 -1 0")
                    reference.send("op $f 1 play 0 0 0 0")
                    reference.send("op $f 1 pause 1 0 0 0")
                    reference.send("op $f 1 locate 1 -1 -1 0")
                    // Independent literal capture recipe: B starts at0.5; A/B pause at1.5/1.75.
                    reference.send("op ${f+24000} 1 locate 1 -1 -1 0")
                    reference.send("op ${f+24000} 1 play 1 0 0 0")
                    reference.send("op ${f+72000} 1 pause 0 0 0 0")
                    reference.send("op ${f+72000} 1 locate 0 -1 -1 1.5")
                    reference.send("op ${f+84000} 1 pause 1 0 0 0")
                    reference.send("op ${f+84000} 1 locate 1 -1 -1 1.25")
                    engine.send("capture \"${actual.absolutePath}\"")
                    reference.send("capture \"${expected.absolutePath}\"")
                    repeat(460) {
                        adapter.validateAuthority(source)
                        driver.tick(engine.outputFrames()/48000.0)
                        engine.render(200);reference.render(200)
                        val t=epoch.timeAt(engine.frames)
                        if(t in .02..1.49) for(d in 0..1) {
                            val want=source.log.replayAt(t).decks[d]
                            if(want.sounding && driver.exact(d,engine.frames)) {
                                val error=abs(engine.position(d)-want.playhead)*48000
                                worstPosition=maxOf(worstPosition,error);compared++
                                assertTrue("deck$d t=$t errorSamples=$error",error<=1.01)
                            }
                        }
                    }
                    assertEquals(0L,engine.late);assertTrue(engine.energy>1)
                }
                driver.stop();engine.render(200)
                adapter.validate(source)
                driver.prepare(.75)
                repeat(120) { adapter.validateAuthority(source);driver.tick(engine.outputFrames()/48000.0);engine.render(200) }
                assertTrue(driver.playing)
                driver.stop()
            }
            // Driver stream contains later seek/resume too; compare the first independent epoch.
            val lhs=ByteBuffer.wrap(actual.readBytes()).order(ByteOrder.nativeOrder()).asFloatBuffer()
            val rhs=ByteBuffer.wrap(expected.readBytes()).order(ByteOrder.nativeOrder()).asFloatBuffer()
            val samples=rhs.remaining();assertEquals(184000,samples)
            var worst=0.0
            repeat(samples) { worst=maxOf(worst,abs(lhs.get().toDouble()-rhs.get().toDouble())) }
            assertTrue("native PCM differs from independent literal recipe: max=$worst",worst<=0.000002)
            assertTrue(compared>100)
            println("group456 native PCM samples=$samples maxError=$worst positionChecks=$compared maxSamples=$worstPosition; existing ReplayDriver/Engine seek/resume PASS")
        } finally { root.deleteRecursively() }
    }
}
