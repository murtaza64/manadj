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
        CHECK(std::abs(db(measure(5000, [](Engine& e) { e.submitFilter(0, .5); })) - db(static_cast<float>(dsp::describeFilter(.5, 48000).gain))) < 1);
        const auto t = dsp::describeFilter(-1, 48000);
        CHECK(t.pass == dsp::Pass::Low && std::abs(t.frequency - 40) < .01 && t.wet == 1 && t.gain < 1);
        const auto h = dsp::describeFilter(1, 48000);
        CHECK(h.pass == dsp::Pass::High && std::abs(h.frequency - 16000) < .01);
        CHECK(dsp::describeFilter(.03, 48000).wet == 0);
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
    std::puts("engine tests passed");
}
