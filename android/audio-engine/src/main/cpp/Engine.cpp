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
    for (auto& d : decks_) { for (auto& h : d.hotcues) h.store(-1); for (auto& e : d.eq) e.store(.5f); }
    for (int i = 0; i < kDeckCount; ++i) updateGain(i);
    for (auto& insert : fx_) insert = std::make_unique<fx::Insert>();
    applyBeatFx(true);
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
    const dsp::FilterSettings settings;
    const auto t = dsp::describeFilter(position, outputRate_.load(), settings);
    const double aux[5] = {t.pass == dsp::Pass::Low ? 0.0 : 1.0, t.frequency, t.wet, settings.resonance, t.gain};
    return submit(Op::Filter, deck, position, 0, 0, aux);
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
    d.tailGain = d.envelope;
    d.tailLeft = kFadeFrames;
}

void Engine::relocate(Deck& d, double seconds, int slot, double overshootFrames) noexcept {
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
            else d.cue.store(position);
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
            const bool low = c.aux[0] == 0;
            const float wet = static_cast<float>(c.aux[2]);
            d.dryTarget = 1 - wet;
            auto& selected = d.branch[low ? 0 : 1];
            selected.hzTarget = c.aux[1];
            selected.qTarget = c.aux[3];
            selected.gainTarget = wet * static_cast<float>(c.aux[4]);
            d.branch[low ? 1 : 0].gainTarget = 0;
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
        if (!(d.playing.load(kRelaxed) || d.preview.load(kRelaxed))) { d.envelope = 0; return -1; }
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
        for (auto& b : d.branch) b.stages[i].reset();
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
    const double kSweep = 1 - std::exp(-static_cast<double>(kSweepBlock) / (.020 * rate));
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
            for (auto& br : d.branch) { br.gain = br.gainTarget; br.logHz = std::log(br.hzTarget); br.qDb = br.qTarget; br.designed = false; }
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
                        br.logHz = std::log(br.hzTarget); br.qDb = br.qTarget; br.designed = false;
                        br.stages[0].reset(); br.stages[1].reset();
                    }
                    const double logTarget = std::log(br.hzTarget);
                    if (!br.designed || std::abs(br.logHz - logTarget) > 1e-4 || std::abs(br.qDb - br.qTarget) > 1e-3) {
                        br.logHz += (logTarget - br.logHz) * kSweep;
                        br.qDb += (br.qTarget - br.qDb) * kSweep;
                        for (int k = 0; k < 2; ++k)
                            br.stages[k].design(br.pass, std::exp(br.logHz), dsp::kRes24QDb[k] + (k == 1 ? br.qDb : 0), rate);
                        br.designed = true;
                    }
                }
            }
            for (int b = 0; b < 3; ++b) {
                d.eqGain[b] += (d.eqTarget[b] - d.eqGain[b]) * kEq;
                if (std::abs(d.eqGain[b] - d.eqTarget[b]) < 1e-6f) d.eqGain[b] = d.eqTarget[b];
            }
            d.dry += (d.dryTarget - d.dry) * kMix;
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
                for (auto& br : d.branch)
                    if (br.gain != 0) y += br.stages[1].process(ch, br.stages[0].process(ch, e)) * br.gain;
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
