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

/** Default desktop filter settings (filterSettings.ts DEFAULT_FILTER_SETTINGS, model res24). */
struct FilterSettings {
    double resonance = 17, compensation = .85, curve = 1, deadzone = .03, lpMin = 40, hpMax = 16000;
};

/** res24 Butterworth pole Qs; resonance is added on the last stage. */
constexpr double kRes24Q[2] = {0.5411961, 1.30656296};
/** The same in dB (20*log10(q)). */
constexpr double kRes24QDb[2] = {-5.332906, 2.322607};

/** Target of the sweep filter for a knob position (describeSweepFilter, res24). */
struct FilterTarget {
    Pass pass = Pass::Low;
    double frequency = 20000;
    double wet = 0;     // 0 = bypass (dry), 1 = fully filtered
    double gain = 1;    // linear make-down compensating the resonant hump
    double qDb[2] = {0, 0};
};

inline double stageMagnitude(Pass pass, double freq, double qDb, double hz, double rate) {
    const double w = 2 * kPi * freq / rate;
    const double c = std::cos(w), alpha = std::sin(w) / (2 * std::pow(10.0, qDb / 20));
    const double b0 = (pass == Pass::Low ? 1 - c : 1 + c) / 2, b1 = pass == Pass::Low ? 1 - c : -(1 + c);
    const double z = 2 * kPi * hz / rate;
    const double nr = b0 + b1 * std::cos(z) + b0 * std::cos(2 * z), ni = -b1 * std::sin(z) - b0 * std::sin(2 * z);
    const double dr = 1 + alpha - 2 * c * std::cos(z) + (1 - alpha) * std::cos(2 * z);
    const double di = 2 * c * std::sin(z) - (1 - alpha) * std::sin(2 * z);
    return std::sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** Measured cascade peak in dB (>= 0), coarse-to-fine log search (sweepFilter.ts cascadePeakDb). */
inline double cascadePeakDb(Pass pass, double freq, const double qDb[2], double rate) {
    const double limit = rate * .499;
    double lo = std::max(1.0, freq / 4), hi = std::min(limit, freq * 4), bestDb = -1e9, best = lo;
    for (int round = 0; round < 3; ++round) {
        const int n = 48;
        const double step = std::pow(hi / lo, 1.0 / n);
        for (int i = 0; i <= n; ++i) {
            const double hz = lo * std::pow(step, i);
            const double m = stageMagnitude(pass, freq, qDb[0], hz, rate) * stageMagnitude(pass, freq, qDb[1], hz, rate);
            const double db = 20 * std::log10(std::max(1e-9, m));
            if (db > bestDb) { bestDb = db; best = hz; }
        }
        lo = std::max(1.0, best / step);
        hi = std::min(limit, best * step);
    }
    return std::max(0.0, bestDb);
}

/** Not realtime-safe (peak search); compute on the control thread. */
inline FilterTarget describeFilter(double position, double rate, const FilterSettings& s = {}) {
    const double p = std::isfinite(position) ? std::clamp(position, -1.0, 1.0) : 0;
    const double limit = rate * .49;
    const double distance = std::max(0.0, std::abs(p) - s.deadzone);
    const double amount = std::pow(distance / (1 - s.deadzone), s.curve);
    FilterTarget t;
    t.pass = p < 0 ? Pass::Low : Pass::High;
    const double open = t.pass == Pass::Low ? std::min(20000.0, limit) : 20;
    const double end = t.pass == Pass::Low ? s.lpMin : std::min(s.hpMax, limit);
    t.frequency = std::clamp(open * std::pow(end / open, amount), 10.0, limit);
    for (int i = 0; i < 2; ++i) t.qDb[i] = 20 * std::log10(kRes24Q[i]) + (i == 1 ? s.resonance : 0);
    t.wet = std::min(1.0, distance / .07);
    t.gain = std::pow(10.0, -s.compensation * cascadePeakDb(t.pass, t.frequency, t.qDb, rate) / 20);
    return t;
}
} // namespace manadj::dsp
