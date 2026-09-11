# Set UI Performance

2026-09-09, [#233](https://github.com/murtaza64/manadj/issues/233).

## Measurements

Chromium headless, Vite development build, 1600x1000 viewport, sandbox copy of
the 93-track Set. Warm queries; 34 successive row targets. Each drag step
includes a deliberate 25 ms timer, so these are responsiveness measurements,
not frame rates or isolated function durations.

| Scenario | Before | After |
|---|---:|---:|
| Original drag harness, mean step | 378 ms | 29-31 ms |
| Original drag harness, worst step | 997 ms | 101-124 ms |
| 4,000 playback-state samples, synthetic 93-track plan | 29.61 ms | 7.35 ms |

The retained browser harness separates drag activation from dragover, matching
native event ordering, and waits for the settled preview before cancelling.
Final run: activation 45 ms; drag mean 29 ms, worst 93 ms. Native drag/drop
produced one intercepted save; cancelled previews produced none. Reordering
made no track-metadata requests. These are local development-build results,
not production/Electron frame-time guarantees.

## Confirmed Costs

- `SetDetailPane`: every changed hover order immediately invoked full preview
  planning, including Take vectorization and Routine replay construction.
- `OverviewLadder.sampleFaderLevels`: approximately 4,000 full `planStateAt`
  evaluations per plan identity, synchronously during render. The initial
  drag profile attributed 2.75 seconds of self time to `planStateAt`.
- `planStateAt`: reconstructed, deduplicated and sorted all authority
  boundaries for every sample. Raw occupancy scanned entries five times.
- Row evidence and BPM references were recreated across the whole list on
  every preview order, defeating row memoization. Evidence lookup also
  repeatedly filtered the full Take history.
- Track metadata was keyed by order, not membership. Reordering invalidated
  the pane, spacebar transport and Conductor feed's metadata query.

## Changes

- Row order and adjacency futures update immediately. Preview planning waits
  for 180 ms of stable target order; repeated events at the same target do
  not postpone it. Drop commits the latest row order, not the settled plan.
- Timing cells remain blank until their order's plan is ready. The ladder
  retains its last completed preview and matching markers while evidence loads.
- Cancel/unmount cancels pending preview work. The pane remounts per Set,
  matching its existing state-isolation assumption.
- Boundary selection uses a direct maximum scan. Occupancy/highlight share
  one entry pass. Authority smoothing, recursive close-boundary handoffs,
  hard cuts and array-precedence rules are unchanged; no mutable-plan cache.
- Pair evidence and BPM references survive order changes. Fader SVGs and
  adjacency bands skip unchanged zoom renders.
- All three metadata consumers use membership-sorted query keys.

## Remaining Costs

- Settled previews still construct a complete plan and sample the whole Set.
  Debouncing reduces frequency, not the indivisible cost of a settled update.
- The ladder mounts and rasterizes offscreen clips. Settled zoom redraws
  whole clip widths; the 6 ms draw-queue budget cannot interrupt one long
  clip job. Viewport-aware, pixel-aligned drawing is the next larger change.
- First-open metadata still uses one GET per track. A batch endpoint or
  shared per-track cache would address cold-open latency separately.
- React development JSX/debug-property bookkeeping remains visible in the
  profile. The track list is not virtualized.

## Verification

```sh
uv run scripts/debug/set_ui_perf.py --url http://localhost:<port> --set-id <id>
# From frontend/:
npx vitest bench --run src/sets/planner.bench.ts
npx vitest run src/sets src/selection src/components/dragScroll.test.ts
npm run build
```

- Browser harness requires a Set with at least five tracks; intercepts its
  native-drop save instead of changing the database.
- 555 targeted tests pass. Coverage includes rapid drag, pending-drop,
  cancellation, cache reuse with spacebar transport mounted, loading-preview
  retention, marker updates and evaluator edge cases.
- Build and Ruff pass; Alembic has one head. UI ESLint findings were compared
  against the parent revision: existing ref/memoization/refresh diagnostics,
  no added rule violations.
