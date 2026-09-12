# Performance sync

Issue: #19. Accepted August 24 grill, completed September 12, 2026.

## Behavior

- One Sync Group, one Group Tempo; no Tempo Master. Synced Decks may all remain engaged.
- First engagement captures the nearest playing Deck's effective BPM (half/double-aware, A-D tie-break); without a reference, captures its own. Later engagements join the existing Group Tempo.
- Unsynced Decks are not continuously followed.
- Pitch input on any member retargets the group. Nudge remains per-Deck; neither gesture disengages sync.
- Preserve each member's half/double relationship while riding tempo.
- Refuse engagement when no match fits the +/-8% range. During group rides, clamp members at +/-8%, show out-of-lock, and recover automatically when reachable.
- SYNC engagement and MATCH snap beat phase once when Quantize is on. No phase lock, bar alignment, or Beatgrid edits. Use a nearest-beat micro-seek on playing Decks; paused Decks retain their launch point and use quantized launch.
- Gridless or scratching Decks skip the phase snap. Preserve loop bounds, wrapping the corrected position inside the loop.
- MATCH remains one-shot; it does not change membership. On a synced Deck its pitch change retargets the group, then only the addressed Deck snaps.
- Disengagement leaves pitch unchanged. The last member leaving clears Group Tempo.
- Pause preserves membership. Load preserves membership, waits for valid BPM/readiness, selects the new Track's half/double relationship, and applies/clamps to Group Tempo without starting playback or snapping phase.
- BPM edits recalculate a member's relationship and pitch against unchanged Group Tempo. Missing BPM leaves it waiting.
- Membership is session-only. Editor/Conductor/replay ownership clears the group without changing pitch; sync controls do nothing while another surface owns playback.
- Key Lock remains independent.

## Controls

- On-screen: retain MATCH; add SYNC with engaged and out-of-lock/waiting states.
- BEAT SYNC: toggle membership. LED lit while engaged, including out-of-lock/waiting.
- Shift + BEAT SYNC: MATCH.
- GRV6: input notes 88/92, SYNC LED note 88 on deck channels 0-3 (official E1 MIDI list, D19).
- Inpulse: input note 5 on deck channels 1/2 and shifted channels 4/5; SYNC LED note 5 on channels 1/2 (existing Mixxx source; MK2 hardware verification pending).

## Verification

- Group capture/join/leave, all-four pitch propagation, octave folding and stable ratios.
- Join refusal, ride clamping and recovery, invalid BPM, load/pause lifecycle, machine ownership.
- Quantize on/off, one-shot phase correction, folded grids, active loops and scratch safety.
- MIDI down-edge toggles, shifted MATCH, pickup after group writes, exact LED bytes and all-off.
- Running lane walkthrough; physical controller and audio acceptance remain human checks.
