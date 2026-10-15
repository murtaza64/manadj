/** One-click look styles (BASE LOOK or a scene's changes). */
import type { ClipLook } from './clipSpec';

export const LOOK_PRESETS: { id: string; label: string; title: string; look: Partial<ClipLook> }[] = [
  { id: 'mixer', label: 'MIXER', title: 'Intro: titles + knobs + playhead, a dim visualizer',
    look: { showKnobs: true, showTitles: true, showPlayhead: true, showCues: true, showTicker: true, vizDim: 0.35, vignette: 0.6, vizOpacity: 0.75 } },
  { id: 'bright', label: 'BRIGHT', title: 'The visualizer at full: no darken, no vignette',
    look: { vizDim: 0, vignette: 0, vizOpacity: 1 } },
  { id: 'waves', label: 'WAVES ONLY', title: 'Strip the UI: no knobs, titles, playhead, cue flags or pills',
    look: { showKnobs: false, showTitles: false, showPlayhead: false, showCues: false, showTicker: false } },
  { id: 'mono-drop', label: 'MONO DROP', title: 'White waves, solid, over a barely darkened visualizer',
    look: { composite: 'cards', wavePalette: 'mono', vizDim: 0.12, vignette: 0.35, vizOpacity: 0.9 } },
  { id: 'window', label: 'WINDOW', title: 'The waves are windows onto the visualizer',
    look: { composite: 'mask', wavePalette: 'mono', vizOpacity: 0.85 } },
  { id: 'light', label: 'LIGHT', title: 'Neon waves added as light',
    look: { composite: 'screen', wavePalette: 'neon', glow: 0.9 } },
  { id: 'tint', label: 'TINT', title: 'Deck hue recolors the visualizer', look: { composite: 'tint', wavePalette: 'deck' } },
  { id: 'stage', label: 'STAGE', title: 'One shared stage, every deck overlaid', look: { composite: 'stage', wavePalette: 'deck', showTicker: false } },
  { id: 'glass', label: 'GLASS CARDS', title: 'Lanes as glass cards', look: { laneFrame: 'cards', composite: 'cards', wavePalette: 'deck' } },
];
