// Synthetic host tests, no Android device or user media.
#include "../../main/cpp/Engine.h"
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <memory>

using namespace manadj;
#define CHECK(x) do { if (!(x)) { std::fprintf(stderr, "%d: %s\n", __LINE__, #x); std::exit(1); } } while (0)
static std::string root;
static int serial = 0;
std::string path() { return root + "/synthetic-" + std::to_string(++serial) + ".wav"; }
std::vector<uint8_t> bytes(const std::string& p) { std::ifstream f(p, std::ios::binary); return {std::istreambuf_iterator<char>(f), {}}; }
uint32_t le(const std::vector<uint8_t>& b, int at) { return b[at] | uint32_t(b[at+1]) << 8 | uint32_t(b[at+2]) << 16 | uint32_t(b[at+3]) << 24; }
int sample(const std::vector<uint8_t>& b, int i) { return static_cast<int16_t>(b[44+i*2] | b[45+i*2] << 8); }
ssize_t fullDisk(int, const void*, size_t) { errno = ENOSPC; return -1; }
static int writes = 0;
ssize_t failedHeader(int fd, const void* p, size_t n) {
    if (++writes >= 3) { errno = EIO; return -1; }
    return ::write(fd, p, n);
}

void prepare(Engine& e, int deck, float left, float right, bool privateCue) {
    std::vector<float> out(4), pcm(16384 * 2);
    for (int i=0; i<16384; ++i) { pcm[i*2]=left; pcm[i*2+1]=right; }
    e.submit(Op::Prepare, deck, 0, deck+1);
    e.render(out.data(), 1);
    auto& d = e.deck(deck);
    CHECK(e.claim(deck, deck+1, d.transport.load(), 48000, 0));
    CHECK(e.offer(deck, d.transport.load(), pcm.data(), 16384) == 16384);
    CHECK(e.publish(deck, deck+1, d.transport.load(), false));
    e.submit(Op::Trim, deck, 1);
    e.submit(Op::Fader, deck, privateCue ? 0 : .65);
    e.submit(Op::Pfl, deck, privateCue ? 1 : 0);
    e.submit(Op::Play, deck);
}

