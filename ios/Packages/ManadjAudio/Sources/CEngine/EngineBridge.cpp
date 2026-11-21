#include "CEngine.h"
// Compile the existing engine in place. No fork or vendored copy to drift.
#include "../../../../../android/audio-engine/src/main/cpp/Engine.cpp"
#include <algorithm>
#include <cmath>
#include <new>
using namespace manadj;
static Engine *E(MDJEngine e) { return static_cast<Engine *>(e); }
static bool valid(int d) { return d >= 0 && d < kDeckCount; }
extern "C" {
MDJEngine mdj_create(int rate) { try { return new Engine(rate); } catch (...) { return nullptr; } }
void mdj_destroy(MDJEngine e) { delete E(e); }
void mdj_set_rate(MDJEngine e, int r) { E(e)->setOutputRate(r); }
void mdj_render(MDJEngine e, float *out, int n, int channels) { E(e)->render(out, n, channels); }
uint64_t mdj_frames(MDJEngine e) { return E(e)->outputFrames(); }
uint64_t mdj_starved_frames(MDJEngine e) { return E(e)->starvedFrames(); }
uint64_t mdj_prepare(MDJEngine e, int d, uint64_t load) { return valid(d) ? E(e)->submit(Op::Prepare, d, 0, load) : 0; }
uint64_t mdj_submit(MDJEngine e, MDJOp op, int d, double value, int slot) {
    static const Op ops[] = {Op::Play, Op::Pause, Op::CueDown, Op::CueUp, Op::HotCueDown, Op::HotCueUp,
        Op::HotCueSet, Op::HotCueClear, Op::Seek, Op::Fader, Op::Trim, Op::Crossfade, Op::Pitch, Op::Bend,
        Op::Pfl, Op::CueMix, Op::Eq, Op::BeatJump, Op::LoopToggle, Op::LoopResize, Op::LoopPreset,
        Op::Quantize, Op::CueSetAt, Op::HotCueSetAt, Op::KeyLock, Op::HeardLatency};
    if (!valid(d) || !std::isfinite(value) || (int)op < 0 || (int)op >= (int)(sizeof(ops)/sizeof(*ops))) return 0;
    return E(e)->submit(ops[(int)op], d, value, 0, slot);
}
uint64_t mdj_grid(MDJEngine e, int d, double bpm, double anchor) {
    const double aux[] = {anchor, 0, 0, 0, 0};
    return valid(d) && std::isfinite(anchor) ? E(e)->submit(Op::SetGrid, d, bpm, 0, 0, aux) : 0;
}
uint64_t mdj_filter(MDJEngine e, int d, double p) { return valid(d) ? E(e)->submitFilter(d, p) : 0; }
uint64_t mdj_fx(MDJEngine e, int effect, int target, bool on, double depth, double beats) { return E(e)->submitBeatFx(effect, target, on, depth, beats, 0); }
void mdj_routing(MDJEngine e, bool split) { E(e)->setRouting(split ? Routing::SplitMono : Routing::Stereo); }
MDJDeck mdj_deck(MDJEngine e, int i) {
    MDJDeck s{}; if (!valid(i)) return s;
    const auto &d = E(e)->deck(i);
    s.load = d.loadId.load(); s.transport = d.transport.load(); s.status = d.status.load();
    s.position = d.position.load(); s.target = d.target.load(); s.cue = d.cue.load(); s.bpm = d.bpm.load(); s.anchor = d.gridAnchor.load();
    s.loopStart = d.loopStart.load(); s.loopEnd = d.loopEnd.load(); s.loopBeats = d.loopBeats.load();
    const int trackRate = d.track.sampleRate.load();
    s.decodedSeconds = d.track.load.load() == s.load && trackRate > 0
        ? double(d.track.frames.load()) / trackRate : 0;
    for (int k = 0; k < 8; ++k) s.hotCues[k] = d.hotcues[k].load();
    s.fader = d.fader.load(); s.trim = d.trim.load(); s.pitch = d.pitch.load(); s.bend = d.bend.load(); s.filter = d.filter.load();
    for (int k = 0; k < 3; ++k) s.eq[k] = d.eq[k].load();
    s.previewSlot = d.previewSlot.load();
    s.playing = d.playing.load(); s.preview = d.preview.load(); s.ready = (s.status & 3) == kReady && (s.status >> 2) == s.load;
    s.fullyDecoded = d.track.load.load() == s.load && d.track.complete.load(); s.keyLock = d.keyLock.load(); s.keyLockActive = d.stretching.load();
    s.pfl = d.pfl.load(); s.loopActive = d.loopActive.load(); return s;
}
bool mdj_stream_claim(MDJEngine e, int d, uint64_t load, uint64_t transport, int rate, double seconds) { return valid(d) && E(e)->claim(d, load, transport, rate, seconds); }
int mdj_stream_write(MDJEngine e, int d, uint64_t transport, const float *pcm, int n) { return valid(d) ? E(e)->offer(d, transport, pcm, n) : -1; }
bool mdj_stream_publish(MDJEngine e, int d, uint64_t load, uint64_t transport, bool eof) { return valid(d) && E(e)->publish(d, load, transport, eof); }
bool mdj_track_begin(MDJEngine e, int d, uint64_t load, uint64_t frames, int rate) { try { return valid(d) && E(e)->trackBegin(d, load, frames, rate, 0); } catch (...) { return false; } }
int mdj_track_write(MDJEngine e, int d, uint64_t load, const float *pcm, int n) { return valid(d) ? E(e)->trackWrite(d, load, pcm, n) : -1; }
bool mdj_track_finish(MDJEngine e, int d, uint64_t load) {
    if (!valid(d)) return false;
    E(e)->trackFinish(d, load);
    auto &deck = E(e)->deck(d);
    const auto transport = deck.transport.load();
    if (!deck.track.complete.load() || !E(e)->claim(d, load, transport, deck.track.sampleRate.load(), 0)) return false;
    return E(e)->publish(d, load, transport, true) && deck.loadId.load() == load;
}
void mdj_fail(MDJEngine e, int d, uint64_t load) { if (valid(d)) E(e)->fail(d, load); }
bool mdj_record_start(MDJEngine e, const char *path) { try { return E(e)->masterRecorder.start(path, E(e)->outputRate()); } catch (...) { return false; } }
void mdj_record_stop(MDJEngine e, bool interrupted) { E(e)->masterRecorder.stop(interrupted ? MasterRecorder::Interrupted : MasterRecorder::None); }
int mdj_record_state(MDJEngine e) { return E(e)->masterRecorder.state(); }
int mdj_record_error(MDJEngine e) { return E(e)->masterRecorder.error(); }
}
