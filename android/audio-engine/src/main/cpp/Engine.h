#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <mutex>
#include "Dsp.h"

namespace manadj {
constexpr int kDeckCount = 4;
constexpr int kHotCues = 8;
constexpr int kMainCueSlot = kHotCues; // previewSlot value for a main-cue preview.
constexpr uint32_t kRingFrames = 65536; // ~0.5 MiB/deck, 2 MiB total at stereo float.
constexpr int kQueueSize = 256;
constexpr int kFadeFrames = 240;        // ~5 ms transport envelope / relocation crossfade at 48 kHz.
constexpr int kHeadSlots = kHotCues + 1; // Hot cues 0..7 + main cue.
constexpr int kHeadFrames = 8192;       // Pre-decoded audio at each cue (~170 ms at 48 kHz).
constexpr int kTailFrames = 2048;       // Old audio captured for a crossfade (240 frames at <=8x ratio).
constexpr double kAtCueEpsilon = 0.01;  // Desktop transport.ts AT_CUE_EPSILON.
constexpr int kBlockFrames = 1024;      // Bus scratch size; longer callbacks render in blocks.

// Output stage: how the master and cue (PFL) buses map onto device channels.
enum class Routing : int {
    Stereo = 0,     // master L/R; cue bus not output
    SplitMono = 1,  // L = mono master, R = mono cue (single stereo jack + splitter cable)
    Quad = 2,       // ch1/2 master, ch3/4 cue (needs a >=4-channel device; stereo master otherwise)
};

static_assert(std::atomic<double>::is_always_lock_free, "callback needs lock-free double atomics");
static_assert(std::atomic<float>::is_always_lock_free, "callback needs lock-free float atomics");
static_assert(std::atomic<uint64_t>::is_always_lock_free, "callback needs lock-free 64-bit atomics");

// Load status word = (loadId << 2) | state. Encoding the load id makes every
// READY/ERROR transition a CAS that a superseded load can never win.
enum State : uint64_t { kEmpty = 0, kLoading = 1, kReady = 2, kError = 3 };
inline uint64_t status(uint64_t load, State state) { return (load << 2) | state; }

// Head state word: low bits state, kHeadBusy while the callback plays from it.
enum HeadState : uint32_t { kHeadEmpty = 0, kHeadWriting = 1, kHeadReady = 2, kHeadBusy = 4 };

/*
 * Pre-decoded audio at a cue point. The worker writes it only while it is not
 * busy (CAS Ready->Writing fails once the callback has set kHeadBusy); the
 * callback plays from it only when tagged with the current load and the exact
 * relocation target, so a jump to a cue starts instantly while the ring refills.
 */
struct Head {
    std::array<float, kHeadFrames * 2> pcm{};
    std::atomic<uint32_t> state{kHeadEmpty};
    std::atomic<uint64_t> load{0};
    std::atomic<double> seconds{-1};
    std::atomic<int> frames{0};
};

enum class Op : int { Prepare, Play, Pause, CueDown, CueUp, HotCueDown, HotCueUp,
                       HotCueSet, HotCueClear, Seek, Fader, Trim, Crossfade, Pitch, Bend, Pfl, CueMix, Eq, Filter };
struct Command {
    Op op;
    int deck;
    uint64_t seq;
    uint64_t load;
    double value;
    int slot;
    double aux[5]; // Filter: pass (0 low/1 high), cutoff Hz, wet, resonance dB, compensation gain
};

/** One sweep-filter branch (res24 cascade); LP and HP run in parallel like the desktop graph. */
struct FilterBranch {
    dsp::Pass pass;
    dsp::Biquad stages[2];
    double logHz = std::log(20000.0), hzTarget = 20000;
    double qDb = 0, qTarget = 0;
    float gain = 0, gainTarget = 0;
    bool designed = false;
};

/*
 * Ownership (one decode worker per deck, one audio callback):
 * - callback writes: loadId, transport, target, position, playing, preview,
 *   previewSlot, cue, hotcues, mixer values, read (while rendering).
 * - worker writes: write, ring, eof, sampleRate, READY/ERROR status, and
 *   read/position only while ring != transport (callback is not rendering).
 * A relocation (load, seek, cue/hot-cue jump) bumps `transport`; the callback
 * renders a deck only once the worker has refilled and published `ring ==
 * transport`, so PCM of an older transport or load can never be heard.
 */
struct Deck {
    std::array<float, kRingFrames * 2> pcm{};
    std::atomic<uint64_t> write{0};
    std::atomic<uint64_t> read{0};
    std::atomic<uint64_t> loadId{0};
    std::atomic<uint64_t> status{0};
    std::atomic<uint64_t> transport{0};
    std::atomic<double> target{0};
    std::atomic<uint64_t> ring{0};
    std::atomic<uint64_t> eof{0};
    std::atomic<uint64_t> applied{0};
    std::atomic<double> position{0};
    std::atomic<bool> playing{false};
    std::atomic<bool> preview{false};
    std::atomic<int> previewSlot{-1};
    std::atomic<int> sampleRate{44100};
    std::atomic<double> cue{0};
    std::array<std::atomic<double>, kHotCues> hotcues{};
    std::atomic<float> fader{1};
    std::atomic<float> trim{.5f};
    std::atomic<float> pitch{0};
    std::atomic<float> bend{0};
    std::atomic<bool> pfl{false};
    std::array<std::atomic<float>, 3> eq{};  // knob values 0..1 (low, mid, high), for snapshots
    std::atomic<float> filter{0};             // knob -1..1
    // Strip DSP (callback-private): LR4 isolator EQ, sweep filter.
    dsp::Biquad eqLow[2], eqMidHp[2], eqMidLp[2], eqHigh[2];
    float eqGain[3] = {1, 1, 1}, eqTarget[3] = {1, 1, 1};
    FilterBranch branch[2] = {{dsp::Pass::Low}, {dsp::Pass::High}};
    float dry = 1, dryTarget = 1;
    bool stripWarm = false;
    std::array<Head, kHeadSlots> heads{};
    // Head being played (-1 none) and the ring offset (source frames) the worker must start at.
    std::atomic<int> headSlot{-1};
    std::atomic<int> ringOffset{0};
    // Actual start of the claimed ring (decoder PTS), applied by the callback on first render.
    std::atomic<double> claimedStart{0};
    std::atomic<uint64_t> claimedTransport{0};
    // Callback-private.
    double fractional = 0;
    double headPos = 0;
    uint64_t positionTransport = 0;
    float gain = 0;          // master: trim x fader law x crossfader (smoothed)
    float targetGain = 0;
    float cueGain = 0;       // cue bus: trim only, pre-fader, 0 when PFL is off (smoothed)
    float targetCueGain = 0;
    float envelope = 0;
    // Crossfade tail: old audio copied at relocation/stop, faded out independently.
    std::array<float, kTailFrames * 2> tail{};
    int tailAvail = 0;
    int tailLeft = 0;
    double tailPos = 0;
    double tailRatio = 1;
    float tailGain = 0;
    float tailCueGain = 0;
};

class Engine {
public:
    explicit Engine(int outputRate = 48000);
    // Any thread; one producer lock, never taken on the callback. Returns 0 if full.
    uint64_t submit(Op op, int deck, double value = 0, uint64_t load = 0, int slot = 0, const double* aux = nullptr);
    // Control thread: computes the desktop sweep-filter target (not realtime-safe) and queues it.
    uint64_t submitFilter(int deck, double position);

