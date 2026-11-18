# Silence loop at track end: behavior design (#424)

Design quest for #424 ("playback: silence loop after track end, sized to the active beat-jump length"). Selected from the backlog game 2026-11-18. The ticket asks for design only; no implementation requested, nothing built. Each open question from the ticket gets a recommendation plus the alternative, so decisions are one-word answers. Grounded in the ticket itself and adjacent Session/looping semantics (#475/#476 phrase cues on the deck's own Metric/Reset structure, #437 Session trace rendering, #473/#446 replay fidelity, #472 offline export).

## The model in one paragraph

When a playing, phrase-aligned deck reaches the end of audible material, the transport keeps running on the deck's own beat grid and the engine renders silence instead of stopping. The silent region behaves as a loop whose length equals the deck's beat-jump size at the moment of entry. The DJ beat-jumps back into audible material whenever they want, landing on-grid with phase intact. Gridless tracks keep today's stop-at-end behavior.

## Decisions

### D1. Activation policy
**Recommend: on by default for gridded tracks, off for gridless; one per-deck Settings toggle.** Surprises at track end cost more in a mix than silent continuation does, and the escape is one familiar gesture (jump/cue/seek). Gridless tracks have no phase to preserve, so the feature buys nothing there. Alternative: opt-in default-off; safer for first release, but the DJs who need it mid-double-drop are the ones who forgot to turn it on.

### D2. What counts as silence
**Recommend: analysis-time detection, stored as track metadata (`lastAudibleSample`), never runtime re-detection.** Threshold relative to the track's own loudness (e.g. band energy under roughly -60 dBFS sustained ~100 ms), reusing the existing analysis pipeline. An audible tail (fade, reverb) is above the floor and is never looped or replayed; the loop starts after it. Alternative: runtime RMS detection; simpler to bolt on, but non-deterministic and untestable against fixtures.

### D3. Entry boundary (the ticket's open "still to validate" item)
**Recommend: enter at the first beat tick at or after `lastAudibleSample`. Do NOT adopt the tentative first-64-beat-hypermeter-tick rule.** Reasoning: beat-jumps are already grid-quantized, and the loop length is the jump-size snapshot, so landing points stay exactly as on-grid as they are during normal playback. Waiting for a 64-tick adds up to 63 beats of dead transport where the DJ sees a finished track but gets no clean affordance, and it only improves alignment for 64-sized jumps. The snapshot rule (D5) preserves phrase structure for the size the DJ is actually using. Alternative: keep the 64-tick entry; simpler mental model ("loops always start on the phrase"), at the cost of dead time and no benefit for non-64 jump sizes.

### D4. Gridless and beat-only tracks
**Recommend: no Metric, no silence loop (keep current behavior); beat-grid-but-no-hypermeter works, preserving beat phase only.** Dropping hypermeter silently is already ruled a bug elsewhere in the system; the same honesty applies here: the loop keeps exactly the grid structure the track actually has.

### D5. Loop length snapshot
**Recommend: snapshot the deck's current beat-jump size at entry; changing jump size mid-loop does not resize the active loop; next entry re-snapshots.** This is the ticket's explicit correction (no hard-coded 64). Alternative: live-resize on jump-size change; feels clever, wraps become phase-inconsistent mid-loop.

### D6. Grid extrapolation past EOF
**Recommend: extend the deck's Metric past decoded audio at the final tempo segment, beat-domain only (the loop length is in beats, so tempo/pitch changes during the loop stretch or compress wall-clock duration and stay on grid, matching how beat-jumps already behave under pitch).** Mark the extrapolated region in metadata so UI and Session rendering can show it as extrapolated, not as audio.

### D7. Escape and interaction semantics
**Recommend: any intentional transport action exits instantly.** Precise arithmetic: with entry beat E (first beat at/after the last audible sample) and loop length J, any position p inside the phantom region [E, E+J) minus J lands in [E-J, E), i.e. at or before the entry beat. That zone is audible material except for the sub-beat sliver between the last audible sample and E (under one beat, by construction), and it clamps to track start when the audible material is shorter than J. So: one backward jump of the snapshot size always exits the loop and lands within one beat of audible content, but "always lands on audio" is not literally guaranteed — say "lands at or before the entry beat." Hot cue, seek, CUE, pause, or engaging a real loop all replace the phantom region immediately. Forward jumps wrap inside the loop (that is what a loop is). Ordinary loops and hot cues keep their current meanings everywhere before the end of audio.

### D8. Session recording and replay
**Recommend: record silence-loop entry and exit as explicit Session events (slot, boundary, snapshot size), not as generic seeks.** The #478 lesson applies: unnamed events get mislabeled later. Replay renders silence from the events, the Session timeline shows the region as hatched/extrapolated rather than fabricating waveform (#437's no-fabricated-events rule), and offline export (#472) renders the same events so an exported MP3 contains the performed silence exactly. This also keeps #473/#446 replay-fidelity work honest: silence regions are deterministic and must not become another desync source.

### D9. Test posture (for the eventual build, both engines)
Deterministic engine-clock fixtures: phase-exact wrap positions at wrap counts 1..100; entry under pitch ramps; variable-beatgrid tracks; gridless no-op; jump-size snapshot vs mid-loop change; escape from each gesture; Session event round-trip and export equivalence. Port boundary per the ticket: behavior design is shared; any implementation splits desktop and Android per lane, with shared behavioral fixtures where the engines allow.

## Decision summary

| # | Question | Recommendation | Main alternative |
|---|---|---|---|
| D1 | Activation | On for gridded, off for gridless, per-deck toggle | Opt-in |
| D2 | Silence detection | Analysis-time, stored metadata | Runtime RMS |
| D3 | Entry boundary | First beat after last audible sample | First 64-tick in silence |
| D4 | Gridless | Disabled (no phase to keep) | Seconds-based fallback loop |
| D5 | Loop length | Jump-size snapshot at entry | Live resize |
| D6 | Past-EOF grid | Extend final tempo segment, beat-domain | Freeze at entry tempo |
| D7 | Escape | Any intentional action exits; backward jump lands at/before entry beat | Dedicated exit gesture |
| D8 | Session | Explicit entry/exit events | Log as seeks |
| D9 | Tests | Deterministic engine-clock fixtures | UI-level tests |

## Sources

- #424 (the ticket; all open questions enumerated there), #475/#476 (phrase-cue Metric/Reset semantics), #437 (Session trace rendering, no fabricated events), #473/#446 (replay fidelity failures the design must not extend), #472 (offline export consumer), #478 (event-naming lesson).
- Issue-body attributions of user decisions are treated as context only; this design is grounded in the ticket text and repo semantics, and the only authorization behind this document is the user's room-3 pick in the game.
- No code changed, no engine touched, no real audio used.
