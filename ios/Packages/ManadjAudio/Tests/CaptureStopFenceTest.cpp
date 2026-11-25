#include "CEngine.h"
#include <atomic>
#include <cassert>
#include <chrono>
#include <cstdio>
#include <thread>
#include <vector>
using namespace std::chrono_literals;
static void render(MDJEngine e, int frames) { std::vector<float> o(frames * 2 + 2); mdj_render(e, o.data(), frames, 2); }

static void ordered_final_segment() {
    auto e = mdj_create(48000); assert(e);
    MDJCaptureStop stop{};
    assert(mdj_capture_request_stop(e) == 0);      // never armed: no token, nothing to fence
    mdj_capture_enable(e, true);
    render(e, 96); render(e, 96);
    auto t = mdj_capture_request_stop(e);
    assert(t == 1 && mdj_capture_request_stop(e) == t); // monotonic nonzero, idempotent
    assert(mdj_capture_stop_poll(e, t, &stop) == 0);    // nonblocking pending until render observes it
    assert(mdj_capture_stop_poll(e, 0, &stop) == -1 && mdj_capture_stop_poll(e, t + 1, &stop) == -1);
    MDJCaptureSnapshot s{};
    assert(!mdj_capture_snapshot(e, &s));           // pending stop gates live snapshot
    render(e, 96);                                  // stop was already requested: this call acks at entry and publishes nothing
    assert(mdj_capture_stop_poll(e, t, &stop) == 1);
    assert(stop.token == t && !stop.gap && stop.published == 2 && stop.remaining == 2 && stop.finalFrame == 192);
    uint64_t last = 0; int n = 0;
    while (mdj_capture_pop(e, &s) == 1) { assert(s.frame > last); last = s.frame; ++n; }
    assert(n == 2 && last == stop.finalFrame);
    render(e, 96); render(e, 0);                    // no publication after ack
    assert(mdj_capture_pop(e, &s) == 0 && !mdj_capture_snapshot(e, &s));
    mdj_capture_enable(e, true); render(e, 96);     // epoch is never re-armed
    assert(mdj_capture_pop(e, &s) == 0);
    assert(mdj_capture_request_stop(e) == t);
    mdj_destroy(e);
}

static void zero_frame_and_mid_call_ack() {
    auto e = mdj_create(48000);
    mdj_capture_enable(e, true);
    auto t = mdj_capture_request_stop(e);
    MDJCaptureStop stop{};
    render(e, 0);                                   // a callback that renders nothing still acks
    assert(mdj_capture_stop_poll(e, t, &stop) == 1 && stop.published == 0 && stop.finalFrame == 0 && stop.remaining == 0);
    mdj_destroy(e);
}

static void concurrent_stop() {
    for (int round = 0; round < 50; ++round) {
        auto e = mdj_create(48000);
        mdj_capture_enable(e, true);
        std::atomic<bool> quit{false};
        std::thread audio([&] { while (!quit) { render(e, 64); std::this_thread::sleep_for(20us); } });
        std::vector<uint64_t> frames; std::atomic<bool> drain{true}; std::atomic<int> failed{0};
        std::thread consumer([&] {
            MDJCaptureSnapshot s{};
            while (drain) { int r = mdj_capture_pop(e, &s); if (r == 1) frames.push_back(s.frame); else if (r < 0) { failed = 1; break; } else std::this_thread::sleep_for(10us); }
        });
        std::this_thread::sleep_for(std::chrono::microseconds(200 + round * 37));
        auto t = mdj_capture_request_stop(e); assert(t != 0);
        MDJCaptureStop stop{};
        while (mdj_capture_stop_poll(e, t, &stop) == 0) std::this_thread::sleep_for(5us);
        std::this_thread::sleep_for(3ms);           // audio thread keeps rendering after the ack
        drain = false; consumer.join(); quit = true; audio.join();
        MDJCaptureSnapshot s{};
        while (!failed && mdj_capture_pop(e, &s) == 1) frames.push_back(s.frame);
        assert(!failed && !stop.gap);
        assert(frames.size() == stop.published && !frames.empty() ? frames.back() == stop.finalFrame : stop.published == 0);
        for (size_t i = 1; i < frames.size(); ++i) assert(frames[i] > frames[i - 1]);
        mdj_destroy(e);
    }
}

static void overflow_preserved() {
    auto e = mdj_create(48000);
    mdj_capture_enable(e, true);
    for (int i = 0; i < 129; ++i) render(e, 96);
    auto t = mdj_capture_request_stop(e);
    render(e, 96);
    MDJCaptureStop stop{};
    assert(mdj_capture_stop_poll(e, t, &stop) == 1 && stop.gap);
    MDJCaptureSnapshot s{};
    assert(mdj_capture_pop(e, &s) == -1);           // gap stays latched; no reset to hide it
    mdj_capture_enable(e, true); render(e, 96);
    assert(mdj_capture_pop(e, &s) == -1);
    mdj_destroy(e);
}

int main() { ordered_final_segment(); zero_frame_and_mid_call_ack(); concurrent_stop(); overflow_preserved(); puts("capture stop fence OK"); }
