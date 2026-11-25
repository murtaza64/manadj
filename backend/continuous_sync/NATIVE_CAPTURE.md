# Native capture prerequisite, still not a session recorder

The new bridge has an opt-in applied-state snapshot and a separate single-consumer
bounded queue. It is disabled by default and no AppModel path enables it.

Callback publication is per rendered segment, including segments split by scheduled
commands. Each record carries segmentStart (when those applied controls took effect)
and frame (position sampling boundary). Four decks, actual crossfader and FX values
come from the callback, not UI command receipts. A reader must use segmentStart for
control changes and frame for sampled positions, not conflate the two timestamps.
Intermediate changes that never rendered any samples are not heard segments.

128 fixed records, producer never waits or overwrites an unread slot. An overflow
latches an error, returned by mdj_capture_pop as -1 for the engine lifetime. Future
recorder must end/report incomplete history, not skip the gap and claim continuity.
The current bridge has no recovery/reset API. Toggle-off/re-enable is not a new
recording epoch and must not be used to clear a gap. The journal/recorder must also
mark interruptions/discontinuities, enforce lifecycle and persist before publishing
successful capture. Those pieces are not implemented.

Latest snapshot reader uses atomic word publication so the C++ seqlock itself has
no non-atomic data race. The queue is one producer / one consumer; API consumers
must not mix multiple drainers. Snapshot accessor is not a queue consumer.

Host evidence: concurrent latest-reader test, ASan/UBSan queue overflow and scheduled
intra-callback segment tests, C bridge compile/link/execution. Existing optimized
engine regression suite passed before the queue addition; rerun it on this head.
Swift source and XCTest exist but Apple compilation has not run on this branch.
No physical callback budget or audio latency claim follows from Linux host timing.


A source-only first Swift mapper now consumes applied segments with explicit
startPosition (sampled after scheduled commands apply, before render) and end
position, avoiding backward-integration guesses for seek/play timestamps. It
emits capture grammar for load, plain play/pause/seek, pitch/bend, controls, loops
and one-Hz ticks, buffers silence until audible, and produces ordered journal
actions. Preview/scratch/active-FX are explicitly unsupported and fail closed;
full Android recorder parity is NOT delivered. AppModel does not enable/drain it.
Queue overflow must call incomplete close; persistence failure requires discarding
the advanced mapper and reconciling its journal. No claim of automatic recovery.

Latest Linux evidence: 104 Core tests and 9 Audio package tests pass. First mapper
has generated context/time/gap and mapper-to-journal restart tests, not full engine
replay equivalence. Callback cost, suspended-app behavior and iOS AVFoundation/app
compilation remain unqualified. This is no reason to enable collection silently.

## Review follow-up, still disabled

At e845de9d the Linux package suites pass Core107/Audio11. The full optimized
EngineTest.cpp suite was rerun on the final capture implementation and passed.
This does not include Apple-only code, a device callback budget or replay proof.
The CEngine-to-Core adapter rejects native FX/preview/scratch and requires an
exact deck/load identity binding. No app caller enables it.

Reopening the local journal now durably closes an active session as incomplete
at its last persisted event boundary, before returning a usable writer. It checks
recovered cross-chunk time ordering and nonempty context0 framing. It does NOT
claim full event grammar or that context0 is a complete deck state. A failed
recovery write prevents construction; old/ambiguous evidence is not deleted.

A generated budget test disqualifies the current whole-envelope persistence for
production: 600 four-deck one-Hz ticks wrote21,001,498 bytes in601 atomic writes
for70,003 final bytes. Linux host elapsed0.781s/max single write1.24ms is not an
Apple performance qualification. The8MiB bound is a fail-closed test ceiling,
not retention. No acknowledged data is deleted. Required replacement design:
immutable chunk files plus a small per-session committed-prefix manifest, with
chunk flush before manifest publication and orphan retention on ambiguous crash;
closed-session eviction only after exact chunk AND terminal-close durable remote
receipts. Existing chunk acknowledgements do not prove the close was committed.
A measured long-session/offline-capacity budget is still required before enabling.

Callback controls are applied command targets, including EQ/stem targets, rather
than every smoothed per-sample gain. End position/ready status do not prove a
segment was physically audible. The mapper's present audibility rule is only a
candidate gate and remains unqualified, especially under decoder starvation,
end-of-track and smoothing. Replay must apply the same control-time semantics;
substituting end-of-segment smoothed values would shift command timing. Physical
output and interruption/suspension gaps need their own explicit evidence.