    // Decode worker API (one worker thread per deck at a time).
    // Starts filling `transport` if it is current: discards ring contents and
    // records the source rate and actual start position. False if superseded.
    bool claim(int deck, uint64_t load, uint64_t transport, int sampleRate, double startSeconds);
    // Accepted frames, or -1 if `transport` is no longer current.
    int offer(int deck, uint64_t transport, const float* samples, int frames);
    // Makes the claimed transport audible; marks the load READY on first publish.
    bool publish(int deck, uint64_t load, uint64_t transport, bool endOfStream);
    void fail(int deck, uint64_t load);
    // Head fill (worker): begin fails while the callback plays from the slot.
    bool headBegin(int deck, int slot);
    int headWrite(int deck, int slot, int offsetFrames, const float* samples, int frames);
    void headCommit(int deck, int slot, uint64_t load, double seconds, int frames);
    void headAbort(int deck, int slot);

    // Renders `frames` interleaved frames of `channels` channels through the current routing.
    void render(float* output, int frames, int channels = 2) noexcept;
    void setRouting(Routing routing) { routing_.store(static_cast<int>(routing)); }
    Routing routing() const { return static_cast<Routing>(routing_.load()); }
    float cueMix() const { return cueMix_.load(); }
    Deck& deck(int index) { return decks_[index]; }
    const Deck& deck(int index) const { return decks_[index]; }
    int outputRate() const { return outputRate_.load(); }
    void setOutputRate(int rate) { outputRate_.store(rate); }
    uint64_t outputFrames() const { return outputFrames_.load(); }
    uint64_t accepted() const { return accepted_.load(); }
    uint64_t applied() const { return applied_.load(); }
    uint64_t starvedFrames() const { return starvedFrames_.load(); }
    float crossfade() const { return crossfade_.load(); }

private:
    std::array<Deck, kDeckCount> decks_{};
    std::array<Command, kQueueSize> commands_{};
    std::mutex submitMutex_;
    std::atomic<uint64_t> queueWrite_{0}, queueRead_{0};
    std::atomic<uint64_t> accepted_{0}, applied_{0}, outputFrames_{0}, starvedFrames_{0};
    std::atomic<int> outputRate_;
    std::atomic<float> crossfade_{0};
    std::atomic<float> cueMix_{0};  // Headphone blend: 0 = cue bus only, 1 = master only.
    std::atomic<int> routing_{0};
    std::array<float, kBlockFrames * 2> master_{};
    std::array<float, kBlockFrames * 2> cue_{};
    void renderBuses(int frames) noexcept;
    bool renderSource(Deck& d, float* strip, int frames) noexcept;
    void designEq(Deck& d, double rate) noexcept;
    void resetStrip(Deck& d) noexcept;
    static constexpr int kSweepBlock = 32;
    std::array<float, kBlockFrames * 2> strip_{};
    double stripRate_ = 0;
    static float ceiling(float value) noexcept;
    void updateGain(int index) noexcept;
    void relocate(Deck& d, double seconds, int slot = -1) noexcept;
    void stop(Deck& d) noexcept;
    void captureTail(Deck& d) noexcept;
    void releaseHead(Deck& d) noexcept;
    void apply(const Command& command) noexcept;
};
} // namespace manadj
