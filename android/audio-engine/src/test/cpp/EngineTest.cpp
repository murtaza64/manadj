#include "../../main/cpp/Engine.h"
#include <cassert>
#include <cmath>
#include <vector>

using manadj::Engine;
using manadj::Op;

int main() {
    Engine engine(48000);
    std::vector<float> out(48000 * 2);
    std::vector<float> tone(48000 * 2, .5f);
    for (int deck = 0; deck < 2; ++deck) {
        const auto prepare = engine.submit(Op::Prepare, deck, 0, 1, 48000, 2);
        engine.render(out.data(), 1);
        assert(engine.deck(deck).applied.load() == prepare);
        assert(engine.offer(deck, 0, tone.data(), 100) == 0);
        assert(engine.offer(deck, 1, tone.data(), 48000) == 48000);
        engine.submit(Op::Ready, deck, 0, 1);
        engine.submit(Op::Play, deck);
    }
    engine.render(out.data(), 4096);
    const auto neutral = .5f * 2 * std::pow(10.f, -6.f / 20.f);
    assert(std::abs(out[8190] - neutral) < .001);
    assert(engine.outputFrames() == 4098);
    assert(engine.deck(0).position.load() > .08);
    const auto a = engine.deck(0).position.load();
    engine.submit(Op::Crossfade, 0, 1);
    engine.render(out.data(), 4096);
    assert(std::abs(out[8190] - neutral / 2) < .001);
    engine.submit(Op::Fader, 1, .5);
    engine.render(out.data(), 4096);
    assert(std::abs(out[8190] - neutral / 8) < .001);
    engine.submit(Op::Pause, 0);
    engine.submit(Op::Pause, 1);
    engine.render(out.data(), 1024);
    assert(out[2046] == 0);
    assert(engine.deck(0).position.load() > a);
    engine.submit(Op::Seek, 0, 6., 2, 48000, 2);
    engine.render(out.data(), 1);
    assert(engine.offer(0, 1, tone.data(), 128) == 0);
    assert(std::abs(engine.deck(0).position.load() - 6.) < .000001);
    assert(engine.deck(0).state.load() == 1);
    engine.offer(0, 2, tone.data(), 8192);
    engine.submit(Op::Ready, 0, 0, 2);
    engine.submit(Op::CueDown, 0);
    engine.render(out.data(), 1);
    assert(engine.deck(0).cue.load() == 6);
    engine.submit(Op::CueDown, 0);
    engine.render(out.data(), 1024);
    assert(engine.deck(0).preview.load());
    assert(engine.deck(0).position.load() > 6);
    engine.submit(Op::CueUp, 0);
    engine.render(out.data(), 100);
    assert(!engine.deck(0).preview.load());
    const auto parked = engine.deck(0).position.load();
    engine.render(out.data(), 100);
    assert(engine.deck(0).position.load() == parked);

    engine.submit(Op::Pitch, 0, 25);
    engine.submit(Op::Bend, 0, 8);
    engine.submit(Op::Play, 0);
    engine.render(out.data(), 480);
    assert(engine.deck(0).position.load() - parked > .013);
    assert(engine.starvedFrames() == 0);
}
