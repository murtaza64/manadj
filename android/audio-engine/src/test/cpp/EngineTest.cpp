// Standalone mixer/transport tests (no Android): see android/audio-engine/README.md.
#include "../../main/cpp/Engine.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <vector>

using namespace manadj;

#define CHECK(cond) do { if (!(cond)) { std::fprintf(stderr, "%s:%d CHECK failed: %s\n", __FILE__, __LINE__, #cond); std::exit(1); } } while (0)

namespace {
std::vector<float> out(48000 * 2);

void tick(Engine& e, int frames = 1) { e.render(out.data(), frames); }

// Emulates the decode worker: refill the current transport with constant PCM.
void feed(Engine& e, int deck, uint64_t load, float value, int frames, bool eof = false) {
    auto& d = e.deck(deck);
    const auto transport = d.transport.load();
    CHECK(e.claim(deck, load, transport, 48000, d.target.load()));
    std::vector<float> pcm(static_cast<size_t>(frames) * 2, value);
    CHECK(e.offer(deck, transport, pcm.data(), frames) == frames);
    CHECK(e.publish(deck, load, transport, eof));
}

// Same as feed() with a sine (amplitude .25) for strip DSP tests.
void feedTone(Engine& e, int deck, uint64_t load, double hz, int frames = 48000) {
    auto& d = e.deck(deck);
    const auto transport = d.transport.load();
    CHECK(e.claim(deck, load, transport, 48000, d.target.load()));
    std::vector<float> pcm(static_cast<size_t>(frames) * 2);
    for (int i = 0; i < frames; ++i) pcm[i * 2] = pcm[i * 2 + 1] = static_cast<float>(.25 * std::sin(2 * 3.14159265358979 * hz * i / 48000));
    CHECK(e.offer(deck, transport, pcm.data(), frames) == frames);
    CHECK(e.publish(deck, load, transport, false));
}

// RMS of the left channel over the last `frames` rendered, after `settle` frames.
float toneRms(Engine& e, int settle, int frames) {
    tick(e, settle);
    tick(e, frames);
    double sum = 0;
    for (int i = 0; i < frames; ++i) sum += out[i * 2] * out[i * 2];
    return static_cast<float>(std::sqrt(sum / frames));
}

// Loads `pcm` (interleaved stereo, 48 kHz) as the whole track; eof so the deck stops at its end.
void loadPcm(Engine& e, int deck, uint64_t load, const std::vector<float>& pcm) {
    e.submit(Op::Prepare, deck, 0, load);
    tick(e);
    auto& d = e.deck(deck);
    const auto transport = d.transport.load();
    CHECK(e.claim(deck, load, transport, 48000, 0));
    const int frames = static_cast<int>(pcm.size() / 2);
    CHECK(e.offer(deck, transport, pcm.data(), frames) == frames);
    CHECK(e.publish(deck, load, transport, true));
}

// Emulates the full-decode worker: the whole track in memory.
void fillTrack(Engine& e, int deck, uint64_t load, const std::vector<float>& pcm, int rate = 48000) {
    const int frames = static_cast<int>(pcm.size() / 2);
    CHECK(e.trackBegin(deck, load, frames, rate, 0));
    for (int at = 0; at < frames; at += 4096) CHECK(e.trackWrite(deck, load, pcm.data() + at * 2, std::min(4096, frames - at)) > 0);
    e.trackFinish(deck, load);
}

// Renders `frames` and returns the left channel.
std::vector<float> capture(Engine& e, int frames) {
    std::vector<float> left(frames);
    for (int done = 0; done < frames;) {
        const int n = std::min(4096, frames - done);
        tick(e, n);
        for (int i = 0; i < n; ++i) left[done + i] = out[i * 2];
        done += n;
    }
    return left;
}

double rms(const std::vector<float>& x, int from, int to) {
    double sum = 0;
    for (int i = from; i < to; ++i) sum += static_cast<double>(x[i]) * x[i];
    return std::sqrt(sum / std::max(1, to - from));
}

// 1 kHz tone (amplitude .25) over [from, to) frames of a `frames`-long silent track.
std::vector<float> burst(int frames, int from, int to) {
    std::vector<float> pcm(static_cast<size_t>(frames) * 2, 0.f);
    for (int i = from; i < to; ++i) pcm[i * 2] = pcm[i * 2 + 1] = static_cast<float>(.25 * std::sin(2 * 3.14159265358979 * 1000 * i / 48000));
    return pcm;
}

void beatFx(Engine& e, int effect, int target, bool on, double depth, double beats, int held = 0) {
    CHECK(e.submitBeatFx(effect, target, on, depth, beats, held) != 0);
}

void grid120(Engine& e, int deck) {
    const double anchor[5] = {0, 0, 0, 0, 0};
    e.submit(Op::SetGrid, deck, 120, 0, 0, anchor);
}

State state(Engine& e, int deck) { return static_cast<State>(e.deck(deck).status.load() & 3); }

void loadDeck(Engine& e, int deck, uint64_t load, float value, int frames = 48000) {
    e.submit(Op::Prepare, deck, 0, load);
    tick(e);
    CHECK(state(e, deck) == kLoading);
    feed(e, deck, load, value, frames);
    CHECK(state(e, deck) == kReady);
}
} // namespace

