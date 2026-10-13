/** Dev-surface gate (packaged-app #278, PRD story 7): one flag for all
 * dev-only surfaces (MIDI inspector, visualizer arena, PAIR editor entry,
 * perf hook). A Vite dev build (`make dev` / lane apps) is dev; the packaged
 * app serves the production bundle, so these surfaces disappear there. */
export const DEV_SURFACES: boolean = import.meta.env.DEV;
