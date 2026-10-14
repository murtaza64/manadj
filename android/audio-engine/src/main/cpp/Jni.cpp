#include "Engine.h"
#include <jni.h>
#include <oboe/Oboe.h>
#include <chrono>
#include <memory>
#include <mutex>
#include <vector>

namespace {
constexpr int kHeader = 29;
constexpr int kDeckFields = 40 + manadj::kHotCues;
constexpr int kSnapshotSize = kHeader + manadj::kDeckCount * kDeckFields;

/*
 * One output stream feeding one Engine. The engine (queue, rings, clocks)
 * outlives any stream: after a disconnect (route change, BT drop) Oboe closes
 * the stream and onErrorAfterClose opens a replacement on Oboe's error thread.
 * streamMutex_ is never taken on the audio callback.
 */
struct Output final : oboe::AudioStreamDataCallback, oboe::AudioStreamErrorCallback {
    manadj::Engine engine;
    std::mutex streamMutex;
    std::shared_ptr<oboe::AudioStream> stream;
    std::atomic<bool> closing{false};
    std::atomic<int> lastError{0};
    std::atomic<int> reopenCount{0};
    std::atomic<int64_t> xruns{0};
    std::atomic<int64_t> xrunBase{0};
    int callbacks = 0;
    std::atomic<int> minCallbackFrames{1 << 30};
    std::atomic<int> maxCallbackFrames{0};
    // Render cost since the last stats read (callback-written, relaxed).
    std::atomic<int64_t> costMaxNs{0}, costSumNs{0}, costCount{0}, costOverNs{0};
    // Requested output: channel count (2, or 4 for Quad routing) and device (0 = system default).
    std::atomic<int> wantChannels{2};
    std::atomic<int> wantDevice{0};
    std::atomic<int> channels{2};
    // Engine output frame at the open stream's frame 0 (set before start; the callback is not running).
    std::atomic<int64_t> streamBase{0};

    int openLocked() {
        oboe::AudioStreamBuilder builder;
        builder.setDirection(oboe::Direction::Output)
            ->setFormat(oboe::AudioFormat::Float)
            ->setChannelCount(wantChannels.load())
            ->setDeviceId(wantDevice.load())
            ->setSharingMode(oboe::SharingMode::Shared)
            ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
            ->setUsage(oboe::Usage::Media)
            ->setContentType(oboe::ContentType::Music)
            ->setDataCallback(this)
            ->setErrorCallback(this);
        std::shared_ptr<oboe::AudioStream> opened;
        const auto result = builder.openStream(opened);
        if (result != oboe::Result::OK) { lastError.store(static_cast<int>(result)); return static_cast<int>(result); }
        engine.setOutputRate(opened->getSampleRate());
        channels.store(opened->getChannelCount());
        streamBase.store(static_cast<int64_t>(engine.outputFrames()));
        const auto started = opened->requestStart();
        if (started != oboe::Result::OK) {
            opened->close();
            lastError.store(static_cast<int>(started));
            return static_cast<int>(started);
        }
        stream = opened;
        lastError.store(0);
        return 0;
    }

    int open() { std::lock_guard<std::mutex> lock(streamMutex); return stream ? 0 : openLocked(); }

    // Replaces the stream (engine state survives) when the channel count or device changes.
    int configure(int routing, int device) {
        std::lock_guard<std::mutex> lock(streamMutex);
        const int want = routing == static_cast<int>(manadj::Routing::Quad) ? 4 : 2;
        engine.setRouting(static_cast<manadj::Routing>(routing));
        if (stream && want == wantChannels.load() && device == wantDevice.load()) return 0;
        wantChannels.store(want);
        wantDevice.store(device);
        if (stream) {
            stream->requestStop();
            stream->close();
            stream.reset();
            xrunBase.store(xruns.load());
        }
        return openLocked();
    }

