#include "Engine.h"
#include <algorithm>

namespace manadj {
namespace {
constexpr auto kAcquire = std::memory_order_acquire;
constexpr auto kRelease = std::memory_order_release;
constexpr auto kRelaxed = std::memory_order_relaxed;

bool ready(const Deck& d) {
    const auto st = d.status.load(kAcquire);
    return (st & 3) == kReady && (st >> 2) == d.loadId.load(kRelaxed);
}
} // namespace

Engine::Engine(int outputRate) : outputRate_(outputRate) {
    for (auto& d : decks_) for (auto& h : d.hotcues) h.store(-1);
    for (int i = 0; i < kDeckCount; ++i) updateGain(i);
}

uint64_t Engine::submit(Op op, int deck, double value, uint64_t load, int slot) {
    if (deck < 0 || deck >= kDeckCount || !std::isfinite(value)) return 0;
    if ((op == Op::HotCueDown || op == Op::HotCueUp || op == Op::HotCueSet || op == Op::HotCueClear) &&
        (slot < 0 || slot >= kHotCues)) return 0;
    std::lock_guard<std::mutex> lock(submitMutex_);
    const auto write = queueWrite_.load(kRelaxed);
    if (write - queueRead_.load(kAcquire) >= kQueueSize) return 0;
    const auto seq = accepted_.fetch_add(1) + 1;
    commands_[write % kQueueSize] = {op, deck, seq, load, value, slot};
    queueWrite_.store(write + 1, kRelease);
    return seq;
}

bool Engine::claim(int index, uint64_t load, uint64_t transport, int sampleRate, double startSeconds) {
    if (index < 0 || index >= kDeckCount || sampleRate <= 0) return false;
    auto& d = decks_[index];
    if (d.loadId.load(kAcquire) != load || d.transport.load(kAcquire) != transport) return false;
    // ring != transport here, so the callback is not reading this deck: the
    // worker may reset the indices and correct the position.
    d.read.store(d.write.load(kRelaxed), kRelease);
    d.sampleRate.store(sampleRate, kRelease);
    d.position.store(startSeconds, kRelease);
    return d.transport.load(kAcquire) == transport;
}

int Engine::offer(int index, uint64_t transport, const float* samples, int frames) {
    if (index < 0 || index >= kDeckCount || frames <= 0 || !samples) return -1;
    auto& d = decks_[index];
    if (d.transport.load(kAcquire) != transport) return -1;
    const auto write = d.write.load(kRelaxed);
    const auto read = d.read.load(kAcquire);
    const int n = static_cast<int>(std::min<uint64_t>(frames, kRingFrames - (write - read)));
    for (int i = 0; i < n; ++i) {
        const auto offset = ((write + i) % kRingFrames) * 2;
        d.pcm[offset] = samples[i * 2];
        d.pcm[offset + 1] = samples[i * 2 + 1];
    }
    // A stale store is harmless: the next claim discards the ring before any
    // newer transport is published.
    d.write.store(write + n, kRelease);
    return n;
}

bool Engine::publish(int index, uint64_t load, uint64_t transport, bool endOfStream) {
    if (index < 0 || index >= kDeckCount) return false;
    auto& d = decks_[index];
    if (endOfStream) d.eof.store(transport, kRelease);
    auto expected = status(load, kLoading);
    d.status.compare_exchange_strong(expected, status(load, kReady));
    d.ring.store(transport, kRelease);
    return d.transport.load(kAcquire) == transport;
}

void Engine::fail(int index, uint64_t load) {
    if (index < 0 || index >= kDeckCount) return;
    auto& d = decks_[index];
    for (auto st : {kLoading, kReady}) {
        auto expected = status(load, st);
        if (d.status.compare_exchange_strong(expected, status(load, kError))) return;
    }
}

void Engine::relocate(Deck& d, double seconds) noexcept {
    const auto t = std::max(0.0, seconds);
    d.target.store(t, kRelaxed);
    d.position.store(t, kRelaxed);
    d.fractional = 0;
    d.envelope = 0;
    d.fadeOut = 0;
    d.transport.store(d.transport.load(kRelaxed) + 1, kRelease);
}

void Engine::stop(Deck& d) noexcept {
    const bool audible = d.playing.load(kRelaxed) || d.preview.load(kRelaxed);
    if (audible && d.ring.load(kAcquire) == d.transport.load(kRelaxed)) d.fadeOut = kFadeFrames;
    d.playing.store(false, kRelaxed);
    d.preview.store(false, kRelaxed);
    d.previewSlot.store(-1, kRelaxed);
}

void Engine::apply(const Command& c) noexcept {
    auto& d = decks_[c.deck];
    const bool isReady = ready(d);
    const double position = d.position.load(kRelaxed);
    switch (c.op) {
        case Op::Prepare:
            d.loadId.store(c.load, kRelease);
            d.status.store(status(c.load, kLoading), kRelease);
            d.playing.store(false);
            d.preview.store(false);
            d.previewSlot.store(-1);
            d.cue.store(0);
            for (auto& h : d.hotcues) h.store(-1);
            relocate(d, 0);
            break;
        case Op::Play:
            if (isReady) { d.playing.store(true); d.preview.store(false); d.previewSlot.store(-1); }
            break;
        case Op::Pause: stop(d); break;
        case Op::CueDown: {
            if (!isReady) break;
            const double cue = d.cue.load();
            if (d.playing.load()) { stop(d); relocate(d, cue); }
            else if (std::abs(position - cue) < kAtCueEpsilon) { d.preview.store(true); d.previewSlot.store(kMainCueSlot); }
            else d.cue.store(position);
            break;
        }
        case Op::CueUp:
            if (d.previewSlot.load() != kMainCueSlot) break;
            if (d.playing.load()) { d.preview.store(false); d.previewSlot.store(-1); }
            else { stop(d); relocate(d, d.cue.load()); }
            break;
        case Op::HotCueDown: {
            const double at = d.hotcues[c.slot].load();
            if (!isReady || at < 0) break;
            relocate(d, at);
            if (!d.playing.load()) { d.preview.store(true); d.previewSlot.store(c.slot); }
            break;
        }
        case Op::HotCueUp:
            if (d.previewSlot.load() != c.slot) break;
            if (d.playing.load()) { d.preview.store(false); d.previewSlot.store(-1); }
            else { stop(d); relocate(d, d.hotcues[c.slot].load()); }
            break;
        case Op::HotCueSet: if (isReady) d.hotcues[c.slot].store(position); break;
        case Op::HotCueClear: d.hotcues[c.slot].store(-1); break;
        case Op::Seek: if (isReady) relocate(d, c.value); break;
        case Op::Fader: d.fader = std::clamp(static_cast<float>(c.value), 0.f, 1.f); updateGain(c.deck); break;
        case Op::Trim: d.trim = std::clamp(static_cast<float>(c.value), 0.f, 1.f); updateGain(c.deck); break;
        case Op::Crossfade:
            crossfade_.store(std::clamp(static_cast<float>(c.value), -1.f, 1.f));
            for (int i = 0; i < kDeckCount; ++i) updateGain(i);
            break;
        case Op::Pitch: d.pitch = std::clamp(static_cast<float>(c.value), -25.f, 25.f); break;
        case Op::Bend: d.bend = std::clamp(static_cast<float>(c.value), -8.f, 8.f); break;
    }
    d.applied.store(c.seq, kRelease);
    applied_.store(c.seq, kRelease);
}

void Engine::updateGain(int index) noexcept {
    auto& d = decks_[index];
    // Crossfade -1 = full A, +1 = full B, 0 = both at unity.
    const float x = crossfade_.load();
    const float fade = index == 0 ? std::min(1.f, 1.f - x) : index == 1 ? std::min(1.f, 1.f + x) : 1.f;
    d.targetGain = d.fader.load() * d.fader.load() * std::pow(10.f, (-6.f + (d.trim.load() - .5f) * 24.f) / 20.f) * fade;
}

float Engine::ceiling(float x) noexcept {
    // -2 dBFS sample ceiling, ordinary signals below threshold unchanged.
    return std::clamp(x, -.7943282f, .7943282f);
}

void Engine::render(float* output, int frames) noexcept {
    while (queueRead_.load(kRelaxed) != queueWrite_.load(kAcquire)) {
        const auto read = queueRead_.load(kRelaxed);
        apply(commands_[read % kQueueSize]);
        queueRead_.store(read + 1, kRelease);
    }
    std::fill(output, output + frames * 2, 0.f);
    const double outRate = outputRate_.load(kRelaxed);
    for (int j = 0; j < kDeckCount; ++j) {
        auto& d = decks_[j];
        if (!ready(d)) {
            if ((d.status.load(kAcquire) & 3) == kError) { d.playing.store(false); d.preview.store(false); d.previewSlot.store(-1); }
            d.fadeOut = 0;
            continue;
        }
        const bool audible = d.playing.load(kRelaxed) || d.preview.load(kRelaxed);
        if (audible) d.fadeOut = 0;
        else if (d.fadeOut == 0) { d.envelope = 0; continue; }
        const auto transport = d.transport.load(kRelaxed);
        if (d.ring.load(kAcquire) != transport) continue; // Refill in progress: silent, clock held.
        const auto sampleRate = d.sampleRate.load(kAcquire);
        const double ratio = (sampleRate / outRate) * (1 + d.pitch.load(kRelaxed) / 100.) * (1 + d.bend.load(kRelaxed) / 100.);
        auto read = d.read.load(kRelaxed);
        auto write = d.write.load(kAcquire);
        if (audible && d.envelope == 0) d.gain = d.targetGain; // Envelope owns the onset.
        double fractional = d.fractional;
        uint64_t consumedTotal = 0;
        for (int i = 0; i < frames; ++i) {
            const auto need = static_cast<uint64_t>(fractional + ratio) + 2;
            if (write - read < need) {
                write = d.write.load(kAcquire);
                if (write - read < need) {
                    if (!audible) { d.fadeOut = 0; break; }
                    if (d.eof.load(kAcquire) == transport && d.write.load(kAcquire) - read < need) {
                        d.playing.store(false); d.preview.store(false); d.previewSlot.store(-1);
                    } else starvedFrames_.fetch_add(frames - i, kRelaxed);
                    break;
                }
            }
            if (!audible) {
                if (d.fadeOut == 0) break;
                d.envelope = static_cast<float>(d.fadeOut--) / kFadeFrames;
            } else d.envelope = std::min(1.f, d.envelope + 1.f / kFadeFrames);
            d.gain += (d.targetGain - d.gain) * .002f;
            const float g = d.gain * d.envelope;
            const auto a = (read % kRingFrames) * 2;
            const auto b = ((read + 1) % kRingFrames) * 2;
            const float f = static_cast<float>(fractional);
            output[i * 2] += (d.pcm[a] + (d.pcm[b] - d.pcm[a]) * f) * g;
            output[i * 2 + 1] += (d.pcm[a + 1] + (d.pcm[b + 1] - d.pcm[a + 1]) * f) * g;
            fractional += ratio;
            const auto consumed = static_cast<uint64_t>(fractional);
            fractional -= consumed;
            read += consumed;
            consumedTotal += consumed;
        }
        // A fade-out reads ahead on a local cursor so the paused position is the stop point.
        if (audible) {
            d.fractional = fractional;
            d.read.store(read, kRelease);
            d.position.store(d.position.load(kRelaxed) + consumedTotal / static_cast<double>(sampleRate), kRelease);
        }
    }
    for (int i = 0; i < frames * 2; ++i) output[i] = ceiling(output[i]);
    outputFrames_.fetch_add(frames, kRelease);
}
} // namespace manadj
