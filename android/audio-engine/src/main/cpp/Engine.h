#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <memory>
#include <mutex>
#include "BeatFx.h"
#include "signalsmith-stretch/signalsmith-stretch.h"
#include "Dsp.h"

namespace manadj {
constexpr int kDeckCount = 4;
constexpr int kHotCues = 8;
constexpr int kMainCueSlot = kHotCues; // previewSlot value for a main-cue preview.
constexpr uint32_t kRingFrames = 65536; // ~0.5 MiB/deck, 2 MiB total at stereo float.
constexpr int kQueueSize = 4096;     // replay schedules ahead; ~400 KB
constexpr int kScheduleSize = 8192;  // ops waiting for their frame
constexpr int kFadeFrames = 240;        // ~5 ms transport envelope / relocation crossfade at 48 kHz.
constexpr int kLoopSlot = kHotCues + 1;   // Head slot holding the active loop's start.
constexpr int kHeadSlots = kHotCues + 2;  // Hot cues 0..7 + main cue + loop start.
constexpr double kLoopMinBeats = 0.125, kLoopMaxBeats = 128, kLoopDefaultBeats = 4; // desktop loop.ts
constexpr double kGridlessBpm = 120;     // desktop jumpBeats fallback for BPM-less tracks
constexpr int kHeadFrames = 8192;       // Pre-decoded audio at each cue (~170 ms at 48 kHz).
constexpr int kTailFrames = 2048;       // Old audio captured for a crossfade (240 frames at <=8x ratio).
constexpr double kMaxLeadInSeconds = 30; // desktop MAX_LEAD_IN_SECONDS: pre-roll bound
constexpr double kAtCueEpsilon = 0.01;  // Desktop transport.ts AT_CUE_EPSILON.
constexpr int kBlockFrames = 1024;
constexpr double kTrackMarginSeconds = 2;  // decoded audio required ahead before the in-memory track serves      // Bus scratch size; longer callbacks render in blocks.

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

/*
 * The whole decoded track (int16 stereo), appended front-to-back by a worker after the
 * deck's Prepare has applied. The callback reads it only while `load` equals the deck's
 * current load, and only below `frames`; once Prepare(load) has applied no callback reads
 * an older tag, so the worker may free and reallocate before tagging the new load.
 */
struct Track {
    std::unique_ptr<int16_t[]> pcm; // worker-owned allocation
    uint64_t capacity = 0;          // frames (worker-owned)
    std::atomic<uint64_t> load{0};
    std::atomic<uint64_t> frames{0};
    std::atomic<int> sampleRate{0};
    std::atomic<double> startSeconds{0}; // source time of frame 0
    std::atomic<bool> complete{false};
};

enum class Op : int { Prepare, Play, Pause, CueDown, CueUp, HotCueDown, HotCueUp,
                       HotCueSet, HotCueClear, Seek, Fader, Trim, Crossfade, Pitch, Bend, Pfl, CueMix, Eq, Filter,
                       SetGrid, BeatJump, LoopToggle, LoopResize, LoopPreset, Quantize, CueSetAt, HotCueSetAt, BeatFx, KeyLock, PhaseAlign, ScratchBegin, ScratchMove, ScratchEnd,
                       LoopSet, CancelScheduled, SetSyncMembers, LaunchStart };
// SetSyncMembers (global): value = Sync Group member mask, slot = SYNCED (in-lock) mask; scopes the launch reference.
// LaunchStart: internal (callback-scheduled end of a deferred quantized launch); never submitted.
// LoopSet: value = start (< 0 clears), aux = {end, playhead (NaN keeps the position)}; machine replay (Session).
// CancelScheduled (never scheduled itself): load = tag; drops every pending scheduled op with that tag.
// ScratchMove: value = platter displacement in track seconds.
// PhaseAlign: deck = the aligning deck, slot = reference deck, value = own/peer half-double ratio.
// BeatFx (deck ignored): slot = effect (-1 none), value = depth, aux = {target, on, beats, held deck mask}.
// LoopResize slot: 0 halve, 1 double, 2 set to value beats.
struct Command {
    Op op;
    int deck;
    uint64_t seq;
    uint64_t load;
    double value;
    int slot;
    uint64_t at;   // engine output frame to apply at (0 = next callback); applied mid-callback, exactly
    uint64_t tag;  // scheduled ops: CancelScheduled(tag) drops them while pending (0 = untagged)
    double aux[5]; // Filter: pass (0 low/1 high), cutoff Hz, wet, resonance dB, compensation gain
};

/** One sweep-filter branch (biquad cascade of up to 4 stages). Two banks x LP/HP run in parallel like
 * the desktop graph (per-model branches): a model change fades the old bank out while the new one fades in. */
struct FilterBranch {
    dsp::Pass pass = dsp::Pass::Low;
    int stages = 0;
    dsp::Biquad stage[dsp::kMaxFilterStages];
    double logHz[dsp::kMaxFilterStages] = {}, qDb[dsp::kMaxFilterStages] = {};
    double logTarget[dsp::kMaxFilterStages] = {}, qTarget[dsp::kMaxFilterStages] = {};
    double tau = .02;
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
    // Beat grid (constant tempo; bpm <= 0 = none) and the active loop (seconds, desktop LoopRegion).
    std::atomic<double> bpm{0}, gridAnchor{0};
    std::atomic<bool> loopActive{false};
    std::atomic<double> loopStart{0}, loopEnd{0}, loopBeats{kLoopDefaultBeats}, pendingLoopBeats{kLoopDefaultBeats};
    // Strip DSP (callback-private): LR4 isolator EQ, sweep filter.
    dsp::Biquad eqLow[2], eqMidHp[2], eqMidLp[2], eqHigh[2];
    float eqGain[3] = {1, 1, 1}, eqTarget[3] = {1, 1, 1};
    FilterBranch branch[4] = {{dsp::Pass::Low}, {dsp::Pass::High}, {dsp::Pass::Low}, {dsp::Pass::High}}; // bank x pass
    int bank = 0, bankModel = -1;
    float dry = 1, dryTarget = 1;
    // Filter drive (tanh(4x) shaper on the summed filter output, gain-compensated; mixed by wet).
    float driveIn = .25f, driveInTarget = .25f, driveOut = 1, driveOutTarget = 1, driveMix = 0, driveMixTarget = 0;
    bool stripWarm = false;
    std::array<Head, kHeadSlots> heads{};
    Track track;
    // Key lock (desktop: Signalsmith Stretch, window model of deckSourceProcessor.ts). Stretch mode
    // renders from the in-memory track only; elsewhere the deck resamples (pitch follows tempo).
    std::atomic<bool> keyLock{false};
    std::atomic<bool> stretching{false};
    std::unique_ptr<signalsmith::stretch::SignalsmithStretch<float>> stretch;
    std::vector<float> stretchIn[2], stretchOut[2]; // window / block scratch (allocated with the stretcher)
    uint64_t stretchTransport = ~0ull;              // transport the stretcher was primed for
    double stretchTranspose = 0;
    // Scratch (desktop scratchMotion.ts): impulse-driven platter. Motion state at output frame
    // scratchTime: position (track s), drive/rate (track s per output s); rendered from the in-memory track.
    std::atomic<bool> scratching{false};
    // Deferred quantized launch: engine frame the deck starts sounding at (0 = none). Playing/preview is
    // already set; until then the deck renders silence and its playhead holds at the entry point.
    std::atomic<uint64_t> launchAt{0};
    bool scratchRunning = false;
    double scratchPos = 0, scratchDrive = 0, scratchRate = 0, scratchTime = 0;
    double scratchStart = 0, scratchLoopStart = 0, scratchLoopEnd = 0;
    bool scratchLoop = false;
    std::atomic<bool> inTrack{false};   // callback renders from the in-memory track (snapshot)
    std::atomic<bool> trackEnd{false};  // reached the end of a complete in-memory track
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
    float gain = 0;          // post-fader: trim x fader law (smoothed); Beat FX insert sits after it
    float targetGain = 0;
    float xf = 1;            // crossfader gain after the insert (smoothed)
    float targetXf = 1;
    double beatSeconds = fx::kBeatSecondsDefault; // last known wall seconds per beat (Beat FX clock)
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
    // Frame stamp (engine output frame, same counter as outputFrames) and cancel tag for the next submits
    // from the calling thread (0 = immediate). Every op type can be scheduled, including submitFilter /
    // BeatFx / SetGrid; the callback splits its buffer at the frame and applies the op exactly there,
    // ordered by (frame, submission). A frame already rendered applies at the next callback start and
    // counts in lateOps. Thread-local: set, submit, reset on one thread (see ScheduleScope).
    static void setSubmitFrame(uint64_t frame, uint64_t tag = 0) noexcept;
    struct ScheduleScope {
        ScheduleScope(uint64_t frame, uint64_t tag = 0) noexcept { setSubmitFrame(frame, tag); }
        ~ScheduleScope() { setSubmitFrame(0, 0); }
    };
    // Drops pending scheduled ops carrying `tag` (applied in submission order: ops submitted before it go).
    uint64_t cancelScheduled(uint64_t tag);
    uint64_t lateOps() const { return lateOps_.load(); }
    int scheduledOps() const { return scheduleCount_.load(); }
    // Control thread: computes the desktop sweep-filter target (not realtime-safe) and queues it.
    uint64_t submitFilter(int deck, double position);
    // Desktop FilterSettings for every deck (click-free); re-targets each deck at its last knob position.
    uint64_t submitFilterSettings(const dsp::FilterSettings& settings);
    dsp::FilterSettings filterSettings() { std::lock_guard<std::mutex> lock(filterMutex_); return filterSettings_; }
    // Whole Beat FX section (desktop setBeatFxSection). effect -1 = none; target fx::Target.
    uint64_t submitBeatFx(int effect, int target, bool on, double depth, double beats, int heldMask);

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
    // Whole-track fill (worker, after Prepare(load) applied). False/-1 once superseded or full.
    bool trackBegin(int deck, uint64_t load, uint64_t capacityFrames, int sampleRate, double startSeconds);
    int trackWrite(int deck, uint64_t load, const float* samples, int frames);
    void trackFinish(int deck, uint64_t load);