int main() {
    char name[] = "/tmp/manadj-recording-decoy-XXXXXX";
    CHECK(::mkdtemp(name)); root = name;
    std::vector<uint8_t> stereoReference;
    for (int routing=0; routing<3; ++routing) {
        auto e = std::make_unique<Engine>();
        prepare(*e, 0, .12f, -.31f, false);
        prepare(*e, 1, -.05f, .09f, false);
        prepare(*e, 2, .75f, .85f, true);
        e->submit(Op::Crossfade, 0, .25);
        e->submit(Op::Eq, 0, .7, 0, 1);
        CHECK(e->submitBeatFx(4, 4, true, -.25, .5, 0)); // master TRANS processing
        std::vector<float> out(8192*4);
        e->render(out.data(), 4096);
        const auto p = path();
        CHECK(e->masterRecorder.start(p, 48000));
        e->setRouting(static_cast<Routing>(routing));
        const int channels = routing==2 ? 4 : 2;
        e->render(out.data(), 4099, channels);
        e->masterRecorder.stop();
        CHECK(e->masterRecorder.state()==MasterRecorder::Complete);
        const auto wav = bytes(p);
        CHECK(wav.size()==44+4099*4 && le(wav,24)==48000 && le(wav,40)==4099*4);
        CHECK(wav[20]==1 && wav[22]==2 && wav[34]==16);
        if (routing==0) stereoReference = wav;
        else CHECK(wav == stereoReference); // logical Master is routing-independent
        if (routing==0 || routing==2) {
            for (int i=0; i<4099; ++i) for (int c=0; c<2; ++c)
                CHECK(std::abs(sample(wav,i*2+c)-std::lrint(out[i*channels+c]*32767))<=1);
        }
        if (routing==1) {
            // Separate stereo Master survives mono physical output, while
            // the private cue is large and absent from the recorded bus.
            CHECK(sample(wav,800)!=sample(wav,801));
            CHECK(std::abs(out[800*2+1])>.5);
            CHECK(std::abs(sample(wav,800))<12000 && std::abs(sample(wav,801))<12000);
        }
        CHECK(!e->masterRecorder.start(p,48000)); // no overwrite
    }
    {
        MasterRecorder r;
        const float stereo[] = {.25f,-.5f, .1f,-.2f, .3f,-.4f};
        for (int rate : {44100,48000,96000}) {
            const auto p=path(); CHECK(r.start(p,rate)); r.push(stereo,3,rate); r.stop();
            CHECK(r.state()==MasterRecorder::Complete && r.frames()==3);
            CHECK(bytes(p).size()==56 && le(bytes(p),24)==uint32_t(rate));
        }
        const auto p=path(); CHECK(r.start(p,48000)); r.push(stereo,3,44100); r.stop();
        CHECK(r.error()==MasterRecorder::RateChanged && bytes(p).empty());
    }
    {
        MasterRecorder r(1); const float pcm[4]={}; const auto p=path();
        CHECK(r.start(p,48000)); r.push(pcm,2,48000); r.stop();
        CHECK(r.error()==MasterRecorder::Overflow && bytes(p).empty());
    }
    {
        MasterRecorder r; const float pcm[6]={}; const auto p=path();
        CHECK(r.start(p,48000,2)); r.push(pcm,3,48000); r.stop();
        CHECK(r.error()==MasterRecorder::RiffLimit && bytes(p).empty());
    }
    {
        MasterRecorder r(1024,fullDisk); const float pcm[4]={}; const auto p=path();
        CHECK(r.start(p,48000)); r.push(pcm,2,48000); r.stop();
        CHECK(r.error()==MasterRecorder::Storage && bytes(p).empty());
    }
    {
        MasterRecorder r(1024,failedHeader); const float pcm[4]={}; const auto p=path();
        CHECK(r.start(p,48000)); r.push(pcm,2,48000); r.stop();
        CHECK(r.error()==MasterRecorder::Storage && bytes(p).empty());
    }
    {
        MasterRecorder r; const float pcm[4]={}; const auto p=path();
        CHECK(r.start(p,48000)); r.push(pcm,2,48000); r.stop(MasterRecorder::Cancelled);
        CHECK(r.state()==MasterRecorder::Failed && bytes(p).empty());
        CHECK(!r.start(p,48000)); // crash/cancel remainder is never overwritten
    }
    {
        MasterRecorder r; const float pcm[4]={}; const auto p=path();
        CHECK(r.start(p,48000)); r.push(pcm,2,48000); r.stop(MasterRecorder::Interrupted);
        CHECK(r.error()==MasterRecorder::Interrupted && bytes(p).empty());
        MasterRecorder restarted;
        CHECK(!restarted.start(p,48000)); // process-restart remnant, no overwrite
        CHECK(restarted.error()==MasterRecorder::Open);
    }
    // Repeated stop at the end of a concurrently produced final partial block.
    {
        MasterRecorder r;
        const float pcm[34]={};
        for (int repeat=0; repeat<30; ++repeat) {
            const auto p=path(); CHECK(r.start(p,48000));
            std::thread producer([&] { for (int i=0; i<100; ++i) r.push(pcm,17,48000); });
            producer.join(); r.stop();
            CHECK(r.state()==MasterRecorder::Complete && r.frames()==1700);
            CHECK(bytes(p).size()==44+1700*4);
        }
    }
    {
        MasterRecorder r; const float oldPcm[4]={1,1,1,1}, nextPcm[4]={0,0,0,0};
        const auto first=path(), next=path();
        CHECK(r.start(first,48000)); const auto staleEpoch = r.epoch();
        r.push(nextPcm,2,48000); r.stop();
        CHECK(r.start(next,48000));
        // Callback paused while rendering an old generation must not publish
        // its late block into a rapidly restarted recording.
        r.push(oldPcm,2,48000,staleEpoch);
        r.push(nextPcm,2,48000,r.epoch()); r.stop();
        CHECK(r.frames()==2 && sample(bytes(next),0)==0);
    }
    std::puts("PASS Master recorder: routing/PFL/gain/FX, WAV framing/rates/partial block, repeat/limits/storage/cancel");
}
