#pragma once
// Beat FX insert with desktop parity (frontend/src/playback/{beatFx,beatFxSettings}.ts,
// worklet/beatFxRepeatKernel.ts): parallel ECHO / LOW CUT ECHO / REVERB / FLANGER returns over a
// dry path, with TRANS / ROLL (replacement effects) in series ahead of them. One insert per
// channel (post-fader, pre-crossfader) plus one on master; the Engine owns the section state.
// Buffers are allocated at construction (control thread); everything else is callback-safe.
#include "Dsp.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace manadj::fx {
enum Effect : int { kEcho, kLowCutEcho, kReverb, kFlanger, kTrans, kRoll, kEffectCount };
enum Target : int { kTargetA, kTargetB, kTargetC, kTargetD, kTargetMaster, kTargetCount };

/** GRV6 BEAT ◄ ► ladder (ECHO_BEAT_LADDER). */
constexpr double kLadder[] = {0.0625, 0.125, 0.25, 0.5, 0.75, 1, 2, 4, 8};
constexpr int kLadderSize = 9;
constexpr double kBeatsDefault = .5;       // ECHO_BEATS_DEFAULT
constexpr double kBeatSecondsDefault = .5; // 120 BPM stand-in until a deck reports a tempo
constexpr double kMaxEchoDelayS = 10, kMinEchoDelayS = .01;
constexpr double kRingSeconds = 10;        // ROLL ring (REPEAT_RING_SECONDS)
constexpr int kCapacityRate = 48000;       // echo line / ROLL ring sized here; higher rates get shorter maxima
constexpr int kMaxRate = 192000;           // short lines (flanger, reverb) sized for this
constexpr double kDeclickS = .05, kRetargetS = .25, kRepeatDeclickS = .005;
constexpr int kBeatsPerBar = 4;
constexpr double kClockJumpBeats = .02, kClockTempoTolerance = .001;

/** Nearest ladder rung (off-ladder inputs snap, as stepEchoBeats does first). */
inline double snapBeats(double beats) {
    int best = 0;
    for (int i = 1; i < kLadderSize; ++i)
        if (std::abs(kLadder[i] - beats) < std::abs(kLadder[best] - beats)) best = i;
    return kLadder[best];
}

inline double echoDelaySeconds(double beats, double beatSeconds) {
    const double beat = std::isfinite(beatSeconds) && beatSeconds > 0 ? beatSeconds : kBeatSecondsDefault;
    return std::clamp(beats * beat, kMinEchoDelayS, kMaxEchoDelayS);
}

struct MixGains { float dry, wet; };
/** Parallel effects: -1 original only, 0 both at unity, +1 effect only (beatFxMixGains). */
inline MixGains parallelGains(double depth) {
    const double m = (std::clamp(depth, -1.0, 1.0) + 1) / 2;
    return {static_cast<float>(std::min(1.0, 2 * (1 - m))), static_cast<float>(std::min(1.0, 2 * m))};
}
/** TRANS/ROLL: linear crossfade (replacementMixGains). */
inline MixGains replacementGains(double depth) {
    const double m = (std::clamp(depth, -1.0, 1.0) + 1) / 2;
    return {static_cast<float>(1 - m), static_cast<float>(m)};
}

/** DEFAULT_BEAT_FX_SETTINGS (flanger length unit 'bars'). */
struct Settings {
    double echoFeedback = .5, echoSaturation = 1;
    double reverbDecay = 2.5, reverbDampingHz = 12000, reverbStereoWidth = 1;
    double flangerDelayMs = 3, flangerWidthMs = 2, flangerFeedback = .35;
    bool flangerBars = true;
    double lowCutEchoHz = 300;
    double transDuty = .5, transSlopeMs = 3, rollFadeMs = 4;
};

/** Linear ramp to a target over a fixed span (Web Audio linearRampToValueAtTime). */
struct Ramp {
    double value = 0, target = 0, step = 0;
    int left = 0;
    void to(double t, double frames) {
        if (t == target && (left > 0 || value == t)) return;
        target = t;
        if (frames < 1) { value = t; left = 0; return; }
        left = static_cast<int>(std::ceil(frames));
        step = (t - value) / left;
    }
    double next() {
        if (left > 0) { value += step; if (--left == 0) value = target; }
        return value;
    }
    bool settled() const { return left == 0; }
};

