package dev.manadj.app.session

import dev.manadj.audio.AudioCommand
import dev.manadj.library.LibraryRepository
import dev.manadj.library.SyncClient
import dev.manadj.library.SyncException
import dev.manadj.library.session.PeerReplay
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.Closeable
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files

/** Opt-in real independent desktop A -> B -> paired HTTP -> Kotlin repository -> native render.
 * Set MANADJ_PEER_FIXTURE_RECEIPT and MANADJ_NATIVE_REPLAY_BRIDGE (see peer_android_fixture.py).
 * Does not claim Android MediaCodec/JNI/Oboe or installed-device sound. */
class PeerSessionNativeChainTest {
    @Test fun resolvedReceiverBytesReplaySeekResumeRetryAndRefuseMissingOrReboundAssets() = runBlocking {
        val receipt = System.getenv("MANADJ_PEER_FIXTURE_RECEIPT")?.let(::File)
        val binary = System.getenv("MANADJ_NATIVE_REPLAY_BRIDGE")?.let(::File)
        assumeTrue("Requires disposable paired backend and native bridge",receipt?.isFile == true && binary?.isFile == true)
        val setup = JSONObject(receipt!!.readText())
        assertEquals(listOf("partial_chunks","unresolved_references","not_materialized","ready"),
            setup.getJSONArray("states").let { a -> (0 until a.length()).map(a::getString) })
        assertEquals(1,setup.getInt("source_track")); assertEquals(9,setup.getInt("receiver_track"))
        val root = Files.createTempDirectory("android443-native-chain-").toFile()
        val repo = LibraryRepository(root,setup.getString("url"),setup.getString("pair_code"))
        try {
            val rows = repo.peerSessions.refresh()
            val row = rows.single { it.uuid == setup.getString("session_uuid") }
            val replay = repo.peerSessions.open(row)
            assertEquals(setOf(9),replay.tracks.keys)
            assertFalse(replay.log.appearances.any { it.trackId == 1 })
            val file = repo.peerSessions.audio(replay,9)
            assertTrue(file.length()>44)
            val retry = repo.peerSessions.audio(replay,9)
            assertEquals(file,retry)
            Bridge(binary!!.absolutePath,replay,file).use { engine ->
                val driver = ReplayDriver(replay.log,engine)
                fun run(start: Double): Pair<Int,Double> {
                    driver.prepare(start)
                    var checks=0;var worst=0.0
                    repeat(250) {
                        driver.tick(engine.outputFrames()/48000.0);engine.render(200)
                        val epoch=driver.epoch ?: return@repeat
                        val at=epoch.timeAt(engine.outputFrames())
                        if(at<=start+.01 || at>1.6 || !driver.exact(0,engine.frames)) return@repeat
                        val want=replay.log.replayAt(at).decks[0]
                        if(!want.sounding) return@repeat
                        val error=kotlin.math.abs(engine.position-want.playhead)*48000
                        worst=maxOf(worst,error);checks++
                        assertTrue("receiver9 vs reference at=$at errorSamples=$error",error<=1.01)
                    }
                    return checks to worst
                }
                val first=run(0.0)
                driver.stop();engine.render(200)
                // Actual fresh paired validation on resume/seek; never raw-ID cache authority.
                assertEquals(replay.generation,repo.peerSessions.open(row).generation)
                val resumed=run(.4)
                assertTrue(first.first>50 && resumed.first>50)
                assertTrue("native exact WAV PCM must sound",engine.energy>1)
                assertEquals(0L,engine.late)
                driver.stop();engine.render(200)
                post(setup,"missing")
                try { repo.peerSessions.open(row);fail("missing desktop asset must refuse cached-ready resume") } catch(e: SyncException) { assertEquals(409,e.status) }
                try { repo.peerSessions.audio(replay,9);fail("cached audio cannot bypass missing desktop source") } catch(e: SyncException) { assertEquals(409,e.status) }
                assertTrue("exact cached bytes remain inspectable, not authority",file.isFile)
                post(setup,"rebind")
                try { repo.peerSessions.open(row);fail("same-ID/same-bytes new incarnation must refuse old generation") } catch(e: SyncException) { assertEquals(409,e.status) }
                val next=repo.peerSessions.open(repo.peerSessions.refresh().single { it.uuid==row.uuid })
                assertNotEquals(replay.generation,next.generation)
                println("peer443 native chain source1->receiver9; initial=$first seekResume=$resumed energy=${engine.energy} late=${engine.late}; retry/missing/rebound guards PASS")
            }
        } finally { root.deleteRecursively() }
    }

    private fun post(setup: JSONObject,path: String) {
        val c=URL(setup.getString("url")+"/fixture/$path").openConnection() as HttpURLConnection
        c.requestMethod="POST";c.setRequestProperty("X-Manadj-Pair",setup.getString("pair_code"))
        try { assertEquals(200,c.responseCode); c.inputStream.close() } finally { c.disconnect() }
    }
    private class Bridge(binary: String,private val replay: PeerReplay,private val file: File): ReplayDriver.Engine,Closeable {
        private val process=ProcessBuilder(binary).redirectError(ProcessBuilder.Redirect.INHERIT).start()
        private val reader=process.inputStream.bufferedReader();private val writer=process.outputStream.bufferedWriter()
        private var state=DoubleArray(8)
        private val held=arrayOfNulls<Int>(4)
        val frames get()=state[1].toLong()
        val late get()=state[2].toLong()
        val energy get()=state[3]
        val position get()=state[4]
        override val sampleRate=48000
        private fun send(line: String) {
            writer.write(line);writer.newLine();writer.flush()
            val result=reader.readLine() ?: error("Native bridge exited ${process.waitFor()}")
            state=result.split(' ').map(String::toDouble).toDoubleArray();check(state[0]==1.0) { "$line -> $result" }
        }
        override fun outputFrames(): Long {send("clock");return frames}
        fun render(n: Int)=send("render $n")
        override fun holds(deck: Int)=held[deck]
        override fun startLoad(deck: Int,trackId: Int) {
            check(trackId in replay.tracks);send("wav $deck $trackId \"${file.absolutePath}\"");held[deck]=trackId
        }
        override fun load(deck: Int,trackId: Int)=ReplayDriver.Load.Ready
        override fun cancel(tag: Long)=send("cancel $tag")
        override fun submit(command: AudioCommand)=op(0,0,command)
        override fun schedule(frame: Long,commands: List<AudioCommand>,tag: Long): Boolean {commands.forEach {op(frame,tag,it)};return true}
        private fun op(frame: Long,tag: Long,c: AudioCommand) {
            val d=c.deck?.ordinal ?: 0
            val op=when(c) {
                is AudioCommand.Play -> "play $d 0 0 0"
                is AudioCommand.Pause -> "pause $d 0 0 0"
                is AudioCommand.SetLoopRegion -> "locate $d ${c.start ?: -1.0} ${c.end} ${c.playhead ?: Double.NaN}"
                is AudioCommand.SetPitch -> "pitch $d ${c.percent} 0 0"
                is AudioCommand.SetBend -> "bend $d ${c.percent} 0 0"
                is AudioCommand.SetFader -> "fader $d ${c.value} 0 0"
                is AudioCommand.SetEq -> "eq $d ${c.value} ${c.band} 0"
                is AudioCommand.SetFilter -> "filter $d ${c.position} 0 0"
                is AudioCommand.SetBeatFx -> {check(!c.on);"fx-off 0 0 0 0"}
                else -> error("Unsupported native chain fixture op $c")
            }
            send("op $frame $tag $op")
        }
        override fun close() {writer.close();assertEquals(0,process.waitFor())}
    }
}
