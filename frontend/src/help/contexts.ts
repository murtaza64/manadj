import type { TourSectionId } from '../tour/tourState';
import type { HelpTarget } from './routes';

export const SETTINGS_HELP: Record<string, HelpTarget> = {
  library: { topic: 'curate', anchor: 'importing' },
  filters: {},
  effects: {},
  waveforms: {},
  'controller-check': {},
  jog: {},
  'mouse-jog': { topic: 'perform', anchor: 'mouse-jog' },
  shortcuts: { topic: 'perform', anchor: 'keyboard' },
  soundcloud: {},
  soulseek: {},
  spotify: {},
  setup: { topic: 'start', anchor: 'setup' },
  tour: { topic: 'start', anchor: 'tour' },
  tutorials: { topic: 'start', anchor: 'tutorials' },
};

export const GUIDE_HELP: Record<string, HelpTarget> = {
  welcome: { topic: 'start', anchor: 'setup' },
  'rekordbox-import': { topic: 'start', anchor: 'rekordbox' },
  'tracks-directory': { topic: 'start', anchor: 'tracks-directory' },
  'cue-mode': SETTINGS_HELP.setup,
  soundcloud: SETTINGS_HELP.setup,
  soulseek: SETTINGS_HELP.setup,
  spotify: SETTINGS_HELP.setup,
  'controller-check': SETTINGS_HELP.setup,
};

export function guideHelp(id: string): HelpTarget {
  return GUIDE_HELP[id] ?? SETTINGS_HELP.setup;
}

export const TOUR_SECTION_HELP: Record<TourSectionId, HelpTarget> = {
  performance: { topic: 'perform' },
  library: { topic: 'curate' },
  edit: { topic: 'editor', anchor: 'editing' },
  sync: {},
  sets: {},
  sessions: {},
  history: {},
};

export const TOUR_STEP_HELP: Record<string, HelpTarget> = {
  'topbar.modes': { topic: 'start', anchor: 'tour' },
  'performance.browse': { topic: 'perform', anchor: 'loading' },
  'performance.decks': { topic: 'perform', anchor: 'keyboard' },
  'performance.waves': { topic: 'perform' },
  'performance.mixer': { topic: 'perform', anchor: 'mixer' },
  'library.sidebar': { topic: 'curate', anchor: 'playlists' },
  'library.search': { topic: 'curate', anchor: 'tags' },
  'library.table': { topic: 'curate', anchor: 'tags' },
  'library.player': { topic: 'curate' },
  'edit.picker': { topic: 'editor', anchor: 'editing' },
  'edit.main': { topic: 'editor', anchor: 'editing' },
  'edit.transport': { topic: 'editor', anchor: 'audition' },
  'sync.tabs': {},
  'sync.tracks': {},
  'sets.sidebar': {},
  'sets.header': {},
  'sets.entries': {},
  'sessions.list': {},
  'library.sessions-row': {},
  'history.root': {},
  'history.table': {},
};

export function tourHelp(section: TourSectionId, step: string): HelpTarget {
  return TOUR_STEP_HELP[step] ?? TOUR_SECTION_HELP[section];
}
