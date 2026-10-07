import type { TourSectionId } from '../tour/tourState';
import type { HelpTarget } from './routes';

export const SETTINGS_HELP: Record<string, HelpTarget> = {
  library: { topic: 'curate', anchor: 'importing' },
  filters: { topic: 'beat-fx', anchor: 'filters' },
  effects: { topic: 'beat-fx', anchor: 'effects' },
  waveforms: { topic: 'analysis', anchor: 'waveforms' },
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
  soundcloud: SETTINGS_HELP.soundcloud,
  soulseek: SETTINGS_HELP.soulseek,
  'controller-check': SETTINGS_HELP['controller-check'],
};

export function guideHelp(id: string): HelpTarget {
  return GUIDE_HELP[id] ?? SETTINGS_HELP.setup;
}

export const TOUR_SECTION_HELP: Record<TourSectionId, HelpTarget> = {
  performance: { topic: 'perform' },
  library: { topic: 'curate' },
  edit: { topic: 'editor', anchor: 'editing' },
  sync: { topic: 'sync', anchor: 'import' },
  sets: { topic: 'sets', anchor: 'planning' },
  sessions: { topic: 'capture', anchor: 'sessions' },
  history: { topic: 'capture', anchor: 'takes' },
};

export const TOUR_STEP_HELP: Record<string, HelpTarget> = {
  'topbar.modes': { topic: 'start', anchor: 'tour' },
  'performance.browse': { topic: 'perform', anchor: 'loading' },
  'performance.decks': { topic: 'perform', anchor: 'keyboard' },
  'performance.waves': { topic: 'analysis', anchor: 'waveforms' },
  'performance.mixer': { topic: 'perform', anchor: 'mixer' },
  'library.sidebar': { topic: 'curate', anchor: 'playlists' },
  'library.search': { topic: 'curate', anchor: 'tags' },
  'library.table': { topic: 'curate', anchor: 'tags' },
  'library.player': { topic: 'analysis', anchor: 'analysis' },
  'edit.picker': { topic: 'editor', anchor: 'editing' },
  'edit.main': { topic: 'editor', anchor: 'editing' },
  'edit.transport': { topic: 'editor', anchor: 'audition' },
  'sync.tabs': { topic: 'sync', anchor: 'import' },
  'sync.tracks': { topic: 'sync', anchor: 'import' },
  'sets.sidebar': { topic: 'sets', anchor: 'planning' },
  'sets.header': { topic: 'sets', anchor: 'playback' },
  'sets.entries': { topic: 'sets', anchor: 'planning' },
  'sessions.list': { topic: 'capture', anchor: 'sessions' },
  'library.sessions-row': { topic: 'capture', anchor: 'sessions' },
  'history.root': { topic: 'capture', anchor: 'takes' },
  'history.table': { topic: 'capture', anchor: 'takes' },
};

export function tourHelp(section: TourSectionId, step: string): HelpTarget {
  return TOUR_STEP_HELP[step] ?? TOUR_SECTION_HELP[section];
}
