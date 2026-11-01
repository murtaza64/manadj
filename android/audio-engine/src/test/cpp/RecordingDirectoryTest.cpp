// Link with -Wl,--wrap=fsync: observe real descriptor identities/barriers of
// the actual recorder, without destructive crash/power-loss experiments.
#include "../../main/cpp/MasterRecorder.h"
#include <sys/stat.h>
#include <cstdio>
#include <cstdlib>

using manadj::MasterRecorder;
#define CHECK(x) do { if (!(x)) { std::fprintf(stderr, "%d: %s\n", __LINE__, #x); std::exit(1); } } while (0)

static struct stat parentIdentity{}, leafIdentity{};
static std::thread::id callbackThread;
static std::vector<std::string> barriers;
static std::string failAt;
static std::string finalPath;

extern "C" int __real_fsync(int fd);
extern "C" int __wrap_fsync(int fd) {
    CHECK(std::this_thread::get_id() != callbackThread);
    struct stat identity{};
    CHECK(::fstat(fd, &identity) == 0);
    std::string kind = "wav";
    if (S_ISDIR(identity.st_mode)) {
        if (identity.st_dev == parentIdentity.st_dev && identity.st_ino == parentIdentity.st_ino) kind = "parent";
        else if (identity.st_dev == leafIdentity.st_dev && identity.st_ino == leafIdentity.st_ino) kind = "leaf";
        else CHECK(false);
    }
    barriers.push_back(kind);
    if (kind == "parent") CHECK(::access(finalPath.c_str(), F_OK) != 0); // creation edge precedes publication
    if (kind == failAt) { errno = EIO; return -1; }
    return __real_fsync(fd);
}

void firstSave(const std::string& failure) {
    // Like PlaybackService: filesDir exists; mkdir creates master-recordings
    // without a parent barrier. Only the recorder may establish durability.
    char scratch[] = "/tmp/manadj-425-directory-decoy-XXXXXX";
    CHECK(::mkdtemp(scratch));
    const std::string leaf = std::string(scratch) + "/master-recordings";
    CHECK(::mkdir(leaf.c_str(), 0700) == 0);
    CHECK(::stat(scratch, &parentIdentity) == 0 && ::stat(leaf.c_str(), &leafIdentity) == 0);
    finalPath = leaf + "/first.wav";
    failAt = failure;
    barriers.clear();
    MasterRecorder recorder;
    const float stereo[] = {.25f, -.5f, .125f, -.25f};
    CHECK(recorder.start(finalPath, 48000));
    recorder.push(stereo, 2, 48000);
    recorder.stop();
    if (failure.empty()) {
        CHECK(recorder.state() == MasterRecorder::Complete && recorder.frames() == 2);
        CHECK((barriers == std::vector<std::string>{"wav", "parent", "leaf"}));
        CHECK(::access(finalPath.c_str(), F_OK) == 0);
        // Existing directory on subsequent save must still establish both
        // barriers, not assume a previous attempt/creation was durable.
        finalPath = leaf + "/second.wav";
        barriers.clear();
        CHECK(recorder.start(finalPath, 48000));
        recorder.push(stereo, 2, 48000); recorder.stop();
        CHECK(recorder.state() == MasterRecorder::Complete);
        CHECK((barriers == std::vector<std::string>{"wav", "parent", "leaf"}));
    } else {
        CHECK(recorder.state() == MasterRecorder::Failed && recorder.error() == MasterRecorder::Storage);
        CHECK(::access(finalPath.c_str(), F_OK) != 0);
        CHECK(::access((finalPath + ".partial").c_str(), F_OK) == 0);
        CHECK((barriers == (failure == "parent" ? std::vector<std::string>{"wav", "parent"} : std::vector<std::string>{"wav", "parent", "leaf"})));
        CHECK(!recorder.start(finalPath, 48000)); // retained incomplete file is not overwritten
    }
}

int main() {
    callbackThread = std::this_thread::get_id();
    firstSave("");
    firstSave("parent");
    firstSave("leaf");
    std::puts("PASS recording directory: first/subsequent save barriers, parent/leaf failure never Complete/SAVED");
}
