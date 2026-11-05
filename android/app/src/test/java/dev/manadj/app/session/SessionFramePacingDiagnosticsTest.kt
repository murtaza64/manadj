package dev.manadj.app.session

import android.os.Looper
import android.content.ComponentName
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.compose.runtime.MutableState
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.manadj.app.*
import dev.manadj.app.library.LibraryHolder
import dev.manadj.library.LibraryRepository
import dev.manadj.library.session.*
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.LooperMode
import java.io.Closeable
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.security.MessageDigest
import kotlin.math.ceil

/** #484 actual SessionScreen/ReplayDeckStack/Timeline/painter; host CPU/cadence, NOT phone FrameTimeline. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w800dp-h600dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
class SessionFramePacingDiagnosticsTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun actualSessionScreenFrameCostsAndPresentedCadenceAtTwoAndFourDecks() {
        SessionFrameHarness(compose).use { scene ->
            for (decks in listOf(2, 4)) {
                val result = scene.profile(SessionFrameFixture(decks))
                result.report("normal")
                assertTrue("source clock must advance", result.frames.last().displayTime > result.frames.first().displayTime + 1)
                assertTrue("actual deck raster must update rather than stick", result.longestDuplicateRun <= 4)
            }
        }
    }

    @Test fun frozenUpdateCounterfactualTripsTheSamePresentationCadenceSignal() {
        SessionFrameHarness(compose).use { scene ->
            val result = scene.profile(SessionFrameFixture(2), frozenUpdates = true)
            result.report("frozen-input-control")
            assertTrue("red-capable control: a stalled input produces a visibly held actual waveform", result.longestDuplicateRun >= 12)
        }
    }
}

internal data class SessionFrameFixture(
    val decks: Int,
    val pausedFirst: Boolean = false,
    val pausedTickNoise: Double = 0.0,
    val pausedSeeks: List<Pair<Double, Double>> = emptyList(),
    val pastRaster: Boolean = false,
    val compactEvidence: Boolean = false,
)

internal data class SessionPresentedFrame(
    val updateMs: Double, val drawMs: Double, val rasterHash: Long,
    val captureTime: Double, val displayTime: Double, val renderedSource: Double, val replaySource: Double,
    val otherReplaySource: Double, val rasterShiftPx: Int, val rasterMismatch: Double,
)

internal data class SessionFrameProfile(val fixture: SessionFrameFixture, val frames: List<SessionPresentedFrame>, val width: Int, val height: Int, val inputHash: String) {
    val longestDuplicateRun: Int get() {
        var run = 0; var longest = 0; var previous: Long? = null
        for (frame in frames) {
            run = if (previous == frame.rasterHash) run + 1 else 0
            longest = maxOf(longest, run); previous = frame.rasterHash
        }
        return longest
    }
    fun report(name: String) {
        fun percentile(xs: List<Double>, p: Double) = xs.sorted()[ceil(xs.size * p).toInt().coerceAtLeast(1) - 1]
        println("FRAME-DIAG name=$name decks=${fixture.decks} paused=${fixture.pausedFirst} tickNoise=${fixture.pausedTickNoise} frames=${frames.size} view=${width}x$height inputSHA=$inputHash testDisplayStepMs=16 sourceUpdateStepMs=32 detailWindowSec=8 timelineWindowSec=40 follow=true updateHostMs.p50=${percentile(frames.map { it.updateMs }, .5)} updateHostMs.p95=${percentile(frames.map { it.updateMs }, .95)} drawHostMs.p50=${percentile(frames.map { it.drawMs }, .5)} drawHostMs.p95=${percentile(frames.map { it.drawMs }, .95)} drawsOver16.67ms=${frames.count { it.drawMs > 16.67 }} longestDuplicateRun=$longestDuplicateRun rawSourceRange=${frames.maxOf { it.renderedSource } - frames.minOf { it.renderedSource }} replaySourceRange=${frames.maxOf { it.replaySource } - frames.minOf { it.replaySource }} otherSourceRange=${frames.maxOf { it.otherReplaySource } - frames.minOf { it.otherReplaySource }} rasterShifts=${frames.map { it.rasterShiftPx }.distinct()} rasterMismatchMax=${frames.maxOf { it.rasterMismatch }} hostOnly=true")
    }
}

/** Shared generated scene for render/frame-cadence checks. No engine, media, persisted user Session or UI install. */
internal class SessionFrameHarness(private val compose: AndroidComposeTestRule<*, ComponentActivity>) : Closeable {
    private val app = RuntimeEnvironment.getApplication()
    private val server = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
    private val serving = Thread({ while (!server.isClosed) try { server.accept().use { socket ->
        socket.soTimeout = 3000
        val input = socket.getInputStream().bufferedReader()
        val path = input.readLine().split(' ')[1]
        while (!input.readLine().isNullOrEmpty()) {}
        val text = if (path.endsWith("/peer-sessions")) """{"version":1,"items":[]}""" else "[]"
        val bytes = text.toByteArray()
        socket.getOutputStream().apply {
            write("HTTP/1.1 200 Fixture\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
            write(bytes); flush()
        }
    } } catch (e: java.io.IOException) { if (!server.isClosed) throw e } }, "generated-session-frame-authority").apply { isDaemon = true; start() }
    private val repo = LibraryRepository(File(app.cacheDir, "generated-frame-library"), "http://127.0.0.1:${server.localPort}")
    private val player: PlayerModel
    private val ux: UiModel
    private val model: SessionModel
    private val moveClock = SessionModel::class.java.getDeclaredMethod("moveClock", Double::class.javaPrimitiveType).apply { isAccessible = true }
    private val timeNanos = SessionModel::class.java.getDeclaredField("timeNanos").apply { isAccessible = true }
    private var contentSet = false

    init {
        compose.mainClock.autoAdvance = false
        runBlocking { repo.peerSessions.refresh() }
        LibraryHolder::class.java.getDeclaredField("instance").apply { isAccessible = true }.set(null, repo)
        // An unstarted service supplies a real binder, but never opens an engine/output in this renderer benchmark.
        val silentService = PlaybackService()
        shadowOf(app).setComponentNameAndServiceForBindService(ComponentName(app, PlaybackService::class.java), silentService.onBind(Intent()))
        val provider = ViewModelProvider(compose.activity, ViewModelProvider.AndroidViewModelFactory(app))
        player = provider[PlayerModel::class.java]
        ux = provider[UiModel::class.java]
        model = provider[SessionModel::class.java]
    }

    @Suppress("UNCHECKED_CAST") private fun playing(value: Boolean) {
        val state = SessionModel::class.java.getDeclaredField("playing\$delegate").apply { isAccessible = true }.get(model) as MutableState<Boolean>
        state.value = value
    }

    private fun generatedLog(config: SessionFrameFixture): Pair<SessionLog, String> {
        val rows = mutableListOf<JSONObject>()
        fun event(t: Double, kind: String, d: Int? = null) = JSONObject().put("t", t).put("kind", kind).apply {
            if (d != null) put("channel", DECKS[d])
        }
        repeat(config.decks) { d ->
            rows += event(0.0, "load", d).put("trackId", 7 + d).put("bpm", 174)
            rows += event(0.0, "transport", d).put("action", "play").put("playhead", 0)
            if (d == 0 && config.pausedFirst) rows += event(10.0, "transport", d).put("action", "pause").put("playhead", 10)
        }
        val tickIndices = if (config.compactEvidence) (1200..1202) else (1 until 2400)
        for (n in tickIndices) {
            val t = n / 2.0
            val heads = JSONObject()
            repeat(config.decks) { d ->
                if (d != 0 || !config.pausedFirst || t < 10) heads.put(DECKS[d], t)
                else if (config.pausedTickNoise != 0.0) heads.put(DECKS[d], 10 + (if (n % 2 == 0) -1 else 1) * config.pausedTickNoise)
            }
            rows += event(t, "tick").put("playheads", heads)
            if (!config.compactEvidence && n % 4 == 0) repeat(config.decks) { d ->
                if (!(d == 0 && config.pausedFirst && t >= 10))
                    rows += event(t, "control", d).put("control", "eqLow").put("value", if (n % 8 == 0) .5 else .3)
            }
        }
        for ((t, source) in config.pausedSeeks) rows += event(t, "transport", 0).put("action", "seek").put("playhead", source)
        rows += event(1200.0, "tick").put("playheads", JSONObject())
        val text = JSONObject().put("uuid", "generated-frame-${config.decks}-${config.pausedFirst}-${config.pausedTickNoise}")
            .put("events", JSONArray(rows.sortedBy { it.getDouble("t") })).toString()
        return SessionLog.parse(text) to MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    fun profile(config: SessionFrameFixture, frozenUpdates: Boolean = false): SessionFrameProfile {
        val (log, inputHash) = generatedLog(config)
        compose.runOnUiThread { playing(false) }
        runBlocking { model.show(SessionHeader(log.uuid, null, "2026-01-01T00:20:00Z", 0), log) }
        compose.runOnUiThread {
            repeat(config.decks) { d ->
                val frames = 120000
                val bands = ByteArray(frames * 8) { i -> (40 + ((i / 8) * 17 + (i % 8) * 29 + d * 11) % 180).toByte() }
                val wave = WaveformData(48000, 1200.0, 480, 480, 480, ByteArray(frames) { 100 }, bands, frames)
                model.waves[7 + d] = TimelineWave(wave, 1f)
            }
            moveClock.invoke(model, 600.0)
            timeNanos.setLong(model, compose.mainClock.currentTime * 1_000_000)
            model.setView(568.0, 40.0); model.follow = true
            playing(true)
        }
        if (!contentSet) { compose.setContent { SessionScreen(player, ux, Modifier.fillMaxSize()) }; contentSet = true }
        compose.waitForIdle()
        val view = compose.activity.window.decorView
        val bitmap = android.graphics.Bitmap.createBitmap(view.width, view.height, android.graphics.Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(bitmap)
        val origin = compose.mainClock.currentTime
        val out = mutableListOf<SessionPresentedFrame>()
        var rasterReference: IntArray? = null
        repeat(144) { i ->
            val updateStarted = System.nanoTime()
            compose.runOnUiThread {
                if (!frozenUpdates && i % 2 == 0) {
                    moveClock.invoke(model, 600.0 + (compose.mainClock.currentTime - origin) / 1000.0)
                    timeNanos.setLong(model, compose.mainClock.currentTime * 1_000_000)
                }
            }
            compose.mainClock.advanceTimeByFrame()
            compose.waitForIdle()
            shadowOf(Looper.getMainLooper()).idle()
            val updateMs = (System.nanoTime() - updateStarted) / 1e6
            val bounds = compose.onNodeWithTag("session-deck-A").fetchSemanticsNode().boundsInWindow
            var drawMs = 0.0
            compose.runOnUiThread {
                bitmap.eraseColor(android.graphics.Color.TRANSPARENT)
                val before = System.nanoTime()
                view.draw(canvas)
                drawMs = (System.nanoTime() - before) / 1e6
            }
            var hash = 1125899906842597L
            val left = (bounds.left + bounds.width * (if (config.pastRaster) .10f else .45f)).toInt()
            val right = (bounds.left + bounds.width * (if (config.pastRaster) .25f else .80f)).toInt()
            val top = if (config.pastRaster) (bounds.top + (bounds.height - 12) / 2 + 4).toInt() else bounds.top.toInt() + 5
            val bottom = if (config.pastRaster) (bounds.bottom - 16).toInt() else (bounds.top + (bounds.height - 12) / 2 - 2).toInt()
            for (y in top until bottom) for (x in left until right) hash = hash * 31 + bitmap.getPixel(x, y)
            if (i >= 24) {
                val rendered = log.at(model.time).decks[0].playheadAt(model.displayTime)
                var bestShift = 0
                var mismatch = 0.0
                if (config.pastRaster) {
                    val width = right - left; val height = bottom - top
                    val pixels = IntArray(width * height)
                    bitmap.getPixels(pixels, 0, width, left, top, width, height)
                    val previous = rasterReference
                    if (previous == null) rasterReference = pixels else {
                        var best = Int.MAX_VALUE
                        for (shift in -8..8) {
                            var errors = 0
                            for (y in 0 until height) for (x in 8 until width - 8)
                                if (pixels[y * width + x] != previous[y * width + x + shift]) errors++
                            if (errors < best) { best = errors; bestShift = shift }
                        }
                        mismatch = best.toDouble() / (height * (width - 16))
                    }
                }
                val reference = log.replayAt(model.displayTime)
                out += SessionPresentedFrame(updateMs, drawMs, hash, model.time, model.displayTime,
                    rendered, reference.decks[0].playhead, reference.decks[1].playhead, bestShift, mismatch)
            }
        }
        bitmap.recycle()
        return SessionFrameProfile(config, out, view.width, view.height, inputHash)
    }

    override fun close() {
        compose.runOnUiThread { playing(false); model.close(); model.viewModelScope.cancel(); player.viewModelScope.cancel(); ux.viewModelScope.cancel() }
        server.close(); serving.join(3000)
        LibraryHolder::class.java.getDeclaredField("instance").apply { isAccessible = true }.set(null, null)
    }
}