    // Renders `frames` interleaved frames of `channels` channels through the current routing.
    void render(float* output, int frames, int channels = 2) noexcept;
    void setRouting(Routing routing) { routing_.store(static_cast<int>(routing)); }
    Routing routing() const { return static_cast<Routing>(routing_.load()); }
    float cueMix() const { return cueMix_.load(); }
    bool quantize() const { return quantize_.load(); }
    Deck& deck(int index) { return decks_[index]; }
    const Deck& deck(int index) const { return decks_[index]; }
    int outputRate() const { return outputRate_.load(); }
    // Control thread, while no stream renders (before start / after close): reconfigures stretchers.
    void setOutputRate(int rate);
    uint64_t outputFrames() const { return outputFrames_.load(); }
    uint64_t accepted() const { return accepted_.load(); }
    uint64_t applied() const { return applied_.load(); }
    uint64_t starvedFrames() const { return starvedFrames_.load(); }
    float crossfade() const { return crossfade_.load(); }
    // Beat FX section as applied, and a bitmask of inserts (fx::Target) currently sounding.
    int fxEffect() const { return fxEffect_.load(); }
    int fxTarget() const { return fxTarget_.load(); }
    bool fxOn() const { return fxOn_.load(); }
    double fxDepth() const { return fxDepth_.load(); }
    double fxBeats() const { return fxBeats_.load(); }
    int fxHeld() const { return fxHeld_.load(); }
    int fxAudible() const { return fxAudible_.load(); }
    const fx::Insert& insert(int target) const { return *fx_[target]; }
    // Whether the in-memory track holds [seconds, seconds + spanFrames] (any thread).
    bool trackCovers(const Deck& d, double seconds, double spanFrames) const noexcept;

private:
    std::array<Deck, kDeckCount> decks_{};
    std::array<Command, kQueueSize> commands_{};
    std::atomic<uint64_t> lateOps_{0};
    std::array<Command, kScheduleSize> schedule_{}; // callback-private, sorted by `at` (stable)
    int scheduleHead_ = 0;
    std::atomic<int> scheduleCount_{0};
    void enqueueScheduled(const Command& c) noexcept;
    void cancelScheduledNow(const Command& c) noexcept;
    std::mutex submitMutex_;
    std::atomic<uint64_t> queueWrite_{0}, queueRead_{0};
    std::atomic<uint64_t> accepted_{0}, applied_{0}, outputFrames_{0}, starvedFrames_{0};
    std::atomic<int> outputRate_;
    std::atomic<float> crossfade_{0};
    std::atomic<float> cueMix_{0};  // Headphone blend: 0 = cue bus only, 1 = master only.
    std::atomic<int> routing_{0};
    std::atomic<bool> quantize_{false};
    std::array<std::unique_ptr<fx::Insert>, fx::kTargetCount> fx_;
    std::atomic<int> fxEffect_{fx::kEcho}, fxTarget_{fx::kTargetA}, fxHeld_{0}, fxAudible_{0};
    std::atomic<bool> fxOn_{false};
    std::atomic<double> fxDepth_{-1}, fxBeats_{fx::kBeatsDefault};
    int fxTempoDeck_ = 0; // MST follows the last deck target (desktop beatFxTempoChannel).
    void applyBeatFx(bool immediate) noexcept;
    void clockBeatFx(int64_t frame) noexcept;
    static constexpr int kFilterSlots = kQueueSize + kScheduleSize; // a scheduled Filter keeps its target until due
    std::mutex filterMutex_;                       // control side only
    dsp::FilterSettings filterSettings_;
    std::array<double, kDeckCount> filterPosition_{};
    uint64_t filterSlot_ = 0;
    std::array<dsp::FilterTarget, kFilterSlots> filterTargets_{}; // written before the Op that names the slot
    std::array<float, 16385> driveCurve_{};
    std::array<float, kBlockFrames * 2> master_{};
    std::array<float, kBlockFrames * 2> cue_{};
    void renderBuses(int frames, int64_t frame) noexcept;
    bool renderSource(Deck& d, float* strip, int frames) noexcept;
    bool renderTail(Deck& d, float* strip, int frames) noexcept;
    int renderSegment(Deck& d, float* strip, int frames, bool& active) noexcept;
    int renderTrack(Deck& d, float* strip, int frames, bool& active) noexcept;
    int renderStretch(Deck& d, float* strip, int frames, bool& active) noexcept;
    void renderScratch(Deck& d, float* strip, int frames, int64_t frame, bool& active) noexcept;
    double scratchPositionAt(const Deck& d, double frame) const noexcept;
    int64_t renderFrame_ = 0; // output frame of the block being rendered
    void stretchBlock(Deck& d, double frame, double rate, int frames, float* outL, float* outR) noexcept;
    void configureStretch(Deck& d, int rate);

    void designEq(Deck& d, double rate) noexcept;
    void resetStrip(Deck& d) noexcept;
    static constexpr int kSweepBlock = 32;
    std::array<float, kBlockFrames * 2> strip_{};
    double stripRate_ = 0;
    static float ceiling(float value) noexcept;
    void updateGain(int index) noexcept;
    void relocate(Deck& d, double seconds, int slot = -1, double overshootFrames = 0) noexcept;
    void applyLoopResize(Deck& d, double beats) noexcept;
    void stop(Deck& d) noexcept;
    int launchReference(int index) const noexcept;
    void launch(int index, double at, int slot) noexcept;
    int syncMembers_ = 0, syncSynced_ = 0; // callback-private (SetSyncMembers)
    void captureTail(Deck& d) noexcept;
    void releaseHead(Deck& d) noexcept;
    void apply(const Command& command) noexcept;
};
} // namespace manadj