int main() {
    const float unity = std::pow(10.f, -6.f / 20.f); // trim .5 => -6 dB headroom.

    { // Two decks mix; crossfade -1..1; fader law.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadDeck(e, 0, 1, .25f);
        loadDeck(e, 1, 2, .25f);
        e.submit(Op::Play, 0);
        e.submit(Op::Play, 1);
        tick(e, 4096);
        CHECK(std::abs(out[8190] - .5f * unity) < .001);
        CHECK(e.deck(0).position.load() > .08);
        e.submit(Op::Crossfade, 0, -1);
        tick(e, 4096);
        CHECK(std::abs(out[8190] - .25f * unity) < .001);
        e.submit(Op::Crossfade, 0, 0);
        e.submit(Op::Fader, 1, .5);
        tick(e, 4096);
        CHECK(std::abs(out[8190] - (.25f + .25f / 4) * unity) < .001);
        CHECK(e.starvedFrames() == 0);
    }

    { // Relocation hides old PCM until the worker refills; stale offers are refused.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadDeck(e, 0, 1, .25f);
        e.submit(Op::Play, 0);
        tick(e, 256);
        const auto old = e.deck(0).transport.load();
        e.submit(Op::Seek, 0, 0.5);
        tick(e, 2048);
        CHECK(std::abs(out[4094]) < 1e-4f);          // silent while refilling (after fade + EQ decay)
        CHECK(e.deck(0).playing.load());             // intent kept
        CHECK(e.deck(0).position.load() == 0.5);     // clock held at target
        float pcm[64] = {};
        CHECK(e.offer(0, old, pcm, 32) == -1);
        CHECK(!e.claim(0, 1, old, 48000, 0));
        CHECK(e.starvedFrames() == 0);
        feed(e, 0, 1, -.25f, 4096);
        tick(e, 512);
        CHECK(out[1022] < -.2f * unity);
    }

    { // A superseded load cannot become READY or ERROR.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        e.submit(Op::Prepare, 0, 0, 1);
        tick(e);
        e.submit(Op::Prepare, 0, 0, 2);
        tick(e);
        const auto t = e.deck(0).transport.load();
        CHECK(!e.claim(0, 1, t, 48000, 0));
        e.publish(0, 1, t, false);
        CHECK(state(e, 0) == kLoading);
        e.fail(0, 1);
        CHECK(state(e, 0) == kLoading);
        e.fail(0, 2);
        CHECK(state(e, 0) == kError);
        e.submit(Op::Play, 0);
        tick(e);
        CHECK(!e.deck(0).playing.load());
    }

    { // Main cue: desktop transport.ts semantics.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadDeck(e, 0, 1, .25f);
        CHECK(e.deck(0).cue.load() == 0);
        e.submit(Op::CueDown, 0);                     // paused at cue: preview
        tick(e, 480);
        CHECK(e.deck(0).preview.load());
        CHECK(e.deck(0).position.load() > .009);
        e.submit(Op::CueUp, 0);                       // release: back to cue, paused
        tick(e);
        CHECK(!e.deck(0).preview.load());
        CHECK(e.deck(0).position.load() == 0);
        feed(e, 0, 1, .25f, 48000);
        e.submit(Op::Seek, 0, 2.0);
        tick(e);
        feed(e, 0, 1, .25f, 48000);
        e.submit(Op::CueDown, 0);                     // paused off cue: set cue, no preview
        tick(e, 64);
        CHECK(e.deck(0).cue.load() == 2.0);
        CHECK(!e.deck(0).preview.load());
        e.submit(Op::CueUp, 0);
        e.submit(Op::Play, 0);
        tick(e, 4800);
        e.submit(Op::CueDown, 0);                     // playing: return to cue and pause
        tick(e);
        CHECK(!e.deck(0).playing.load());
        CHECK(e.deck(0).position.load() == 2.0);
        feed(e, 0, 1, .25f, 48000);
        e.submit(Op::CueDown, 0);                     // hold preview, press play, release: keeps playing
        e.submit(Op::Play, 0);
        e.submit(Op::CueUp, 0);
        tick(e, 480);
        CHECK(e.deck(0).playing.load());
        CHECK(e.deck(0).position.load() > 2.0);
    }

    { // Hot cues: set captures the applied position; gated preview; jump while playing.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadDeck(e, 0, 1, .25f);
        e.submit(Op::HotCueDown, 0, 0, 0, 3);        // empty slot: no effect
        tick(e);
        CHECK(e.deck(0).previewSlot.load() == -1);
        e.submit(Op::Seek, 0, 1.5);
        tick(e);
        feed(e, 0, 1, .25f, 48000);
        e.submit(Op::HotCueSet, 0, 0, 0, 3);
        e.submit(Op::Seek, 0, 4.0);
        tick(e);
        CHECK(e.deck(0).hotcues[3].load() == 1.5);
        feed(e, 0, 1, .25f, 48000);
        e.submit(Op::HotCueDown, 0, 0, 0, 3);        // paused: jump + gated preview after refill
        tick(e, 64);
        CHECK(e.deck(0).previewSlot.load() == 3);
        CHECK(std::abs(out[126]) < 1e-3f);
        feed(e, 0, 1, .25f, 48000);
        tick(e, 480);
        CHECK(out[958] > 0);
        e.submit(Op::HotCueUp, 0, 0, 0, 2);          // other slot's release: ignored
        tick(e);
        CHECK(e.deck(0).preview.load());
        e.submit(Op::HotCueUp, 0, 0, 0, 3);
        tick(e);
        CHECK(!e.deck(0).preview.load());
        CHECK(e.deck(0).position.load() == 1.5);
        feed(e, 0, 1, .25f, 48000);
        e.submit(Op::Seek, 0, 6.0);
        e.submit(Op::Play, 0);
        tick(e);
        feed(e, 0, 1, .25f, 48000);
        e.submit(Op::HotCueDown, 0, 0, 0, 3);        // playing: jump, keep playing
        tick(e);
        CHECK(e.deck(0).playing.load());
        CHECK(e.deck(0).position.load() == 1.5);
    }

    { // End of stream stops the deck instead of erroring; pause fades without moving the clock.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadDeck(e, 0, 1, .25f);
        e.submit(Op::Seek, 0, 10.0);
        e.submit(Op::Play, 0);
        tick(e);
        feed(e, 0, 1, .25f, 1000, true);
        tick(e, 2048);
        CHECK(!e.deck(0).playing.load());
        CHECK(state(e, 0) == kReady);
        CHECK(e.starvedFrames() == 0);
        e.submit(Op::Seek, 0, 0.0);
        e.submit(Op::Play, 0);
        tick(e);
        feed(e, 0, 1, .25f, 48000);
        tick(e, 4800);
        e.submit(Op::Pause, 0);
        tick(e, 1);
        const double parked = e.deck(0).position.load();
        tick(e, 120);
        CHECK(out[2 * 60] > 0);                       // still fading out
        CHECK(e.deck(0).position.load() == parked);
        tick(e, 512);
        CHECK(std::abs(out[1022]) < 1e-3f);
        CHECK(e.deck(0).position.load() == parked);
    }

    { // Varispeed/bend advance the source clock; starvation is counted only while audible.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadDeck(e, 0, 1, .25f, 2048);
        e.submit(Op::Pitch, 0, 25);
        e.submit(Op::Bend, 0, 8);
        e.submit(Op::Play, 0);
        tick(e, 480);
        CHECK(std::abs(e.deck(0).position.load() - .01 * 1.25 * 1.08) < .0005);
        tick(e, 4096);
        CHECK(e.starvedFrames() > 0);
        CHECK(e.deck(0).playing.load());
    }
    { // Pre-decoded head: hot-cue jump while playing is gapless, crossfaded, and hands off to the ring.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadDeck(e, 0, 1, .25f);
        e.submit(Op::Seek, 0, 2.0);
        tick(e);
        feed(e, 0, 1, .25f, 48000);
        e.submit(Op::HotCueSet, 0, 0, 0, 1);
        e.submit(Op::Seek, 0, 6.0);
        tick(e);
        CHECK(e.deck(0).hotcues[1].load() == 2.0);
        std::vector<float> head(kHeadFrames * 2, .5f);
        CHECK(e.headBegin(0, 1));
        CHECK(e.headWrite(0, 1, 0, head.data(), kHeadFrames) == kHeadFrames);
        e.headCommit(0, 1, 1, 2.0, kHeadFrames);
        feed(e, 0, 1, .25f, 48000);
        e.submit(Op::Play, 0);
        tick(e, 1024);
        e.submit(Op::HotCueDown, 0, 0, 0, 1);
        tick(e, 512);
        CHECK(e.deck(0).headSlot.load() == 1);
        CHECK(!e.headBegin(0, 1));                    // busy: worker cannot overwrite
        float lo = 1, hi = 0;
        for (int i = 0; i < 512; ++i) { lo = std::min(lo, out[i * 2]); hi = std::max(hi, out[i * 2]); }
        CHECK(lo > .2f * unity);                      // no gap, no dip below the old level
        CHECK(std::abs(out[1022] - .5f * unity) < .002);
        CHECK(std::abs(out[0] - .25f * unity) < .02); // starts at the old level (crossfade)
        // Ring for the jump starts at head frame kHeadFrames-1.
        CHECK(e.deck(0).ringOffset.load() == kHeadFrames - 1);
        feed(e, 0, 1, -.5f, 48000);
        CHECK(std::abs(e.deck(0).position.load() - (2.0 + 512 / 48000.)) < 1e-6);
        tick(e, kHeadFrames);
        CHECK(e.deck(0).headSlot.load() == -1);
        CHECK(out[kHeadFrames * 2 - 2] < -.4f * unity);
        CHECK(std::abs(e.deck(0).position.load() - (2.0 + (512 + kHeadFrames) / 48000.)) < 1e-6);
        CHECK(e.headBegin(0, 1));                     // released after hand-off
        e.headAbort(0, 1);
        CHECK(e.starvedFrames() == 0);
    }

    { // Relocation without a head fades the old audio out instead of cutting.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadDeck(e, 0, 1, .25f);
        e.submit(Op::Play, 0);
        tick(e, 1024);
        e.submit(Op::Seek, 0, 3.0);
        tick(e, 4096);
        CHECK(out[0] > .2f * unity);                  // no instant cut
        float prev = out[0];
        for (int i = 1; i < 2048; ++i) { CHECK(std::abs(out[i * 2] - prev) < .005f); prev = out[i * 2]; } // no step (click)
        CHECK(std::abs(out[8190]) < 1e-4f);
    }
    { // Master + cue buses: PFL is pre-fader; routing maps buses to device channels.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadDeck(e, 0, 1, .2f);
        loadDeck(e, 1, 2, .1f);
        e.submit(Op::Play, 0);
        e.submit(Op::Play, 1);
        e.submit(Op::Fader, 0, 0);                    // A silent on master...
        e.submit(Op::Pfl, 0, 1);                      // ...but cued
        std::vector<float> quad(4096 * 4);
        e.setRouting(Routing::Quad);
        e.render(quad.data(), 4096, 4);
        const float* f = &quad[4095 * 4];
        CHECK(std::abs(f[0] - .1f * unity) < .002 && std::abs(f[1] - .1f * unity) < .002); // master = B only
        CHECK(std::abs(f[2] - .2f * unity) < .002 && std::abs(f[3] - .2f * unity) < .002); // cue = A pre-fader
        e.setRouting(Routing::SplitMono);
        e.render(quad.data(), 512, 2);
        CHECK(std::abs(quad[1022] - .1f * unity) < .002);  // L = mono master
        CHECK(std::abs(quad[1023] - .2f * unity) < .002);  // R = mono cue
        e.submit(Op::CueMix, 0, 1);                   // headphones = master
        e.render(quad.data(), 512, 2);
        CHECK(std::abs(quad[1023] - .1f * unity) < .002);
        e.setRouting(Routing::Stereo);
        e.render(quad.data(), 512, 2);
        CHECK(std::abs(quad[1022] - .1f * unity) < .002 && std::abs(quad[1023] - .1f * unity) < .002);
        e.setRouting(Routing::Quad);                  // Quad on a stereo stream falls back to master
        e.render(quad.data(), 512, 2);
        CHECK(std::abs(quad[1023] - .1f * unity) < .002);
        e.submit(Op::CueMix, 0, 0);
        e.submit(Op::Pfl, 0, 0);
        e.render(quad.data(), 8192 / 4, 4);
        CHECK(std::abs(quad[(2047) * 4 + 2]) < .002);  // PFL off: cue bus empty (smoothed)
        std::vector<float> big(5000 * 2);             // longer than one bus block
        e.render(big.data(), 5000, 2);
        CHECK(std::abs(big[9998] - .1f * unity) < .002);
    }
    { // Strip DSP parity: LR4 isolator EQ (250 / 2500 Hz), res24 sweep filter with deadzone.
        const float ref = .25f / std::sqrt(2.f) * unity;
        auto measure = [&](double hz, auto&& configure) {
            auto owned = std::make_unique<Engine>(48000);
            Engine& e = *owned;
            e.submit(Op::Prepare, 0, 0, 1);
            tick(e);
            feedTone(e, 0, 1, hz);
            configure(e);
            e.submit(Op::Play, 0);
            return toneRms(e, 4800, 4800) / ref;
        };
        auto db = [](float g) { return 20 * std::log10(std::max(g, 1e-9f)); };
        for (double hz : {60.0, 1000.0, 8000.0})
            CHECK(std::abs(db(measure(hz, [](Engine&) {}))) < 1.0);           // neutral strip ~flat
        CHECK(db(measure(60, [](Engine& e) { e.submit(Op::Eq, 0, 0, 0, 0); })) < -24);    // low kill
        CHECK(db(measure(1000, [](Engine& e) { e.submit(Op::Eq, 0, 0, 0, 1); })) < -18);  // mid kill
        CHECK(db(measure(8000, [](Engine& e) { e.submit(Op::Eq, 0, 0, 0, 2); })) < -24);  // high kill
        CHECK(std::abs(db(measure(60, [](Engine& e) { e.submit(Op::Eq, 0, 1, 0, 0); })) - 6) < 1); // +6 dB boost
        CHECK(std::abs(db(measure(1000, [](Engine& e) { e.submitFilter(0, .02); }))) < .5);  // deadzone = bypass
        CHECK(db(measure(5000, [](Engine& e) { e.submitFilter(0, -1); })) < -40);           // LP fully swept (40 Hz)
        CHECK(db(measure(200, [](Engine& e) { e.submitFilter(0, 1); })) < -40);             // HP fully swept (16 kHz)
        CHECK(std::abs(db(measure(100, [](Engine& e) { e.submitFilter(0, .5); }))) > 6);    // mid HP sweep cuts 100 Hz
        // ...and passes 5 kHz at the desktop's resonance-compensated passband level.
        CHECK(std::abs(db(measure(5000, [](Engine& e) { e.submitFilter(0, .5); })) - db(static_cast<float>(std::pow(10.0, dsp::describeFilter(.5, 48000, [] { dsp::FilterSettings f; f.resonance = 10.5; f.compensation = .1; return f; }()).gainDb / 20)))) < 1);
        const auto t = dsp::describeFilter(-1, 48000);
        CHECK(t.pass == dsp::Pass::Low && std::abs(t.frequency - 40) < .01 && t.wet == 1 && t.gainDb < 0);
        const auto h = dsp::describeFilter(1, 48000);
        CHECK(h.pass == dsp::Pass::High && std::abs(h.frequency - 16000) < .01);
        CHECK(dsp::describeFilter(.03, 48000).wet == 0);
    }
    { // Filter parity: magnitude response matches the desktop sweepResponseDb for every model.
        struct Case { int model; double resonance, compensation, curve, deadzone, lpMin, hpMax, spread, trim, position; double db[9]; };
        static const Case cases[] = {
#include "FilterCases.inc"
        };
        const double freqs[9] = {30, 80, 200, 500, 1000, 2500, 6000, 12000, 18000};
        for (const auto& c : cases) {
            dsp::FilterSettings s;
            s.model = static_cast<dsp::FilterModel>(c.model);
            s.resonance = c.resonance; s.compensation = c.compensation; s.curve = c.curve; s.deadzone = c.deadzone;
            s.lpMin = c.lpMin; s.hpMax = c.hpMax; s.spread = c.spread; s.trim = c.trim;
            for (int k = 0; k < 9; ++k) {
                if (c.db[k] < -90) continue; // TS clamps at -120 dB
                const double got = dsp::sweepResponseDb(s, c.position, freqs[k], 48000);
                if (std::abs(got - c.db[k]) > .05) std::fprintf(stderr, "model %d pos %g hz %g: %f vs %f\n", c.model, c.position, freqs[k], got, c.db[k]);
                CHECK(std::abs(got - c.db[k]) < .05);
            }
        }
        // The realtime strip renders that response (sine RMS vs the formula), incl. live settings changes.
        auto measureWith = [&](const dsp::FilterSettings& s, double position, double hz) {
            auto owned = std::make_unique<Engine>(48000);
            Engine& e = *owned;
            e.submitFilterSettings(s);
            e.submitFilter(0, position);
            e.submit(Op::Prepare, 0, 0, 1);
            tick(e);
            feedTone(e, 0, 1, hz);
            e.submit(Op::Play, 0);
            return 20 * std::log10(std::max(1e-9f, toneRms(e, 12000, 12000) / (.25f / std::sqrt(2.f) * unity)));
        };
        dsp::FilterSettings dual; dual.model = dsp::FilterModel::Dual; dual.spread = 1.4; dual.resonance = 20;
        dsp::FilterSettings steep; steep.model = dsp::FilterModel::Res48; steep.resonance = 12; steep.trim = 2;
        dsp::FilterSettings legacy; legacy.model = dsp::FilterModel::Current;
        for (const auto* s : {&dual, &steep, &legacy})
            for (double pos : {-.6, .45})
                for (double hz : {200.0, 1000.0, 6000.0}) {
                    const double want = dsp::sweepResponseDb(*s, pos, hz, 48000);
                    if (want < -40) continue;
                    const double got = measureWith(*s, pos, hz);
                    if (std::abs(got - want) > 1) std::fprintf(stderr, "strip model %d pos %g hz %g: %f vs %f\n", (int)s->model, pos, hz, got, want);
                    CHECK(std::abs(got - want) < 1);
                }
    }

    { // Phone default = desktop shipped setting: level vs knob across the sweep matches desktop within 1 dB.
        dsp::FilterSettings shipped; shipped.resonance = 10.5; shipped.compensation = .1;
        for (double pos : {-.5, -.3, -.15, -.06, -.02, .02, .06, .15, .3}) {
            for (double hz : {300.0, 1000.0}) {
                auto owned = std::make_unique<Engine>(48000);
                Engine& e = *owned;                 // no submitFilterSettings: the engine default
                e.submitFilter(0, pos);
                e.submit(Op::Prepare, 0, 0, 1);
                tick(e);
                feedTone(e, 0, 1, hz);
                e.submit(Op::Play, 0);
                const double got = 20 * std::log10(toneRms(e, 12000, 12000) / (.25f / std::sqrt(2.f) * unity));
                const double want = dsp::sweepResponseDb(shipped, pos, hz, 48000);
                if (want < -30) continue;
                if (std::abs(got - want) > 1) std::fprintf(stderr, "default pos %g hz %g: %f vs desktop %f\n", pos, hz, got, want);
                CHECK(std::abs(got - want) < 1);
                if (std::abs(pos) <= .15) CHECK(got > -1.5); // no big level drop just off center
            }
        }
    }

    { // Live settings changes (model swap, resonance, trim) are click-free.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        e.submit(Op::Prepare, 0, 0, 1);
        tick(e);
        feedTone(e, 0, 1, 1000);
        e.submit(Op::Play, 0);
        e.submitFilter(0, .3);
        tick(e, 9600);
        float prev = out[9599 * 2], worst = 0;
        dsp::FilterSettings s;
        for (int step = 0; step < 6; ++step) {
            s.model = static_cast<dsp::FilterModel>(step % 5); s.resonance = 4 * step; s.trim = step % 2 ? -6 : 3;
            e.submitFilterSettings(s);
            tick(e, 2400);
            for (int i = 0; i < 2400; ++i) { worst = std::max(worst, std::abs(out[i * 2] - prev)); prev = out[i * 2]; }
        }
        CHECK(worst < .05f); // a 1 kHz tone at this level moves <= ~.02 per sample; a click jumps far more
    }

    { // Beat jump (desktop jumpBeats): grid tempo, gridless 120 BPM fallback, loop translates.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadDeck(e, 0, 1, .25f);
        e.submit(Op::Seek, 0, 10.0);
        tick(e);
        feed(e, 0, 1, .25f, 48000);
        e.submit(Op::BeatJump, 0, 4);                 // gridless: 4 beats @120 = 2 s
        tick(e);
        CHECK(std::abs(e.deck(0).position.load() - 12.0) < 1e-9);
        const double grid[5] = {0.1, 0, 0, 0, 0};
        e.submit(Op::SetGrid, 0, 125, 0, 0, grid);    // 0.48 s beats
        e.submit(Op::BeatJump, 0, -8);
        tick(e);
        CHECK(std::abs(e.deck(0).position.load() - (12.0 - 8 * .48)) < 1e-9);
        e.submit(Op::BeatJump, 0, -100);              // clamps at track start
        tick(e);
        CHECK(e.deck(0).position.load() == 0);
    }

    { // Loops: quantized engage, sample-accurate wrap from the loop head, resize, release.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadDeck(e, 0, 1, .25f);
        const double grid[5] = {0.0, 0, 0, 0, 0};
        e.submit(Op::SetGrid, 0, 120, 0, 0, grid);    // 0.5 s beats
        e.submit(Op::Quantize, 0, 1);
        e.submit(Op::Seek, 0, 2.02);
        tick(e);
        feed(e, 0, 1, .25f, 48000);
        e.submit(Op::LoopPreset, 0, 1);               // 1 beat, snapped to 2.0
        tick(e);
        CHECK(e.deck(0).loopActive.load());
        CHECK(e.deck(0).loopStart.load() == 2.0 && e.deck(0).loopEnd.load() == 2.5);
        // Worker emulation: loop-start head (8192 frames > 1 beat at 48 kHz? no: 24000) + ring.
        std::vector<float> head(kHeadFrames * 2, .5f);
        CHECK(e.headBegin(0, kLoopSlot));
        e.headWrite(0, kLoopSlot, 0, head.data(), kHeadFrames);
        e.headCommit(0, kLoopSlot, 1, 2.0, kHeadFrames);
        e.submit(Op::Play, 0);
        tick(e, 24000 - 960);                         // 0.48 s from 2.02 -> 2.5 = exactly the wrap
        tick(e, 1);
        CHECK(e.deck(0).headSlot.load() == kLoopSlot);
        CHECK(std::abs(e.deck(0).position.load() - 2.0) < 2.0 / 48000);
        tick(e, 2048);
        CHECK(std::abs(out[4094] - .5f * unity) < .002); // playing the loop start
        CHECK(e.starvedFrames() == 0);
        // Many wraps keep phase: after the ring takes over, wraps continue without drift.
        feed(e, 0, 1, .5f, 30000);
        for (int k = 0; k < 20; ++k) {
            tick(e, 4096);
            if (e.deck(0).headSlot.load() < 0 && e.deck(0).ring.load() != e.deck(0).transport.load()) feed(e, 0, 1, .5f, 30000);
        }
        CHECK(e.deck(0).position.load() >= 2.0 && e.deck(0).position.load() < 2.5);
        e.submit(Op::LoopResize, 0, 0, 0, 0);         // halve -> 1/2 beat
        tick(e);
        CHECK(e.deck(0).loopBeats.load() == .5 && e.deck(0).loopEnd.load() == 2.25);
        CHECK(e.deck(0).position.load() < 2.25);      // stranded playhead pulled back in
        e.submit(Op::LoopToggle, 0);                  // release
        tick(e);
        CHECK(!e.deck(0).loopActive.load());
        e.submit(Op::LoopToggle, 0);                  // re-engage with the remembered size
        tick(e);
        CHECK(e.deck(0).loopActive.load() && e.deck(0).loopBeats.load() == .5);
        e.submit(Op::Seek, 0, 5.0);                   // absolute relocation cancels the loop
        tick(e);
        CHECK(!e.deck(0).loopActive.load());
    }

    { // Gridless tracks: loop engage is inert (never guess), pending size still changes.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadDeck(e, 0, 1, .25f);
        e.submit(Op::LoopToggle, 0);
        e.submit(Op::LoopResize, 0, 0, 0, 1);
        tick(e);
        CHECK(!e.deck(0).loopActive.load());
        CHECK(e.deck(0).pendingLoopBeats.load() == 8);
    }
    { // CUE stabs while stopped at the cue: every DOWN previews from the cue head, every UP returns.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadDeck(e, 0, 1, .25f);
        std::vector<float> head(kHeadFrames * 2, .25f);
        CHECK(e.headBegin(0, kMainCueSlot));
        e.headWrite(0, kMainCueSlot, 0, head.data(), kHeadFrames);
        e.headCommit(0, kMainCueSlot, 1, 0.0, kHeadFrames);
        for (int stab = 0; stab < 20; ++stab) {
            const int len = 480 + (stab % 4) * 480; // 10..40 ms presses
            e.submit(Op::CueDown, 0);
            tick(e, len);
            float peak = 0;
            for (int i = 0; i < len; ++i) peak = std::max(peak, std::abs(out[i * 2]));
            if (!(peak > .2f * unity)) std::fprintf(stderr, "stab %d len %d peak %f preview %d head %d pos %f\n", stab, len, peak, (int)e.deck(0).preview.load(), e.deck(0).headSlot.load(), e.deck(0).position.load());
            CHECK(peak > .2f * unity);
            e.submit(Op::CueUp, 0);
            tick(e, 480);
            CHECK(!e.deck(0).preview.load() && e.deck(0).position.load() == 0.0);
        }
    }

    { // In-memory tracks: beat jumps are sample-exact and gapless; equal-BPM decks keep phase.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        const int frames = 48000 * 60;
        std::vector<float> ramp(static_cast<size_t>(frames) * 2);
        // Distinct per-frame content (a slow ramp + tone) so the playing frame is identifiable.
        for (int i = 0; i < frames; ++i) ramp[i * 2] = ramp[i * 2 + 1] = static_cast<float>(.2 + .1 * std::sin(i * .01));
        for (int d = 0; d < 2; ++d) {
            loadPcm(e, d, d + 1, std::vector<float>(ramp.begin(), ramp.begin() + 48000 * 2)); // ring: first second only
            fillTrack(e, d, d + 1, ramp);
            grid120(e, d);
            e.submit(Op::Seek, d, 20.0);
        }
        tick(e);
        CHECK(e.deck(0).position.load() == 20.0 && e.deck(1).position.load() == 20.0); // outside the ring: exact
        e.submit(Op::Play, 0); e.submit(Op::Play, 1);
        tick(e, 4800);
        CHECK(e.deck(0).inTrack.load() && e.deck(1).inTrack.load());
        const double beat = .5;
        const double jumps[] = {1, -1, 4, -4, 16, -16, .25, -.25, 16, 4, -1};
        double expected = 0;
        for (double j : jumps) {
            e.submit(Op::BeatJump, 0, j);
            expected += j;
            float minAbs = 1;
            for (int k = 0; k < 10; ++k) { tick(e, 96); for (int i = 0; i < 96; ++i) minAbs = std::min(minAbs, std::abs(out[i * 2])); }
            CHECK(minAbs > .05f);                                  // no silent frames across the jump
            const double offset = (e.deck(0).position.load() - e.deck(1).position.load()) / beat;
            CHECK(std::abs(offset - expected) < 1e-9);              // displaced by exactly the jumped beats
        }
        CHECK(e.starvedFrames() == 0);
        // Hot cue jumps and loop wraps are exact too.
        e.submit(Op::HotCueSetAt, 0, 30.0, 0, 3);
        e.submit(Op::HotCueDown, 0, 0, 0, 3);
        tick(e);
        CHECK(std::abs(e.deck(0).position.load() - (30.0 + 1 / 48000.)) < 1e-9);
        e.submit(Op::HotCueUp, 0, 0, 0, 3);
        e.submit(Op::LoopPreset, 0, 1);                            // 1 beat at the playhead
        tick(e);
        const double ls = e.deck(0).loopStart.load();
        for (int k = 0; k < 3; ++k) tick(e, 48000);                  // 6 wraps
        const double p = e.deck(0).position.load();
        CHECK(p >= ls && p < ls + .5);
        CHECK(std::abs((p - ls) - std::fmod(3.0 + 1 / 48000., .5)) < 1e-6);
        CHECK(e.starvedFrames() == 0);
    }

    { // Quantize: cue/hot-cue placement snaps; playing hot-cue trigger keeps the beat phase.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        std::vector<float> pcm(48000 * 20 * 2, .25f);
        loadPcm(e, 0, 1, std::vector<float>(pcm.begin(), pcm.begin() + 48000 * 2));
        fillTrack(e, 0, 1, pcm);
        grid120(e, 0);
        e.submit(Op::Quantize, 0, 1);
        e.submit(Op::Seek, 0, 3.1);
        e.submit(Op::CueDown, 0);                      // stopped, not at cue: set (snapped to 3.0)
        tick(e);
        CHECK(e.deck(0).cue.load() == 3.0 && e.deck(0).position.load() == 3.0);
        e.submit(Op::Seek, 0, 5.3);
        e.submit(Op::HotCueSet, 0, 0, 0, 2);
        tick(e);
        CHECK(e.deck(0).hotcues[2].load() == 5.5);
        e.submit(Op::Seek, 0, 8.1);                     // 0.1 s after a beat
        e.submit(Op::Play, 0);
        e.submit(Op::HotCueDown, 0, 0, 0, 2);
        tick(e);
        CHECK(std::abs(e.deck(0).position.load() - (5.6 + 1 / 48000.)) < 1e-9);
        e.submit(Op::Quantize, 0, 0);
        e.submit(Op::HotCueDown, 0, 0, 0, 2);
        tick(e);
        CHECK(std::abs(e.deck(0).position.load() - (5.5 + 1 / 48000.)) < 1e-9);
    }

    { // Key lock: tempo changes, pitch stays (zero-crossing pitch estimate), incl. a 44.1 kHz source.
        for (int rate : {48000, 44100}) {
            auto owned = std::make_unique<Engine>(48000);
            Engine& e = *owned;
            const int frames = rate * 20;
            std::vector<float> tone(static_cast<size_t>(frames) * 2);
            for (int i = 0; i < frames; ++i) tone[i * 2] = tone[i * 2 + 1] = static_cast<float>(.25 * std::sin(2 * 3.14159265358979 * 440 * i / rate));
            e.submit(Op::Prepare, 0, 0, 1);
            tick(e);
            auto& d = e.deck(0);
            const auto transport = d.transport.load();
            CHECK(e.claim(0, 1, transport, rate, 0));
            CHECK(e.offer(0, transport, tone.data(), 4096) == 4096);
            CHECK(e.publish(0, 1, transport, false));
            fillTrack(e, 0, 1, tone, rate);
            e.submit(Op::Seek, 0, 2.0);
            e.submit(Op::Pitch, 0, 8);
            auto pitchOf = [&](bool keyLock) {
                e.submit(Op::KeyLock, 0, keyLock ? 1 : 0);
                e.submit(Op::Play, 0);
                capture(e, 9600);                       // settle (prime, fade, filters)
                const double before = d.position.load();
                auto x = capture(e, 48000);
                const double advanced = d.position.load() - before;
                CHECK(std::abs(advanced - 1.08) < .002);  // tempo follows pitch either way
                int crossings = 0;
                for (int i = 1; i < 48000; ++i) if ((x[i - 1] < 0) != (x[i] < 0)) ++crossings;
                return crossings / 2.0;                     // Hz over one second
            };
            const double locked = pitchOf(true);
            if (std::abs(locked - 440) > 3) std::fprintf(stderr, "rate %d locked pitch %f\n", rate, locked);
            CHECK(std::abs(locked - 440) < 3);
            CHECK(d.stretching.load());
            const double free = pitchOf(false);
            CHECK(std::abs(free - 440 * 1.08) < 3);        // resample path: pitch follows tempo
            CHECK(!d.stretching.load());
            // Key-locked jumps stay gapless.
            e.submit(Op::KeyLock, 0, 1);
            const double grid[5] = {0, 0, 0, 0, 0};
            e.submit(Op::SetGrid, 0, 120, 0, 0, grid);
            capture(e, 4800);
            for (double j : {4.0, -4.0, 1.0}) {
                e.submit(Op::BeatJump, 0, j);
                auto x = capture(e, 4800);
                double rmsMin = 1;
                for (int w = 0; w + 480 <= 4800; w += 480) rmsMin = std::min(rmsMin, rms(x, w, w + 480));
                if (rmsMin <= .03) std::fprintf(stderr, "rate %d jump %g rmsMin %f\n", rate, j, rmsMin);
                CHECK(rmsMin > .03);
            }
        }
    }

    { // Beat FX ECHO on A: beat-synced repeats at beats x beatSeconds, feedback .5, tails ring after OFF.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadPcm(e, 0, 1, burst(48000, 4800, 7200));
        grid120(e, 0);
        beatFx(e, fx::kEcho, fx::kTargetA, true, 0, .5);  // depth 0: dry 1, wet 1; 1/2 beat = 12000 frames
        e.submit(Op::Play, 0);
        auto x = capture(e, 4800 + 48000);
        const double dry = rms(x, 5000, 7000);
        CHECK(dry > .05);
        CHECK(rms(x, 9000, 16000) < dry * .01);              // nothing between burst and first repeat
        const double first = rms(x, 17000, 19000), second = rms(x, 29000, 31000);
        CHECK(first > dry * .9 && first < dry * 1.6);        // tanh-normalized clip lifts small signals
        CHECK(second > first * .4 && second < first * .9);   // feedback .5 through the clip
        CHECK(e.fxAudible() == 1);
        beatFx(e, fx::kEcho, fx::kTargetA, false, 0, .5);   // OFF: send closes, return still rings
        x = capture(e, 12000);
        CHECK(rms(x, 0, 12000) > dry * .05);
        capture(e, 48000 * 6);
        CHECK(e.fxAudible() == 0);                           // tail rang out: insert idle
        CHECK(e.starvedFrames() == 0);
    }

    { // Depth -1 is dry only; a B target leaves A untouched; held paddle engages regardless of ON.
        for (int variant = 0; variant < 3; ++variant) {
            auto owned = std::make_unique<Engine>(48000);
            Engine& e = *owned;
            loadPcm(e, 0, 1, burst(48000, 4800, 7200));
            grid120(e, 0);
            if (variant == 0) beatFx(e, fx::kEcho, fx::kTargetA, true, -1, .5);
            if (variant == 1) beatFx(e, fx::kEcho, fx::kTargetB, true, 0, .5);
            if (variant == 2) beatFx(e, fx::kEcho, fx::kTargetB, false, 0, .5, 1); // paddle on A
            e.submit(Op::Play, 0);
            auto x = capture(e, 24000);
            const double echo = rms(x, 17000, 19000);
            if (variant < 2) CHECK(echo < 1e-4); else CHECK(echo > rms(x, 5000, 7000) * .9);
        }
    }

    { // MST target follows the last deck target's tempo; deck pitch scales the delay.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadPcm(e, 0, 1, burst(48000, 4800, 7200));
        grid120(e, 0);
        e.submit(Op::Pitch, 0, 25);                          // 1.25x: beat = 0.4 s, 1/2 beat = 9600 frames
        beatFx(e, fx::kEcho, fx::kTargetMaster, true, 0, .5);
        e.submit(Op::Play, 0);
        auto x = capture(e, 24000);
        // Burst plays at 1.25x: source 4800..7200 -> output 3840..5760; echo at +9600.
        const double dry = rms(x, 4000, 5600);
        CHECK(rms(x, 13600, 15200) > dry * .9);
        CHECK(rms(x, 16000, 17000) < dry * .05);
        CHECK(e.fxAudible() == 1 << fx::kTargetMaster);
    }

    { // REVERB: beatless tail of ~2.5 s RT60 at about the dry level, decays to idle.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadPcm(e, 0, 1, burst(48000, 4800, 24000));
        beatFx(e, fx::kReverb, fx::kTargetA, true, 1, .5);  // depth +1: effect only
        e.submit(Op::Play, 0);
        auto x = capture(e, 48000 * 2);
        const double wet = rms(x, 12000, 24000);
        CHECK(wet > .02 && wet < .3);                        // dry is ~.088 rms here
        const double t1 = rms(x, 26000, 30800), t2 = rms(x, 26000 + 24000, 30800 + 24000);
        // 0.5 s later: -12 dB for a 2.5 s RT60 (60 dB / 2.5 s x 0.5 s), allow wide slack.
        CHECK(t1 > 0 && t2 < t1 * .5 && t2 > t1 * .08);
        beatFx(e, fx::kReverb, fx::kTargetA, false, 1, .5);  // an engaged insert never idles
        capture(e, 48000 * 6);
        CHECK(e.fxAudible() == 0);
    }

    { // FLANGER: a swept comb on a tone (LFO = beats in bars: 1/2 bar = 1 s at 120 BPM).
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadPcm(e, 0, 1, burst(48000, 0, 48000));
        grid120(e, 0);
        beatFx(e, fx::kFlanger, fx::kTargetA, true, 0, .5);
        e.submit(Op::Play, 0);
        auto x = capture(e, 48000);
        CHECK(std::abs(e.insert(fx::kTargetA).lfoHz() - 1.0) < 1e-9);
        double lo = 1e9, hi = 0;
        for (int w = 4800; w + 2400 <= 48000; w += 2400) { const double r = rms(x, w, w + 2400); lo = std::min(lo, r); hi = std::max(hi, r); }
        CHECK(hi > lo * 1.3);                                // the comb moves over the tone
    }

    { // TRANS: grid-locked gate, duty .5 of each 1/2-beat cell; depth +1 mutes the off half.
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        loadPcm(e, 0, 1, burst(48000, 0, 48000));
        grid120(e, 0);
        beatFx(e, fx::kTrans, fx::kTargetA, true, 1, .5);    // cell 12000 frames
        e.submit(Op::Play, 0);
        auto x = capture(e, 48000);
        const double on = rms(x, 12000 + 1000, 12000 + 5000), off = rms(x, 12000 + 7000, 12000 + 11000);
        CHECK(on > .05);
        CHECK(off < on * .01);
        CHECK(rms(x, 36000 + 1000, 36000 + 5000) > on * .9); // still phase-locked three cells later
    }

    { // ROLL: loops the last complete cell (repeats are identical while the source moves on).
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        std::vector<float> ramp(48000 * 2);
        for (int i = 0; i < 48000; ++i) ramp[i * 2] = ramp[i * 2 + 1] = static_cast<float>(.5 * i / 48000);
        loadPcm(e, 0, 1, ramp);
        grid120(e, 0);
        e.submit(Op::Play, 0);
        capture(e, 13000);                                    // past the 1/4-beat boundary at 12000
        beatFx(e, fx::kRoll, fx::kTargetA, true, 1, .25);     // cell 6000 frames: loops [6000, 12000)
        auto x = capture(e, 24000);
        CHECK(e.insert(fx::kTargetA).repeat().rolling());
        CHECK(std::abs(e.insert(fx::kTargetA).repeat().rollLength() - 6000) < 1);
        double worst = 0;
        for (int i = 2000; i < 8000; ++i) worst = std::max(worst, static_cast<double>(std::abs(x[i] - x[i + 6000])));
        CHECK(worst < 1e-3);                                  // periodic at the cell length
        CHECK(std::abs(x[2000] - x[2000 + 12000]) < 1e-3);
        beatFx(e, fx::kRoll, fx::kTargetA, false, 1, .25);    // release: back to the live ramp
        x = capture(e, 4800);
        CHECK(x[4000] > x[1000]);
    }

    { // Callback cost: echo on all four decks + reverb on master, 96-frame callbacks (informational).
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        for (int d = 0; d < 4; ++d) { loadPcm(e, d, d + 1, burst(48000, 0, 48000)); e.submit(Op::Play, d); }
        beatFx(e, fx::kReverb, fx::kTargetMaster, true, 0, .5, 15); // paddles: echo->reverb on all
        tick(e, 4800);
        CHECK(e.fxAudible() == 31);
    }

    std::puts("engine tests passed");
}
