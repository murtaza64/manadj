#include "Engine.h"
#include <jni.h>
#include <oboe/Oboe.h>
#include <memory>
#include <vector>

namespace {
struct Output final : oboe::AudioStreamDataCallback, oboe::AudioStreamErrorCallback {
    manadj::Engine engine;
    std::shared_ptr<oboe::AudioStream> stream;
    std::atomic<int> streamError{0};

    int start() {
        oboe::AudioStreamBuilder builder;
        builder.setDirection(oboe::Direction::Output)
            ->setFormat(oboe::AudioFormat::Float)
            ->setChannelCount(2)
            ->setSharingMode(oboe::SharingMode::Shared)
            ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
            ->setDataCallback(this)
            ->setErrorCallback(this);
        const auto result = builder.openStream(stream);
        if (result != oboe::Result::OK) return static_cast<int>(result);
        engine.setOutputRate(stream->getSampleRate());
        const auto started = stream->requestStart();
        if (started != oboe::Result::OK) {
            stream->close();
            stream.reset();
            return static_cast<int>(started);
        }
        return 0;
    }

    oboe::DataCallbackResult onAudioReady(oboe::AudioStream*, void* buffer, int32_t frames) override {
        engine.render(static_cast<float*>(buffer), frames);
        return oboe::DataCallbackResult::Continue;
    }

    void onErrorAfterClose(oboe::AudioStream*, oboe::Result error) override {
        streamError.store(static_cast<int>(error));
    }

    void stop() {
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
    if (!offline && sink->start() != 0) return 0;
    return reinterpret_cast<jlong>(sink.release());
}

extern "C" JNIEXPORT void JNICALL
Java_dev_manadj_audio_AudioEngine_nativeClose(JNIEnv*, jobject, jlong handle) {
    auto* sink = output(handle);
    if (sink) { sink->stop(); delete sink; }
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_manadj_audio_AudioEngine_nativeSubmit(JNIEnv*, jobject, jlong handle, jint op, jint deck,
                                                  jdouble value, jlong generation, jint rate, jint channels) {
    if (op < 0 || op > static_cast<int>(manadj::Op::End)) return 0;
    return output(handle)->engine.submit(static_cast<manadj::Op>(op), deck, value, generation, rate, channels);
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_manadj_audio_AudioEngine_nativeOffer(JNIEnv* env, jobject, jlong handle, jint deck,
                                                 jlong generation, jfloatArray samples, jint frames) {
    if (frames < 1 || static_cast<jsize>(frames * 2) > env->GetArrayLength(samples)) return 0;
    jfloat* pcm = env->GetFloatArrayElements(samples, nullptr);
    if (!pcm) return 0;
    const int count = output(handle)->engine.offer(deck, generation, pcm, frames);
    env->ReleaseFloatArrayElements(samples, pcm, JNI_ABORT);
    return count;
}

extern "C" JNIEXPORT jdoubleArray JNICALL
Java_dev_manadj_audio_AudioEngine_nativeSnapshot(JNIEnv* env, jobject, jlong handle) {
    auto* sink = output(handle);
    const auto& e = sink->engine;
    // Header: frames, rate, output channels, epoch, starved frames, xrun count,
    // stream error, last accepted, last applied, crossfade. Decks: state, generation,
    // source seconds, source rate, playing, preview, cue, applied, buffered,
    // fader, trim, pitch, bend.
    double data[11 + 4 * 13] = {
        static_cast<double>(e.outputFrames()), static_cast<double>(e.outputRate()), 2, 1,
        static_cast<double>(e.starvedFrames()),
        sink->stream ? static_cast<double>(sink->stream->getXRunCount().value()) : 0,
        static_cast<double>(sink->streamError.load()), static_cast<double>(e.accepted()),
        static_cast<double>(e.applied()), e.crossfade(), sink->stream ? 1.0 : 0.0
    };
    for (int i = 0; i < 4; ++i) {
        const auto& d = sink->engine.deck(i);
        const int n = 11 + i * 13;
        data[n] = d.state.load();
        data[n + 1] = static_cast<double>(d.generation.load());
        data[n + 2] = d.position.load();
        data[n + 3] = d.sampleRate.load();
        data[n + 4] = d.playing.load();
        data[n + 5] = d.preview.load();
        data[n + 6] = d.cue.load();
        data[n + 7] = static_cast<double>(d.applied.load());
        data[n + 8] = static_cast<double>(d.write.load() - d.read.load());
        data[n + 9] = d.fader.load();
        data[n + 10] = d.trim.load();
        data[n + 11] = d.pitch.load();
        data[n + 12] = d.bend.load();
    }
    auto result = env->NewDoubleArray(63);
    if (result) env->SetDoubleArrayRegion(result, 0, 63, data);
    return result;
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_dev_manadj_audio_AudioEngine_nativeRenderOffline(JNIEnv* env, jobject, jlong handle, jint frames) {
    if (frames < 0 || frames > 8192) return nullptr;
    std::vector<float> pcm(static_cast<size_t>(frames) * 2);
    output(handle)->engine.render(pcm.data(), frames);
    auto array = env->NewFloatArray(frames * 2);
    if (array) env->SetFloatArrayRegion(array, 0, frames * 2, pcm.data());
    return array;
}