/** TRANS gate value [0, 1] at `x` frames into a `cell`-frame cell (transGate). */
inline double transGate(double x, double cell, double duty, double slope) {
    const double on = std::clamp(duty, 0.0, 1.0) * cell;
    const double s = std::max(1.0, std::min({slope, on / 2, (cell - on) / 2}));
    if (x < s) return x / s;
    if (x < on) return 1;
    if (x < on + s) return 1 - (x - on) / s;
    return 0;
}

/** TRANS + ROLL kernel: a line-for-line port of beatFxRepeatKernel.ts RepeatKernel. */
class Repeat {
public:
    enum Mode { kOff, kTrans, kRoll };
    explicit Repeat(int capacityFrames) : cap_(capacityFrames), ringL_(capacityFrames), ringR_(capacityFrames) {}

    void prepare(double rate) {
        rate_ = rate;
        clock_.valid = false;
        roll_.valid = rollFrom_.valid = false;
        historyStart_ = writtenUntil_ + 1; // Rate change: older history is unusable.
    }
    void setSettings(const Settings& s) { duty_ = s.transDuty; slopeMs_ = s.transSlopeMs; fadeMs_ = s.rollFadeMs; }

    void setClock(double frame, bool hasBeat, double beat, double beatFrames) {
        if (!(beatFrames > 0)) return;
        if (!hasBeat) {
            const double b = clock_.valid ? beatAt(frame) : 0;
            clock_ = {true, frame, b, beatFrames};
            return;
        }
        if (clock_.valid) {
            const double predicted = beatAt(frame);
            const bool sameTempo = std::abs(beatFrames / clock_.beatFrames - 1) < kClockTempoTolerance;
            if (sameTempo && std::abs(predicted - beat) < kClockJumpBeats) return;
        }
        clock_ = {true, frame, beat, beatFrames};
    }

    void setState(Mode mode, double beats, double dry, double wet, double frame) {
        const Mode previousMode = mode_;
        const double previousBeats = beats_;
        mode_ = mode; beats_ = std::max(1.0 / 64, beats); dryTarget_ = dry; wetTarget_ = wet;
        if (mode == kRoll) {
            if (previousMode != kRoll || !roll_.valid) engageRoll(frame);
            else if (std::abs(beats - previousBeats) > 1e-9) resliceRoll(frame, beats);
        }
    }

    bool active() const { return transEngaged_ > 0 || rollEngaged_ > 0 || mode_ != kOff; }
    Mode mode() const { return mode_; }
    bool rolling() const { return roll_.valid; }
    double rollStart() const { return roll_.start; }
    double rollLength() const { return roll_.length; }

    /** Records only (fast path while nothing is engaged). */
    void record(const float* lr, int n, int64_t frame) noexcept {
        for (int i = 0; i < n; ++i) write(frame + i, lr[i * 2], lr[i * 2 + 1]);
    }

