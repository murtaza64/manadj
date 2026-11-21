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
