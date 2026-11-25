#ifndef MANADJ_C_ENGINE_H
#define MANADJ_C_ENGINE_H
#include <stdint.h>
#include <stdbool.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef void * MDJEngine;
typedef enum {
    MDJPlay, MDJPause, MDJCueDown, MDJCueUp, MDJHotCueDown, MDJHotCueUp,
    MDJHotCueSet, MDJHotCueClear, MDJSeek, MDJFader, MDJTrim, MDJCrossfade,
    MDJPitch, MDJBend, MDJPfl, MDJCueMix, MDJEq, MDJBeatJump, MDJLoopToggle,
    MDJLoopResize, MDJLoopPreset, MDJQuantize, MDJCueSetAt, MDJHotCueSetAt,
    MDJKeyLock, MDJHeardLatency
} MDJOp;
typedef struct {
    int previewSlot;
    uint64_t load, transport, status;
    double position, target, cue, bpm, anchor, loopStart, loopEnd, loopBeats, decodedSeconds;
    double hotCues[8];
    float fader, trim, pitch, bend, filter, eq[3];
    bool playing, preview, ready, fullyDecoded, keyLock, keyLockActive, pfl, loopActive;
} MDJDeck;
typedef struct {
    uint64_t load, transport, launchFrame;
    double position, startPosition, bpm, loopStart, loopEnd;
    float fader, trim, pitch, bend, filter, eq[3], stems[4];
    int previewSlot;
    bool playing, preview, scratching, loop, pfl, ready;
} MDJCaptureDeck;
typedef struct {
    uint64_t frame, segmentStart;
    int sampleRate;
    float crossfade;
    int fxEffect, fxTarget, fxHeld;
    bool fxOn;
    double fxDepth, fxBeats;
    MDJCaptureDeck decks[4];
} MDJCaptureSnapshot;
// Returns false before first render or during bounded publication contention.
// On false the caller keeps its old state and does not invent a new event.
// enable(false) is a nonblocking stop request, not a fence: use the token API below
// to know when the render thread has stopped publishing. enable(true) is ignored
// once a stop was requested; an epoch is never re-armed.
void mdj_capture_enable(MDJEngine engine, bool enabled);
typedef struct { uint64_t token, finalFrame, published, remaining; bool gap; } MDJCaptureStop;
// Nonzero monotonic token, or 0 if capture was never armed. Idempotent per epoch.
uint64_t mdj_capture_request_stop(MDJEngine engine);
// 1=acked (render committed its last publication; none follow), 0=pending, -1=bad token.
// After 1, pop until published snapshots are consumed (remaining reaches 0 and the
// last frame equals finalFrame); gap=true means evidence is incomplete.
int mdj_capture_stop_poll(MDJEngine engine, uint64_t token, MDJCaptureStop *result);
bool mdj_capture_snapshot(MDJEngine engine, MDJCaptureSnapshot *result);
// One consumer, 1=frame, 0=empty, -1=gap. Gap remains latched for this engine.
int mdj_capture_pop(MDJEngine engine, MDJCaptureSnapshot *result);
MDJEngine mdj_create(int rate);
void mdj_destroy(MDJEngine engine);
void mdj_set_rate(MDJEngine engine, int rate); // output stopped only
void mdj_render(MDJEngine engine, float *interleaved, int frames, int channels);
uint64_t mdj_frames(MDJEngine engine);
uint64_t mdj_starved_frames(MDJEngine engine);
uint64_t mdj_prepare(MDJEngine engine, int deck, uint64_t load);
uint64_t mdj_submit(MDJEngine engine, MDJOp op, int deck, double value, int slot);
uint64_t mdj_grid(MDJEngine engine, int deck, double bpm, double anchor);
uint64_t mdj_filter(MDJEngine engine, int deck, double position);
uint64_t mdj_fx(MDJEngine engine, int effect, int target, bool on, double depth, double beats);
void mdj_routing(MDJEngine engine, bool splitMono);
MDJDeck mdj_deck(MDJEngine engine, int deck);
bool mdj_stream_claim(MDJEngine engine, int deck, uint64_t load, uint64_t transport, int rate, double seconds);
int mdj_stream_write(MDJEngine engine, int deck, uint64_t transport, const float *stereo, int frames);
bool mdj_stream_publish(MDJEngine engine, int deck, uint64_t load, uint64_t transport, bool eof);
bool mdj_track_begin(MDJEngine engine, int deck, uint64_t load, uint64_t frames, int rate);
int mdj_track_write(MDJEngine engine, int deck, uint64_t load, const float *stereo, int frames);
bool mdj_track_finish(MDJEngine engine, int deck, uint64_t load);
void mdj_fail(MDJEngine engine, int deck, uint64_t load);
bool mdj_record_start(MDJEngine engine, const char *path);
void mdj_record_stop(MDJEngine engine, bool interrupted);
int mdj_record_state(MDJEngine engine);
int mdj_record_error(MDJEngine engine);
#ifdef __cplusplus
}
#endif
#endif
