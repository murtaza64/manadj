#include "CEngine.h"
#include <cassert>
int main() {
    auto e = mdj_create(48000); assert(e);
    mdj_capture_enable(e, true);
    MDJCaptureSnapshot s{};
    assert(!mdj_capture_snapshot(e, &s));
    assert(!mdj_capture_snapshot(e, nullptr));
    assert(mdj_submit(e, MDJCrossfade, 0, -.5, 0));
    assert(mdj_submit(e, MDJFader, 1, .25, 0));
    float output[192]{}; mdj_render(e, output, 96, 2);
    assert(mdj_capture_snapshot(e, &s));
    assert(s.frame == 96 && s.sampleRate == 48000);
    assert(s.crossfade == -.5f && s.decks[1].fader == .25f);
    mdj_destroy(e);
}