First chunk-store replacement (still test-only) uses immutable event files and a
version2 compact committed-prefix manifest. No installed capture data exists, so
version1 envelopes are rejected and preserved rather than silently migrated.
600 generated ticks now write about159KB total instead of21MB;1202 atomic writes
are still two per append, so write-count/energy is NOT fixed. Reopen follows only
manifest references, closes the committed active prefix incomplete and retains
unreferenced chunks. An injected chunk-landed/manifest-failed test proves the
orphan is retained and the uncommitted suffix does not become valid history.
Core108 and Audio11 Linux tests pass. The manifest currently covers all sessions,
and in-memory aggregate sizing still scans retained chunks. Long-duration,
many-session CPU/energy, inode/file-count limits, bounded batching, ancestor
creation durability, retention/terminal receipts and Apple protection remain
unfinished before activation. The8MiB limit excludes orphan filesystem overhead
and is therefore not a complete disk budget.

Preview-slot review: Engine prepare/play/preview-release reset previewSlot to-1;
cue/hotcue preview sets it to the preview slot. The host adapter now also rejects
nonnegative previewSlot even when preview=false, failing closed for an inconsistent
publication rather than interpreting it as supported plain transport.

Damaged-session isolation follow-up: missing/corrupt referenced chunks isolate
only their session from all(); damagedSessionIDs identifies the withheld session.
The original manifest entry is preserved on future healthy writes, with all
recoverable files untouched. There is no silent truncation or deletion. A wholly
malformed manifest still fails closed because entry identities cannot be trusted.
Disk scan now counts unreferenced files, directories and allocated/logical bytes,
and saturates at64MiB/8192 entries. Saturation makes the store read-only while
healthy evidence remains accessible, not a request to discard data. A5MB orphan
is counted; a64MiB orphan blocks new writes without deletion. Reserve512KiB/four
entries before mutations. These are generated test safety ceilings, not approved
production retention or a promise the app can run indefinitely offline.

The per-mutation disk scan makes existing O(total retained) work worse: the same
600tick host test rose from0.85s to8.49s total. It remains unfit for activation.
A cached single-writer quota ledger plus bounded startup reconciliation and batch
transactions is needed, and must include crash temporaries/ancestor directories.
No Apple fsync/energy/physical performance claim is made.

Quota-ledger preparation: startup performs the bounded orphan/corruption scan;
mutations now stat only touched chunk/manifest/parent paths and update cached
physical bytes/entry counts. The same600tick test returns to about1.00s host time,
still1202writes. Historical event byte count is cached. This relies on the stated
single-actor exclusive-owner contract, not enforced multi-process locking; external
filesystem writes require reopen/reconciliation. Aggregate manifest creation and
session arrays still scale; no claim of complete O(1) append or mobile energy.
Stat failure after persistence freezes further writes, forcing reopen. Test checks
cached counts against fresh bounded startup scan. Apple/APFS allocation semantics,
ancestor/temp accounting, long sessions, batching and terminal receipts unchanged.

Generated narrow replay acceptance: the actual CEngine render/queue/conversion/
runtime/journal test now replays persisted plain play and fader event times into
a fresh engine with the same generated440Hz PCM. All192000 output samples match
within1e-6. This supports this one plain transport/mixer fixture, not seek/loop/
pitch/EQ/stem/FX/scratch replay, starvation, hardware output or Apple lifecycle.
Exact load registry retains512 per-deck tokens without eviction; two queued loads
drained after replacement map to original track42 and replacement99. It is not yet
connected to NativeAudio's prepare path. Capacity fails closed, no silent pruning.

A shared Swift queue-drain building block now consumes at most128 records per
call, resolves exact historical load IDs and returns ordered segments for the
serialized persistence runtime. Test proves disabled/empty behavior, replacement
ordering, permanent overflow failure and that toggling capture never clears gap.
No NativeAudio/AppModel caller starts capture or polling. Integrating requires a
single consumer task, applying batches sequentially, explicit interruption close
before graph stop/restart, and a new engine epoch after a latched gap. Do not infer
an authorized polling policy or a hardware-safe cadence from this helper.

