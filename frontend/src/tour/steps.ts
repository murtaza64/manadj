/**
 * Tour content (feature-tour #282): steps are data, one block per
 * section — never JSX scattered across views. A step points at a
 * `data-tour="<anchor>"` attribute; steps whose anchor isn't rendered
 * (hidden pane, empty state, gated control) are skipped, not broken.
 */

import type { TourSectionId } from './tourState';

export interface TourStep {
  /** Matches a `data-tour` attribute somewhere in the DOM. */
  anchor: string;
  title: string;
  body: string;
}

export interface TourSection {
  id: TourSectionId;
  /** Menu label in the TopBar ? popover. */
  label: string;
  steps: TourStep[];
}

// Perform first (setup-guides #301): fresh installs open in PERFORM, so its
// tour fires first and carries the Modes step; order is also the ? menu's.
export const TOUR_SECTIONS: TourSection[] = [
  {
    id: 'performance',
    label: 'Perform',
    steps: [
      {
        anchor: 'topbar.modes',
        title: 'Modes',
        body: 'The app is a set of modes: PERFORM the decks, EDIT the mix editor, SYNC import/export. ⋯ holds EXPORT (your full library) and HISTORY. Backtick (`) flips between decks and library.',
      },
      {
        anchor: 'performance.waves',
        title: 'Waveforms',
        body: 'Every deck\u2019s waveform, aligned to the beat. Click to seek; the pink playhead is the audible mix position.',
      },
      {
        anchor: 'performance.mixer',
        title: 'Mixer',
        body: 'Channel faders, EQ, filter and the crossfader — mirrored on a connected MIDI controller, which keeps working during this tour.',
      },
      {
        anchor: 'performance.decks',
        title: 'Decks',
        body: 'Transport, hot cues, loops and jog per deck. Keyboard hints live on the deck panels; load tracks from the library below.',
      },
      {
        anchor: 'performance.browse',
        title: 'Library stays with you',
        body: 'The browse panel rides along under every mode — search and load without leaving the decks.',
      },
    ],
  },
  {
    id: 'library',
    label: 'Library (Export)',
    steps: [
      {
        anchor: 'library.sidebar',
        title: 'Sidebar',
        body: 'Playlists, Sets and Sessions live here. + New… at the bottom creates a playlist or a planned Set; drag tracks onto a row to add them.',
      },
      {
        anchor: 'library.search',
        title: 'Search and filters',
        body: 'Type to filter the table; BPM, key and tag filters stack on top. The count shows filtered / total.',
      },
      {
        anchor: 'library.table',
        title: 'Track table',
        body: 'Your library. Click a row to preview it below; drag column headers to reorder, drag rows onto playlists, Sets or decks.',
      },
      {
        anchor: 'library.player',
        title: 'Preview deck',
        body: 'The selected track loads here — waveform, hot cues, and the metadata editor for the loaded track.',
      },
    ],
  },
  {
    id: 'edit',
    label: 'Mix editor',
    steps: [
      {
        anchor: 'edit.picker',
        title: 'Mix picker',
        body: 'Open a mix here: name two tracks to land on their Transitions, Cameos and Routines, or jump in from loaded decks.',
      },
      {
        anchor: 'edit.main',
        title: 'Timeline',
        body: 'The opened mix\u2019s lanes: audio, fader and EQ automation over time. Record takes in PERFORM, refine them here.',
      },
      {
        anchor: 'edit.transport',
        title: 'Transport',
        body: 'Play the mix, undo/redo edits, and adjust the mix BPM. Only visible once a mix is open.',
      },
    ],
  },
  {
    id: 'sync',
    label: 'Sync',
    steps: [
      {
        anchor: 'sync.tabs',
        title: 'Import and export',
        body: 'Tracks syncs your library against external sources (rekordbox, directories); Playlists pushes curated lists; Acquisition pulls new music in.',
      },
      {
        anchor: 'sync.tracks',
        title: 'Track sync',
        body: 'Each row is a track with evidence of where it lives. Import from here fills an empty library.',
      },
    ],
  },
  {
    id: 'sets',
    label: 'Sets',
    steps: [
      {
        anchor: 'sets.sidebar',
        title: 'Sets',
        body: 'A Set is a planned sequence of tracks. Create one with + New…, then drag tracks onto its sidebar row.',
      },
      {
        anchor: 'sets.header',
        title: 'Set controls',
        body: 'Play the plan, toggle the overview ladder, auto-fill transitions, or resolve them from recorded evidence.',
      },
      {
        anchor: 'sets.entries',
        title: 'Entries',
        body: 'The running order. Each adjacency can carry a pinned transition — the Conductor plays them back to back.',
      },
    ],
  },
  {
    id: 'sessions',
    label: 'Sessions',
    steps: [
      {
        anchor: 'sessions.list',
        title: 'Sessions',
        body: 'Every night you play in PERFORM is recorded as a Session — the whole timeline, every deck.',
      },
      {
        anchor: 'library.sessions-row',
        title: 'Getting back here',
        body: 'Sessions live in the library sidebar, under Tracks.',
      },
    ],
  },
  {
    id: 'history',
    label: 'Takes',
    steps: [
      {
        anchor: 'history.root',
        title: 'Transition history',
        body: 'Finished handovers from PERFORM land here as Takes, grouped by track pair. Promote the keepers into the mix editor.',
      },
      {
        anchor: 'history.table',
        title: 'Takes',
        body: 'Audition a take, open its Session moment, or promote it to the pair\u2019s active transition.',
      },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    steps: [
      {
        anchor: 'settings.nav',
        title: 'Sections',
        body: 'Filters, waveform styling, jog calibration and more. Changes apply live and persist with your library.',
      },
      {
        anchor: 'settings.content',
        title: 'Tuning',
        body: 'Each section edits one concern. The Tour section resets this tour if you ever want the walkthrough again.',
      },
    ],
  },
];

export function tourSection(id: TourSectionId): TourSection | undefined {
  return TOUR_SECTIONS.find((s) => s.id === id);
}