    void process(float* lr, int n, int64_t frame) noexcept {
        const double step = 1 / std::max(1.0, kRepeatDeclickS * rate_);
        const double transTarget = mode_ == kTrans ? 1 : 0;
        const double rollTarget = mode_ == kRoll ? 1 : 0;
        if (mode_ == kTrans) ensureClock(static_cast<double>(frame));
        const bool hasClock = clock_.valid;
        const double cell = hasClock ? beats_ * clock_.beatFrames : 0;
        const double slope = slopeMs_ * rate_ / 1000;
        for (int i = 0; i < n; ++i) {
            const int64_t f = frame + i;
            const float l = lr[i * 2], r = lr[i * 2 + 1];
            if (!roll_.valid || static_cast<double>(f) < roll_.freezeAt) write(f, l, r);
            dry_ += std::clamp(dryTarget_ - dry_, -step, step);
            wet_ += std::clamp(wetTarget_ - wet_, -step, step);
            transEngaged_ += std::clamp(transTarget - transEngaged_, -step, step);
            rollEngaged_ += std::clamp(rollTarget - rollEngaged_, -step, step);

            double gain = 1;
            if (transEngaged_ > 0 && hasClock && cell > 0) {
                const double beat = clock_.beat + (static_cast<double>(f) - clock_.frame) / clock_.beatFrames;
                const double cells = beat / beats_;
                const double x = (cells - std::floor(cells)) * cell;
                const double gate = transGate(x, cell, duty_, slope);
                gain = 1 - transEngaged_ + transEngaged_ * (dry_ + wet_ * gate);
            }
            double yL = l * gain, yR = r * gain;
            if (roll_.valid && rollEngaged_ > 0) {
                double rL = loopSample(roll_.start, roll_.length, f, ringL_);
                double rR = loopSample(roll_.start, roll_.length, f, ringR_);
                if (rollFrom_.valid) {
                    const double a = rollFrom_.remaining / rollFrom_.total;
                    rL = (1 - a) * rL + a * loopSample(rollFrom_.start, rollFrom_.length, f, ringL_);
                    rR = (1 - a) * rR + a * loopSample(rollFrom_.start, rollFrom_.length, f, ringR_);
                    if (--rollFrom_.remaining <= 0) rollFrom_.valid = false;
                }
                const double e = rollEngaged_;
                yL = (1 - e) * yL + e * (dry_ * yL + wet_ * rL);
                yR = (1 - e) * yR + e * (dry_ * yR + wet_ * rR);
            } else if (roll_.valid && rollEngaged_ <= 0 && rollTarget == 0) {
                roll_.valid = rollFrom_.valid = false; // Fully released: resume recording.
            }
            lr[i * 2] = static_cast<float>(yL);
            lr[i * 2 + 1] = static_cast<float>(yR);
        }
    }

private:
    struct Clock { bool valid; double frame, beat, beatFrames; };
    struct Region { bool valid; double start, length, freezeAt; };
    struct From { bool valid; double start, length, remaining, total; };
    const int cap_;
    std::vector<float> ringL_, ringR_;
    double rate_ = 48000;
    int64_t historyStart_ = 0, writtenUntil_ = 0;
    Mode mode_ = kOff;
    double beats_ = 1, dryTarget_ = 1, wetTarget_ = 0;
    double duty_ = .5, slopeMs_ = 3, fadeMs_ = 4;
    Clock clock_{false, 0, 0, 0};
    double dry_ = 1, wet_ = 0, transEngaged_ = 0, rollEngaged_ = 0;
    Region roll_{false, 0, 0, 0};
    From rollFrom_{false, 0, 0, 0, 0};

    void write(int64_t f, float l, float r) noexcept {
        if (f != writtenUntil_) historyStart_ = f; // gap
        const auto index = static_cast<size_t>(f % cap_);
        ringL_[index] = l;
        ringR_[index] = r;
        writtenUntil_ = f + 1;
    }
    void ensureClock(double frame) { if (!clock_.valid) clock_ = {true, frame, 0, rate_ / 2}; }
    double beatAt(double frame) const { return clock_.beat + (frame - clock_.frame) / clock_.beatFrames; }
    double fadeFrames(double length) const { return std::max(1.0, std::min(fadeMs_ * rate_ / 1000, length / 4)); }
    bool valid(int64_t frame) const {
        return frame >= historyStart_ && frame < writtenUntil_ && frame >= writtenUntil_ - cap_;
    }
    void engageRoll(double frame) {
        ensureClock(frame);
        const double length = std::min(beats_ * clock_.beatFrames, cap_ / 2.0);
        const double boundaryBeat = std::floor(beatAt(frame) / beats_ + 1e-9) * beats_;
        const double boundary = clock_.frame + (boundaryBeat - clock_.beat) * clock_.beatFrames;
        const double backward = boundary - length;
        const double cell = beats_ * clock_.beatFrames;
        const double start = valid(static_cast<int64_t>(std::floor(backward))) ? backward
            : boundary >= static_cast<double>(historyStart_) ? boundary : boundary + cell;
        roll_ = {true, start, length, start + length + fadeFrames(length)};
        rollFrom_.valid = false;
    }
    void resliceRoll(double frame, double beats) {
        ensureClock(frame);
        const double length = std::min(beats * clock_.beatFrames, cap_ / 2.0);
        const double end = roll_.start + roll_.length;
        const double start = length <= roll_.length ? roll_.start : end - length;
        if (length > roll_.length && !valid(static_cast<int64_t>(std::floor(start)))) return;
        const double fade = fadeFrames(std::min(length, roll_.length));
        rollFrom_ = {true, roll_.start, roll_.length, fade, fade};
        roll_ = {true, start, length, std::max(roll_.freezeAt, start + length + fadeFrames(length))};
    }
    double ringAt(double frame, const std::vector<float>& ring) const {
        const auto index = static_cast<int64_t>(std::floor(frame));
        if (!valid(index)) return 0;
        return ring[static_cast<size_t>(((index % cap_) + cap_) % cap_)];
    }
    double loopSample(double start, double length, int64_t f, const std::vector<float>& ring) const {
        const double frame = static_cast<double>(f);
        if (frame < start) return ringAt(frame, ring);
        const double p = std::fmod(std::fmod(frame - start, length) + length, length);
        const double fade = fadeFrames(length);
        const double head = ringAt(start + p, ring);
        if (p >= fade || frame - start < length) return head;
        const double a = p / fade;
        return a * head + (1 - a) * ringAt(start + length + p, ring);
    }
};

