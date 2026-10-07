import type { TourSectionId } from '../tour/tourState';
import type { HelpTarget } from './routes';

export const SETTINGS_HELP: Record<string, HelpTarget> = {
  library: { topic: 'curate', anchor: 'importing' },
  filters: { topic: 'beat-fx', anchor: 'filters' },
  effects: { topic: 'beat-fx', anchor: 'effects' },
  waveforms: { topic: 'analysis', anchor: 'automatic-analysis' },
  'controller-check': { topic: 'controllers', anchor: 'check' },
  jog: { topic: 'controllers', anchor: 'jog-calibration' },
  'mouse-jog': { topic: 'perform', anchor: 'mouse-jog' },
  shortcuts: { topic: 'perform', anchor: 'keyboard' },
  soundcloud: { topic: 'acquire', anchor: 'soundcloud' },
  soulseek: { topic: 'acquire', anchor: 'soulseek' },
  setup: { topic: 'start', anchor: 'setup' },
  tour: { topic: 'start', anchor: 'tour' },
  tutorials: { topic: 'start', anchor: 'tutorials' },
};

export const GUIDE_HELP: Record<string, HelpTarget> = {
  welcome: { topic: 'start', anchor: 'setup' },
  'rekordbox-import': { topic: 'start', anchor: 'rekordbox' },
  'tracks-directory': { topic: 'start', anchor: 'tracks-directory' },
  'cue-mode': { topic: 'audio', anchor: 'cue-mode' },
  soundcloud: { topic: 'start', anchor: 'accounts' },
  soulseek: { topic: 'start', anchor: 'accounts' },
  'controller-check': SETTINGS_HELP['controller-check'],
};

export function guideHelp(id: string): HelpTarget {
  return GUIDE_HELP[id] ?? SETTINGS_HELP.setup;
}

export const TOUR_SECTION_HELP: Record<TourSectionId, HelpTarget> = {
  performance: { topic: 'perform' },
  library: { topic: 'curate' },
  edit: { topic: 'editor', anchor: 'editing' },
  sync: { topic: 'sync' },
  sets: { topic: 'sets' },
  sessions: { topic: 'capture', anchor: 'sessions' },
  history: { topic: 'capture', anchor: 'takes' },
};

export const TOUR_STEP_HELP: Record<string, HelpTarget> = {
  'topbar.modes': { topic: 'start', anchor: 'tour' },
  'performance.browse': { topic: 'perform', anchor: 'loading' },
  'performance.decks': { topic: 'perform', anchor: 'keyboard' },
  'performance.waves': { topic: 'perform' },
  'performance.mixer': { topic: 'perform', anchor: 'mixer' },
  'library.sidebar': { topic: 'curate', anchor: 'playlists' },
  'library.search': { topic: 'curate', anchor: 'filters' },
  'library.table': { topic: 'curate', anchor: 'tags' },
  'library.player': { topic: 'curate', anchor: 'edit-track' },
  'edit.picker': { topic: 'editor', anchor: 'editing' },
  'edit.main': { topic: 'editor', anchor: 'modes' },
  'edit.transport': { topic: 'editor', anchor: 'audition' },
  'sync.tabs': { topic: 'sync' },
  'sync.tracks': { topic: 'sync', anchor: 'inspect' },
  'sets.sidebar': { topic: 'sets', anchor: 'planning' },
  'sets.header': { topic: 'sets', anchor: 'playback' },
  'sets.entries': { topic: 'sets', anchor: 'pins' },
  'sessions.list': { topic: 'capture', anchor: 'timeline' },
  'library.sessions-row': { topic: 'capture', anchor: 'timeline' },
  'history.root': { topic: 'capture', anchor: 'takes' },
  'history.table': { topic: 'capture', anchor: 'takes' },
};

export function tourHelp(section: TourSectionId, step: string): HelpTarget {
  return TOUR_STEP_HELP[step] ?? TOUR_SECTION_HELP[section];
}