Apple disabled host milestone (90505128): NativeAudio now owns optional load
registry/runtime and a serialized drain barrier. AppModel library loads pass exact
track IDs; Files import has none and rejects capture. Prepare keeps C publication
OFF; there is no public arming entry point or AppModel prepare caller. Interruption
stops publication, waits for prior drain, then closes incomplete before reuse.
Apple CI applies the exact source patch on current main. Both macOS packages,
actual unsigned iphoneos strict-concurrency build and disabled host simulator
lifecycle test passed run45677015027 at remote4fd7ed4. This is generated stopped
engine qualification, not active capture or physical output validation.

Native library edit candidate: actor-owned bounded durable intent journal for
first-slice title/main-cue, logical track UUIDs, original/new values, causal parent
IDs, stable retry UUID and sequence. LibraryRepository can explicitly prepare it
with trusted library identity/bindings and overlay cached snapshots without
changing base bytes. Reopen recovers overlays, divergent base values remain
visible as conflicts, no wall-clock winner or acknowledgement inferred from value
equality. Ambiguous write freezes until reopen; capacity/corrupt bytes retained.
119 Core Linux tests pass including actual repository replacement/reopen fixture.
No app caller, signed serialization, verified receipts/pruning, transport, native
OAuth library resource or trusted binding provisioning exists yet. Whole-envelope
rewrite at1024intents/1MiB is a generated safety ceiling, not energy/production
capacity evidence. Parent-directory/APFS durability and exclusive-owner limits
of SessionEventJournal.durableWrite also apply. No archive UI added: tombstone
semantics still belong to signed application adapter.

Independent7225fcd2 review revisions: intentsv2 now persist source revision
(snapshot audio_rev + file size/name, explicitly NOT a content hash). Missing
source evidence, absent/rebound logical IDs and changed revisions are unresolved
and surfaced; prepare rejects while retaining readable pendingEdits/unresolvedEdits.
Conflicting bases no longer get a silent overlay winner. Snapshot revision is a
legacy freshness guard, not signed content/owner authority; exact-byte binding
still required before transport activation. Repository serializes concurrent edits
through task chain without rejecting them merely because sync awaits network.
Non-destructive serialized reopen exists, including generated ambiguous-after-
rename recovery. Corrupt evidence remains failclosed with explicit error, no
fresh-empty fallback. Arbitrary nonempty causal parents rejected by repository
until verified signed heads exist. Lowlevel journal only structurally validates.

Native library auth candidate reuses hardened feedback flow but has a separate
fixed library resource, callback path, keychain namespace and generation. Build-
time enabledfalse blocks signIn/accessToken/signOut before network/keychain work;
no AppModel caller. Resource and issuer match existing desktop target; no live
native registration/login/refresh has run.7new package auth boundary tests pass,
fullCore129 after review fixes. New auth file is in generated Xcode project, team
setting preserved. Apple qualification must be extended to this revised source.

Second review isolation: changed/missing bindings no longer disable all edits.
Only affected pending tracks are withheld; unresolvedEdits and recoveryWarning
retain visibility while healthy tracks continue. Explicit setAsideEdits preserves
all evidence and sequence IDs, durably records disposition, allows fresh local
intent on reviewed new source. No pruning or serverack. Snapshot installation
uses the edit task lane, preventing revision replacement halfway through append.
Generated regression proves one changed source, healthy edit, explicit setaside,
new-source edit and reopen with three retained evidence entries/two pending.

Apple-only native metadata codec candidate uses CryptoKitEd25519 and fixedgrammar
JavaScriptCore JSON.stringify for ECMAScript numbers, not Swift Double text.
Eight generated PythonRFC8785 signed vectors cover Unicode/escaping/null/zero/
small exponent/decimal/large exponent/rounding; Apple tests verify pinned publickey
and canonical bytes, deny tampering/wronggroup/key. No generic incoming session
codec, durable signedoutbox/cursor, trusted heads or transport yet. This codec is
not Linuxqualified because Apple modules unavailable, awaiting exact Apple CI.

Journal compatibility follow-up: disposition envelope now writes version3 and
explicitly reads prior version2 without setAside as an empty disposition list.
Opening never rewrites prior bytes; next successful append preserves old intents
and writesv3. Unknown/malformed versions failclosed. Generated migration fixture
checks originalbytes/id/sequence preservation. Version1 without sourceRevision
remains explicitly unsupported, not silently converted into invented identity.