/**
 * Algorithmic stand-in for the desktop's synthesized 2.5 s noise-convolution reverb: an
 * 8-line Hadamard FDN behind per-channel allpass diffusers. RT60 = reverbDecay, output one-pole
 * damping at reverbDampingHz, stereo width as mid/side, and the impulse response normalized
 * to unit energy per channel like reverbImpulseResponse.
 */
class Reverb {
public:
    static constexpr int kLines = 8;
    static constexpr int kDiffusers = 4;
    Reverb() {
        for (int i = 0; i < kLines; ++i) lines_[i].assign(static_cast<size_t>(kLengths[i] * (kMaxRate / 48000.0)) + 2, 0.f);
        for (int c = 0; c < 2; ++c)
            for (int k = 0; k < kDiffusers; ++k)
                diffusers_[c][k].assign(static_cast<size_t>(kDiffuserLengths[c][k] * (kMaxRate / 48000.0)) + 2, 0.f);
    }
    void prepare(double rate, const Settings& s) {
        for (int i = 0; i < kLines; ++i) {
            length_[i] = std::max(1, static_cast<int>(std::lround(kLengths[i] * rate / 48000)));
            gain_[i] = static_cast<float>(std::pow(10.0, -3.0 * length_[i] / (s.reverbDecay * rate)));
        }
        for (int c = 0; c < 2; ++c)
            for (int k = 0; k < kDiffusers; ++k)
                diffuserLength_[c][k] = std::max(1, static_cast<int>(std::lround(kDiffuserLengths[c][k] * rate / 48000)));
        smoothing_ = static_cast<float>(std::exp(-2 * dsp::kPi * std::min(s.reverbDampingHz, rate * .49) / rate));
        width_ = static_cast<float>(std::clamp(s.reverbStereoWidth, 0.0, 1.0));
        reset();
    }
    void reset() {
        for (auto& l : lines_) std::fill(l.begin(), l.end(), 0.f);
        for (auto& c : diffusers_) for (auto& d : c) std::fill(d.begin(), d.end(), 0.f);
        for (int& p : pos_) p = 0;
        for (auto& p : diffuserPos_) for (int& q : p) q = 0;
        lowL_ = lowR_ = 0;
    }
    /** Unit-energy output scale, measured once at 48 kHz (the FDN is rate-scaled, so it holds). */
    static float scale() {
        static const float value = [] {
            Reverb r;
            Settings s;
            r.prepare(48000, s);
            double energy = 0;
            const int n = static_cast<int>(s.reverbDecay * 48000 * 1.5);
            for (int i = 0; i < n; ++i) {
                float l, rr;
                r.process(i == 0 ? 1.f : 0.f, 0.f, l, rr);
                energy += static_cast<double>(l) * l;
            }
            return static_cast<float>(1 / std::sqrt(energy > 0 ? energy : 1));
        }();
        return value;
    }
    void setScale(float s) { scale_ = s; }

