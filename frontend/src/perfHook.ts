type PerfCounters = {
  scenario: string | null;
  sinceMs: number;
  rafRequested: number;
  rafFired: number;
  rafCallbackMs: number;
  rafSlowCallbacks: number;
  rafSlowestCallbackMs: number;
};

declare global {
  interface Window {
    __MANADJ_PERF__?: {
      markIdleScenario(name: string): void;
      getFrameCounters(): PerfCounters;
      resetFrameCounters(): void;
    };
  }
}

export function installPerfHook(): void {
  if (window.__MANADJ_PERF__) return;

  const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const originalCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  let startedAt = performance.now();
  let scenario: string | null = null;
  let rafRequested = 0;
  let rafFired = 0;
  let rafCallbackMs = 0;
  let rafSlowCallbacks = 0;
  let rafSlowestCallbackMs = 0;

  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    rafRequested++;
    return originalRequestAnimationFrame((time) => {
      rafFired++;
      const before = performance.now();
      callback(time);
      const elapsed = performance.now() - before;
      rafCallbackMs += elapsed;
      rafSlowestCallbackMs = Math.max(rafSlowestCallbackMs, elapsed);
      if (elapsed >= 8) rafSlowCallbacks++;
    });
  };
  window.cancelAnimationFrame = (handle: number): void => originalCancelAnimationFrame(handle);

  window.__MANADJ_PERF__ = {
    markIdleScenario(name: string) {
      scenario = name;
      this.resetFrameCounters();
    },
    getFrameCounters() {
      return {
        scenario,
        sinceMs: performance.now() - startedAt,
        rafRequested,
        rafFired,
        rafCallbackMs,
        rafSlowCallbacks,
        rafSlowestCallbackMs,
      };
    },
    resetFrameCounters() {
      startedAt = performance.now();
      rafRequested = 0;
      rafFired = 0;
      rafCallbackMs = 0;
      rafSlowCallbacks = 0;
      rafSlowestCallbackMs = 0;
    },
  };
}
