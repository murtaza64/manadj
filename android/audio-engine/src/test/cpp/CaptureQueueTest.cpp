#include "../../main/cpp/Engine.h"
#include <cassert>
#include <memory>
#include <thread>
#include <atomic>
using namespace manadj;
int main() {
    auto e = std::make_unique<Engine>(48000); e->enableCapture(true);
    float output[192]{};
    e->submit(Op::Fader, 0, .25); e->render(output,96);
    e->submit(Op::Fader, 0, .75); e->render(output,96);
    CaptureSnapshot snap;
    // Both applied states survive even if the app did not poll between them.
    assert(e->popCapture(snap)==1 && snap.frame==96 && snap.decks[0].fader==.25f);
    assert(e->popCapture(snap)==1 && snap.frame==192 && snap.decks[0].fader==.75f);
    assert(e->popCapture(snap)==0);
    // Frame-scheduled changes inside one callback retain each rendered segment.
    { Engine::ScheduleScope at(216); e->submit(Op::Fader,0,.1); }
    { Engine::ScheduleScope at(240); e->submit(Op::Fader,0,.9); }
    e->render(output,96);
    assert(e->popCapture(snap)==1 && snap.frame==216 && snap.decks[0].fader==.75f);
    assert(e->popCapture(snap)==1 && snap.frame==240 && snap.segmentStart==216 && snap.decks[0].fader==.1f);
    assert(e->popCapture(snap)==1 && snap.frame==288 && snap.segmentStart==240 && snap.decks[0].fader==.9f);
    // A stalled consumer cannot silently turn overflow into complete history.
    for(int i=0;i<129;++i)e->render(output,96);
    assert(e->popCapture(snap)==-1);
    e->enableCapture(false); e->enableCapture(true);
    assert(e->popCapture(snap)==-1); // never reset gap by toggling recording
}
