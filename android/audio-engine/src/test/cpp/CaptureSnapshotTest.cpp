#include "../../main/cpp/Engine.h"
#include <atomic>
#include <cassert>
#include <chrono>
#include <cstdio>
#include <memory>
#include <thread>
using namespace manadj;
int main() {
    auto engine = std::make_unique<Engine>(48000);
    engine->enableCapture(true);
    CaptureSnapshot snap;
    assert(!engine->captureSnapshot(snap));
    std::array<float, 192> out{};
    engine->submit(Op::Fader, 0, .25);
    engine->submit(Op::Crossfade, 0, -.5);
    assert(!engine->captureSnapshot(snap)); // receipt is not applied state
    engine->render(out.data(), 96);
    assert(engine->captureSnapshot(snap));
    assert(snap.frame == 96 && snap.sampleRate == 48000);
    assert(snap.decks[0].fader == .25f && snap.crossfade == -.5f);
    std::atomic<bool> done{false};
    std::thread reader([&] {
        uint64_t previous = 0;
        while (!done.load()) if (engine->captureSnapshot(snap)) {
            assert(snap.frame >= previous && snap.frame % 96 == 0);
            previous = snap.frame;
            // Both controls apply in the same callback, never a mixed frame.
            if (snap.frame > 96) assert(snap.decks[0].fader == snap.crossfade);
        }
    });
    auto started = std::chrono::steady_clock::now();
    for (int i = 0; i < 10000; ++i) {
        double value = i % 2 ? .25 : .75;
        engine->submit(Op::Fader, 0, value); engine->submit(Op::Crossfade, 0, value);
        engine->render(out.data(), 96);
    }
    done.store(true); reader.join();
    std::printf("10000 callback snapshots with concurrent reader: %.2f ms\n", std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-started).count());
}
