# Practice-view playback is a buffer-based Web Audio engine, parallel to the library player

Status: accepted (spike passed 2026-07-03 — instant transport and EQ quality confirmed by ear; Web Audio remains the platform. Next: the buffer-based engine replaces the library player's `<audio>` implementation)

The Practice view's Deck is a new, framework-free TypeScript playback engine built on Web Audio: the whole track is fetched and `decodeAudioData`-ed into an `AudioBuffer`, played via `AudioBufferSourceNode` through an isolator-style EQ/filter graph, with the engine keeping its own playhead clock. It is a parallel stack — the library player keeps its `<audio>`-element implementation untouched.

## Considered options

- **`MediaElementSourceNode` wrapping the existing `<audio>` element** — rejected: it inherits the element's seek/buffering latency, which is the very problem the spike exists to test (instant cue stabs, beatjumps, hot cue work).
- **Native app** — deferred, not rejected: if the spike fails its latency/glitch criteria after honest optimization, a native app gets scoped before any two-deck work.

## Consequences

- ~130MB RAM per decoded track (desktop-only concern; two decks ≈ 260MB — acceptable).
- Visible fetch+decode wait on track load (target < ~5s).
- `AudioBufferSourceNode`s are one-shot: every seek/pause recreates the node, and the engine owns playhead bookkeeping against `AudioContext.currentTime` (no free `currentTime`). This clock is also the foundation for future deck sync and waveform rendering.
- Keylock/time-stretch (AudioWorklet + stretch engine) is explicitly untested by the spike and remains the largest open platform risk.
