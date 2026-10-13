#pragma once

#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <mutex>

namespace manadj {
constexpr int kDeckCount = 4;
constexpr uint32_t kRingFrames = 65536; // ~0.5 MiB/deck, 2 MiB total at stereo float.
constexpr int kQueueSize = 128;

enum class Op : int { Prepare, Ready, Error, Play, Pause, CueDown, CueUp, Seek,
                       Fader, Trim, Crossfade, Pitch, Bend, HotPreview, End };
struct Command {
    Op op;
    int deck;
    uint64_t seq;
    uint64_t generation;
    double value;
    int sampleRate;
    int channels;
};

struct Deck {
    std::array<float, kRingFrames * 2> pcm{};
    std::atomic<uint64_t> write{0};
    std::atomic<uint64_t> read{0};
    std::atomic<uint64_t> generation{0};
    std::atomic<uint64_t> applied{0};
    std::atomic<double> position{0};
    std::atomic<int> state{0}; // 0 empty, 1 loading, 2 ready, 3 error
    std::atomic<bool> playing{false};
    std::atomic<bool> preview{false};
    bool eof = false;
    std::atomic<int> sampleRate{44100};
    int channels = 2;
    double fractional = 0;
    std::atomic<double> cue{-1};
    std::atomic<float> fader{1};
    std::atomic<float> trim{.5f};
    float gain = 0;
    float targetGain = 0;
    std::atomic<float> pitch{0};
    std::atomic<float> bend{0};
};

class Engine {
public:
    explicit Engine(int outputRate = 48000);
    // Multiple JNI callers may submit; one producer lock, never taken on the callback.
    uint64_t submit(Op op, int deck, double value = 0, uint64_t generation = 0,
                    int sourceRate = 0, int channels = 0);
    // One decoder per deck; returns accepted frames or 0 for stale/full.
    int offer(int deck, uint64_t generation, const float* samples, int frames);
    void render(float* output, int frames) noexcept;
    Deck& deck(int index) { return decks_[index]; }
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
    void apply(const Command& command) noexcept;
};
} // namespace manadj