    void process(float inL, float inR, float& outL, float& outR) noexcept {
        const float dL = diffuse(0, inL), dR = diffuse(1, inR);
        float v[kLines], m[kLines];
        for (int i = 0; i < kLines; ++i) {
            // Line i holds its last length_[i] inputs in a ring of exactly that size.
            m[i] = v[i] = lines_[i][static_cast<size_t>(pos_[i])] * gain_[i];
        }
        for (int h = 1; h < kLines; h <<= 1)
            for (int i = 0; i < kLines; i += h << 1)
                for (int j = i; j < i + h; ++j) { const float a = m[j], b = m[j + h]; m[j] = a + b; m[j + h] = a - b; }
        constexpr float kNorm = 0.35355339f; // 1/sqrt(8): orthonormal Hadamard
        for (int i = 0; i < kLines; ++i) {
            lines_[i][static_cast<size_t>(pos_[i])] = m[i] * kNorm + ((i & 1) ? dR : dL);
            if (++pos_[i] >= length_[i]) pos_[i] = 0;
        }
        float yL = v[0] - v[2] + v[4] - v[6];
        float yR = v[1] - v[3] + v[5] - v[7];
        const float mid = (yL + yR) * .5f, side = (yL - yR) * .5f * width_;
        yL = mid + side; yR = mid - side;
        lowL_ = (1 - smoothing_) * yL + smoothing_ * lowL_;
        lowR_ = (1 - smoothing_) * yR + smoothing_ * lowR_;
        outL = lowL_ * scale_;
        outR = lowR_ * scale_;
    }

private:
    static constexpr int kLengths[kLines] = {1123, 1361, 1597, 1787, 2027, 2251, 2473, 2711};
    static constexpr int kDiffuserLengths[2][kDiffusers] = {{155, 117, 413, 301}, {163, 109, 397, 311}};
    static constexpr float kDiffuserGain = .7f;
    std::vector<float> lines_[kLines];
    std::vector<float> diffusers_[2][kDiffusers];
    int length_[kLines] = {}, pos_[kLines] = {};
    int diffuserLength_[2][kDiffusers] = {}, diffuserPos_[2][kDiffusers] = {};
    float gain_[kLines] = {};
    float smoothing_ = 0, width_ = 1, lowL_ = 0, lowR_ = 0, scale_ = 1;

    float diffuse(int c, float x) noexcept {
        for (int k = 0; k < kDiffusers; ++k) {
            auto& buf = diffusers_[c][k];
            int& p = diffuserPos_[c][k];
            const float delayed = buf[static_cast<size_t>(p)];
            const float w = x + kDiffuserGain * delayed;
            buf[static_cast<size_t>(p)] = w;
            x = delayed - kDiffuserGain * w;
            if (++p >= diffuserLength_[c][k]) p = 0;
        }
        return x;
    }
};

/** One Beat FX insert (createBeatFxInsert). */
class Insert {
public:
    Insert()
        : echo_(static_cast<size_t>(kMaxEchoDelayS * kCapacityRate + 4) * 2),
          flanger_(static_cast<size_t>(.05 * kMaxRate + 4) * 2),
          repeat_(static_cast<int>(kRingSeconds * kCapacityRate)),
          reverbScale_(Reverb::scale()) {
        prepare(48000);
    }

    /** Rate change / init: designs filters and clears all state. Callback-safe. */
    void prepare(double rate) {
        rate_ = rate;
        std::fill(echo_.begin(), echo_.end(), 0.f);
        std::fill(flanger_.begin(), flanger_.end(), 0.f);
        echoPos_ = flangerPos_ = echoQuiet_ = flangerQuiet_ = 0;
        echoLive_ = flangerLive_ = false;
        reverb_.prepare(rate, settings_);
        reverb_.setScale(reverbScale_);
        reverbLive_ = false;
        repeat_.prepare(rate);
        repeat_.setSettings(settings_);
        // echoClipCurve(echoSaturation).
        const double drive = std::max(0.0, settings_.echoSaturation);
        for (int i = 0; i <= 4096; ++i) {
            const double x = 2.0 * i / 4096 - 1;
            clip_[i] = static_cast<float>(drive > 0 ? std::tanh(drive * x) / std::tanh(drive) : x);
        }
        hpf_.design(dsp::Pass::High, settings_.lowCutEchoHz, 20 * std::log10(0.70710678), rate);
        hpf_.reset();
        lfoPhase_ = 0;
        quietFrames_ = 0;
        idle_ = effect_ < 0;
        primed_ = false;
        retime(true);
    }

