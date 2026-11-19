# manaDJ toys — hand #2

Three small, self-contained browser toys, first played as a hosted page.
Phone-first, dark manaDJ token palette (void `#0b0b0f`, deck A `#00e5ff`,
deck B `#ff2d95`, mono type).

- **Pocket 8** — an 8-step, 3-lane drum machine (kick / snare / hat) at
  128 BPM. Tap cells to toggle steps, PLAY runs the loop with a moving
  step highlight. All sounds are synthesized with WebAudio (oscillator
  pitch-drop kick, filtered-noise hat and snare). No samples.
- **Drop needle** — a reaction game. A playhead sweeps one 64-beat
  phrase; stop it on the diamond. Scores in beats early/late.
- **Tempo oracle** — tap the pad and it reads your internal BPM and
  names the nearest tempo shelf (74 lofi, 124 house, 128, 140, 174 dnb).

## Run

```
npm install
npm run dev      # local play
npm run build    # static bundle in dist/
```

No backend. No network calls. State is in-memory only.

## Possible manaDJ integration (backlog idea, not a plan)

These were made as waiting-room toys. If any of them earn a place in
manaDJ later, the reusable parts are the synth kit (`useAudio`), the
step-grid interaction from Pocket 8, and the beat-error scoring from
Drop needle. They are deliberately engine-free: nothing here models the
real metric ladder, grid origin, or phrase alignment, and the UI copy
says so. Any integration would wire interactions to the real engine
rather than claim parity.
