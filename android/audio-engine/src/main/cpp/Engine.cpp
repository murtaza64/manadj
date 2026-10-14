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
    d.claimedStart.store(startSeconds, kRelease);
    d.claimedTransport.store(transport, kRelease);
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

bool Engine::headBegin(int index, int slot) {
    if (index < 0 || index >= kDeckCount || slot < 0 || slot >= kHeadSlots) return false;
    auto& h = decks_[index].heads[slot];
    auto st = h.state.load(kAcquire);
    while (!(st & kHeadBusy)) {
        if (h.state.compare_exchange_weak(st, kHeadWriting, std::memory_order_acq_rel)) return true;
    }
    return false;
}

int Engine::headWrite(int index, int slot, int offsetFrames, const float* samples, int frames) {
    if (index < 0 || index >= kDeckCount || slot < 0 || slot >= kHeadSlots || offsetFrames < 0) return 0;
    auto& h = decks_[index].heads[slot];
    const int n = std::max(0, std::min(frames, kHeadFrames - offsetFrames));
    std::copy(samples, samples + n * 2, h.pcm.begin() + offsetFrames * 2);
    return n;
}

void Engine::headCommit(int index, int slot, uint64_t load, double seconds, int frames) {
    if (index < 0 || index >= kDeckCount || slot < 0 || slot >= kHeadSlots) return;
    auto& h = decks_[index].heads[slot];
    h.load.store(load, kRelaxed);
    h.seconds.store(seconds, kRelaxed);
    h.frames.store(std::clamp(frames, 0, kHeadFrames), kRelaxed);
    h.state.store(frames > 1 ? kHeadReady : kHeadEmpty, kRelease);
}

void Engine::headAbort(int index, int slot) {
    if (index < 0 || index >= kDeckCount || slot < 0 || slot >= kHeadSlots) return;
    decks_[index].heads[slot].state.store(kHeadEmpty, kRelease);
}

void Engine::releaseHead(Deck& d) noexcept {
    const int slot = d.headSlot.load(kRelaxed);
    if (slot >= 0) d.heads[slot].state.fetch_and(~static_cast<uint32_t>(kHeadBusy), kRelease);
    d.headSlot.store(-1, kRelaxed);
}

void Engine::captureTail(Deck& d) noexcept {
    // Only audio that is actually being heard gets a fade-out tail.
    if (!ready(d) || !(d.playing.load(kRelaxed) || d.preview.load(kRelaxed)) || d.envelope <= 0) return;
    const int slot = d.headSlot.load(kRelaxed);
    const auto transport = d.transport.load(kRelaxed);
    int n = 0;
    if (slot >= 0) {
        const auto& h = d.heads[slot];
        const int from = static_cast<int>(d.headPos);
        n = std::clamp(h.frames.load(kRelaxed) - from, 0, kTailFrames);
        std::copy(h.pcm.begin() + from * 2, h.pcm.begin() + (from + n) * 2, d.tail.begin());
    } else if (d.ring.load(kAcquire) == transport) {
        const auto read = d.read.load(kRelaxed);
        n = static_cast<int>(std::min<uint64_t>(kTailFrames, d.write.load(kAcquire) - read));
        for (int i = 0; i < n; ++i) {
            const auto o = ((read + i) % kRingFrames) * 2;
            d.tail[i * 2] = d.pcm[o];
            d.tail[i * 2 + 1] = d.pcm[o + 1];
        }
    }
    if (n < 2) return;
    const double outRate = outputRate_.load(kRelaxed);
    d.tailAvail = n;
    d.tailPos = slot >= 0 ? d.headPos - static_cast<int>(d.headPos) : d.fractional;
    d.tailRatio = (d.sampleRate.load(kRelaxed) / outRate) * (1 + d.pitch.load(kRelaxed) / 100.) * (1 + d.bend.load(kRelaxed) / 100.);
    d.tailGain = d.gain * d.envelope;
    d.tailCueGain = d.cueGain * d.envelope;
    d.tailLeft = kFadeFrames;
}

void Engine::relocate(Deck& d, double seconds, int slot) noexcept {
    captureTail(d);
    releaseHead(d);
    const auto t = std::max(0.0, seconds);
    int offset = 0;
    if (slot >= 0 && slot < kHeadSlots) {
        auto& h = d.heads[slot];
        uint32_t expected = kHeadReady;
        if (h.load.load(kRelaxed) == d.loadId.load(kRelaxed) && h.seconds.load(kRelaxed) == t &&
            h.state.compare_exchange_strong(expected, kHeadReady | kHeadBusy, std::memory_order_acq_rel)) {
            if (h.load.load(kRelaxed) == d.loadId.load(kRelaxed) && h.seconds.load(kRelaxed) == t) {
                d.headSlot.store(slot, kRelaxed);
                offset = h.frames.load(kRelaxed) - 1;
            } else h.state.fetch_and(~static_cast<uint32_t>(kHeadBusy), kRelease);
        }
    }
    d.ringOffset.store(offset, kRelaxed);
    d.headPos = 0;
    d.target.store(t, kRelaxed);
    d.position.store(t, kRelaxed);
    d.fractional = 0;
    d.envelope = 0;
    d.transport.store(d.transport.load(kRelaxed) + 1, kRelease);
}

