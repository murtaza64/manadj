#pragma once
// Channel-strip DSP with desktop parity (frontend/src/playback/{graph,mixerMath,sweepFilter,
// filterSettings}.ts, Mixer.ts): 3-band LR4 isolator EQ and the default "res24" sweep filter.
#include <algorithm>
#include <cmath>

namespace manadj::dsp {
constexpr double kPi = 3.14159265358979323846;
constexpr double kButterworthQDb = -3.0103; // 20*log10(1/sqrt(2))
constexpr double kCrossoverLowMidHz = 250;
constexpr double kCrossoverMidHighHz = 2500;

/** EQ knob [0,1] -> gain: 1 = +6 dB, .5 = 0 dB, 0 = kill; bottom half linear amplitude. */
inline float eqValueToGain(double value) {
    const double v = std::clamp(value, 0.0, 1.0);
    return static_cast<float>(v >= .5 ? std::pow(10.0, (v - .5) * 12 / 20) : v / .5);
}

enum class Pass { Low, High };

/** Web Audio low/high-pass biquad (Q in dB), normalized; transposed direct form II. */
struct Biquad {
    float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    float z1[2] = {0, 0}, z2[2] = {0, 0};

    void design(Pass pass, double hz, double qDb, double rate) {
        const double w = 2 * kPi * std::clamp(hz, 1.0, rate * .49) / rate;
        const double c = std::cos(w), alpha = std::sin(w) / (2 * std::pow(10.0, qDb / 20));
        const double a0 = 1 + alpha;
        const double nb0 = (pass == Pass::Low ? 1 - c : 1 + c) / 2;
        const double nb1 = pass == Pass::Low ? 1 - c : -(1 + c);
        b0 = static_cast<float>(nb0 / a0); b1 = static_cast<float>(nb1 / a0); b2 = b0;
        a1 = static_cast<float>(-2 * c / a0); a2 = static_cast<float>((1 - alpha) / a0);
    }
    float process(int ch, float x) {
        const float y = b0 * x + z1[ch];
        z1[ch] = b1 * x - a1 * y + z2[ch];
        z2[ch] = b2 * x - a2 * y;
        return y;
    }
    void reset() { z1[0] = z1[1] = z2[0] = z2[1] = 0; }
    void copyCoefficients(const Biquad& o) { b0 = o.b0; b1 = o.b1; b2 = o.b2; a1 = o.a1; a2 = o.a2; }
};

/** Desktop filterSettings.ts FILTER_MODELS (ordinals are the wire format). */
enum class FilterModel : int { Current = 0, Res12 = 1, Res24 = 2, Res48 = 3, Dual = 4 };

/** filterSettings.ts FilterSettings / DEFAULT_FILTER_SETTINGS (sanitized ranges applied by sanitize()). */
struct FilterSettings {
    FilterModel model = FilterModel::Res24;
    double resonance = 17, compensation = .85, curve = 1, deadzone = .03, lpMin = 40, hpMax = 16000;
    double spread = .8, drive = 0, trim = 0, smoothing = 20;

