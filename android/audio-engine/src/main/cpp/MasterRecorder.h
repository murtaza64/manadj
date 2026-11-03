#pragma once

#include <array>
#include <atomic>
#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <mutex>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

namespace manadj {

// One callback producer, one disk worker. Lifetime = engine lifetime; never
// publish/free a recorder pointer while the callback may use it.
class MasterRecorder {
public:
    enum State { Idle, Recording, Finalizing, Complete, Failed };
    enum Error { None, Open, Overflow, RateChanged, Storage, RiffLimit, Interrupted, Cancelled };
    using Write = ssize_t (*)(int, const void*, size_t);
    explicit MasterRecorder(uint32_t capacity = 262144, Write write = ::write)
        : capacity_(capacity), ring_(static_cast<size_t>(capacity) * 2), write_(write) {}
    ~MasterRecorder() { stop(Interrupted); }

    // Non-realtime control only. A completed recording is never overwritten.
    bool start(const std::string& path, int rate, uint64_t limit = (UINT32_MAX - 36ull) / 4) {
        std::lock_guard<std::mutex> lock(control_);
        if (state() == Recording || state() == Finalizing) return false;
        if (worker_.joinable()) worker_.join();
        if (rate < 8000 || rate > 384000 || capacity_ == 0 || ::access(path.c_str(), F_OK) == 0) return false;
        const std::string partial = path + ".partial";
        const int fd = ::open(partial.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0600);
        error_.store(None);
        frames_.store(0);
        if (fd < 0) { error_.store(Open); state_.store(Failed); return false; }
        read_.store(0); written_.store(0);
        rate_ = rate;
        limit_ = std::min<uint64_t>(limit, (UINT32_MAX - 36ull) / 4);
        accepting_.store(true);
        epoch_.store(++sequence_);
        state_.store(Recording);
        try { worker_ = std::thread([this, fd, path, partial] { drain(fd, path, partial); }); }
        catch (...) {
            epoch_.store(0); accepting_.store(false); error_.store(Storage); state_.store(Failed); ::close(fd);
            return false;
        }
        return true;
    }

    // Callback: bounded copies and lock-free atomics only. No allocation,
    // locks, condition-variable notification, disk IO or finalization.
    void push(const float* stereo, uint32_t frames, int rate, uint64_t epoch = UINT64_MAX) noexcept {
        if (epoch == UINT64_MAX) epoch = epoch_.load();
        inFlight_.fetch_add(1);
        if (epoch != 0 && epoch_.load() == epoch && accepting_.load()) {
            if (rate != rate_) fail(RateChanged);
            else {
                const auto w = written_.load(std::memory_order_relaxed);
                const auto r = read_.load(std::memory_order_acquire);
                if (frames > capacity_ - (w - r)) fail(Overflow);
                else {
                    const auto offset = static_cast<uint32_t>(w % capacity_);
                    const auto first = std::min(frames, capacity_ - offset);
                    std::memcpy(ring_.data() + offset * 2, stereo, first * 2 * sizeof(float));
                    std::memcpy(ring_.data(), stereo + first * 2, (frames - first) * 2 * sizeof(float));
                    written_.store(w + frames, std::memory_order_release);
                }
            }
        }
        inFlight_.fetch_sub(1);
    }

    // Off callback, serialized with start. Normal stop drains final partial
    // block; interruption/cancel leaves .partial, never a shareable success.
    void stop(Error reason = None) {
        std::lock_guard<std::mutex> lock(control_);
        if (state() == Recording || state() == Finalizing) {
            if (reason != None) fail(reason);
            epoch_.store(0);
            accepting_.store(false);
        }
        if (worker_.joinable()) worker_.join();
    }
    State state() const { return static_cast<State>(state_.load()); }
    uint64_t epoch() const noexcept { return epoch_.load(); }
    Error error() const { return static_cast<Error>(error_.load()); }
    uint64_t frames() const { return frames_.load(); }
    int sampleRate() const { return rate_; } // Control thread reads after start.

private:
    const uint32_t capacity_;
    std::vector<float> ring_;
    Write write_;
    std::mutex control_;
    std::thread worker_;
    std::atomic<uint64_t> read_{0}, written_{0}, frames_{0};
    std::atomic<uint64_t> epoch_{0};
    uint64_t sequence_ = 0; // Serialized control calls only.
    std::atomic<int> state_{Idle}, error_{None}, inFlight_{0};
    std::atomic<bool> accepting_{false};
    std::atomic<int> rate_{0};
    uint64_t limit_ = 0;