void Engine::stop(Deck& d) noexcept {
    captureTail(d);
    d.envelope = 0;
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
            d.tailLeft = 0;
            relocate(d, 0);
            break;
        case Op::Play:
            if (isReady) { d.playing.store(true); d.preview.store(false); d.previewSlot.store(-1); }
            break;
        case Op::Pause: stop(d); break;
        case Op::CueDown: {
            if (!isReady) break;
            const double cue = d.cue.load();
            if (d.playing.load()) { stop(d); relocate(d, cue, kMainCueSlot); }
            else if (std::abs(position - cue) < kAtCueEpsilon) { d.preview.store(true); d.previewSlot.store(kMainCueSlot); }
            else d.cue.store(position);
            break;
        }
        case Op::CueUp:
            if (d.previewSlot.load() != kMainCueSlot) break;
            if (d.playing.load()) { d.preview.store(false); d.previewSlot.store(-1); }
            else { stop(d); relocate(d, d.cue.load(), kMainCueSlot); }
            break;
        case Op::HotCueDown: {
            const double at = d.hotcues[c.slot].load();
            if (!isReady || at < 0) break;
            relocate(d, at, c.slot);
            if (!d.playing.load()) { d.preview.store(true); d.previewSlot.store(c.slot); }
            break;
        }
        case Op::HotCueUp:
            if (d.previewSlot.load() != c.slot) break;
            if (d.playing.load()) { d.preview.store(false); d.previewSlot.store(-1); }
            else { stop(d); relocate(d, d.hotcues[c.slot].load(), c.slot); }
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
        case Op::Pfl: d.pfl.store(c.value != 0); updateGain(c.deck); break;
        case Op::CueMix: cueMix_.store(std::clamp(static_cast<float>(c.value), 0.f, 1.f)); break;
    }
    d.applied.store(c.seq, kRelease);
    applied_.store(c.seq, kRelease);
}

void Engine::updateGain(int index) noexcept {
    auto& d = decks_[index];
    // Crossfade -1 = full A, +1 = full B, 0 = both at unity.
    const float x = crossfade_.load();
    const float fade = index == 0 ? std::min(1.f, 1.f - x) : index == 1 ? std::min(1.f, 1.f + x) : 1.f;
    const float trim = std::pow(10.f, (-6.f + (d.trim.load() - .5f) * 24.f) / 20.f);
    d.targetGain = d.fader.load() * d.fader.load() * trim * fade;
    d.targetCueGain = d.pfl.load() ? trim : 0.f;
}

float Engine::ceiling(float x) noexcept {
    // -2 dBFS sample ceiling, ordinary signals below threshold unchanged.
    return std::clamp(x, -.7943282f, .7943282f);
}

void Engine::render(float* output, int frames, int channels) noexcept {
    while (queueRead_.load(kRelaxed) != queueWrite_.load(kAcquire)) {
        const auto read = queueRead_.load(kRelaxed);
        apply(commands_[read % kQueueSize]);
        queueRead_.store(read + 1, kRelease);
    }
    const auto routing = static_cast<Routing>(routing_.load(kRelaxed));
    const float mix = cueMix_.load(kRelaxed);
    for (int done = 0; done < frames;) {
        const int n = std::min(kBlockFrames, frames - done);
        renderBuses(n);
        float* out = output + static_cast<size_t>(done) * channels;
        for (int i = 0; i < n; ++i, out += channels) {
            const float mL = master_[i * 2], mR = master_[i * 2 + 1];
            // Headphone feed: cue bus blended toward master by the cue-mix knob.
            const float cL = cue_[i * 2] * (1 - mix) + mL * mix, cR = cue_[i * 2 + 1] * (1 - mix) + mR * mix;
            for (int c = 0; c < channels; ++c) out[c] = 0;
            if (routing == Routing::SplitMono && channels >= 2) {
                out[0] = ceiling((mL + mR) * .5f);
                out[1] = ceiling((cL + cR) * .5f);
            } else if (routing == Routing::Quad && channels >= 4) {
                out[0] = ceiling(mL); out[1] = ceiling(mR);
                out[2] = ceiling(cL); out[3] = ceiling(cR);
            } else {
                out[0] = ceiling(mL);
                if (channels >= 2) out[1] = ceiling(mR);
            }
        }
        done += n;
    }
    outputFrames_.fetch_add(frames, kRelease);
}