    FilterSettings sanitized() const {
        FilterSettings s = *this;
        auto fix = [](double v, double lo, double hi, double fallback) { return std::isfinite(v) ? std::clamp(v, lo, hi) : fallback; };
        const FilterSettings d;
        s.resonance = fix(resonance, 0, 24, d.resonance);
        s.compensation = fix(compensation, 0, 1, d.compensation);
        s.curve = fix(curve, .35, 2.5, d.curve);
        s.deadzone = fix(deadzone, 0, .12, d.deadzone);
        s.lpMin = fix(lpMin, 20, 300, d.lpMin);
        s.hpMax = fix(hpMax, 2000, 20000, d.hpMax);
        s.spread = fix(spread, 0, 2, d.spread);
        s.drive = fix(drive, 0, 18, d.drive);
        s.trim = fix(trim, -18, 12, d.trim);
        s.smoothing = fix(smoothing, 5, 100, d.smoothing);
        const int m = static_cast<int>(model);
        if (m < 0 || m > 4) s.model = d.model;
        return s;
    }
};

constexpr int kMaxFilterStages = 4;
struct FilterStage { double frequency = 20000, qDb = kButterworthQDb; };

/** describeSweepFilter result, plus the per-settings values the strip needs. */
struct FilterTarget {
    FilterModel model = FilterModel::Res24;
    Pass pass = Pass::Low;
    double frequency = 20000;
    double wet = 0;          // 0 = bypass (dry), 1 = fully filtered
    double gainDb = 0;       // branch gain: trim - compensation x measured cascade peak
    double trim = 0;         // dry gain is (1 - wet) x trim
    int stages = 2;
    FilterStage stage[kMaxFilterStages];
    double smoothingSeconds = .02; // cutoff/Q time constant (setTargetAtTime)
    double drive = 0, driveMix = 0;
};

/** Magnitude of one Web Audio low/high-pass biquad (Q in dB) at hz. */
inline void stageResponse(Pass pass, double freq, double qDb, double hz, double rate, double& re, double& im) {
    const double w = 2 * kPi * freq / rate;
    const double c = std::cos(w), alpha = std::sin(w) / (2 * std::pow(10.0, qDb / 20));
    const double b0 = (pass == Pass::Low ? 1 - c : 1 + c) / 2, b1 = pass == Pass::Low ? 1 - c : -(1 + c);
    const double z = 2 * kPi * hz / rate;
    const double nr = b0 + b1 * std::cos(z) + b0 * std::cos(2 * z), ni = -b1 * std::sin(z) - b0 * std::sin(2 * z);
    const double dr = 1 + alpha - 2 * c * std::cos(z) + (1 - alpha) * std::cos(2 * z);
    const double di = 2 * c * std::sin(z) - (1 - alpha) * std::sin(2 * z);
    const double den = dr * dr + di * di;
    re = (nr * dr + ni * di) / den;
    im = (ni * dr - nr * di) / den;
}

inline double cascadeGainDb(const FilterTarget& t, double hz, double rate) {
    double m = 1;
    for (int i = 0; i < t.stages; ++i) {
        double re, im;
        stageResponse(t.pass, t.stage[i].frequency, t.stage[i].qDb, hz, rate, re, im);
        m *= std::hypot(re, im);
    }
    return 20 * std::log10(std::max(1e-9, m));
}

/** Measured cascade peak in dB (>= 0), coarse-to-fine log search (sweepFilter.ts cascadePeakDb). */
inline double cascadePeakDb(const FilterTarget& t, double rate) {
    const double limit = rate * .499;
    double lo = 1e300, hi = 0;
    for (int i = 0; i < t.stages; ++i) { lo = std::min(lo, t.stage[i].frequency); hi = std::max(hi, t.stage[i].frequency); }
    lo = std::max(1.0, lo / 4);
    hi = std::min(limit, hi * 4);
    double bestDb = -1e300, best = lo;
    for (int round = 0; round < 3; ++round) {
        const int n = 48;
        const double step = std::pow(hi / lo, 1.0 / n);
        for (int i = 0; i <= n; ++i) {
            const double hz = lo * std::pow(step, i);
            const double db = cascadeGainDb(t, hz, rate);
            if (db > bestDb) { bestDb = db; best = hz; }
        }
        lo = std::max(1.0, best / step);
        hi = std::min(limit, best * step);
    }
    return std::max(0.0, bestDb);
}

/** describeSweepFilter (all models). Not realtime-safe (peak search); compute on the control thread. */
inline FilterTarget describeFilter(double position, double rate, const FilterSettings& in = {}) {
    const FilterSettings s = in.sanitized();
    const double p = std::isfinite(position) ? std::clamp(position, -1.0, 1.0) : 0;
    const double limit = rate * .49;
    FilterTarget t;
    t.model = s.model;
    t.trim = s.trim;
    t.drive = s.drive;
    if (s.model == FilterModel::Current) {
        // graph.ts sweepPositionToFilter: fixed 3 dB resonance, 80 Hz / 8 kHz, open low-pass at center.
        if (std::abs(p) < .05) { t.pass = Pass::Low; t.frequency = 20000; t.stage[0].qDb = kButterworthQDb; }
        else if (p < 0) { t.pass = Pass::Low; t.frequency = 20000 * std::pow(80.0 / 20000, -p); t.stage[0].qDb = 3; }
        else { t.pass = Pass::High; t.frequency = 20 * std::pow(8000.0 / 20, p); t.stage[0].qDb = 3; }
        t.frequency = std::min(limit, t.frequency);
        t.stage[0].frequency = t.frequency;
        t.stages = 1;
        t.wet = 1;
        t.gainDb = s.trim;
        t.smoothingSeconds = .015;
        return t;
    }
    const double distance = std::max(0.0, std::abs(p) - s.deadzone);
    const double amount = std::pow(distance / (1 - s.deadzone), s.curve);
    t.pass = p < 0 ? Pass::Low : Pass::High;
    const double open = t.pass == Pass::Low ? std::min(20000.0, limit) : 20;
    const double end = t.pass == Pass::Low ? s.lpMin : std::min(s.hpMax, limit);
    t.frequency = open * std::pow(end / open, amount);
    static constexpr double kRes48[4] = {0.50979558, 0.60134489, 0.89997622, 2.56291545};
    static constexpr double kRes24[2] = {0.5411961, 1.30656296};
    static constexpr double kHalf[2] = {0.70710678118654752, 0.70710678118654752};
    const double* qs = s.model == FilterModel::Res48 ? kRes48 : s.model == FilterModel::Res24 ? kRes24 : kHalf;
    t.stages = s.model == FilterModel::Res48 ? 4 : s.model == FilterModel::Res12 ? 1 : 2;
    for (int i = 0; i < t.stages; ++i) {
        const double spreadFactor = s.model == FilterModel::Dual ? std::pow(2.0, (i - .5) * s.spread) : 1;
        t.stage[i].frequency = std::min(limit, std::max(10.0, t.frequency * spreadFactor));
        t.stage[i].qDb = 20 * std::log10(qs[i]) +
            (s.model == FilterModel::Dual ? s.resonance / 2 : i == t.stages - 1 ? s.resonance : 0);
    }
    t.wet = std::min(1.0, distance / .07);
    t.gainDb = s.trim - s.compensation * cascadePeakDb(t, rate);
    t.smoothingSeconds = s.smoothing / 1000;
    t.driveMix = s.drive > 0 ? t.wet : 0;
    return t;
}

/** sweepResponseDb: magnitude response (dB) incl. the dry/wet crossfade phase, before drive. */
inline double sweepResponseDb(const FilterSettings& s, double position, double hz, double rate) {
    const FilterTarget d = describeFilter(position, rate, s);
    if (d.wet == 0) return d.trim;
    double re = 1, im = 0;
    for (int i = 0; i < d.stages; ++i) {
        double r, m;
        stageResponse(d.pass, d.stage[i].frequency, d.stage[i].qDb, hz, rate, r, m);
        const double nr = re * r - im * m;
        im = re * m + im * r;
        re = nr;
    }
    const double gain = std::pow(10.0, d.gainDb / 20);
    re = d.wet * re * gain + (1 - d.wet) * std::pow(10.0, d.trim / 20);
    im *= d.wet * gain;
    return 20 * std::log10(std::max(1e-6, std::hypot(re, im)));
}
} // namespace manadj::dsp
