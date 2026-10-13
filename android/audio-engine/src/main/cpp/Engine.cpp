#include "Engine.h"
#include <algorithm>

namespace manadj {
Engine::Engine(int outputRate) : outputRate_(outputRate) {
    for (int i = 0; i < kDeckCount; ++i) updateGain(i);
}

uint64_t Engine::submit(Op op, int deck, double value, uint64_t generation,
                        int sourceRate, int channels) {
    if (deck < 0 || deck >= kDeckCount || !std::isfinite(value)) return 0;
    std::lock_guard<std::mutex> lock(submitMutex_);
    const auto write = queueWrite_.load(std::memory_order_relaxed);
    if (write - queueRead_.load(std::memory_order_acquire) >= kQueueSize) return 0;
    const auto seq = accepted_.fetch_add(1) + 1;
    commands_[write % kQueueSize] = {op, deck, seq, generation, value, sourceRate, channels};
    queueWrite_.store(write + 1, std::memory_order_release);
    return seq;
}

int Engine::offer(int index, uint64_t generation, const float* samples, int frames) {
    if (index < 0 || index >= kDeckCount || frames <= 0 || !samples) return 0;
    auto& d = decks_[index];
    if (d.generation.load(std::memory_order_acquire) != generation) return 0;
    const auto write = d.write.load(std::memory_order_relaxed);
    const auto read = d.read.load(std::memory_order_acquire);
    const int n = static_cast<int>(std::min<uint64_t>(frames, kRingFrames - (write - read)));
    for (int i = 0; i < n; ++i) {
        const auto offset = ((write + i) % kRingFrames) * 2;
        d.pcm[offset] = samples[i * 2];
        d.pcm[offset + 1] = samples[i * 2 + 1];
    }
    // Producer must stop on seek/load, await generation acknowledgement, then offer.
    if (d.generation.load(std::memory_order_acquire) != generation) return 0;
    d.write.store(write + n, std::memory_order_release);
    return n;
}

void Engine::apply(const Command& c) noexcept {
    auto& d = decks_[c.deck];
    switch (c.op) {
        case Op::Prepare:
        case Op::Seek:
            d.playing.store(c.op == Op::Seek && d.playing.load(), std::memory_order_relaxed);
            d.preview.store(false, std::memory_order_relaxed);
            if (c.op == Op::Prepare) { d.playing.store(false); d.cue = -1; d.state.store(1); }
            else d.state.store(1);
            d.generation.store(c.generation, std::memory_order_release);
            d.eof = false;
            d.read.store(0, std::memory_order_release);
            d.write.store(0, std::memory_order_release);
            d.fractional = 0;
            d.position.store(c.value);
            if (c.sampleRate > 0) d.sampleRate.store(c.sampleRate);
            if (c.channels > 0) d.channels = c.channels;
            break;
        case Op::Ready:
            if (c.generation == d.generation.load()) d.state.store(2);
            break;
        case Op::Error:
            if (c.generation == d.generation.load()) { d.state.store(3); d.playing.store(false); }
            break;
        case Op::Play:
            if (d.state.load() == 2) { d.playing.store(true); d.preview.store(false); }
            break;
        case Op::Pause: d.playing.store(false); d.preview.store(false); break;
        case Op::CueDown:
            if (d.playing.load()) {
                d.playing.store(false);
                d.preview.store(false);
                // Cue return needs a source refill; controller handles that as Seek.
            } else if (d.cue.load() < 0) d.cue.store(d.position.load());
            else if (d.state.load() == 2) d.preview.store(true);
            break;
        case Op::CueUp: if (!d.playing.load()) d.preview.store(false); break;
        case Op::Fader: d.fader = std::clamp(static_cast<float>(c.value), 0.f, 1.f); updateGain(c.deck); break;
        case Op::Trim: d.trim = std::clamp(static_cast<float>(c.value), 0.f, 1.f); updateGain(c.deck); break;
        case Op::Crossfade:
            crossfade_.store(std::clamp(static_cast<float>(c.value), -1.f, 1.f));
            for (int i = 0; i < kDeckCount; ++i) updateGain(i);
            break;
        case Op::Pitch: d.pitch = std::clamp(static_cast<float>(c.value), -25.f, 25.f); break;
        case Op::Bend: d.bend = std::clamp(static_cast<float>(c.value), -8.f, 8.f); break;
        case Op::HotPreview: if (d.state.load() == 2 && !d.playing.load()) d.preview.store(true); break;
        case Op::End: if (c.generation == d.generation.load()) d.eof = true; break;
    }
    d.applied.store(c.seq, std::memory_order_release);
    applied_.store(c.seq, std::memory_order_release);
}

void Engine::updateGain(int index) noexcept {
    auto& d = decks_[index];
    const float fade = index == 0 ? std::min(1.f, 1.f - crossfade_.load()) :
                       index == 1 ? std::min(1.f, 1.f + crossfade_.load()) : 1.f;
    d.targetGain = d.fader.load() * d.fader.load() * std::pow(10.f, (-6.f + (d.trim.load() - .5f) * 24.f) / 20.f) * fade;
}

float Engine::ceiling(float x) noexcept {
    // -2 dBFS sample ceiling, ordinary signals below threshold unchanged.
    return std::clamp(x, -.7943282f, .7943282f);
}

void Engine::render(float* output, int frames) noexcept {
    while (queueRead_.load(std::memory_order_relaxed) != queueWrite_.load(std::memory_order_acquire)) {
        const auto read = queueRead_.load(std::memory_order_relaxed);
        apply(commands_[read % kQueueSize]);
        queueRead_.store(read + 1, std::memory_order_release);
    }
    const double outRate = outputRate_.load(std::memory_order_relaxed);
    for (int i = 0; i < frames; ++i) {
        float left = 0, right = 0;
        for (int j = 0; j < kDeckCount; ++j) {
            auto& d = decks_[j];
            if (d.state.load(std::memory_order_relaxed) != 2 ||
                !(d.playing.load(std::memory_order_relaxed) || d.preview.load(std::memory_order_relaxed))) continue;
            auto read = d.read.load(std::memory_order_relaxed);
            const auto write = d.write.load(std::memory_order_acquire);
            const auto sampleRate = d.sampleRate.load(std::memory_order_relaxed);
            const double ratio = (sampleRate / outRate) * (1 + d.pitch.load() / 100.) * (1 + d.bend.load() / 100.);
            if (write - read < static_cast<uint64_t>(d.fractional + ratio) + 2) {
                if (d.eof) { d.playing.store(false); d.preview.store(false); }
                else starvedFrames_.fetch_add(1, std::memory_order_relaxed);
                continue;
            }
            const auto a = (read % kRingFrames) * 2;
            const auto b = ((read + 1) % kRingFrames) * 2;
            d.gain += (d.targetGain - d.gain) * .002f;
            left += (d.pcm[a] + (d.pcm[b] - d.pcm[a]) * d.fractional) * d.gain;
            right += (d.pcm[a + 1] + (d.pcm[b + 1] - d.pcm[a + 1]) * d.fractional) * d.gain;
            d.fractional += ratio;
            const auto consumed = static_cast<uint64_t>(d.fractional);
            d.fractional -= consumed;
            d.read.store(read + consumed, std::memory_order_release);
            d.position.store(d.position.load(std::memory_order_relaxed) + consumed / static_cast<double>(sampleRate),
                             std::memory_order_release);
        }
        output[i * 2] = ceiling(left);
        output[i * 2 + 1] = ceiling(right);
    }
    outputFrames_.fetch_add(frames, std::memory_order_release);
}
} // namespace manadj
