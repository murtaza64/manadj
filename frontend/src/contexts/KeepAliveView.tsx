/**
 * Keep-alive mode view (perf-layout 09): App used to render mode views
 * conditionally — every mode switch unmounted the whole bottom section and
 * lost every component's local state (timeline zoom, list scrolls, panel
 * state). This mounts a view on FIRST activation, keeps it mounted
 * afterwards, and hides inactive ones — state survives for every
 * component at once.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ViewActiveContext } from './viewActive';

export function KeepAliveView({ active, children }: { active: boolean; children: ReactNode }) {
  // Once-activated latch (derived-state-during-render idiom): never
  // activated -> nothing mounts, so first paint stays as cheap as the old
  // conditional render.
  const [everActive, setEverActive] = useState(active);
  if (active && !everActive) setEverActive(true);
  if (!everActive && !active) return null;
  return (
    <ViewActiveContext.Provider value={active}>
      {/* `contents` when visible keeps the child a direct flex item of
          app-main — layout identical to the pre-keep-alive tree. */}
      <div style={{ display: active ? 'contents' : 'none' }}>{children}</div>
    </ViewActiveContext.Provider>
  );
}
