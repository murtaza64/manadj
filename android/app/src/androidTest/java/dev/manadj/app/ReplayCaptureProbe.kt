package dev.manadj.app

import android.os.ParcelFileDescriptor
import androidx.test.platform.app.InstrumentationRegistry
import dev.manadj.app.session.ReplayDriver
import dev.manadj.audio.AudioCommand
import dev.manadj.audio.AudioEngine
import dev.manadj.audio.DeckId
import dev.manadj.audio.LoadState
import dev.manadj.library.session.SessionLog
import java.io.DataOutputStream
import java.io.File
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * #378 S5 diagnostic: replays a real Session window through the real engine + [ReplayDriver] (offline, paced
 * at real time) with only one deck audible, and writes the mono output for host-side alignment analysis.
 * Inputs pushed by the host to /data/local/tmp/s5/ (session.json, <trackId>.<ext>); skipped when absent.
 * Args: from, to (Session seconds), decks (e.g. "0,1,3"), keylock (1/0).
 */
class ReplayCaptureProbe {
    private val dir = File("/data/local/tmp/s5")

    private class Offline(val engine: AudioEngine, val tracks: Map<Int, File>, val solo: Int, val keyLock: Boolean) : ReplayDriver.Engine {
        val held = arrayOfNulls<Int>(4)
        override val sampleRate get() = engine.snapshot().outputSampleRate
        override fun outputFrames() = engine.snapshot().outputFrames
        private fun map(c: AudioCommand) = if (c is AudioCommand.SetFader) c.copy(value = if (c.deck.ordinal == solo) 1.0 else 0.0) else c
        override fun schedule(frame: Long, commands: List<AudioCommand>, tag: Long) = engine.schedule(frame, commands.map(::map), tag).all { it.accepted }
        override fun cancel(tag: Long) { engine.cancelScheduled(tag) }
        override fun submit(command: AudioCommand) { engine.submit(map(command)) }
        override fun holds(deck: Int): Int? = held[deck]?.takeIf { engine.snapshot().decks.getValue(DeckId.entries[deck]).loadState == LoadState.READY }
        override fun startLoad(deck: Int, trackId: Int) {
            ParcelFileDescriptor.open(tracks.getValue(trackId), ParcelFileDescriptor.MODE_READ_ONLY).use { engine.load(DeckId.entries[deck], "t$trackId", it) }
            engine.submit(AudioCommand.SetKeyLock(DeckId.entries[deck], keyLock))
            held[deck] = trackId
        }
        override fun load(deck: Int, trackId: Int): ReplayDriver.Load {
            val d = engine.snapshot().decks.getValue(DeckId.entries[deck])
            return when {
                d.sourceId != "t$trackId" || d.loadState == LoadState.LOADING -> ReplayDriver.Load.Pending
                d.loadState == LoadState.ERROR -> ReplayDriver.Load.Failed(d.error ?: "error")
                d.fullyDecoded -> ReplayDriver.Load.Ready
                else -> ReplayDriver.Load.Partial(d.decodedSeconds)
            }
        }
    }

    @Test fun capture() {
        val sessionFile = File(dir, "session.json")
        assumeTrue("no inputs in $dir", sessionFile.exists())
        val args = InstrumentationRegistry.getArguments()
        val from = args.getString("from")!!.toDouble()
        val to = args.getString("to")!!.toDouble()
        val decks = args.getString("decks", "0").split(",").map { it.trim().toInt() }
        val keyLock = args.getString("keylock", "1") == "1"
        val log = SessionLog.parse(sessionFile.readText())
        val tracks = HashMap<Int, File>()
        for (f in dir.listFiles()!!) { val id = f.nameWithoutExtension.toIntOrNull() ?: continue; tracks[id] = f }
        val out = InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null)!!
        for (solo in decks) {
            val engine = AudioEngine(offline = true)
            try {
                val host = Offline(engine, tracks, solo, keyLock)
                DeckId.entries.forEach { engine.submit(AudioCommand.SetKeyLock(it, keyLock)) }
                val driver = ReplayDriver(log, host, onNotice = { android.util.Log.i("ReplayCaptureProbe", "notice: $it") })
                driver.prepare(from)
                val file = File(out, "capture-$solo.f32")
                DataOutputStream(file.outputStream().buffered()).use { o ->
                    var started = false
                    val wall0 = System.nanoTime()
                    var rendered = 0L
                    while (true) {
                        val now = driver.tick(System.nanoTime() / 1e9)
                        if (!driver.playing && !driver.preparing) break
                        val frames0 = engine.snapshot().outputFrames
                        val chunk = engine.renderOfflineForTest(256)
                        rendered += 256
                        // Real-time pacing (decode progress as on the phone).
                        val ahead = rendered / 48000.0 - (System.nanoTime() - wall0) / 1e9
                        if (ahead > 0) Thread.sleep((ahead * 1000).toLong())
                        val e = driver.epoch ?: continue
                        if (now == null) continue
                        if (!started) {
                            started = true
                            // Header: Session time of the first captured frame, sample rate.
                            o.writeDouble(e.timeAt(frames0)); o.writeInt(48000)
                        }
                        for (i in 0 until chunk.size / 2) o.writeFloat((chunk[2 * i] + chunk[2 * i + 1]) / 2)
                        if (e.timeAt(frames0) >= to) break
                    }
                }
                android.util.Log.i("ReplayCaptureProbe", "deck $solo -> $file lateOps=${engine.snapshot().lateOps}")
                driver.stop()
            } finally { engine.close() }
        }
    }
}
