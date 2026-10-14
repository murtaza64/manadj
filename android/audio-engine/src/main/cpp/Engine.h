#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <mutex>

namespace manadj {
constexpr int kDeckCount = 4;
constexpr int kHotCues = 8;
constexpr int kMainCueSlot = kHotCues; // previewSlot value for a main-cue preview.
constexpr uint32_t kRingFrames = 65536; // ~0.5 MiB/deck, 2 MiB total at stereo float.
constexpr int kQueueSize = 256;
constexpr int kFadeFrames = 240;        // ~5 ms transport envelope at 48 kHz.
constexpr double kAtCueEpsilon = 0.01;  // Desktop transport.ts AT_CUE_EPSILON.

static_assert(std::atomic<double>::is_always_lock_free, "callback needs lock-free double atomics");
static_assert(std::atomic<float>::is_always_lock_free, "callback needs lock-free float atomics");
static_assert(std::atomic<uint64_t>::is_always_lock_free, "callback needs lock-free 64-bit atomics");

// Load status word = (loadId << 2) | state. Encoding the load id makes every
// READY/ERROR transition a CAS that a superseded load can never win.
enum State : uint64_t { kEmpty = 0, kLoading = 1, kReady = 2, kError = 3 };
inline uint64_t status(uint64_t load, State state) { return (load << 2) | state; }

enum class Op : int { Prepare, Play, Pause, CueDown, CueUp, HotCueDown, HotCueUp,
                       HotCueSet, HotCueClear, Seek, Fader, Trim, Crossfade, Pitch, Bend };
struct Command {
    Op op;
    int deck;
    uint64_t seq;
    uint64_t load;
    double value;
    int slot;
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
    // Callback-private.
    double fractional = 0;
    float gain = 0;
    float targetGain = 0;
    float envelope = 0;
    int fadeOut = 0;
};

class Engine {
public:
    explicit Engine(int outputRate = 48000);
    // Any thread; one producer lock, never taken on the callback. Returns 0 if full.
    uint64_t submit(Op op, int deck, double value = 0, uint64_t load = 0, int slot = 0);

    // Decode worker API (one worker thread per deck at a time).
    // Starts filling `transport` if it is current: discards ring contents and
    // records the source rate and actual start position. False if superseded.
    bool claim(int deck, uint64_t load, uint64_t transport, int sampleRate, double startSeconds);
    // Accepted frames, or -1 if `transport` is no longer current.
    int offer(int deck, uint64_t transport, const float* samples, int frames);
    // Makes the claimed transport audible; marks the load READY on first publish.
    bool publish(int deck, uint64_t load, uint64_t transport, bool endOfStream);
    void fail(int deck, uint64_t load);

    void render(float* output, int frames) noexcept;
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
    static float ceiling(float value) noexcept;
    void updateGain(int index) noexcept;
    void relocate(Deck& d, double seconds) noexcept;
    void stop(Deck& d) noexcept;
    void apply(const Command& command) noexcept;
};
} // namespace manadj
