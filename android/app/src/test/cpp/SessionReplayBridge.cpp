// Host-only ReplayDriver bridge: real Engine render, generated PCM, no JNI/device.
#include "Engine.h"
#include <cmath>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>
using namespace manadj;

int main() {
    auto owned = std::make_unique<Engine>(48000);
    auto& engine = *owned;
    std::vector<float> out(4096 * 2);
    double energy = 0;
    for (std::string line; std::getline(std::cin, line);) {
        std::istringstream in(line);
        std::string action;
        in >> action;
        bool ok = true;
        if (action == "render") {
            int frames; in >> frames;
            while (frames > 0) {
                int count = std::min(frames, 4096);
                engine.render(out.data(), count);
                frames -= count;
                for (int i = 0; i < count * 2; ++i) energy += out[i] * out[i];
            }
        } else if (action == "load") {
            int deck; uint64_t id; in >> deck >> id;
            ok = engine.submit(Op::Prepare, deck, 0, id) != 0;
            engine.render(out.data(), 1);
            constexpr int frames = 48000 * 40;
            ok = ok && engine.trackBegin(deck, id, frames, 48000, 0);
            std::vector<float> pcm(4096 * 2);
            for (int at = 0; at < frames; at += 4096) {
                int count = std::min(4096, frames - at);
                for (int i = 0; i < count; ++i)
                    pcm[i*2] = pcm[i*2+1] = .2f * std::sin((at+i) * 2 * 3.14159265358979 * (220+110*deck) / 48000);
                ok = ok && engine.trackWrite(deck, id, pcm.data(), count) > 0;
            }
            engine.trackFinish(deck, id);
            auto transport = engine.deck(deck).transport.load();
            ok = ok && engine.claim(deck, id, transport, 48000, 0);
            ok = ok && engine.offer(deck, transport, pcm.data(), 4096) == 4096;
            ok = ok && engine.publish(deck, id, transport, false);
        } else if (action == "cancel") {
            uint64_t tag; in >> tag; ok = engine.cancelScheduled(tag) != 0;
        } else if (action == "op") {
            uint64_t frame, tag; int deck; std::string op; double value, a, b;
            std::string vText, aText, bText;
            in >> frame >> tag >> op >> deck >> vText >> aText >> bText;
            value = std::stod(vText); a = std::stod(aText); b = std::stod(bText);
            Engine::ScheduleScope stamp(frame, tag);
            if (op == "locate") {
                double aux[5] = {a, b, 0, 0, 0};
                ok = engine.submit(Op::LoopSet, deck, value, 0, 0, aux) != 0;
            } else if (op == "filter") ok = engine.submitFilter(deck, value) != 0;
            else if (op == "fx") ok = engine.submitBeatFx(-1, 4, false, -1, 1, 0) != 0;
            else {
                Op type;
                if (op == "play") type = Op::Play;
                else if (op == "pause") type = Op::Pause;
                else if (op == "pitch") type = Op::Pitch;
                else if (op == "bend") type = Op::Bend;
                else if (op == "fader") type = Op::Fader;
                else if (op == "eq") type = Op::Eq;
                else if (op == "scratchBegin") type = Op::ScratchBegin;
                else if (op == "scratchMove") type = Op::ScratchMove;
                else if (op == "scratchEnd") type = Op::ScratchEnd;
                else return 3;
                ok = engine.submit(type, deck, value, 0, static_cast<int>(a)) != 0;
            }
        } else if (action != "clock") return 3;
        std::cout << std::setprecision(17) << ok << ' ' << engine.outputFrames()
                  << ' ' << engine.lateOps() << ' ' << energy;
        for (int deck = 0; deck < 4; ++deck) std::cout << ' ' << engine.deck(deck).position.load();
        for (int deck = 0; deck < 4; ++deck) std::cout << ' ' << engine.deck(deck).scratching.load();
        for (int deck = 0; deck < 4; ++deck) std::cout << ' ' << engine.deck(deck).playing.load();
        std::cout << std::endl;
    }
}
