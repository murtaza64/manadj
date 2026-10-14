package dev.manadj.audio

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.sin
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Generated decoy media only; files are deleted after each test. */
@RunWith(AndroidJUnit4::class)
class AudioEngineTest {
    private val files = mutableListOf<File>()
    private val cache get() = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir

    @After fun removeDecoys() { files.forEach { it.delete() } }

    private fun wav(name: String, value: Double, seconds: Int = 5, rate: Int = 48000, bits: Int = 16): File {
        val file = File(cache, name).also { files.add(it) }
        val bytes = bits / 8
        val frames = rate * seconds
        val size = frames * 2 * bytes
        val b = ByteBuffer.allocate(44 + size).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()).putInt(36 + size).put("WAVEfmt ".toByteArray()).putInt(16)
        b.putShort(1).putShort(2).putInt(rate).putInt(rate * 2 * bytes).putShort((2 * bytes).toShort()).putShort(bits.toShort())
        b.put("data".toByteArray()).putInt(size)
        val full = (1 shl (bits - 1)) - 1
        val v = (value * full).toInt()
        repeat(frames * 2) {
            if (bits == 16) b.putShort(v.toShort()) else { b.put(v.toByte()); b.put((v shr 8).toByte()); b.put((v shr 16).toByte()) }
        }
        file.writeBytes(b.array())
        return file
    }

    /** AAC-in-MP4 decoy produced by the platform encoder: exercises the MediaCodec path. */
    private fun m4a(name: String, hz: Double, seconds: Int): File {
        val file = File(cache, name).also { files.add(it) }
        val rate = 44100
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, rate, 2).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
        }
        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        encoder.start()
        val muxer = MediaMuxer(file.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val info = MediaCodec.BufferInfo()
        val total = rate * seconds
        var frame = 0
        var track = -1
        var done = false
        while (!done) {
            val input = encoder.dequeueInputBuffer(10_000)
            if (input >= 0) {
                val buffer = encoder.getInputBuffer(input)!!.order(ByteOrder.LITTLE_ENDIAN)
                buffer.clear()
                if (frame >= total) encoder.queueInputBuffer(input, 0, 0, frame * 1_000_000L / rate, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                else {
                    val n = minOf(buffer.capacity() / 4, total - frame, 1024)
                    repeat(n) { i -> val s = (sin((frame + i) * hz * 2 * PI / rate) * 8000).toInt().toShort(); buffer.putShort(s).putShort(s) }
                    encoder.queueInputBuffer(input, 0, n * 4, frame * 1_000_000L / rate, 0)
                    frame += n
                }
            }
            val output = encoder.dequeueOutputBuffer(info, 10_000)
            if (output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) { track = muxer.addTrack(encoder.outputFormat); muxer.start() }
            else if (output >= 0) {
                if ((info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && info.size > 0) muxer.writeSampleData(track, encoder.getOutputBuffer(output)!!, info)
                encoder.releaseOutputBuffer(output, false)
                done = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
            }
        }
        encoder.stop(); encoder.release(); muxer.stop(); muxer.release()
        return file
    }

    private fun AudioEngine.load(deck: DeckId, id: String, file: File) =
        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { load(deck, id, it) }

    private fun AudioEngine.deck(deck: DeckId) = snapshot().decks.getValue(deck)

    /** Drives the offline callback until [condition] holds. */
    private fun AudioEngine.until(what: String, condition: AudioEngine.() -> Boolean) {
        repeat(3000) {
            if (condition()) return
            renderOfflineForTest(256)
            Thread.sleep(2)
        }
        fail("Timed out: $what; ${snapshot().decks}")
    }

    private fun AudioEngine.settled(vararg decks: DeckId) = until("settled ${decks.toList()}") {
        decks.all { deck(it).let { d -> d.loadState == LoadState.READY && !d.filling } }
    }

    @Test fun decodedLocalWavMixSeekAndDesktopCueSemantics() {
        val a = wav("engine-a.wav", .25)
        val b = wav("engine-b.wav", -.25)
        AudioEngine(offline = true).use { engine ->
            assertTrue(engine.load(DeckId.A, "generated-a", a).accepted)
            assertTrue(engine.load(DeckId.B, "generated-b", b).accepted)
            engine.settled(DeckId.A, DeckId.B)
            engine.until("decoded") { deck(DeckId.A).fullyDecoded && deck(DeckId.B).fullyDecoded }
            assertEquals("generated-a", engine.deck(DeckId.A).sourceId)
            assertEquals(48000, engine.deck(DeckId.A).sampleRate)
            assertEquals(5.0, engine.deck(DeckId.A).durationSeconds!!, .01)
            assertFalse(engine.snapshot().outputOpen)
            assertTrue(engine.submit(AudioCommand.Play(DeckId.A)).accepted)
            assertTrue(engine.submit(AudioCommand.Play(DeckId.B)).accepted)
            val both = engine.renderOfflineForTest(4096)
            assertEquals(0f, both[8190], .005f)
            assertTrue(engine.deck(DeckId.A).sourceFrame > 3000)

            val fade = engine.submit(AudioCommand.SetCrossfade(-1.0))
            engine.renderOfflineForTest(4096)
            val left = engine.renderOfflineForTest(512)
            assertEquals(.25f * Math.pow(10.0, -6.0 / 20.0).toFloat(), left[1022], .004f)
            assertTrue(engine.snapshot().appliedCommandId >= fade.id)
            assertEquals(-1.0, engine.snapshot().crossfade, 0.0)

            assertTrue(engine.submit(AudioCommand.Seek(DeckId.A, 2.0)).accepted)
            engine.until("seek applied") { deck(DeckId.A).sourceSeconds == 2.0 || deck(DeckId.A).sourceSeconds > 2.0 }
            engine.settled(DeckId.A)
            assertTrue(engine.deck(DeckId.A).playing)
            assertEquals(2.0, engine.deck(DeckId.A).sourceSeconds, .1)
            engine.submit(AudioCommand.CueDown(DeckId.A)) // Playing: return to cue (track start) and pause.
            engine.renderOfflineForTest(64)
            assertFalse(engine.deck(DeckId.A).playing)
            assertEquals(0.0, engine.deck(DeckId.A).sourceSeconds, 0.0)
            engine.submit(AudioCommand.CueUp(DeckId.A))
            engine.settled(DeckId.A)
            engine.submit(AudioCommand.Seek(DeckId.A, 1.0))
            engine.renderOfflineForTest(64)
            engine.settled(DeckId.A)
            engine.submit(AudioCommand.CueDown(DeckId.A)) // Paused off cue: move the cue here.
            engine.submit(AudioCommand.CueUp(DeckId.A))
            engine.renderOfflineForTest(64)
            assertEquals(1.0, engine.deck(DeckId.A).cueSeconds!!, .03)
            engine.submit(AudioCommand.CueDown(DeckId.A)) // At cue: hold preview.
            val preview = engine.renderOfflineForTest(512)
            assertTrue(preview[1022] > 0)
            assertEquals(AudioEngine.MAIN_CUE, engine.deck(DeckId.A).previewSlot)
            engine.submit(AudioCommand.CueUp(DeckId.A))
            engine.renderOfflineForTest(64)
            assertFalse(engine.deck(DeckId.A).previewing)
            assertEquals(engine.deck(DeckId.A).cueSeconds!!, engine.deck(DeckId.A).sourceSeconds, 0.0)
        }
    }

    @Test fun hotCueSetGateAndSeekPastEnd() {
        val a = wav("engine-hot.wav", .25, seconds = 3)
        AudioEngine(offline = true).use { engine ->
            engine.load(DeckId.A, "hot", a)
            engine.settled(DeckId.A)
            engine.until("decoded") { deck(DeckId.A).fullyDecoded } // offline renders outrun the streaming decoder
            engine.submit(AudioCommand.Seek(DeckId.A, 1.5))
            engine.renderOfflineForTest(64)
            engine.settled(DeckId.A)
            engine.submit(AudioCommand.SetHotCue(DeckId.A, 2))
            engine.renderOfflineForTest(64)
            assertEquals(1.5, engine.deck(DeckId.A).hotCues[2]!!, .01)
            engine.submit(AudioCommand.Seek(DeckId.A, 0.2))
            engine.renderOfflineForTest(64)
            engine.settled(DeckId.A)
            engine.submit(AudioCommand.HotCueDown(DeckId.A, 2, "g1"))
            engine.renderOfflineForTest(64)
            engine.settled(DeckId.A)
            assertEquals(2, engine.deck(DeckId.A).previewSlot)
            assertTrue(engine.renderOfflineForTest(512)[1022] > 0)
            engine.submit(AudioCommand.HotCueUp(DeckId.A, 2, "g1"))
            engine.renderOfflineForTest(64)
            assertFalse(engine.deck(DeckId.A).previewing)
            assertEquals(engine.deck(DeckId.A).hotCues[2]!!, engine.deck(DeckId.A).sourceSeconds, 0.0)

            engine.submit(AudioCommand.Seek(DeckId.A, 3.0))
            engine.submit(AudioCommand.Play(DeckId.A))
            engine.until("parked at end") { deck(DeckId.A).let { it.atEnd && !it.filling && !it.playing } }
            assertEquals(LoadState.READY, engine.deck(DeckId.A).loadState)
            assertNull(engine.deck(DeckId.A).error)
        }
    }

    @Test fun aacDecodesSeeksInPlaceAnd24BitWav() {
        val aac = m4a("engine-aac.m4a", 440.0, 4)
        val deep = wav("engine-24.wav", .5, seconds = 2, rate = 44100, bits = 24)
        AudioEngine(offline = true).use { engine ->
            engine.load(DeckId.A, "aac", aac)
            engine.load(DeckId.B, "deep", deep)
            engine.settled(DeckId.A, DeckId.B)
            // Offline renders outrun the streaming decoder; render from the in-memory track.
            engine.until("decoded") { deck(DeckId.A).fullyDecoded && deck(DeckId.B).fullyDecoded }
            assertEquals(44100, engine.deck(DeckId.A).sampleRate)
            engine.submit(AudioCommand.SetCrossfade(-1.0))
            engine.submit(AudioCommand.Play(DeckId.A))
            var peak = 0f
            repeat(8) { engine.renderOfflineForTest(1024).forEach { peak = maxOf(peak, it) } }
            assertTrue("AAC rendered silence", peak > .05f)
            for (target in listOf(3.0, 0.5, 2.25)) {
                engine.submit(AudioCommand.Seek(DeckId.A, target))
                engine.renderOfflineForTest(64)
                engine.settled(DeckId.A)
                assertEquals(target, engine.deck(DeckId.A).sourceSeconds, .05)
            }
            assertNull(engine.deck(DeckId.A).error)
            engine.submit(AudioCommand.Pause(DeckId.A))
            engine.submit(AudioCommand.SetCrossfade(1.0))
            engine.submit(AudioCommand.Play(DeckId.B))
            engine.renderOfflineForTest(2048)
            val out = engine.renderOfflineForTest(512)
            assertEquals(.5f * Math.pow(10.0, -6.0 / 20.0).toFloat(), out[1022], .01f)
        }
    }

    @Test fun oboeOpensAndRendersFramesOnDevice() {
        val media = wav("engine-oboe.wav", .25)
        AudioEngine().use { engine ->
            val started = engine.snapshot()
            assertTrue(started.outputOpen)
            assertEquals(2, started.outputChannels)
            assertTrue(started.outputSampleRate > 0)
            engine.load(DeckId.A, "sink-fixture", media)
            for (attempt in 0 until 200) {
                if (engine.deck(DeckId.A).let { it.loadState == LoadState.READY && !it.filling }) break
                Thread.sleep(10)
            }
            assertEquals(LoadState.READY, engine.deck(DeckId.A).loadState)
            assertTrue(engine.submit(AudioCommand.SetFader(DeckId.A, 0.0)).accepted) // Silent on the test host.
            assertTrue(engine.submit(AudioCommand.Play(DeckId.A)).accepted)
            Thread.sleep(50)
            val sourceAtStart = engine.deck(DeckId.A).sourceFrame
            Thread.sleep(250)
            val rendered = engine.snapshot()
            assertTrue("No native callbacks: $rendered", rendered.outputFrames > started.outputFrames)
            assertTrue("Decoded source not consumed by stream: $rendered", rendered.decks.getValue(DeckId.A).sourceFrame > sourceAtStart)
            assertEquals(0, rendered.outputError)
            assertTrue(rendered.outputXruns >= 0)
        }
    }

    @Test fun cueJumpsWithPreDecodedHeadsAreGapless() {
        for ((name, file) in listOf("wav" to wav("engine-gapless.wav", .25, seconds = 10), "aac" to m4a("engine-gapless.m4a", 440.0, 10))) {
            AudioEngine(offline = true).use { engine ->
                engine.load(DeckId.A, name, file)
                engine.settled(DeckId.A)
                engine.submit(AudioCommand.Seek(DeckId.A, 2.0)); engine.renderOfflineForTest(16); engine.settled(DeckId.A)
                engine.submit(AudioCommand.SetHotCue(DeckId.A, 4))
                engine.submit(AudioCommand.Seek(DeckId.A, 5.0)); engine.renderOfflineForTest(16); engine.settled(DeckId.A)
                engine.until("$name heads ready") { (deck(DeckId.A).readyHeads and (1 shl 4)) != 0 && (deck(DeckId.A).readyHeads and (1 shl 8)) != 0 }
                engine.submit(AudioCommand.Play(DeckId.A))
                engine.renderOfflineForTest(2048)
                engine.submit(AudioCommand.HotCueDown(DeckId.A, 4))
                val jump = engine.renderOfflineForTest(1024)
                assertEquals("$name used head", 4, engine.deck(DeckId.A).let { if (it.filling) -1 else 4 })
                // Silence = any 64-frame window with no energy (a refill gap is >=400 frames).
                for (w in 0 until 1024 / 64) {
                    var e = 0f
                    for (i in w * 64 until (w + 1) * 64) e += jump[i * 2] * jump[i * 2]
                    assertTrue("$name gap at window $w e=$e ${engine.deck(DeckId.A)}", e > 1e-4f)
                }
                assertEquals(2.0 + 1024 * (if (name == "wav") 48000 else 44100) / 48000.0 / (if (name == "wav") 48000 else 44100), engine.deck(DeckId.A).sourceSeconds, .002)
                // Move the main cue past the AAC encoder priming silence, wait for its head.
                engine.submit(AudioCommand.Pause(DeckId.A))
                engine.submit(AudioCommand.Seek(DeckId.A, 3.0)); engine.renderOfflineForTest(16); engine.settled(DeckId.A)
                engine.submit(AudioCommand.CueDown(DeckId.A)); engine.submit(AudioCommand.CueUp(DeckId.A)); engine.renderOfflineForTest(16)
                engine.until("$name cue head") { (deck(DeckId.A).readyHeads and (1 shl 8)) != 0 }
                engine.submit(AudioCommand.Play(DeckId.A)); engine.renderOfflineForTest(2048)
                engine.submit(AudioCommand.CueDown(DeckId.A)) // playing: back to main cue, paused
                engine.renderOfflineForTest(64)
                engine.deck(DeckId.A).let { assertTrue("$it", it.headSlot == AudioEngine.MAIN_CUE || it.fromMemory) }
                engine.submit(AudioCommand.CueDown(DeckId.A)) // at cue: preview from the cue head instantly
                val preview = engine.renderOfflineForTest(512)
                var e = 0f; for (i in 256 until 512) e += preview[i * 2] * preview[i * 2]
                assertTrue("$name cue preview silent e=$e ${engine.deck(DeckId.A)}", e > 1e-4f)
            }
        }
    }

    @Test fun pflCueBusAndRoutingModes() {
        val a = wav("engine-pfl-a.wav", .2)
        val b = wav("engine-pfl-b.wav", .1)
        AudioEngine(offline = true).use { engine ->
            engine.load(DeckId.A, "a", a); engine.load(DeckId.B, "b", b)
            engine.settled(DeckId.A, DeckId.B)
            engine.submit(AudioCommand.SetFader(DeckId.A, 0.0))
            engine.submit(AudioCommand.SetPfl(DeckId.A, true))
            engine.submit(AudioCommand.Play(DeckId.A)); engine.submit(AudioCommand.Play(DeckId.B))
            assertEquals(0, engine.configureOutput(Routing.QUAD))
            engine.renderOfflineForTest(4096, 4)
            val quad = engine.renderOfflineForTest(256, 4)
            val u = Math.pow(10.0, -6.0 / 20.0).toFloat()
            assertEquals(.1f * u, quad[255 * 4], .003f)     // master: B (A faded out)
            assertEquals(.2f * u, quad[255 * 4 + 2], .003f) // cue: A pre-fader
            assertTrue(engine.deck(DeckId.A).pfl)
            assertEquals(Routing.QUAD, engine.snapshot().routing)
            engine.configureOutput(Routing.SPLIT_MONO)
            val split = engine.renderOfflineForTest(256)
            assertEquals(.1f * u, split[510], .003f)
            assertEquals(.2f * u, split[511], .003f)
        }
    }

    @Test fun deviceOutputsEnumerateAndStereoRoutingReopens() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val am = context.getSystemService(android.media.AudioManager::class.java)
        val outputs = am.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS)
        android.util.Log.i("manadj-bench", "outputs: " + outputs.joinToString { "#${it.id} type=${it.type} ${it.productName} ch=${it.channelCounts.toList()} rates=${it.sampleRates.toList()}" })
        assertTrue(outputs.isNotEmpty())
        AudioEngine().use { engine ->
            val before = engine.snapshot().outputFrames
            assertEquals(0, engine.configureOutput(Routing.SPLIT_MONO, 0))
            Thread.sleep(200)
            val s = engine.snapshot()
            assertTrue(s.outputOpen); assertEquals(2, s.outputChannels); assertEquals(Routing.SPLIT_MONO, s.routing)
            assertTrue(s.outputFrames > before)
            android.util.Log.i("manadj-bench", "split-mono stream: ${engine.outputInfo()}")
        }
    }

    @Test fun eqFilterApplyAndRenderCostFitsTheCallback() {
        val tone = m4a("engine-cost.m4a", 440.0, 10)
        AudioEngine(offline = true).use { engine ->
            for (deck in DeckId.entries) engine.load(deck, "cost-$deck", tone)
            engine.settled(*DeckId.entries.toTypedArray())
            for (deck in DeckId.entries) {
                engine.submit(AudioCommand.SetEq(deck, 0, 0.0)); engine.submit(AudioCommand.SetEq(deck, 2, .8))
                engine.submit(AudioCommand.SetFilter(deck, if (deck.ordinal % 2 == 0) -.6 else .6))
                engine.submit(AudioCommand.Play(deck))
            }
            engine.renderOfflineForTest(512)
            val a = engine.deck(DeckId.A)
            assertEquals(0.0, a.eq[0], 1e-6); assertEquals(.8, a.eq[2], 1e-6); assertEquals(-.6, a.filter, 1e-6)
            // Phone callbacks are 96 frames every 2 ms; time the full 4-deck strip path (+JNI/alloc overhead).
            val n = 2000
            val t0 = System.nanoTime()
            repeat(n) { engine.renderOfflineForTest(96) }
            val perCallbackUs = (System.nanoTime() - t0) / 1000.0 / n
            android.util.Log.i("manadj-bench", "4 decks EQ+filter: %.1f us per 96-frame render (budget 2000 us)".format(perCallbackUs))
            assertTrue("render too slow: $perCallbackUs us", perCallbackUs < 1000)
        }
    }

    @Test fun beatFxSectionAppliesTailsRingAndCostFitsTheCallback() {
        val tone = m4a("engine-fx.m4a", 440.0, 10)
        AudioEngine(offline = true).use { engine ->
            assertTrue("beat-fx" in engine.snapshot().supportedCapabilities)
            assertEquals(BeatFx.DEFAULT, engine.snapshot().beatFx)
            for (deck in DeckId.entries) engine.load(deck, "fx-$deck", tone)
            engine.submit(AudioCommand.SetGrid(DeckId.A, 120.0, 0.0))
            engine.settled(*DeckId.entries.toTypedArray())
            engine.submit(AudioCommand.Play(DeckId.A))
            val echo = BeatFxState(BeatFxEffect.ECHO, BeatFxTarget.A, true, 0.0, .75)
            assertTrue(engine.submit(AudioCommand.SetBeatFx(echo)).accepted)
            repeat(9) { engine.renderOfflineForTest(4000); Thread.sleep(2) }
            val s = engine.snapshot()
            assertEquals(echo, s.beatFx)
            assertEquals(setOf(BeatFxTarget.A), s.beatFxAudible)
            // Pausing the deck leaves the echo tail ringing (3/4 beat = 375 ms repeats); without FX it is silent.
            engine.submit(AudioCommand.Pause(DeckId.A))
            engine.renderOfflineForTest(4800)
            var tail = 0f
            repeat(4) { engine.renderOfflineForTest(4800).forEach { tail = maxOf(tail, kotlin.math.abs(it)) } }
            assertTrue("no echo tail: $tail", tail > .01f)
            assertEquals(.75, BeatFx.step(.5, true), 0.0); assertEquals(.0625, BeatFx.step(.0625, false), 0.0)
            // Cost: 4 decks playing, echo then reverb on every insert (paddles A-D + MST target).
            for (deck in DeckId.entries) engine.submit(AudioCommand.Play(deck))
            for (effect in listOf(BeatFxEffect.ECHO, BeatFxEffect.REVERB, BeatFxEffect.ROLL)) {
                engine.submit(AudioCommand.SetBeatFx(effect, BeatFxTarget.MASTER, true, 0.0, .5, DeckId.entries.toSet()))
                engine.renderOfflineForTest(4096)
                assertEquals(BeatFxTarget.entries.toSet(), engine.snapshot().beatFxAudible)
                val n = 2000
                val t0 = System.nanoTime()
                repeat(n) { engine.renderOfflineForTest(96) }
                val perCallbackUs = (System.nanoTime() - t0) / 1000.0 / n
                android.util.Log.i("manadj-bench", "4 decks + $effect on 5 inserts: %.1f us per 96-frame render (budget 2000 us)".format(perCallbackUs))
                assertTrue("render too slow: $perCallbackUs us", perCallbackUs < 1000)
            }
        }
    }

    @Test fun wholeTrackInMemoryMakesBeatJumpsExactAndKeepsDecksInPhase() {
        val tone = m4a("engine-mem.m4a", 440.0, 30)
        AudioEngine(offline = true).use { engine ->
            for (deck in listOf(DeckId.A, DeckId.B)) {
                engine.load(deck, "mem-$deck", tone)
                engine.submit(AudioCommand.SetGrid(deck, 120.0, 0.0))
            }
            engine.settled(DeckId.A, DeckId.B)
            engine.until("fully decoded") { listOf(DeckId.A, DeckId.B).all { deck(it).fullyDecoded } }
            assertTrue(engine.deck(DeckId.A).decodedSeconds > 29.0)
            for (deck in listOf(DeckId.A, DeckId.B)) engine.submit(AudioCommand.Seek(deck, 20.0))
            engine.renderOfflineForTest(16)
            assertEquals(20.0, engine.deck(DeckId.A).sourceSeconds, 0.0) // no refill: exact and immediate
            assertFalse(engine.deck(DeckId.A).filling)
            for (deck in listOf(DeckId.A, DeckId.B)) engine.submit(AudioCommand.Play(deck))
            engine.renderOfflineForTest(1024)
            assertTrue(engine.deck(DeckId.A).fromMemory)
            var expected = 0.0
            for (beats in listOf(1.0, -4.0, 16.0, -16.0, .25, 4.0, -1.0)) {
                engine.submit(AudioCommand.BeatJump(DeckId.A, beats)); expected += beats
                var quiet = 0
                repeat(20) { engine.renderOfflineForTest(96).let { pcm -> for (i in 0 until 96) if (kotlin.math.abs(pcm[i * 2]) + kotlin.math.abs(pcm[i * 2 + 1]) < 1e-6f) quiet++ } }
                val s = engine.snapshot()
                val offset = (s.decks.getValue(DeckId.A).sourceSeconds - s.decks.getValue(DeckId.B).sourceSeconds) / .5
                assertEquals("phase after $beats", expected, offset, 1e-9)
                assertTrue("silent frames after jump $beats: $quiet", quiet < 4)
            }
            assertEquals(0L, engine.snapshot().starvedDeckFrames)
        }
    }

    @Test fun filterSettingsParseDesktopJsonAndApplyLive() {
        val desktop = """{"model":"dual","resonance":20,"compensation":1,"curve":1,"deadzone":0.08,"lpMin":40,"hpMax":16000,"spread":1.4,"drive":3,"trim":-2,"smoothing":30}"""
        val s = FilterSettings.fromJson(desktop)
        assertEquals(FilterModel.DUAL, s.model); assertEquals(1.4, s.spread, 0.0); assertEquals(-2.0, s.trim, 0.0)
        assertEquals(s, FilterSettings.fromJson(s.toJson()))
        assertEquals(FilterSettings(), FilterSettings.fromJson("not json"))
        assertEquals(24.0, FilterSettings(resonance = 99.0).sanitized().resonance, 0.0)
        val tone = wav("engine-filter.wav", .25, seconds = 5)
        AudioEngine(offline = true).use { engine ->
            // Values exported from desktop sweepResponseDb (FilterCases.inc): res48, resonance 12, lpMin 100, hpMax 8000, trim 2, position -0.6.
            val steep = FilterSettings(model = FilterModel.RES48, resonance = 12.0, lpMin = 100.0, hpMax = 8000.0, trim = 2.0)
            val db = engine.filterResponseDb(steep, -.6, doubleArrayOf(30.0, 200.0))
            assertEquals(-5.783165, db[0], .05); assertEquals(-5.749322, db[1], .05)
            assertEquals(0.0, engine.filterResponseDb(FilterSettings(), 0.0, doubleArrayOf(1000.0))[0], 1e-9)
            engine.load(DeckId.A, "filter", tone)
            engine.settled(DeckId.A)
            assertTrue(engine.submit(AudioCommand.SetFilterSettings(s)).accepted)
            assertTrue(engine.submit(AudioCommand.SetFilter(DeckId.A, -.5)).accepted)
            engine.submit(AudioCommand.Play(DeckId.A))
            engine.renderOfflineForTest(4096)
            assertEquals(s, engine.filterSettings)
            assertTrue("filter-settings" in engine.snapshot().supportedCapabilities)
        }
    }

    @Test fun keyLockKeepsPitchAcrossTempoAndFitsTheCallback() {
        val tone = m4a("engine-keylock.m4a", 440.0, 30) // 44.1 kHz source: exercises the rate-transpose path
        AudioEngine(offline = true).use { engine ->
            assertTrue("key-lock" in engine.snapshot().supportedCapabilities)
            engine.load(DeckId.A, "kl", tone)
            engine.settled(DeckId.A)
            engine.until("decoded") { deck(DeckId.A).fullyDecoded }
            engine.submit(AudioCommand.Seek(DeckId.A, 5.0))
            engine.submit(AudioCommand.SetPitch(DeckId.A, 8.0))
            fun pitch(lock: Boolean): Double {
                engine.submit(AudioCommand.SetKeyLock(DeckId.A, lock))
                engine.submit(AudioCommand.Play(DeckId.A))
                repeat(3) { engine.renderOfflineForTest(4000) }
                var crossings = 0
                var last = 0f
                repeat(12) { engine.renderOfflineForTest(4000).let { pcm -> for (i in 0 until 4000) { val v = pcm[i * 2]; if ((v < 0) != (last < 0)) crossings++; last = v } } }
                return crossings / 2.0 // 48000 frames = 1 s
            }
            val locked = pitch(true)
            assertTrue(engine.deck(DeckId.A).keyLock && engine.deck(DeckId.A).keyLockActive)
            assertEquals("locked pitch", 440.0, locked, 4.0)
            assertEquals("free pitch", 440.0 * 1.08, pitch(false), 4.0)
            // Cost: 4 key-locked decks (plus a key-locked relocation, which re-primes).
            engine.submit(AudioCommand.SetKeyLock(DeckId.A, true))
            for (deck in DeckId.entries.drop(1)) engine.load(deck, "kl-$deck", tone)
            engine.settled(*DeckId.entries.toTypedArray())
            engine.until("all decoded") { DeckId.entries.all { deck(it).fullyDecoded } }
            for (deck in DeckId.entries) { engine.submit(AudioCommand.SetKeyLock(deck, true)); engine.submit(AudioCommand.SetPitch(deck, 5.0)); engine.submit(AudioCommand.Play(deck)) }
            engine.renderOfflineForTest(4096)
            val times = LongArray(3000)
            repeat(3000) { i -> val t0 = System.nanoTime(); engine.renderOfflineForTest(96); times[i] = System.nanoTime() - t0 }
            times.sort()
            val t0 = System.nanoTime()
            engine.submit(AudioCommand.Seek(DeckId.A, 12.0)); engine.renderOfflineForTest(96)
            val prime = (System.nanoTime() - t0) / 1000.0
            android.util.Log.i("manadj-bench", "4 decks key-locked: p50 %.0f p99 %.0f max %.0f us per 96-frame render; relocation re-prime %.0f us".format(times[1500] / 1e3, times[2970] / 1e3, times.last() / 1e3, prime))
            assertTrue("render too slow p50 ${times[1500] / 1e3} us", times[1500] < 1_000_000)
        }
    }

    @Test fun scratchMovesThePlatterAndReleaseResumes() {
        val tone = wav("engine-scratch.wav", .25, seconds = 10)
        AudioEngine(offline = true).use { engine ->
            assertTrue("scratch" in engine.snapshot().supportedCapabilities)
            engine.load(DeckId.A, "s", tone)
            engine.settled(DeckId.A)
            engine.until("decoded") { deck(DeckId.A).fullyDecoded }
            engine.submit(AudioCommand.Seek(DeckId.A, 4.0)); engine.submit(AudioCommand.Play(DeckId.A))
            engine.renderOfflineForTest(960)
            engine.submit(AudioCommand.ScratchBegin(DeckId.A)); engine.renderOfflineForTest(96)
            val held = engine.deck(DeckId.A)
            assertTrue(held.scratching && !held.playing)
            repeat(30) { engine.submit(AudioCommand.ScratchMove(DeckId.A, -.01)); engine.renderOfflineForTest(96) }
            engine.renderOfflineForTest(4800)
            assertEquals(held.sourceSeconds - .3, engine.deck(DeckId.A).sourceSeconds, 2e-3)
            engine.submit(AudioCommand.ScratchEnd(DeckId.A)); engine.renderOfflineForTest(96)
            engine.deck(DeckId.A).let { assertTrue("$it", !it.scratching && it.playing) }
        }
    }

    @Test fun outputTimestampGivesASmoothAudiblePosition() {
        val media = wav("engine-clock.wav", .25, seconds = 10)
        AudioEngine().use { engine ->
            engine.load(DeckId.A, "clock", media)
            for (attempt in 0 until 300) { if (engine.deck(DeckId.A).let { it.loadState == LoadState.READY && !it.filling }) break; Thread.sleep(10) }
            engine.submit(AudioCommand.SetFader(DeckId.A, 0.0)) // Silent on the test host.
            engine.submit(AudioCommand.Play(DeckId.A))
            Thread.sleep(500)
            val s = engine.snapshot()
            assertNotNull(s.presentedFrame); assertNotNull(s.presentedNanos)
            val now = System.nanoTime()
            val audible = s.audibleSeconds(DeckId.A, now)
            val lag = s.decks.getValue(DeckId.A).sourceSeconds - audible
            android.util.Log.i("manadj-bench", "clock: render ${s.decks.getValue(DeckId.A).sourceSeconds} audible $audible lag ${lag * 1000} ms")
            assertTrue("audible lag $lag s", lag > -0.01 && lag < 0.3)
            // Monotonic across snapshots.
            // Monotonic across snapshots (emulator timestamps are coarse: 20 ms bursts).
            var last = audible
            var worst = 0.0
            repeat(40) {
                Thread.sleep(7)
                val next = engine.snapshot().audibleSeconds(DeckId.A)
                worst = maxOf(worst, last - next)
                last = next
            }
            android.util.Log.i("manadj-bench", "clock: worst backward step ${worst * 1000} ms over 40 snapshots")
            assertTrue("went backwards ${worst * 1000} ms", worst < 0.025)
        }
    }

    @Test fun loopsWrapGaplessFromTheLoopHeadAndBeatJumpsMoveThem() {
        val media = wav("engine-loop.wav", .25, seconds = 20)
        AudioEngine(offline = true).use { engine ->
            engine.load(DeckId.A, "loop", media)
            engine.submit(AudioCommand.SetGrid(DeckId.A, 120.0, 0.0))
            engine.settled(DeckId.A)
            engine.submit(AudioCommand.SetQuantize(true))
            engine.submit(AudioCommand.Seek(DeckId.A, 4.01)); engine.renderOfflineForTest(16); engine.settled(DeckId.A)
            engine.submit(AudioCommand.LoopPreset(DeckId.A, 0.5)) // 1/2 beat = 250 ms, snapped to 4.0
            engine.renderOfflineForTest(16)
            assertEquals(LoopRegion(4.0, 4.25, .5), engine.deck(DeckId.A).loop)
            engine.until("loop head") { (deck(DeckId.A).readyHeads and (1 shl 9)) != 0 }
            engine.submit(AudioCommand.Play(DeckId.A))
            var wraps = 0
            var last = 0.0
            repeat(120) { // 120 x 1024 frames = 2.56 s ≈ 10 wraps
                val pcm = engine.renderOfflineForTest(1024)
                for (w in 0 until 1024 / 64) {
                    var e = 0f
                    for (i in w * 64 until (w + 1) * 64) e += pcm[i * 2] * pcm[i * 2]
                    assertTrue("gap at render $it window $w: ${engine.deck(DeckId.A)}", e > 1e-4f)
                }
                val at = engine.deck(DeckId.A).sourceSeconds
                assertTrue("escaped the loop: $at", at >= 4.0 && at < 4.25 + 1e-3)
                if (at < last) wraps++
                last = at
                Thread.sleep(1)
            }
            assertTrue("wraps=$wraps", wraps >= 8)
            engine.submit(AudioCommand.BeatJump(DeckId.A, 4.0)) // +2 s: loop moves with the playhead
            engine.renderOfflineForTest(16)
            val moved = engine.deck(DeckId.A).loop!!
            assertEquals(6.0, moved.start, 1e-9); assertEquals(6.25, moved.end, 1e-9)
            engine.submit(AudioCommand.LoopToggle(DeckId.A))
            engine.renderOfflineForTest(16)
            assertNull(engine.deck(DeckId.A).loop)
        }
    }

    @Test fun manyRelocationsWhilePlayingNeverEndEarly() {
        val media = wav("engine-reloc.wav", .25, seconds = 20, rate = 44100)
        val rng = java.util.Random(7)
        AudioEngine(offline = true).use { engine ->
            engine.load(DeckId.A, "reloc", media)
            engine.settled(DeckId.A)
            engine.submit(AudioCommand.Play(DeckId.A))
            repeat(150) { i ->
                val target = rng.nextDouble() * 18
                if (i % 2 == 0) { engine.submit(AudioCommand.Seek(DeckId.A, target)); engine.renderOfflineForTest(16) }
                else { engine.submit(AudioCommand.SetHotCue(DeckId.A, 1)); engine.submit(AudioCommand.HotCueDown(DeckId.A, 1)); engine.submit(AudioCommand.HotCueUp(DeckId.A, 1)) }
                engine.renderOfflineForTest(16)
                engine.settled(DeckId.A)
                engine.renderOfflineForTest(rng.nextInt(4096) + 1)
                val d = engine.deck(DeckId.A)
                assertTrue("stopped after relocation $i to $target: $d", d.playing && !d.atEnd)
            }
        }
    }

    /** Physical-output baseline: logs negotiated Oboe config; hot-cue jumps while playing must keep playing. */
    @Test fun deviceOutputStatsAndJumpsKeepPlaying() {
        val media = wav("engine-bench.wav", .25, seconds = 30)
        AudioEngine().use { engine ->
            engine.load(DeckId.A, "bench", media)
            for (attempt in 0 until 300) { if (engine.deck(DeckId.A).let { it.loadState == LoadState.READY && !it.filling }) break; Thread.sleep(10) }
            engine.submit(AudioCommand.SetFader(DeckId.A, 0.0)) // Silent on the test host.
            engine.submit(AudioCommand.Seek(DeckId.A, 1.0))
            Thread.sleep(100)
            engine.submit(AudioCommand.SetHotCue(DeckId.A, 0))
            engine.submit(AudioCommand.Play(DeckId.A))
            Thread.sleep(200)
            val before = engine.snapshot()
            var gapped = 0
            var headed = 0
            repeat(20) { i ->
                Thread.sleep(150L + (i % 5) * 37)
                assertTrue("stopped before jump $i: ${engine.deck(DeckId.A)}", engine.deck(DeckId.A).playing)
                val t0 = System.nanoTime()
                engine.submit(AudioCommand.HotCueDown(DeckId.A, 0, "j$i"))
                engine.submit(AudioCommand.HotCueUp(DeckId.A, 0, "j$i"))
                var seen = false
                var head = false
                while (System.nanoTime() - t0 < 50_000_000L) {
                    val d = engine.deck(DeckId.A)
                    if (d.filling) seen = true
                    if (d.headSlot == 0) head = true
                    Thread.sleep(1)
                }
                if (seen) gapped++
                if (head) headed++
            }
            Thread.sleep(300)
            val after = engine.snapshot()
            val info = engine.outputInfo()
            android.util.Log.i("manadj-bench", "output: $info")
            android.util.Log.i("manadj-bench", "jumps: 20, from pre-decoded head $headed, with refill gap $gapped; starved=${after.starvedDeckFrames - before.starvedDeckFrames} xruns=${after.outputXruns}")
            assertTrue("deck stopped after jumps: ${after.decks.getValue(DeckId.A)}", after.decks.getValue(DeckId.A).playing)
            assertNotNull(info)
            assertTrue(info!!.framesPerBurst > 0)
        }
    }

    @Test fun replacementRetiresOldDecodeAndReportsUnsupportedAsError() {
        val a = wav("engine-replace-a.wav", .25)
        val b = wav("engine-replace-b.wav", -.25)
        val bad = File(cache, "unsupported.bin").also { files.add(it); it.writeBytes(byteArrayOf(1, 2, 3, 4, 5)) }
        AudioEngine(offline = true).use { engine ->
            engine.load(DeckId.A, "old", a)
            engine.load(DeckId.A, "new", b)
            engine.settled(DeckId.A)
            val current = engine.deck(DeckId.A)
            assertEquals("new", current.sourceId)
            assertNull(current.error)
            engine.submit(AudioCommand.Play(DeckId.A))
            val pcm = engine.renderOfflineForTest(4096)
            assertTrue(pcm[8190] < -.1f)
            engine.load(DeckId.A, "unsupported", bad)
            engine.until("unsupported errors") { deck(DeckId.A).loadState == LoadState.ERROR }
            val failed = engine.deck(DeckId.A)
            assertEquals("unsupported", failed.sourceId)
            assertNotNull(failed.error)
            assertFalse(failed.playing)
        }
    }
}