    oboe::DataCallbackResult onAudioReady(oboe::AudioStream* s, void* buffer, int32_t frames) override {
        const auto t0 = std::chrono::steady_clock::now();
        engine.render(static_cast<float*>(buffer), frames, channels.load(std::memory_order_relaxed));
        const int64_t ns = std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - t0).count();
        if (ns > costMaxNs.load(std::memory_order_relaxed)) costMaxNs.store(ns, std::memory_order_relaxed);
        costSumNs.fetch_add(ns, std::memory_order_relaxed);
        costCount.fetch_add(1, std::memory_order_relaxed);
        // Over half the callback period counts as a near-miss.
        if (ns * 2 > static_cast<int64_t>(frames) * 1000000000LL / std::max(1, engine.outputRate())) costOverNs.fetch_add(1, std::memory_order_relaxed);
        if (frames < minCallbackFrames.load(std::memory_order_relaxed)) minCallbackFrames.store(frames, std::memory_order_relaxed);
        if (frames > maxCallbackFrames.load(std::memory_order_relaxed)) maxCallbackFrames.store(frames, std::memory_order_relaxed);
        if ((++callbacks & 63) == 0) {
            const auto count = s->getXRunCount();
            if (count) xruns.store(xrunBase.load(std::memory_order_relaxed) + count.value(), std::memory_order_relaxed);
        }
        return oboe::DataCallbackResult::Continue;
    }

    void onErrorAfterClose(oboe::AudioStream*, oboe::Result error) override {
        std::lock_guard<std::mutex> lock(streamMutex);
        lastError.store(static_cast<int>(error));
        stream.reset();
        xrunBase.store(xruns.load());
        if (closing.load()) return;
        // Oboe permits reopening from this callback; a failure leaves outputOpen
        // false and the app may retry via nativeReopen.
        if (openLocked() == 0) reopenCount.fetch_add(1);
    }

    void stop() {
        closing.store(true);
        std::lock_guard<std::mutex> lock(streamMutex);
        if (stream) {
            stream->requestStop();
            stream->close();
            stream.reset();
        }
    }
};