void Engine::renderBuses(int frames) noexcept {
    float* output = master_.data();
    float* cue = cue_.data();
    std::fill(output, output + frames * 2, 0.f);
    std::fill(cue, cue + frames * 2, 0.f);
    const double outRate = outputRate_.load(kRelaxed);
    for (int j = 0; j < kDeckCount; ++j) {
        auto& d = decks_[j];
        // Crossfade tail of whatever was heard before the last relocation/stop.
        for (int i = 0; i < frames && d.tailLeft > 0; ++i) {
            const int k = static_cast<int>(d.tailPos);
            if (k + 1 >= d.tailAvail) { d.tailLeft = 0; break; }
            const float f = static_cast<float>(d.tailPos - k);
            const float ramp = static_cast<float>(d.tailLeft--) / kFadeFrames;
            const float l = d.tail[k * 2] + (d.tail[k * 2 + 2] - d.tail[k * 2]) * f;
            const float r = d.tail[k * 2 + 1] + (d.tail[k * 2 + 3] - d.tail[k * 2 + 1]) * f;
            output[i * 2] += l * d.tailGain * ramp;
            output[i * 2 + 1] += r * d.tailGain * ramp;
            cue[i * 2] += l * d.tailCueGain * ramp;
            cue[i * 2 + 1] += r * d.tailCueGain * ramp;
            d.tailPos += d.tailRatio;
        }
        if (!ready(d)) {
            if ((d.status.load(kAcquire) & 3) == kError) { d.playing.store(false); d.preview.store(false); d.previewSlot.store(-1); }
            continue;
        }
        const auto transport = d.transport.load(kRelaxed);
        const bool ringLive = d.ring.load(kAcquire) == transport;
        if (ringLive && d.positionTransport != transport) {
            // First audible frame of a claimed ring: adopt the decoder's actual start.
            if (d.headSlot.load(kRelaxed) < 0 && d.ringOffset.load(kRelaxed) == 0 && d.claimedTransport.load(kAcquire) == transport)
                d.position.store(d.claimedStart.load(kAcquire), kRelease);
            d.positionTransport = transport;
        }
        if (!(d.playing.load(kRelaxed) || d.preview.load(kRelaxed))) { d.envelope = 0; continue; }
        int slot = d.headSlot.load(kRelaxed);
        if (slot < 0 && !ringLive) continue; // Refill in progress: silent, clock held.
        const auto sampleRate = d.sampleRate.load(kAcquire);
        const double ratio = (sampleRate / outRate) * (1 + d.pitch.load(kRelaxed) / 100.) * (1 + d.bend.load(kRelaxed) / 100.);
        if (d.envelope == 0) { d.gain = d.targetGain; d.cueGain = d.targetCueGain; } // Envelope owns the onset.
        auto read = d.read.load(kRelaxed);
        auto write = d.write.load(kAcquire);
        double fractional = slot >= 0 ? d.headPos : d.fractional;
        uint64_t consumedTotal = 0;
        for (int i = 0; i < frames; ++i) {
            const float* a;
            const float* b;
            if (slot >= 0) {
                const auto& h = d.heads[slot];
                const int last = h.frames.load(kRelaxed) - 1;
                int k = static_cast<int>(fractional);
                if (k >= last) {
                    // Head exhausted: continue in the ring, whose frame 0 is head frame `last`.
                    if (!ringLive) { starvedFrames_.fetch_add(frames - i, kRelaxed); break; }
                    read = d.read.load(kRelaxed) + static_cast<uint64_t>(k - last);
                    write = d.write.load(kAcquire);
                    fractional -= k;
                    releaseHead(d);
                    slot = -1;
                } else {
                    a = &h.pcm[k * 2];
                    b = &h.pcm[(k + 1) * 2];
                }
            }
            if (slot < 0) {
                const auto need = static_cast<uint64_t>(fractional + ratio) + 2;
                if (write - read < need) {
                    write = d.write.load(kAcquire);
                    if (write - read < need) {
                        if (d.eof.load(kAcquire) == transport && d.write.load(kAcquire) - read < need) {
                            d.playing.store(false); d.preview.store(false); d.previewSlot.store(-1);
                        } else starvedFrames_.fetch_add(frames - i, kRelaxed);
                        break;
                    }
                }
                a = &d.pcm[(read % kRingFrames) * 2];
                b = &d.pcm[((read + 1) % kRingFrames) * 2];
            }
            d.envelope = std::min(1.f, d.envelope + 1.f / kFadeFrames);
            d.gain += (d.targetGain - d.gain) * .002f;
            d.cueGain += (d.targetCueGain - d.cueGain) * .002f;
            const float f = static_cast<float>(fractional - static_cast<int>(fractional));
            const float l = (a[0] + (b[0] - a[0]) * f) * d.envelope;
            const float r = (a[1] + (b[1] - a[1]) * f) * d.envelope;
            output[i * 2] += l * d.gain;
            output[i * 2 + 1] += r * d.gain;
            cue[i * 2] += l * d.cueGain;
            cue[i * 2 + 1] += r * d.cueGain;
            const auto before = static_cast<uint64_t>(fractional);
            fractional += ratio;
            const auto consumed = static_cast<uint64_t>(fractional) - before;
            consumedTotal += consumed;
            if (slot < 0) { read += consumed; fractional -= static_cast<uint64_t>(fractional); }
        }
        if (slot >= 0) d.headPos = fractional;
        else { d.fractional = fractional; d.read.store(read, kRelease); }
        d.position.store(d.position.load(kRelaxed) + consumedTotal / static_cast<double>(sampleRate), kRelease);
    }
}
} // namespace manadj