    /** The insert's effective section state: the engaged effect (-1 none), depth, beats. */
    void update(int effect, double depth, double beats, bool immediate = false) {
        const double declick = immediate ? 0 : kDeclickS * rate_;
        const MixGains mix = parallelGains(depth);
        const bool parallel = effect >= kEcho && effect <= kFlanger;
        for (int e = kEcho; e <= kFlanger; ++e) send_[e].to(effect == e ? 1 : 0, declick);
        wet_.to(mix.wet, declick);
        dry_.to(parallel ? mix.dry : 1, declick);
        // The echo loop is shared: its low cut follows whichever echo was engaged last.
        if (effect == kLowCutEcho) hpfMix_.to(1, declick);
        else if (effect == kEcho) hpfMix_.to(0, declick);
        const MixGains replace = replacementGains(depth);
        const Repeat::Mode mode = effect == kTrans ? Repeat::kTrans : effect == kRoll ? Repeat::kRoll : Repeat::kOff;
        if (mode != pendingMode_ || beats != pendingBeats_ || replace.dry != pendingDry_ || replace.wet != pendingWet_) {
            pendingMode_ = mode; pendingBeats_ = beats; pendingDry_ = replace.dry; pendingWet_ = replace.wet;
            repeatDirty_ = true;
        }
        const bool beatsChanged = beats != beats_;
        effect_ = effect;
        beats_ = beats;
        if (beatsChanged) retime(immediate);
        if (effect >= 0 || !settledDry()) { idle_ = false; quietFrames_ = 0; }
    }

    /** Wall seconds per beat of the clocking deck (grid x play rate); ramps 0.25 s. */
    void setBeatSeconds(double seconds, bool immediate = false) {
        if (!(seconds > 0) || !std::isfinite(seconds)) return;
        if (std::abs(seconds - beatSeconds_) < 1e-3 && !immediate) return;
        beatSeconds_ = seconds;
        retime(immediate);
    }
    double beatSeconds() const { return beatSeconds_; }

    /** TRANS/ROLL phase source: beat coordinate at absolute output frame (hasBeat false = tempo only). */
    void setClock(double frame, bool hasBeat, double beat, double beatSeconds) {
        repeat_.setClock(frame, hasBeat, beat, beatSeconds * rate_);
    }

    bool audible() const { return !idle_ || repeat_.active(); }
    int effect() const { return effect_; }
    const Repeat& repeat() const { return repeat_; }
    double echoDelayFrames() const { return delay_.value; }
    double lfoHz() const { return lfoHz_.value; }