Output* output(jlong handle) { return reinterpret_cast<Output*>(handle); }
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_manadj_audio_AudioEngine_nativeOpen(JNIEnv*, jobject, jboolean offline) {
    auto sink = std::make_unique<Output>();
    if (!offline && sink->open() != 0) return 0;
    return reinterpret_cast<jlong>(sink.release());
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_manadj_audio_AudioEngine_nativeReopen(JNIEnv*, jobject, jlong handle) {
    return output(handle)->open();
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_manadj_audio_AudioEngine_nativeConfigure(JNIEnv*, jobject, jlong handle, jint routing, jint device, jboolean offline) {
    if (routing < 0 || routing > 2) return -1;
    if (offline) { output(handle)->engine.setRouting(static_cast<manadj::Routing>(routing)); return 0; }
    return output(handle)->configure(routing, device);
}

extern "C" JNIEXPORT void JNICALL
Java_dev_manadj_audio_AudioEngine_nativeStop(JNIEnv*, jobject, jlong handle) {
    output(handle)->stop();
}

extern "C" JNIEXPORT void JNICALL
Java_dev_manadj_audio_AudioEngine_nativeClose(JNIEnv*, jobject, jlong handle) {
    auto* sink = output(handle);
    if (sink) { sink->stop(); delete sink; }
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_manadj_audio_AudioEngine_nativeSubmit(JNIEnv*, jobject, jlong handle, jint op, jint deck,
                                                  jdouble value, jlong load, jint slot) {
    using manadj::Op;
    if (op < 0 || op > static_cast<int>(Op::SetSyncMembers) || op == static_cast<int>(Op::Filter) || op == static_cast<int>(Op::BeatFx) ||
        op == static_cast<int>(Op::LoopSet) || op == static_cast<int>(Op::CancelScheduled)) return 0; // dedicated entry points
    if (op == static_cast<int>(manadj::Op::SetGrid)) return 0; // nativeSetGrid carries the anchor.
    return static_cast<jlong>(output(handle)->engine.submit(static_cast<manadj::Op>(op), deck, value,
                                                            static_cast<uint64_t>(load), slot));
}

// Frame stamp + cancel tag for the following submits on this thread (0, 0 = immediate).
extern "C" JNIEXPORT void JNICALL
Java_dev_manadj_audio_AudioEngine_nativeSetSchedule(JNIEnv*, jobject, jlong frame, jlong tag) {
    manadj::Engine::setSubmitFrame(static_cast<uint64_t>(frame), static_cast<uint64_t>(tag));
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_manadj_audio_AudioEngine_nativeCancelScheduled(JNIEnv*, jobject, jlong handle, jlong tag) {
    return static_cast<jlong>(output(handle)->engine.cancelScheduled(static_cast<uint64_t>(tag)));
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_manadj_audio_AudioEngine_nativeSetGrid(JNIEnv*, jobject, jlong handle, jint deck, jdouble bpm, jdouble anchor) {
    if (!std::isfinite(bpm) || !std::isfinite(anchor)) return 0;
    const double aux[5] = {anchor, 0, 0, 0, 0};
    return static_cast<jlong>(output(handle)->engine.submit(manadj::Op::SetGrid, deck, bpm, 0, 0, aux));
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_manadj_audio_AudioEngine_nativeSetLoop(JNIEnv*, jobject, jlong handle, jint deck, jdouble start, jdouble end, jdouble playhead) {
    if (!std::isfinite(start) || !std::isfinite(end)) return 0;
    const double aux[5] = {end, playhead, 0, 0, 0};
    return static_cast<jlong>(output(handle)->engine.submit(manadj::Op::LoopSet, deck, start, 0, 0, aux));
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_manadj_audio_AudioEngine_nativeSubmitFilter(JNIEnv*, jobject, jlong handle, jint deck, jdouble position) {
    if (!std::isfinite(position)) return 0;
    return static_cast<jlong>(output(handle)->engine.submitFilter(deck, position));
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_manadj_audio_AudioEngine_nativeSubmitBeatFx(JNIEnv*, jobject, jlong handle, jint effect, jint target, jboolean on,
                                                        jdouble depth, jdouble beats, jint held) {
    return static_cast<jlong>(output(handle)->engine.submitBeatFx(effect, target, on, depth, beats, held));
}

namespace {
// params: resonance, compensation, curve, deadzone, lpMin, hpMax, spread, drive, trim, smoothing
manadj::dsp::FilterSettings filterSettings(JNIEnv* env, jint model, jdoubleArray params) {
    manadj::dsp::FilterSettings s;
    if (env->GetArrayLength(params) < 10) return s;
    double v[10];
    env->GetDoubleArrayRegion(params, 0, 10, v);
    s.model = static_cast<manadj::dsp::FilterModel>(model);
    s.resonance = v[0]; s.compensation = v[1]; s.curve = v[2]; s.deadzone = v[3]; s.lpMin = v[4];
    s.hpMax = v[5]; s.spread = v[6]; s.drive = v[7]; s.trim = v[8]; s.smoothing = v[9];
    return s.sanitized();
}
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_manadj_audio_AudioEngine_nativeSetFilterSettings(JNIEnv* env, jobject, jlong handle, jint model, jdoubleArray params) {
    return static_cast<jlong>(output(handle)->engine.submitFilterSettings(filterSettings(env, model, params)));
}

extern "C" JNIEXPORT jdoubleArray JNICALL
Java_dev_manadj_audio_AudioEngine_nativeFilterResponse(JNIEnv* env, jobject, jint model, jdoubleArray params, jdouble position,
                                                          jdoubleArray freqs, jdouble rate) {
    const auto s = filterSettings(env, model, params);
    const int n = env->GetArrayLength(freqs);
    std::vector<double> hz(n), db(n);
    env->GetDoubleArrayRegion(freqs, 0, n, hz.data());
    for (int i = 0; i < n; ++i) db[i] = manadj::dsp::sweepResponseDb(s, position, hz[i], rate);
    auto result = env->NewDoubleArray(n);
    if (result) env->SetDoubleArrayRegion(result, 0, n, db.data());
    return result;
}

extern "C" JNIEXPORT void JNICALL
Java_dev_manadj_audio_AudioEngine_nativeTransport(JNIEnv* env, jobject, jlong handle, jint deck, jdoubleArray out) {
    if (deck < 0 || deck >= manadj::kDeckCount || env->GetArrayLength(out) < 5 + manadj::kHeadSlots) return;
    const auto& d = output(handle)->engine.deck(deck);
    // Transport is read before target/offset (release-ordered by the callback).
    const auto load = d.loadId.load();
    const auto transport = d.transport.load();
    double values[4 + manadj::kHeadSlots] = {static_cast<double>(load), static_cast<double>(transport), d.target.load(),
                                             static_cast<double>(d.ringOffset.load())};
    for (int h = 0; h < manadj::kHotCues; ++h) values[4 + h] = d.hotcues[h].load();
    values[4 + manadj::kMainCueSlot] = d.cue.load();
    values[4 + manadj::kLoopSlot] = d.loopActive.load() ? d.loopStart.load() : -1;
    env->SetDoubleArrayRegion(out, 0, 4 + manadj::kHeadSlots, values);
    // Frames buffered ahead of the playhead (meaningful once the current transport is published).
    const double buffered = static_cast<double>(d.write.load() - d.read.load());
    env->SetDoubleArrayRegion(out, 4 + manadj::kHeadSlots, 1, &buffered);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_manadj_audio_AudioEngine_nativeClaim(JNIEnv*, jobject, jlong handle, jint deck, jlong load,
                                                 jlong transport, jint rate, jdouble start) {
    return output(handle)->engine.claim(deck, static_cast<uint64_t>(load), static_cast<uint64_t>(transport), rate, start);
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_manadj_audio_AudioEngine_nativeOffer(JNIEnv* env, jobject, jlong handle, jint deck, jlong transport,
                                                 jfloatArray samples, jint offsetFrames, jint frames) {
    constexpr int kChunk = 1024;
    if (frames < 1 || offsetFrames < 0 ||
        static_cast<jlong>(offsetFrames + frames) * 2 > env->GetArrayLength(samples)) return -1;
    float chunk[kChunk * 2];
    int total = 0;
    while (total < frames) {
        const int n = std::min(kChunk, frames - total);
        env->GetFloatArrayRegion(samples, (offsetFrames + total) * 2, n * 2, chunk);
        const int accepted = output(handle)->engine.offer(deck, static_cast<uint64_t>(transport), chunk, n);
        if (accepted < 0) return total ? total : -1;
        total += accepted;
        if (accepted < n) break;
    }
    return total;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_manadj_audio_AudioEngine_nativeHeadBegin(JNIEnv*, jobject, jlong handle, jint deck, jint slot) {
    return output(handle)->engine.headBegin(deck, slot);
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_manadj_audio_AudioEngine_nativeHeadWrite(JNIEnv* env, jobject, jlong handle, jint deck, jint slot,
                                                     jint at, jfloatArray samples, jint frames) {
    const int n = std::max(0, std::min<int>(frames, manadj::kHeadFrames - at));
    if (n == 0 || env->GetArrayLength(samples) < n * 2) return 0;
    std::vector<float> copy(static_cast<size_t>(n) * 2); // Worker thread; allocation is fine here.
    env->GetFloatArrayRegion(samples, 0, n * 2, copy.data());
    return output(handle)->engine.headWrite(deck, slot, at, copy.data(), n);
}

extern "C" JNIEXPORT void JNICALL
Java_dev_manadj_audio_AudioEngine_nativeHeadCommit(JNIEnv*, jobject, jlong handle, jint deck, jint slot,
                                                      jlong load, jdouble seconds, jint frames) {
    if (frames > 0) output(handle)->engine.headCommit(deck, slot, static_cast<uint64_t>(load), seconds, frames);
    else output(handle)->engine.headAbort(deck, slot);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_manadj_audio_AudioEngine_nativeTrackBegin(JNIEnv*, jobject, jlong handle, jint deck, jlong load, jlong capacity,
                                                      jint rate, jdouble start) {
    if (capacity <= 0) return false;
    return output(handle)->engine.trackBegin(deck, static_cast<uint64_t>(load), static_cast<uint64_t>(capacity), rate, start);
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_manadj_audio_AudioEngine_nativeTrackWrite(JNIEnv* env, jobject, jlong handle, jint deck, jlong load,
                                                      jfloatArray samples, jint frames) {
    constexpr int kChunk = 2048;
    if (frames < 1 || static_cast<jlong>(frames) * 2 > env->GetArrayLength(samples)) return -1;
    float chunk[kChunk * 2];
    int total = 0;
    while (total < frames) {
        const int n = std::min(kChunk, frames - total);
        env->GetFloatArrayRegion(samples, total * 2, n * 2, chunk);
        const int written = output(handle)->engine.trackWrite(deck, static_cast<uint64_t>(load), chunk, n);
        if (written < 0) return total ? total : -1;
        total += written;
        if (written < n) break;
    }
    return total;
}

extern "C" JNIEXPORT void JNICALL
Java_dev_manadj_audio_AudioEngine_nativeTrackFinish(JNIEnv*, jobject, jlong handle, jint deck, jlong load) {
    output(handle)->engine.trackFinish(deck, static_cast<uint64_t>(load));
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_manadj_audio_AudioEngine_nativePublish(JNIEnv*, jobject, jlong handle, jint deck, jlong load,
                                                   jlong transport, jboolean eof) {
    return output(handle)->engine.publish(deck, static_cast<uint64_t>(load), static_cast<uint64_t>(transport), eof);
}

extern "C" JNIEXPORT void JNICALL
Java_dev_manadj_audio_AudioEngine_nativeFail(JNIEnv*, jobject, jlong handle, jint deck, jlong load) {
    output(handle)->engine.fail(deck, static_cast<uint64_t>(load));
}

extern "C" JNIEXPORT jdoubleArray JNICALL
Java_dev_manadj_audio_AudioEngine_nativeSnapshot(JNIEnv* env, jobject, jlong handle) {
    auto* sink = output(handle);
    const auto& e = sink->engine;
    bool open;
    // Output clock: the engine frame heard at CLOCK_MONOTONIC `presentedNanos` (Oboe timestamp,
    // mapped from stream frames to engine frames via framesWritten). -1 when unavailable.
    double presentedFrame = -1, presentedNanos = -1;
    {
        std::lock_guard<std::mutex> lock(sink->streamMutex);
        open = sink->stream && sink->stream->getState() == oboe::StreamState::Started;
        if (open) {
            const auto ts = sink->stream->getTimestamp(CLOCK_MONOTONIC);
            if (ts && ts.value().position > 0) {
                presentedFrame = static_cast<double>(sink->streamBase.load() + ts.value().position);
                presentedNanos = static_cast<double>(ts.value().timestamp);
            }
        }
    }
    double data[kSnapshotSize] = {
        static_cast<double>(e.outputFrames()), static_cast<double>(e.outputRate()), 2, 1,
        static_cast<double>(e.starvedFrames()), static_cast<double>(sink->xruns.load()),
        static_cast<double>(sink->lastError.load()), static_cast<double>(e.accepted()),
        static_cast<double>(e.applied()), e.crossfade(), open ? 1.0 : 0.0,
        static_cast<double>(sink->reopenCount.load()), static_cast<double>(static_cast<int>(e.routing())),
        static_cast<double>(sink->channels.load()), e.cueMix(), e.quantize() ? 1.0 : 0.0,
        static_cast<double>(e.fxEffect()), static_cast<double>(e.fxTarget()), e.fxOn() ? 1.0 : 0.0,
        e.fxDepth(), e.fxBeats(), static_cast<double>(e.fxHeld()), static_cast<double>(e.fxAudible()),
        0, presentedFrame, presentedNanos, 0,
        static_cast<double>(e.lateOps()), static_cast<double>(e.scheduledOps()),
    };
    // Deck positions are sampled at engine frame data[23]; retry if a callback ran mid-read.
    for (int attempt = 0; attempt < 4; ++attempt) {
    const auto clockFrame = e.outputFrames();
    data[23] = static_cast<double>(clockFrame);
    for (int i = 0; i < manadj::kDeckCount; ++i) {
        const auto& d = e.deck(i);
        const int n = kHeader + i * kDeckFields;
        const auto status = d.status.load();
        const auto transport = d.transport.load();
        data[n] = static_cast<double>(status & 3);
        data[n + 1] = static_cast<double>(status >> 2);
        data[n + 2] = static_cast<double>(d.loadId.load());
        data[n + 3] = static_cast<double>(transport);
        data[n + 4] = d.ring.load() == transport ? 1 : 0;
        data[n + 5] = d.eof.load() == transport ? 1 : 0;
        data[n + 6] = d.position.load();
        data[n + 7] = d.sampleRate.load();
        data[n + 8] = d.playing.load();
        data[n + 9] = d.preview.load();
        data[n + 10] = d.previewSlot.load();
        data[n + 11] = d.cue.load();
        data[n + 12] = static_cast<double>(d.applied.load());
        data[n + 13] = static_cast<double>(d.write.load() - d.read.load());
        data[n + 14] = d.fader.load();
        data[n + 15] = d.trim.load();
        data[n + 16] = d.pitch.load();
        data[n + 17] = d.bend.load();
        data[n + 18] = d.headSlot.load();
        int heads = 0;
        for (int h = 0; h < manadj::kHeadSlots; ++h)
            if ((d.heads[h].state.load() & 3) == manadj::kHeadReady && d.heads[h].load.load() == d.loadId.load() &&
                d.heads[h].seconds.load() == (h == manadj::kMainCueSlot ? d.cue.load() : h == manadj::kLoopSlot ? d.loopStart.load() : d.hotcues[h].load())) heads |= 1 << h;
        data[n + 19] = heads;
        data[n + 20] = d.pfl.load() ? 1 : 0;
        for (int b = 0; b < 3; ++b) data[n + 21 + b] = d.eq[b].load();
        data[n + 24] = d.filter.load();
        data[n + 25] = d.bpm.load();
        data[n + 26] = d.gridAnchor.load();
        data[n + 27] = d.loopActive.load() ? 1 : 0;
        data[n + 28] = d.loopStart.load();
        data[n + 29] = d.loopEnd.load();
        data[n + 30] = d.loopBeats.load();
        data[n + 31] = d.pendingLoopBeats.load();
        const bool tracked = d.track.load.load() == d.loadId.load() && d.track.load.load() != 0;
        data[n + 32] = tracked && d.track.sampleRate.load() > 0 ? d.track.startSeconds.load() + d.track.frames.load() / static_cast<double>(d.track.sampleRate.load()) : 0;
        data[n + 33] = tracked && d.track.complete.load() ? 1 : 0;
        data[n + 34] = d.inTrack.load() ? 1 : 0;
        data[n + 35] = e.trackCovers(d, d.position.load(), 0) ? 1 : 0;
        if (d.trackEnd.load()) data[n + 5] = 1;
        data[n + 36] = d.keyLock.load() ? 1 : 0;
        data[n + 37] = d.stretching.load() ? 1 : 0;
        data[n + 38] = d.scratching.load() ? 1 : 0;
        data[n + 39] = static_cast<double>(d.launchAt.load());
        for (int h = 0; h < manadj::kHotCues; ++h) data[n + 40 + h] = d.hotcues[h].load();
    }
    if (e.outputFrames() == clockFrame) break;
    }
    auto result = env->NewDoubleArray(kSnapshotSize);
    if (result) env->SetDoubleArrayRegion(result, 0, kSnapshotSize, data);
    return result;
}

// Output configuration as negotiated: api, sharing, performance mode, rate, channels,
// frames per burst, buffer size, buffer capacity, estimated latency ms (-1 unknown),
// device id, xruns, min/max callback frames. Empty when no stream is open.
extern "C" JNIEXPORT jdoubleArray JNICALL
Java_dev_manadj_audio_AudioEngine_nativeOutputInfo(JNIEnv* env, jobject, jlong handle) {
    auto* sink = output(handle);
    double data[13] = {};
    int n = 0;
    {
        std::lock_guard<std::mutex> lock(sink->streamMutex);
        if (auto& s = sink->stream) {
            const auto latency = s->calculateLatencyMillis();
            const double values[13] = {
                static_cast<double>(s->getAudioApi()), static_cast<double>(s->getSharingMode()),
                static_cast<double>(s->getPerformanceMode()), static_cast<double>(s->getSampleRate()),
                static_cast<double>(s->getChannelCount()), static_cast<double>(s->getFramesPerBurst()),
                static_cast<double>(s->getBufferSizeInFrames()), static_cast<double>(s->getBufferCapacityInFrames()),
                latency ? latency.value() : -1.0, static_cast<double>(s->getDeviceId()),
                static_cast<double>(sink->xruns.load()), static_cast<double>(sink->minCallbackFrames.load()),
                static_cast<double>(sink->maxCallbackFrames.load()),
            };
            std::copy(values, values + 13, data);
            n = 13;
        }
    }
    auto result = env->NewDoubleArray(n);
    if (result && n) env->SetDoubleArrayRegion(result, 0, n, data);
    return result;
}

// Render cost since the previous call: max us, mean us, callbacks, callbacks over half their period. Resets.
extern "C" JNIEXPORT jdoubleArray JNICALL
Java_dev_manadj_audio_AudioEngine_nativeRenderCost(JNIEnv* env, jobject, jlong handle) {
    auto* sink = output(handle);
    const double count = static_cast<double>(sink->costCount.exchange(0));
    const double data[4] = {sink->costMaxNs.exchange(0) / 1e3, count > 0 ? sink->costSumNs.exchange(0) / 1e3 / count : 0,
                            count, static_cast<double>(sink->costOverNs.exchange(0))};
    auto result = env->NewDoubleArray(4);
    if (result) env->SetDoubleArrayRegion(result, 0, 4, data);
    return result;
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_dev_manadj_audio_AudioEngine_nativeRenderOffline(JNIEnv* env, jobject, jlong handle, jint frames, jint channels) {
    if (frames < 0 || frames > 8192 || channels < 1 || channels > 8) return nullptr;
    std::vector<float> pcm(static_cast<size_t>(frames) * channels);
    output(handle)->engine.render(pcm.data(), frames, channels);
    auto array = env->NewFloatArray(frames * channels);
    if (array) env->SetFloatArrayRegion(array, 0, frames * channels, pcm.data());
    return array;
}