    void fail(Error error) noexcept {
        int none = None;
        error_.compare_exchange_strong(none, error);
        epoch_.store(0);
        accepting_.store(false);
    }
    bool writeAll(int fd, const void* bytes, size_t size) {
        auto* data = static_cast<const uint8_t*>(bytes);
        while (size) {
            const auto n = write_(fd, data, size);
            if (n < 0 && errno == EINTR) continue;
            if (n <= 0) { fail(Storage); return false; }
            data += n; size -= static_cast<size_t>(n);
        }
        return true;
    }
    bool syncDirectory(const std::string& path) {
        // Worker only. Propagate errors from supported Android/POSIX
        // operations rather than reporting Complete without the barrier.
        const int fd = ::open(path.c_str(), O_RDONLY | O_DIRECTORY);
        if (fd < 0) { fail(Storage); return false; }
        bool ok = ::fsync(fd) == 0;
        if (::close(fd) != 0) ok = false;
        if (!ok) fail(Storage);
        return ok;
    }
    std::array<uint8_t, 44> header(uint32_t frames) const {
        std::array<uint8_t, 44> h{};
        auto put = [&](int at, uint32_t n, int count) { for (int i = 0; i < count; ++i) h[at + i] = static_cast<uint8_t>(n >> (i * 8)); };
        std::memcpy(h.data(), "RIFF", 4); put(4, 36 + frames * 4, 4);
        std::memcpy(h.data() + 8, "WAVEfmt ", 8); put(16, 16, 4);
        put(20, 1, 2); put(22, 2, 2); put(24, rate_, 4); put(28, rate_ * 4, 4);
        put(32, 4, 2); put(34, 16, 2); std::memcpy(h.data() + 36, "data", 4); put(40, frames * 4, 4);
        return h;
    }
    void drain(int fd, const std::string& path, const std::string& partial) {
        auto h = header(0);
        writeAll(fd, h.data(), h.size());
        std::array<uint8_t, 4096 * 4> pcm{};
        while (error() == None) {
            const auto r = read_.load(std::memory_order_relaxed);
            const auto w = written_.load(std::memory_order_acquire);
            const auto n = static_cast<uint32_t>(std::min<uint64_t>(4096, w - r));
            if (!n) {
                if (!accepting_.load() && inFlight_.load() == 0 && written_.load(std::memory_order_acquire) == r) break;
                std::this_thread::sleep_for(std::chrono::milliseconds(2));
                continue;
            }
            if (frames_.load() + n > limit_) { fail(RiffLimit); break; }
            for (uint32_t i = 0; i < n * 2; ++i) {
                const float x = ring_[((r * 2) + i) % (static_cast<uint64_t>(capacity_) * 2)];
                const int value = std::isfinite(x) ? static_cast<int>(std::lrint(std::clamp(x, -1.f, 1.f) * 32767.f)) : 0;
                pcm[i * 2] = static_cast<uint8_t>(value);
                pcm[i * 2 + 1] = static_cast<uint8_t>(value >> 8);
            }
            if (!writeAll(fd, pcm.data(), n * 4)) break;
            frames_.fetch_add(n);
            read_.store(r + n, std::memory_order_release);
        }
        accepting_.store(false);
        epoch_.store(0);
        // Wait off-callback before reusing storage in the next start.
        while (inFlight_.load() != 0) std::this_thread::yield();
        state_.store(Finalizing);
        if (error() == None && frames() == 0) fail(Cancelled);
        if (error() == None) {
            h = header(static_cast<uint32_t>(frames()));
            if (::lseek(fd, 0, SEEK_SET) < 0 || !writeAll(fd, h.data(), h.size()) || ::fsync(fd) != 0) fail(Storage);
        }
        if (::close(fd) != 0) fail(Storage);
        if (error() == None) {
            const auto slash = path.find_last_of('/');
            const std::string parent = slash == std::string::npos ? "." : (slash == 0 ? "/" : path.substr(0, slash));
            // PlaybackService may just have mkdir'd master-recordings.
            // Sync filesDir's entry for it BEFORE publishing the final WAV;
            // syncing the leaf alone cannot persist that creation edge.
            if (syncDirectory(parent + "/..")) {
                if (::rename(partial.c_str(), path.c_str()) != 0) fail(Storage);
                else syncDirectory(parent);
            }
        }
        // A failed post-rename directory sync is not shareable success.
        if (error() != None && ::access(path.c_str(), F_OK) == 0) ::rename(path.c_str(), partial.c_str());
        state_.store(error() == None ? Complete : Failed);
    }
};
static_assert(std::atomic<int>::is_always_lock_free && std::atomic<uint64_t>::is_always_lock_free && std::atomic<bool>::is_always_lock_free,
              "Master recorder callback requires lock-free atomics");
} // namespace manadj