    /** In place over interleaved stereo; `frame` = absolute output frame of lr[0]. */
    void process(float* lr, int n, int64_t frame) noexcept {
        if (repeatDirty_) {
            repeat_.setState(pendingMode_, pendingBeats_, pendingDry_, pendingWet_, static_cast<double>(frame));
            repeatDirty_ = false;
        }
        if (repeat_.active()) repeat_.process(lr, n, frame);
        else repeat_.record(lr, n, frame);
        if (idle_) { // Lines keep recording silence (cheap), so a later wake reads true history.
            zeroAdvance(echo_, echoPos_, n);
            zeroAdvance(flanger_, flangerPos_, n);
            return;
        }
        const int echoCap = static_cast<int>(echo_.size() / 2);
        const int flangerCap = static_cast<int>(flanger_.size() / 2);
        const float feedback = static_cast<float>(settings_.echoFeedback);
        const float flangerFeedback = static_cast<float>(settings_.flangerFeedback);
        const double center = settings_.flangerDelayMs / 1000;
        const double amplitude = std::min(settings_.flangerWidthMs / 2000, std::max(0.0, center - .0001));
        float peak = 0;
        for (int i = 0; i < n; ++i) {
            const float sEcho = static_cast<float>(send_[kEcho].next());
            const float sLce = static_cast<float>(send_[kLowCutEcho].next());
            const float sRev = static_cast<float>(send_[kReverb].next());
            const float sFlg = static_cast<float>(send_[kFlanger].next());
            const float wet = static_cast<float>(wet_.next());
            const float dry = static_cast<float>(dry_.next());
            const float hm = static_cast<float>(hpfMix_.next());
            const double delay = delay_.next();
            const double lfoHz = lfoHz_.next();
            const float x[2] = {lr[i * 2], lr[i * 2 + 1]};
            float ret[2] = {0, 0};
            if (sEcho > 0 || sLce > 0 || echoLive_) { // Echo / low-cut echo: send -> [low cut] -> delay -> soft clip.
                const double readPos = static_cast<double>(echoPos_) - delay;
                int k = static_cast<int>(std::floor(readPos));
                const float f = static_cast<float>(readPos - k);
                if (k < 0) k += echoCap;
                const auto a = static_cast<size_t>(k) * 2;
                const auto b = static_cast<size_t>(k + 1 == echoCap ? 0 : k + 1) * 2;
                const auto w = static_cast<size_t>(echoPos_) * 2;
                float level = 0;
                for (int ch = 0; ch < 2; ++ch) {
                    const float read = echo_[a + ch] + (echo_[b + ch] - echo_[a + ch]) * f;
                    // WaveShaper: 4097-point tanh curve over [-1, 1], linear interpolation, clamped.
                    const float pos = (std::clamp(read, -1.f, 1.f) + 1) * 2048;
                    const int ci = std::min(static_cast<int>(pos), 4095);
                    const float clipped = clip_[ci] + (clip_[ci + 1] - clip_[ci]) * (pos - ci);
                    float u = (sEcho + sLce) * x[ch] + feedback * clipped;
                    if (hm > 0) u = (1 - hm) * u + hm * hpf_.process(ch, u);
                    echo_[w + ch] = u;
                    ret[ch] += clipped;
                    level = std::max(level, std::abs(u));
                }
                if (hm > 0) hpfWarm_ = true;
                else if (hpfWarm_) { hpf_.reset(); hpfWarm_ = false; }
                if (++echoPos_ == echoCap) echoPos_ = 0;
                // Live until the line has held only silence for a full delay span.
                echoQuiet_ = sEcho > 0 || sLce > 0 || level > 1e-6f ? 0 : echoQuiet_ + 1;
                echoLive_ = echoQuiet_ < delay + 2;
            } else { // Dead loop: keep recording its (silent) input, like a DelayNode does.
                echo_[static_cast<size_t>(echoPos_) * 2] = echo_[static_cast<size_t>(echoPos_) * 2 + 1] = 0;
                if (++echoPos_ == echoCap) echoPos_ = 0;
            }
            if (sRev > 0 || reverbLive_) { // Reverb (skipped once its tail has died).
                float l, r;
                reverb_.process(sRev * x[0], sRev * x[1], l, r);
                ret[0] += l; ret[1] += r;
                reverbQuiet_ = sRev > 0 || std::max(std::abs(l), std::abs(r)) > 1e-6f ? 0 : reverbQuiet_ + 1;
                reverbLive_ = reverbQuiet_ < static_cast<int>(rate_ * .2);
                if (!reverbLive_) reverb_.reset();
            }
            // Flanger LFO free-runs (an oscillator started at creation); the line runs while live.
            lfoPhase_ += 2 * dsp::kPi * lfoHz / rate_;
            if (lfoPhase_ > 2 * dsp::kPi) lfoPhase_ -= 2 * dsp::kPi;
            if (sFlg > 0 || flangerLive_) { // Flanger: LFO-swept short delay with regeneration.
                const double d = (center + amplitude * std::sin(lfoPhase_)) * rate_;
                const double readPos = static_cast<double>(flangerPos_) - d;
                int k = static_cast<int>(std::floor(readPos));
                const float f = static_cast<float>(readPos - k);
                if (k < 0) k += flangerCap;
                const auto a = static_cast<size_t>(k) * 2;
                const auto b = static_cast<size_t>(k + 1 == flangerCap ? 0 : k + 1) * 2;
                const auto w = static_cast<size_t>(flangerPos_) * 2;
                float level = 0;
                for (int ch = 0; ch < 2; ++ch) {
                    const float read = flanger_[a + ch] + (flanger_[b + ch] - flanger_[a + ch]) * f;
                    const float u = sFlg * x[ch] + flangerFeedback * read;
                    flanger_[w + ch] = u;
                    ret[ch] += read;
                    level = std::max(level, std::abs(u));
                }
                if (++flangerPos_ == flangerCap) flangerPos_ = 0;
                flangerQuiet_ = sFlg > 0 || level > 1e-6f ? 0 : flangerQuiet_ + 1;
                flangerLive_ = flangerQuiet_ < flangerCap;
            } else {
                flanger_[static_cast<size_t>(flangerPos_) * 2] = flanger_[static_cast<size_t>(flangerPos_) * 2 + 1] = 0;
                if (++flangerPos_ == flangerCap) flangerPos_ = 0;
            }
            for (int ch = 0; ch < 2; ++ch) {
                lr[i * 2 + ch] = x[ch] * dry + wet * ret[ch];
                peak = std::max(peak, std::abs(ret[ch]));
            }
        }
        // Idle once nothing is engaged, every ramp has settled and the returns stayed silent for
        // longer than the echo loop (its line is then empty): tails have rung out.
        bool settled = settledDry() && wet_.settled() && hpfMix_.settled();
        for (const auto& s : send_) settled = settled && s.settled() && s.value == 0;
        quietFrames_ = settled && peak < 1e-5f ? quietFrames_ + n : 0;
        if (quietFrames_ > delay_.value + rate_ * .25) {
            idle_ = true;
            hpf_.reset(); hpfWarm_ = false;
        }
    }

private:
    Settings settings_;
    double rate_ = 48000;
    std::vector<float> echo_, flanger_;
    float clip_[4097] = {};
    int echoPos_ = 0, flangerPos_ = 0, echoQuiet_ = 0, flangerQuiet_ = 0;
    bool echoLive_ = false, flangerLive_ = false;
    Repeat repeat_;
    Reverb reverb_;
    float reverbScale_ = 1;
    bool reverbLive_ = false;
    int reverbQuiet_ = 0;
    dsp::Biquad hpf_;
    bool hpfWarm_ = false;
    Ramp send_[4], wet_, dry_{1, 1, 0, 0}, hpfMix_, delay_, lfoHz_;
    double lfoPhase_ = 0;
    int effect_ = -1;
    double beats_ = kBeatsDefault, beatSeconds_ = kBeatSecondsDefault;
    Repeat::Mode pendingMode_ = Repeat::kOff;
    double pendingBeats_ = kBeatsDefault, pendingDry_ = 1, pendingWet_ = 0;
    bool repeatDirty_ = false;
    double quietFrames_ = 0;
    bool idle_ = true;
    bool primed_ = false;

    static void zeroAdvance(std::vector<float>& line, int& pos, int n) noexcept {
        const int cap = static_cast<int>(line.size() / 2);
        while (n > 0) {
            const int run = std::min(n, cap - pos);
            std::fill(line.begin() + pos * 2, line.begin() + (pos + run) * 2, 0.f);
            pos = pos + run == cap ? 0 : pos + run;
            n -= run;
        }
    }
    bool settledDry() const { return dry_.settled() && dry_.value == 1; }
    void retime(bool immediate) {
        const double span = immediate || !primed_ ? 0 : kRetargetS * rate_;
        const double maxDelay = static_cast<double>(echo_.size() / 2) - 4;
        delay_.to(std::min(echoDelaySeconds(beats_, beatSeconds_) * rate_, maxDelay), span);
        const double period = std::max(kMinEchoDelayS, beats_ * (settings_.flangerBars ? kBeatsPerBar : 1) * beatSeconds_);
        lfoHz_.to(1 / std::max(.01, period), span);
        primed_ = true;
    }
};
} // namespace manadj::fx
