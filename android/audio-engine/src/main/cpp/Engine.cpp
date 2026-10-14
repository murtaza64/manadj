#include "Engine.h"
#include <algorithm>

namespace manadj {
namespace {
constexpr auto kAcquire = std::memory_order_acquire;
constexpr auto kRelease = std::memory_order_release;
constexpr auto kRelaxed = std::memory_order_relaxed;

// Nearest gridline (desktop snapToNearestBeat on a constant grid; ties toward the earlier beat).
// Gridless: exact.
double snapToBeat(const Deck& d, double t) {
    const double bpm = d.bpm.load(std::memory_order_relaxed);
    if (bpm <= 0) return t;
    const double beat = 60 / bpm, anchor = d.gridAnchor.load(std::memory_order_relaxed);
    const double k = (t - anchor) / beat, lo = std::floor(k);
    const double snapped = anchor + (k - lo <= .5 ? lo : lo + 1) * beat;
    return snapped < 0 ? snapped + beat : snapped;
}

bool ready(const Deck& d) {
    const auto st = d.status.load(kAcquire);
    return (st & 3) == kReady && (st >> 2) == d.loadId.load(kRelaxed);
}
} // namespace

Engine::Engine(int outputRate) : outputRate_(outputRate) {
    for (auto& d : decks_) { for (auto& h : d.hotcues) h.store(-1); for (auto& e : d.eq) e.store(.5f); }
    for (int i = 0; i < kDeckCount; ++i) updateGain(i);
    for (auto& insert : fx_) insert = std::make_unique<fx::Insert>();
    for (auto& d : decks_) { d.stretch = std::make_unique<signalsmith::stretch::SignalsmithStretch<float>>(); configureStretch(d, outputRate); }
    for (int i = 0; i < 16385; ++i) driveCurve_[i] = static_cast<float>(std::tanh(4 * (2.0 * i / 16384 - 1)));
    // Until the app applies the synced desktop setting: the desktop's shipped default
    // (backend/shipped_defaults.json), not the TS code fallback (17 dB / 0.85 compensation, ~12 dB quieter).
    filterSettings_.resonance = 10.5;
    filterSettings_.compensation = .1;
    for (int i = 0; i < kDeckCount; ++i) submitFilter(i, 0);
    applyBeatFx(true);
}

void Engine::configureStretch(Deck& d, int rate) {
    // presetDefault like the desktop, with split computation: the work of each 30 ms spectral step is
    // spread over the step instead of landing in one callback (phone callbacks are 2 ms).
    d.stretch->presetDefault(2, static_cast<float>(rate), true);
    const int window = d.stretch->inputLatency() + d.stretch->outputLatency();
    for (int c = 0; c < 2; ++c) { d.stretchIn[c].assign(window, 0.f); d.stretchOut[c].assign(kBlockFrames, 0.f); }
    d.stretchTransport = ~0ull;
    d.stretchTranspose = 0;
}

void Engine::setOutputRate(int rate) {
    if (rate == outputRate_.load()) return;
    outputRate_.store(rate);
    for (auto& d : decks_) configureStretch(d, rate);
}

uint64_t Engine::submitBeatFx(int effect, int target, bool on, double depth, double beats, int heldMask) {
    if (effect < -1 || effect >= fx::kEffectCount || target < 0 || target >= fx::kTargetCount) return 0;
    if (!std::isfinite(depth) || !std::isfinite(beats) || beats <= 0) return 0;
    const double aux[5] = {static_cast<double>(target), on ? 1.0 : 0.0, beats, static_cast<double>(heldMask & 15), 0};
    return submit(Op::BeatFx, 0, depth, 0, effect, aux);
}

// Each insert's effective state: the section's ON + CH SELECT, or a held per-deck paddle
// (desktop beatFxChannelEngaged); MST ignores paddles.
void Engine::applyBeatFx(bool immediate) noexcept {
    const int effect = fxEffect_.load(kRelaxed), target = fxTarget_.load(kRelaxed), held = fxHeld_.load(kRelaxed);
    const bool on = fxOn_.load(kRelaxed);
    for (int t = 0; t < fx::kTargetCount; ++t) {
        const bool engaged = effect >= 0 && ((on && target == t) || (t < kDeckCount && (held >> t & 1)));
        fx_[t]->update(engaged ? effect : -1, fxDepth_.load(kRelaxed), fxBeats_.load(kRelaxed), immediate);
    }
}

// Per block, before rendering: echo/flanger timing from each deck's tempo (grid x play rate;
// gridless keeps the last known), and the TRANS/ROLL phase from a playing deck's grid.
void Engine::clockBeatFx(int64_t frame) noexcept {
    for (int i = 0; i < kDeckCount; ++i) {
        auto& d = decks_[i];
        const double bpm = d.bpm.load(kRelaxed);
        const double rate = (1 + d.pitch.load(kRelaxed) / 100.) * (1 + d.bend.load(kRelaxed) / 100.);
        if (bpm > 0 && rate > 0) d.beatSeconds = 60 / bpm / rate;
        fx_[i]->setBeatSeconds(d.beatSeconds);
    }
    fx_[fx::kTargetMaster]->setBeatSeconds(decks_[fxTempoDeck_].beatSeconds);
    for (int t = 0; t < fx::kTargetCount; ++t) {
        auto& insert = *fx_[t];
        if (insert.effect() < fx::kTrans) continue;
        const auto& d = decks_[t < kDeckCount ? t : fxTempoDeck_];
        if (!ready(d) || !d.playing.load(kRelaxed)) continue; // A stopped deck leaves the kernel freewheeling.
        const double bpm = d.bpm.load(kRelaxed);
        if (bpm > 0) insert.setClock(static_cast<double>(frame), true, (d.position.load(kRelaxed) - d.gridAnchor.load(kRelaxed)) * bpm / 60, d.beatSeconds);
        else insert.setClock(static_cast<double>(frame), false, 0, d.beatSeconds);
    }
}

uint64_t Engine::submitFilter(int deck, double position) {
    if (deck < 0 || deck >= kDeckCount || !std::isfinite(position)) return 0;
    std::lock_guard<std::mutex> lock(filterMutex_);
    const int slot = static_cast<int>(filterSlot_++ % kFilterSlots);
    filterTargets_[slot] = dsp::describeFilter(position, outputRate_.load(), filterSettings_);
    filterPosition_[deck] = position;
    const double aux[5] = {};
    return submit(Op::Filter, deck, position, 0, slot, aux);
}

uint64_t Engine::submitFilterSettings(const dsp::FilterSettings& settings) {
    std::array<double, kDeckCount> positions;
    {
        std::lock_guard<std::mutex> lock(filterMutex_);
        filterSettings_ = settings.sanitized();
        positions = filterPosition_;
    }
    uint64_t last = 0;
    for (int i = 0; i < kDeckCount; ++i) if (const auto id = submitFilter(i, positions[i])) last = id;
    return last;
}

uint64_t Engine::submit(Op op, int deck, double value, uint64_t load, int slot, const double* aux) {
    if (deck < 0 || deck >= kDeckCount || !std::isfinite(value)) return 0;
    if ((op == Op::HotCueDown || op == Op::HotCueUp || op == Op::HotCueSet || op == Op::HotCueClear || op == Op::HotCueSetAt) &&
        (slot < 0 || slot >= kHotCues)) return 0;
    if (op == Op::Eq && (slot < 0 || slot > 2)) return 0;
    if ((op == Op::Filter || op == Op::BeatFx) && !aux) return 0;
    std::lock_guard<std::mutex> lock(submitMutex_);
    const auto write = queueWrite_.load(kRelaxed);
    if (write - queueRead_.load(kAcquire) >= kQueueSize) return 0;
    const auto seq = accepted_.fetch_add(1) + 1;
    auto& c = commands_[write % kQueueSize];
    c = {op, deck, seq, load, value, slot, {}};
    if (aux) std::copy(aux, aux + 5, c.aux);
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

bool Engine::trackBegin(int index, uint64_t load, uint64_t capacity, int sampleRate, double startSeconds) {
    if (index < 0 || index >= kDeckCount || capacity == 0 || sampleRate <= 0) return false;
    auto& d = decks_[index];
    auto& t = d.track;
    if (d.loadId.load(kAcquire) != load) return false; // Prepare(load) not applied, or superseded.
    // No callback reads an untagged/older track once Prepare(load) applied: safe to reallocate.
    t.load.store(0, kRelease);
    t.frames.store(0, kRelease);
    t.complete.store(false, kRelease);
    if (!t.pcm || t.capacity < capacity || t.capacity > capacity * 2) {
        t.pcm.reset();
        t.capacity = 0;
        t.pcm.reset(new (std::nothrow) int16_t[capacity * 2]);
        if (!t.pcm) return false;
        t.capacity = capacity;
    }
    t.sampleRate.store(sampleRate, kRelease);
    t.startSeconds.store(startSeconds, kRelease);
    t.load.store(load, kRelease);
    return d.loadId.load(kAcquire) == load;
}

int Engine::trackWrite(int index, uint64_t load, const float* samples, int frames) {
    if (index < 0 || index >= kDeckCount || frames <= 0 || !samples) return -1;
    auto& d = decks_[index];
    auto& t = d.track;
    if (t.load.load(kAcquire) != load || d.loadId.load(kAcquire) != load) return -1;
    const auto at = t.frames.load(kRelaxed);
    const int n = static_cast<int>(std::min<uint64_t>(frames, t.capacity - at));
    int16_t* out = t.pcm.get() + at * 2;
    for (int i = 0; i < n * 2; ++i)
        out[i] = static_cast<int16_t>(std::lrint(std::clamp(samples[i], -1.f, 32767.f / 32768) * 32768));
    t.frames.store(at + n, kRelease);
    return n;
}

void Engine::trackFinish(int index, uint64_t load) {
    if (index < 0 || index >= kDeckCount) return;
    auto& t = decks_[index].track;
    if (t.load.load(kAcquire) == load) t.complete.store(true, kRelease);
}

bool Engine::trackCovers(const Deck& d, double seconds, double spanFrames) const noexcept {
    const auto& t = d.track;
    if (t.load.load(kAcquire) != d.loadId.load(kRelaxed) || t.load.load(kRelaxed) == 0) return false;
    const double f = (seconds - t.startSeconds.load(kRelaxed)) * t.sampleRate.load(kRelaxed);
    if (f < 0) return false;
    const auto avail = static_cast<double>(t.frames.load(kAcquire));
    return f + spanFrames + 2 < avail || (t.complete.load(kAcquire) && f + 1 < avail);
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
    if (d.inTrack.load(kRelaxed) && trackCovers(d, d.position.load(kRelaxed), 0)) {
        const auto& t = d.track;
        const int rate = t.sampleRate.load(kRelaxed);
        const double frame = (d.position.load(kRelaxed) - t.startSeconds.load(kRelaxed)) * rate;
        const auto from = static_cast<uint64_t>(frame);
        n = static_cast<int>(std::min<uint64_t>(kTailFrames, t.frames.load(kAcquire) - from));
        const int16_t* pcm = t.pcm.get() + from * 2;
        for (int i = 0; i < n * 2; ++i) d.tail[i] = pcm[i] * (1.f / 32768);
        if (n < 2) return;
        d.tailAvail = n;
        d.tailPos = frame - static_cast<double>(from);
        d.tailRatio = (rate / static_cast<double>(outputRate_.load(kRelaxed))) * (1 + d.pitch.load(kRelaxed) / 100.) * (1 + d.bend.load(kRelaxed) / 100.);
        d.tailGain = d.envelope;
        d.tailLeft = kFadeFrames;
        return;
    }
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
    d.tailGain = d.envelope;
    d.tailLeft = kFadeFrames;
}

void Engine::relocate(Deck& d, double seconds, int slot, double overshootFrames) noexcept {
    captureTail(d);
    releaseHead(d);
    const auto t = std::max(0.0, seconds);
    d.trackEnd.store(false, kRelaxed);
    // Jump into memory only with a margin ahead of a still-running decode, so playback never
    // catches the decode front (that would force a ring resync gap); otherwise heads/ring serve.
    if (trackCovers(d, t, kTrackMarginSeconds * d.track.sampleRate.load(kRelaxed))) {
        // In-memory track: the jump is exact and immediate (overshoot carried, no refill). The
        // ring still follows the new transport in case playback later leaves the decoded region.
        d.ringOffset.store(0, kRelaxed);
        d.inTrack.store(true, kRelaxed); // render from memory next (no re-entry margin check)
        d.headPos = 0;
        d.target.store(t, kRelaxed);
        d.position.store(t + overshootFrames / d.track.sampleRate.load(kRelaxed), kRelaxed);
        d.fractional = 0;
        d.envelope = 0;
        d.transport.store(d.transport.load(kRelaxed) + 1, kRelease);
        return;
    }
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
    // A loop wrap keeps its sub-frame overshoot when playing from the head (no drift across wraps).
    d.headPos = offset > 0 ? std::min(overshootFrames, static_cast<double>(offset - 1)) : 0;
    d.target.store(t, kRelaxed);
    d.position.store(t + (offset > 0 ? d.headPos / d.sampleRate.load(kRelaxed) : 0), kRelaxed);
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
            d.loopActive.store(false);
            d.bpm.store(0);
            d.tailLeft = 0;
            d.inTrack.store(false);
            d.trackEnd.store(false);
            relocate(d, 0);
            break;
        case Op::Play:
            if (isReady) { d.playing.store(true); d.preview.store(false); d.previewSlot.store(-1); }
            break;
        case Op::Pause: stop(d); break;
        case Op::CueDown: {
            if (!isReady) break;
            const double cue = d.cue.load();
            if (d.playing.load()) { stop(d); d.loopActive.store(false); relocate(d, cue, kMainCueSlot); }
            else if (std::abs(position - cue) < kAtCueEpsilon) { d.preview.store(true); d.previewSlot.store(kMainCueSlot); }
            else {
                // Placement: Quantize snaps the cue, and the parked playhead moves with it.
                const double at = quantize_.load() ? snapToBeat(d, position) : position;
                d.cue.store(at);
                if (at != position) relocate(d, at, kMainCueSlot);
            }
            break;
        }
        case Op::CueUp:
            if (d.previewSlot.load() != kMainCueSlot) break;
            if (d.playing.load()) { d.preview.store(false); d.previewSlot.store(-1); }
            else { stop(d); d.loopActive.store(false); relocate(d, d.cue.load(), kMainCueSlot); }
            break;
        case Op::HotCueDown: {
            const double at = d.hotcues[c.slot].load();
            if (!isReady || at < 0) break;
            d.loopActive.store(false);
            // Playing + Quantize: phase-preserving whole-beat jump (desktop phasePreservingJumpTarget);
            // paused triggers land exactly.
            const bool snap = quantize_.load() && d.playing.load() && d.bpm.load() > 0;
            relocate(d, snap ? snapToBeat(d, at) + (position - snapToBeat(d, position)) : at, snap ? -1 : c.slot);
            if (!d.playing.load()) { d.preview.store(true); d.previewSlot.store(c.slot); }
            break;
        }
        case Op::HotCueUp:
            if (d.previewSlot.load() != c.slot) break;
            if (d.playing.load()) { d.preview.store(false); d.previewSlot.store(-1); }
            else { stop(d); relocate(d, d.hotcues[c.slot].load(), c.slot); }
            break;
        case Op::HotCueSet: if (isReady) d.hotcues[c.slot].store(quantize_.load() ? snapToBeat(d, position) : position); break;
        case Op::HotCueClear: d.hotcues[c.slot].store(-1); break;
        case Op::Seek: if (isReady) { d.loopActive.store(false); relocate(d, c.value); } break;
        case Op::SetGrid:
            d.bpm.store(c.value > 0 && std::isfinite(c.value) ? c.value : 0);
            d.gridAnchor.store(c.aux[0]);
            break;
        case Op::BeatJump: {
            // Relative displacement (desktop jumpBeats): an active loop translates with the playhead.
            if (!isReady) break;
            const double bpm = d.bpm.load() > 0 ? d.bpm.load() : kGridlessBpm;
            const double target = std::max(0.0, position + c.value * 60 / bpm);
            if (d.loopActive.load()) {
                const double start = std::max(0.0, d.loopStart.load() + (target - position));
                d.loopEnd.store(start + (d.loopEnd.load() - d.loopStart.load()));
                d.loopStart.store(start);
            }
            relocate(d, target);
            break;
        }
        case Op::LoopToggle:
            if (d.loopActive.load()) { d.loopActive.store(false); break; } // Release: play flows past the end.
            [[fallthrough]];
        case Op::LoopPreset: {
            if (c.op == Op::LoopPreset) {
                const double beats = std::clamp(c.value, kLoopMinBeats, kLoopMaxBeats);
                if (d.loopActive.load()) {
                    if (d.loopBeats.load() == beats) d.loopActive.store(false); // the lit preset releases
                    else applyLoopResize(d, beats);
                    break;
                }
                d.pendingLoopBeats.store(beats);
            }
            // Engage at the playhead, snapped to the nearest beat under Quantize; gridless: inert.
            const double bpm = d.bpm.load();
            if (!isReady || bpm <= 0) break;
            const double beat = 60 / bpm, anchor = d.gridAnchor.load();
            const double start = quantize_.load() ? anchor + std::round((position - anchor) / beat) * beat : position;
            const double beats = d.pendingLoopBeats.load();
            d.loopStart.store(std::max(0.0, start));
            d.loopEnd.store(std::max(0.0, start) + beats * beat);
            d.loopBeats.store(beats);
            d.loopActive.store(true);
            break;
        }
        case Op::LoopResize: {
            const double current = d.loopActive.load() ? d.loopBeats.load() : d.pendingLoopBeats.load();
            const double beats = std::clamp(c.slot == 0 ? current / 2 : c.slot == 1 ? current * 2 : c.value, kLoopMinBeats, kLoopMaxBeats);
            if (!d.loopActive.load()) d.pendingLoopBeats.store(beats);
            else applyLoopResize(d, beats);
            break;
        }
        case Op::Quantize: quantize_.store(c.value != 0); break;
        // Stored cues from a library (applied after Prepare, which resets them).
        // Like the desktop load path, a stopped deck parks at the stored main cue.
        case Op::CueSetAt:
            d.cue.store(std::max(0.0, c.value));
            if (!d.playing.load() && !d.preview.load()) relocate(d, d.cue.load(), kMainCueSlot);
            break;
        case Op::HotCueSetAt: d.hotcues[c.slot].store(c.value < 0 ? -1 : c.value); break;
        case Op::Fader: d.fader = std::clamp(static_cast<float>(c.value), 0.f, 1.f); updateGain(c.deck); break;
        case Op::Trim: d.trim = std::clamp(static_cast<float>(c.value), 0.f, 1.f); updateGain(c.deck); break;
        case Op::Crossfade:
            crossfade_.store(std::clamp(static_cast<float>(c.value), -1.f, 1.f));
            for (int i = 0; i < kDeckCount; ++i) updateGain(i);
            break;
        case Op::Pitch: d.pitch = std::clamp(static_cast<float>(c.value), -25.f, 25.f); break;
        case Op::Bend: d.bend = std::clamp(static_cast<float>(c.value), -8.f, 8.f); break;
        case Op::Pfl: d.pfl.store(c.value != 0); updateGain(c.deck); break;
        case Op::Eq:
            d.eq[c.slot].store(static_cast<float>(std::clamp(c.value, 0.0, 1.0)));
            d.eqTarget[c.slot] = dsp::eqValueToGain(c.value);
            break;
        case Op::Filter: {
            d.filter.store(static_cast<float>(std::clamp(c.value, -1.0, 1.0)));
            const dsp::FilterTarget t = filterTargets_[c.slot % kFilterSlots];
            const int model = static_cast<int>(t.model);
            if (model != d.bankModel) {
                // Model change: the old bank fades out (tails intact), the new one starts at its target.
                if (d.bankModel >= 0) { d.branch[d.bank * 2].gainTarget = d.branch[d.bank * 2 + 1].gainTarget = 0; d.bank ^= 1; }
                d.bankModel = model;
            }
            const int lowIndex = d.bank * 2, selectedIndex = lowIndex + (t.pass == dsp::Pass::Low ? 0 : 1);
            auto& selected = d.branch[selectedIndex];
            if (selected.stages != t.stages) { selected.stages = t.stages; selected.designed = false; if (selected.gain != 0) for (auto& st : selected.stage) st.reset(); }
            for (int k = 0; k < t.stages; ++k) { selected.logTarget[k] = std::log(t.stage[k].frequency); selected.qTarget[k] = t.stage[k].qDb; }
            selected.tau = t.smoothingSeconds;
            selected.gainTarget = static_cast<float>(t.wet * std::pow(10.0, t.gainDb / 20));
            d.branch[selectedIndex ^ 1].gainTarget = 0;
            d.dryTarget = static_cast<float>((1 - t.wet) * std::pow(10.0, t.trim / 20));
            d.driveInTarget = static_cast<float>(std::pow(10.0, t.drive / 20) / 4);
            d.driveOutTarget = static_cast<float>(std::pow(10.0, -t.drive / 20));
            d.driveMixTarget = t.model == dsp::FilterModel::Current ? 0.f : static_cast<float>(t.driveMix);
            break;
        }
        case Op::KeyLock: {
            const bool on = c.value != 0;
            if (on != d.keyLock.load()) {
                // Mode switch while audible: crossfade from the old path (desktop mode toggle declick).
                captureTail(d);
                d.envelope = 0;
                d.keyLock.store(on);
                d.stretchTransport = ~0ull;
            }
            break;
        }
        case Op::CueMix: cueMix_.store(std::clamp(static_cast<float>(c.value), 0.f, 1.f)); break;
        case Op::BeatFx: {
            const int target = static_cast<int>(c.aux[0]);
            fxEffect_.store(c.slot);
            fxTarget_.store(target);
            fxOn_.store(c.aux[1] != 0 && c.slot >= 0); // A null SELECT forces OFF.
            fxDepth_.store(std::clamp(c.value, -1.0, 1.0));
            fxBeats_.store(fx::snapBeats(c.aux[2]));
            fxHeld_.store(static_cast<int>(c.aux[3]) & 15);
            if (target < kDeckCount) fxTempoDeck_ = target;
            applyBeatFx(false);
            break;
        }
    }
    d.applied.store(c.seq, kRelease);
    applied_.store(c.seq, kRelease);
}

void Engine::applyLoopResize(Deck& d, double beats) noexcept {
    // Anchored at the start edge, pure seconds scaling (desktop loop-resize, ADR 0027 §6).
    const double start = d.loopStart.load(), oldEnd = d.loopEnd.load();
    const double end = start + (oldEnd - start) * (beats / d.loopBeats.load());
    d.loopEnd.store(end);
    d.loopBeats.store(beats);
    d.pendingLoopBeats.store(beats);
    // A shrink that strands the playhead pulls it back in at its phase modulo the new length.
    const double length = end - start, position = d.position.load(), offset = position - start;
    if (length > 0 && offset >= length && position < oldEnd) relocate(d, start + std::fmod(offset, length));
}

void Engine::updateGain(int index) noexcept {
    auto& d = decks_[index];
    // Crossfade -1 = full A, +1 = full B, 0 = both at unity.
    const float x = crossfade_.load();
    const float fade = index == 0 ? std::min(1.f, 1.f - x) : index == 1 ? std::min(1.f, 1.f + x) : 1.f;
    const float trim = std::pow(10.f, (-6.f + (d.trim.load() - .5f) * 24.f) / 20.f);
    d.targetGain = d.fader.load() * d.fader.load() * trim;
    d.targetXf = fade;
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
        renderBuses(n, static_cast<int64_t>(outputFrames_.load(kRelaxed)) + done);
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

// Crossfade tail of whatever was heard before the last relocation/stop. Returns whether it wrote.
bool Engine::renderTail(Deck& d, float* strip, int frames) noexcept {
    bool active = false;
    for (int i = 0; i < frames && d.tailLeft > 0; ++i) {
        const int k = static_cast<int>(d.tailPos);
        if (k + 1 >= d.tailAvail) { d.tailLeft = 0; break; }
        const float f = static_cast<float>(d.tailPos - k);
        const float ramp = static_cast<float>(d.tailLeft--) / kFadeFrames;
        const float l = d.tail[k * 2] + (d.tail[k * 2 + 2] - d.tail[k * 2]) * f;
        const float r = d.tail[k * 2 + 1] + (d.tail[k * 2 + 3] - d.tail[k * 2 + 1]) * f;
        strip[i * 2] += l * d.tailGain * ramp;
        strip[i * 2 + 1] += r * d.tailGain * ramp;
        d.tailPos += d.tailRatio;
        active = true;
    }
    return active;
}

// Writes the deck's pre-strip signal (source x envelope + crossfade tail) into `strip`.
// A loop wrap splits the block: the old tail is flushed up to the wrap, then the deck
// relocates to the loop start (from its pre-decoded head) and rendering continues.
bool Engine::renderSource(Deck& d, float* strip, int frames) noexcept {
    bool active = false;
    for (int done = 0; done < frames;) {
        bool wrote = false;
        const int n = renderSegment(d, strip + done * 2, frames - done, wrote);
        active |= wrote;
        if (n < 0) { active |= renderTail(d, strip + done * 2, frames - done); break; }
        done += n;
    }
    return active;
}

// Renders up to `frames`; returns -1 if it covered the whole span, else the frames rendered
// before a loop wrap (tail already flushed over them and the relocation applied).
int Engine::renderSegment(Deck& d, float* strip, int frames, bool& active) noexcept {
    const double outRate = outputRate_.load(kRelaxed);
    {
        if (!ready(d)) {
            if ((d.status.load(kAcquire) & 3) == kError) { d.playing.store(false); d.preview.store(false); d.previewSlot.store(-1); }
            return -1;
        }
        const auto transport = d.transport.load(kRelaxed);
        const bool ringLive = d.ring.load(kAcquire) == transport;
        if (ringLive && d.positionTransport != transport) {
            // First audible frame of a claimed ring: adopt the decoder's actual start.
            if (d.headSlot.load(kRelaxed) < 0 && d.ringOffset.load(kRelaxed) == 0 && d.claimedTransport.load(kAcquire) == transport)
                d.position.store(d.claimedStart.load(kAcquire), kRelease);
            d.positionTransport = transport;
        }
        if (!(d.playing.load(kRelaxed) || d.preview.load(kRelaxed))) { d.envelope = 0; d.stretching.store(false, kRelaxed); return -1; }
        {
            const double span = frames * 8.0 * d.track.sampleRate.load(kRelaxed) / outRate; // max ratio margin
            // Enter memory mode with a margin; once in it, stay while the block itself is covered.
            const double need = d.inTrack.load(kRelaxed) ? span : span + kTrackMarginSeconds * d.track.sampleRate.load(kRelaxed);
            if (trackCovers(d, d.position.load(kRelaxed), need)) return renderTrack(d, strip, frames, active);
            if (d.inTrack.load(kRelaxed)) {
                // Left the decoded region (only while the track is still decoding): resync the ring.
                relocate(d, d.position.load(kRelaxed));
                d.inTrack.store(false, kRelaxed);
                return -1;
            }
        }
        int slot = d.headSlot.load(kRelaxed);
        if (slot < 0 && !ringLive) return -1; // Refill in progress: silent, clock held.
        const auto sampleRate = d.sampleRate.load(kAcquire);
        const double ratio = (sampleRate / outRate) * (1 + d.pitch.load(kRelaxed) / 100.) * (1 + d.bend.load(kRelaxed) / 100.);
        if (d.envelope == 0 && d.tailLeft == 0) { d.gain = d.targetGain; d.cueGain = d.targetCueGain; d.xf = d.targetXf; } // Envelope owns the onset.
        auto read = d.read.load(kRelaxed);
        auto write = d.write.load(kAcquire);
        double fractional = slot >= 0 ? d.headPos : d.fractional;
        uint64_t consumedTotal = 0;
        // Loop wrap point in source frames from here (desktop foldLoopPlayhead: never re-enter from beyond).
        const double startPosition = d.position.load(kRelaxed);
        const bool looping = d.loopActive.load(kRelaxed) && startPosition < d.loopEnd.load(kRelaxed);
        const double untilEnd = looping ? (d.loopEnd.load(kRelaxed) - startPosition) * sampleRate : 0;
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
            const float f = static_cast<float>(fractional - static_cast<int>(fractional));
            strip[i * 2] += (a[0] + (b[0] - a[0]) * f) * d.envelope;
            strip[i * 2 + 1] += (a[1] + (b[1] - a[1]) * f) * d.envelope;
            active = true;
            const auto before = static_cast<uint64_t>(fractional);
            fractional += ratio;
            const auto consumed = static_cast<uint64_t>(fractional) - before;
            consumedTotal += consumed;
            if (slot < 0) { read += consumed; fractional -= static_cast<uint64_t>(fractional); }
            if (looping && consumedTotal >= untilEnd) {
                if (slot >= 0) d.headPos = fractional;
                else { d.fractional = fractional; d.read.store(read, kRelease); }
                renderTail(d, strip, i + 1);
                relocate(d, d.loopStart.load(kRelaxed), kLoopSlot, consumedTotal - untilEnd);
                return i + 1;
            }
        }
        if (slot >= 0) d.headPos = fractional;
        else { d.fractional = fractional; d.read.store(read, kRelease); }
        d.position.store(d.position.load(kRelaxed) + consumedTotal / static_cast<double>(sampleRate), kRelease);
    }
    return -1;
}

// Renders from the in-memory track: like renderSegment, without ring/head bookkeeping.
int Engine::renderTrack(Deck& d, float* strip, int frames, bool& active) noexcept {
    const auto& t = d.track;
    const int rate = t.sampleRate.load(kRelaxed);
    const double ratio = (rate / static_cast<double>(outputRate_.load(kRelaxed))) *
                         (1 + d.pitch.load(kRelaxed) / 100.) * (1 + d.bend.load(kRelaxed) / 100.);
    if (!d.inTrack.load(kRelaxed)) { releaseHead(d); d.inTrack.store(true, kRelaxed); }
    d.positionTransport = d.transport.load(kRelaxed); // the ring's claimed start must not move us
    if (d.keyLock.load(kRelaxed)) return renderStretch(d, strip, frames, active);
    d.stretching.store(false, kRelaxed);
    if (d.envelope == 0 && d.tailLeft == 0) { d.gain = d.targetGain; d.cueGain = d.targetCueGain; d.xf = d.targetXf; }
    const double start = t.startSeconds.load(kRelaxed);
    const auto avail = t.frames.load(kAcquire);
    const bool complete = t.complete.load(kAcquire);
    const double startPosition = d.position.load(kRelaxed);
    double frame = (startPosition - start) * rate;
    const bool looping = d.loopActive.load(kRelaxed) && startPosition < d.loopEnd.load(kRelaxed);
    const double loopEndFrame = looping ? (d.loopEnd.load(kRelaxed) - start) * rate : 0;
    const int16_t* pcm = t.pcm.get();
    constexpr float kScale = 1.f / 32768;
    for (int i = 0; i < frames; ++i) {
        const auto k = static_cast<uint64_t>(frame);
        if (k + 1 >= avail) {
            if (complete) { d.playing.store(false); d.preview.store(false); d.previewSlot.store(-1); d.trackEnd.store(true); }
            else starvedFrames_.fetch_add(frames - i, kRelaxed);
            break;
        }
        const int16_t* a = pcm + k * 2;
        const float f = static_cast<float>(frame - static_cast<double>(k));
        d.envelope = std::min(1.f, d.envelope + 1.f / kFadeFrames);
        strip[i * 2] += (a[0] + (a[2] - a[0]) * f) * kScale * d.envelope;
        strip[i * 2 + 1] += (a[1] + (a[3] - a[1]) * f) * kScale * d.envelope;
        active = true;
        frame += ratio;
        if (looping && frame >= loopEndFrame) {
            d.position.store(start + frame / rate, kRelaxed); // tail continues past the end
            renderTail(d, strip, i + 1);
            relocate(d, d.loopStart.load(kRelaxed), kLoopSlot, frame - loopEndFrame);
            return i + 1;
        }
    }
    d.position.store(start + frame / rate, kRelease);
    return -1;
}

// One stretcher block (desktop SignalsmithEngine.render): refill the whole input window so it ends at
// frame + rate x outputLatency + inputLatency (the algorithmic latency becomes read-ahead, so the
// output sounds `frame` now), seek, then process `frames` of output. Reads past an active loop's end
// fold back to its start; outside the decoded track reads as silence.
void Engine::stretchBlock(Deck& d, double frame, double rate, int frames, float* outL, float* outR) noexcept {
    auto& st = *d.stretch;
    const auto& t = d.track;
    const int window = static_cast<int>(d.stretchIn[0].size());
    const auto end = static_cast<int64_t>(std::llround(frame + rate * st.outputLatency() + st.inputLatency()));
    const int64_t first = end - window;
    const auto avail = static_cast<int64_t>(t.frames.load(kAcquire));
    const int src = t.sampleRate.load(kRelaxed);
    const double start = t.startSeconds.load(kRelaxed);
    const bool looping = d.loopActive.load(kRelaxed);
    const auto loopStart = static_cast<int64_t>(std::llround((d.loopStart.load(kRelaxed) - start) * src));
    const auto loopEnd = static_cast<int64_t>(std::llround((d.loopEnd.load(kRelaxed) - start) * src));
    const int64_t loopLength = loopEnd - loopStart;
    const int16_t* pcm = t.pcm.get();
    float* inL = d.stretchIn[0].data();
    float* inR = d.stretchIn[1].data();
    for (int i = 0; i < window; ++i) {
        int64_t f = first + i;
        if (looping && loopLength > 0 && f >= loopEnd) f = loopStart + (f - loopStart) % loopLength;
        if (f >= 0 && f < avail) { inL[i] = pcm[f * 2] * (1.f / 32768); inR[i] = pcm[f * 2 + 1] * (1.f / 32768); }
        else inL[i] = inR[i] = 0;
    }
    float* ins[2] = {inL, inR};
    float* outs[2] = {outL, outR};
    st.seek(ins, window, rate);
    st.process(ins, 0, outs, frames);
}

int Engine::renderStretch(Deck& d, float* strip, int frames, bool& active) noexcept {
    const auto& t = d.track;
    const int src = t.sampleRate.load(kRelaxed);
    const double out = outputRate_.load(kRelaxed);
    const double speed = (1 + d.pitch.load(kRelaxed) / 100.) * (1 + d.bend.load(kRelaxed) / 100.);
    const double rate = speed * src / out;   // input frames per output frame
    const double transpose = src / out;      // input is read at the output rate: undo that pitch shift
    const double start = t.startSeconds.load(kRelaxed);
    const auto avail = static_cast<double>(t.frames.load(kAcquire));
    double frame = (d.position.load(kRelaxed) - start) * src;
    auto& st = *d.stretch;
    float* outL = d.stretchOut[0].data();
    float* outR = d.stretchOut[1].data();
    const auto transport = d.transport.load(kRelaxed);
    if (!d.stretching.load(kRelaxed) || d.stretchTransport != transport) {
        // Warm-primed reset (desktop prime): render and discard inputLatency of the track's own
        // history ending at the start, in 128-frame blocks, so the first output is not hollow.
        st.reset();
        st.setTransposeFactor(static_cast<float>(transpose), static_cast<float>(8000 / out));
        d.stretchTranspose = transpose;
        int warm = st.inputLatency();
        double at = frame - warm * rate;
        while (warm > 0) {
            const int n = std::min(128, warm);
            stretchBlock(d, at, rate, n, outL, outR);
            at += n * rate;
            warm -= n;
        }
        d.stretchTransport = transport;
        d.stretching.store(true, kRelaxed);
    } else if (transpose != d.stretchTranspose) {
        st.setTransposeFactor(static_cast<float>(transpose), static_cast<float>(8000 / out));
        d.stretchTranspose = transpose;
    }
    if (d.envelope == 0 && d.tailLeft == 0) { d.gain = d.targetGain; d.cueGain = d.targetCueGain; d.xf = d.targetXf; }
    stretchBlock(d, frame, rate, frames, outL, outR);
    for (int i = 0; i < frames; ++i) {
        d.envelope = std::min(1.f, d.envelope + 1.f / kFadeFrames);
        strip[i * 2] += outL[i] * d.envelope;
        strip[i * 2 + 1] += outR[i] * d.envelope;
    }
    active = true;
    frame += frames * rate;
    if (d.loopActive.load(kRelaxed)) {
        const double ls = (d.loopStart.load(kRelaxed) - start) * src, le = (d.loopEnd.load(kRelaxed) - start) * src;
        // The stretcher already heard the wrap (folded window): only the playhead folds.
        if (le > ls && frame >= le && frame - frames * rate < le) frame = ls + std::fmod(frame - ls, le - ls);
    }
    if (frame + 1 >= avail && t.complete.load(kAcquire)) {
        d.playing.store(false); d.preview.store(false); d.previewSlot.store(-1); d.trackEnd.store(true);
        d.stretching.store(false, kRelaxed);
    }
    d.position.store(start + frame / src, kRelease);
    return -1;
}

void Engine::designEq(Deck& d, double rate) noexcept {
    for (int i = 0; i < 2; ++i) {
        d.eqLow[i].design(dsp::Pass::Low, dsp::kCrossoverLowMidHz, dsp::kButterworthQDb, rate);
        d.eqMidHp[i].design(dsp::Pass::High, dsp::kCrossoverLowMidHz, dsp::kButterworthQDb, rate);
        d.eqMidLp[i].design(dsp::Pass::Low, dsp::kCrossoverMidHighHz, dsp::kButterworthQDb, rate);
        d.eqHigh[i].design(dsp::Pass::High, dsp::kCrossoverMidHighHz, dsp::kButterworthQDb, rate);
    }
}

void Engine::resetStrip(Deck& d) noexcept {
    for (int i = 0; i < 2; ++i) {
        d.eqLow[i].reset(); d.eqMidHp[i].reset(); d.eqMidLp[i].reset(); d.eqHigh[i].reset();
        for (auto& b : d.branch) for (auto& st : b.stage) st.reset();
    }
}

void Engine::renderBuses(int frames, int64_t frame) noexcept {
    float* output = master_.data();
    float* cue = cue_.data();
    float* strip = strip_.data();
    std::fill(output, output + frames * 2, 0.f);
    std::fill(cue, cue + frames * 2, 0.f);
    const double rate = outputRate_.load(kRelaxed);
    if (rate != stripRate_) {
        stripRate_ = rate;
        for (auto& d : decks_) { designEq(d, rate); for (auto& b : d.branch) b.designed = false; }
        for (auto& insert : fx_) insert->prepare(rate);
        applyBeatFx(true);
    }
    clockBeatFx(frame);
    // Per-sample one-pole smoothing: EQ ~ desktop 50 ms ramp, filter gains ~35 ms, cutoff/Q 20 ms.
    const float kEq = static_cast<float>(1 - std::exp(-1 / (.017 * rate)));
    const float kMix = static_cast<float>(1 - std::exp(-1 / (.012 * rate)));
    int audible = 0;
    for (int index = 0; index < kDeckCount; ++index) {
        auto& d = decks_[index];
        auto& insert = *fx_[index];
        std::fill(strip, strip + frames * 2, 0.f);
        if (!renderSource(d, strip, frames)) {
            if (d.stripWarm) { resetStrip(d); d.stripWarm = false; }
            // Silent strip: settle smoothed values so the next onset starts at its targets.
            for (int b = 0; b < 3; ++b) d.eqGain[b] = d.eqTarget[b];
            d.dry = d.dryTarget;
            for (auto& br : d.branch) {
                br.gain = br.gainTarget;
                for (int k = 0; k < br.stages; ++k) { br.logHz[k] = br.logTarget[k]; br.qDb[k] = br.qTarget[k]; }
                br.designed = false;
            }
            d.driveIn = d.driveInTarget; d.driveOut = d.driveOutTarget; d.driveMix = d.driveMixTarget;
            d.xf = d.targetXf;
            // A stopped deck's insert still rings out its tail (and the ROLL ring keeps recording).
            insert.process(strip, frames, frame);
            if (insert.audible()) {
                audible |= 1 << index;
                for (int i = 0; i < frames * 2; ++i) output[i] += strip[i] * d.xf;
            }
            continue;
        }
        d.stripWarm = true;
        for (int i = 0; i < frames; ++i) {
            if (i % kSweepBlock == 0) {
                for (auto& br : d.branch) {
                    if (br.gain == 0 && br.gainTarget == 0) continue;
                    if (br.gain == 0) { // Waking a silent branch: start at its target (sweepFilter.ts).
                        for (int k = 0; k < br.stages; ++k) { br.logHz[k] = br.logTarget[k]; br.qDb[k] = br.qTarget[k]; br.stage[k].reset(); }
                        br.designed = false;
                    }
                    bool moved = !br.designed;
                    const double kSweep = 1 - std::exp(-static_cast<double>(kSweepBlock) / (br.tau * rate));
                    for (int k = 0; k < br.stages; ++k) {
                        if (std::abs(br.logHz[k] - br.logTarget[k]) > 1e-4 || std::abs(br.qDb[k] - br.qTarget[k]) > 1e-3) {
                            br.logHz[k] += (br.logTarget[k] - br.logHz[k]) * kSweep;
                            br.qDb[k] += (br.qTarget[k] - br.qDb[k]) * kSweep;
                            moved = true;
                        }
                    }
                    if (moved) {
                        for (int k = 0; k < br.stages; ++k) br.stage[k].design(br.pass, std::exp(br.logHz[k]), br.qDb[k], rate);
                        br.designed = true;
                    }
                }
            }
            for (int b = 0; b < 3; ++b) {
                d.eqGain[b] += (d.eqTarget[b] - d.eqGain[b]) * kEq;
                if (std::abs(d.eqGain[b] - d.eqTarget[b]) < 1e-6f) d.eqGain[b] = d.eqTarget[b];
            }
            d.dry += (d.dryTarget - d.dry) * kMix;
            d.driveMix += (d.driveMixTarget - d.driveMix) * kMix;
            d.driveIn += (d.driveInTarget - d.driveIn) * kMix;
            d.driveOut += (d.driveOutTarget - d.driveOut) * kMix;
            for (auto& br : d.branch) {
                br.gain += (br.gainTarget - br.gain) * kMix;
                if (std::abs(br.gain - br.gainTarget) < 1e-6f) br.gain = br.gainTarget;
            }
            d.gain += (d.targetGain - d.gain) * .002f;
            d.cueGain += (d.targetCueGain - d.cueGain) * .002f;
            for (int ch = 0; ch < 2; ++ch) {
                const float x = strip[i * 2 + ch];
                const float low = d.eqLow[1].process(ch, d.eqLow[0].process(ch, x));
                const float mid = d.eqMidLp[1].process(ch, d.eqMidLp[0].process(ch, d.eqMidHp[1].process(ch, d.eqMidHp[0].process(ch, x))));
                const float high = d.eqHigh[1].process(ch, d.eqHigh[0].process(ch, x));
                const float e = low * d.eqGain[0] + mid * d.eqGain[1] + high * d.eqGain[2];
                float y = e * d.dry;
                for (auto& br : d.branch) {
                    if (br.gain == 0) continue;
                    float v = e;
                    for (int k = 0; k < br.stages; ++k) v = br.stage[k].process(ch, v);
                    y += v * br.gain;
                }
                if (d.driveMix > 1e-6f) { // WaveShaper: 16385-point curve over [-1, 1], clamped.
                    const float pos = (std::clamp(y * d.driveIn, -1.f, 1.f) + 1) * 8192;
                    const int ci = std::min(static_cast<int>(pos), 16383);
                    const float shaped = driveCurve_[ci] + (driveCurve_[ci + 1] - driveCurve_[ci]) * (pos - ci);
                    y = y * (1 - d.driveMix) + shaped * d.driveOut * d.driveMix;
                }
                strip[i * 2 + ch] = y * d.gain; // post-fader, into the Beat FX insert
                cue[i * 2 + ch] += y * d.cueGain;
            }
        }
        insert.process(strip, frames, frame);
        if (insert.audible()) audible |= 1 << index;
        for (int i = 0; i < frames; ++i) {
            d.xf += (d.targetXf - d.xf) * .002f;
            output[i * 2] += strip[i * 2] * d.xf;
            output[i * 2 + 1] += strip[i * 2 + 1] * d.xf;
        }
    }
    auto& masterInsert = *fx_[fx::kTargetMaster];
    masterInsert.process(output, frames, frame);
    if (masterInsert.audible()) audible |= 1 << fx::kTargetMaster;
    fxAudible_.store(audible, kRelaxed);
}
} // namespace manadj
