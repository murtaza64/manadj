HUMAN — DEFINITIVE Heard semantics (supersedes the derivations in #56/#59 where they differ). In the human's words: "if I stab cue point X at time t, I am hearing what manadj rendered t-lag ago, so the system should pretend I pressed X at time t-lag, therefore actually cueing the track from X+lag, so that the cue point I'm holding lines up with what I'm hearing in the speakers when I press it."

Implement exactly (L = route latency in s, r = the cued deck's playback rate, all in the audio callback at the press frame):
1. Virtual press time t_v = t - L.
2. Quantize off: start the cued deck NOW at position X + L·r.
3. Quantize on: run the desktop launch decision (launchStart/crossDeckLaunchTarget) AS IF at t_v, i.e. against the playing deck's position at t_v (= engine position now - L·r_play). It returns a start delay d ≥ 0 and/or an entry position e (default X). Translate to now: if d ≥ L, schedule the start at X (or e) after (d - L); else start immediately at e + (L - d)·r.
4. The same rule for CUE-hold preview, hot cue hold, PLAY and slide-to-lock latch, through ONE code path. Release/stop acts immediately (no virtual time).
5. Display: playheads and waveforms show heard time (engine - L) continuously, so on a stab the waveform shows X at the press moment and moves once.
6. Grid mode = the same code with L = 0.
Tests: L ∈ {0, 120, 350, 700} ms, rates 0.92/1.0/1.08, presses at 50 random phases; assert the cued deck's speaker-time position at t equals X (unquantized) or the quantized target (quantized) within 1 ms, and that the display shows exactly one discontinuity per stab. Delete any older Heard path that disagrees.

7. Amendment: compensation only when another deck is audibly playing (desktop launchReference condition). Otherwise plain launch at X, no lag shift.

## Engine implementation (engine lane, android-engine)

- One path: `Engine::launch` on the audio callback at the press frame, for PLAY, CUE-hold, hot-cue-hold (and any UI latch that sends those ops). Release/stop are immediate.
- Reference = desktop `launchReference` (another deck ready, playing, not scratching, with a grid; nearest effective tempo; Sync members only in-lock members). No reference → plain launch at X (rule 7).
- Modes: `QuantizeMode.GRID` (L = 0), `HEARD` (quantized, rule 3), `HEARD_UNQUANTIZED` (rule 2: X + L·r now).
- Rule 3 equivalence: target = reference beat nearest its position at t_v; delay vs now = d − L → wait (d − L) at X when d ≥ L, else immediate at e + (L − d)·r.
- Tests (native EngineTest "Heard semantics"): L ∈ {0, 120, 350, 700} ms × pitch {−8, 0, +8} × 50 random phases × quantized/unquantized/single-deck × PLAY/CUE/hot-cue = 600 launches; speaker-time error < 1 ms, one relocation per stab. Sign-flip guard: the 350 ms Heard test fails if the sign is flipped.
- Phone diagnostics: `adb logcat -s manadj-launch`.
