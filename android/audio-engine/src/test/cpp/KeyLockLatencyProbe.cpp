// Diagnostic (#378 S5): where a key-locked deck's audio lands vs its clock, per source rate, pitch and entry.
// Build: clang++ -std=c++17 -O2 -Iandroid/audio-engine/src/main/cpp/third_party android/audio-engine/src/main/cpp/Engine.cpp android/audio-engine/src/test/cpp/KeyLockLatencyProbe.cpp -o /tmp/kl && /tmp/kl
#include "../../main/cpp/Engine.h"
#include <cmath>
#include <cstdio>
#include <memory>
#include <vector>

using namespace manadj;

static std::vector<float> out(48000 * 2);
static void tick(Engine& e, int frames) { e.render(out.data(), frames); }
static std::vector<float> capture(Engine& e, int frames) {
    std::vector<float> left(frames);
    for (int done = 0; done < frames;) { const int n = std::min(4096, frames - done); tick(e, n); for (int i = 0; i < n; ++i) left[done + i] = out[i * 2]; done += n; }
    return left;
}

int main() {
    for (int src : {48000, 44100}) for (double pitch : {0.0, 3.0, -4.0}) for (int entry = 0; entry < 3; ++entry) for (bool kl : {false, true}) {
        auto owned = std::make_unique<Engine>(48000);
        Engine& e = *owned;
        const int frames = src * 20;
        std::vector<float> pcm(static_cast<size_t>(frames) * 2, 0.f);
        const double burstAt = 10.0;
        for (int i = static_cast<int>(burstAt * src); i < static_cast<int>(burstAt * src) + src / 10; ++i) pcm[i * 2] = pcm[i * 2 + 1] = static_cast<float>(.25 * std::sin(2 * M_PI * 1000 * i / src));
        e.submit(Op::Prepare, 0, 0, 1); tick(e, 1);
        auto& d = e.deck(0);
        const auto transport = d.transport.load();
        e.claim(0, 1, transport, src, 0);
        e.offer(0, transport, pcm.data(), std::min(frames, src * 2));
        e.publish(0, 1, transport, true);
        e.trackBegin(0, 1, frames, src, 0);
        for (int at = 0; at < frames; at += 4096) e.trackWrite(0, 1, pcm.data() + at * 2, std::min(4096, frames - at));
        e.trackFinish(0, 1);
        e.submit(Op::KeyLock, 0, kl ? 1 : 0);
        e.submit(Op::Pitch, 0, pitch);
        const double rate = 1 + static_cast<double>(static_cast<float>(pitch)) / 100;
        double startPos;
        if (entry == 0) {        // playing long before the burst
            e.submit(Op::Seek, 0, 2.0); e.submit(Op::Play, 0); capture(e, 48000 * 6); startPos = d.position.load();
        } else if (entry == 1) { // placed shortly before (replay join: relocate, then play)
            e.submit(Op::Seek, 0, 9.5); e.submit(Op::Play, 0); startPos = 9.5;
        } else {                 // relocated while already playing elsewhere
            e.submit(Op::Seek, 0, 3.0); e.submit(Op::Play, 0); capture(e, 48000 * 2);
            e.submit(Op::Seek, 0, 9.5); tick(e, 1); startPos = d.position.load();
        }
        const auto x = capture(e, 48000 * 2);
        int onset = -1;
        for (int i = 0; i < static_cast<int>(x.size()) && onset < 0; ++i) if (std::abs(x[i]) > .05) onset = i;
        const double expected = (burstAt - startPos) / rate * 48000;
        std::printf("src %5d pitch %+4.1f entry %-9s keylock %-3s onset %+8.2f ms vs clock\n", src, pitch,
            entry == 0 ? "playing" : entry == 1 ? "placed" : "relocated", kl ? "on" : "off", (onset - expected) / 48.0);
    }
}
