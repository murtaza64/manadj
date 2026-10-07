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
        body: 'PERFORM is for playing, EDIT for shaping mixes, SYNC for importing and exporting. ⋯ holds EXPORT (the full Library) and HISTORY. Backtick (`) switches between the Library and Decks.',
      },
      {
        anchor: 'performance.browse',
        title: 'Start with your music',
        body: 'Your Tracks appear here after importing in SYNC. After this Tour, load one onto a Deck to start the hands-on Keyboard DJing Tutorial.',
      },
      {
        anchor: 'performance.decks',
        title: 'Play a Track',
        body: 'Each Deck has play, Main Cue, Hot Cues and loops, plus its own volume and EQ. Small key labels show the keyboard controls.',
      },
      {
        anchor: 'performance.waves',
        title: 'See the beat',
        body: 'Each loaded Deck has a waveform. Beat lines help you compare timing; the pink line marks the playhead.',
      },
      {
        anchor: 'performance.mixer',
        title: 'Blend the Decks',
        body: 'The crossfader blends its assigned Decks. This strip also holds deck count and keyboard-hint controls. Close the Tour when you are ready to play.',
      },
    ],
  },
  {
    id: 'library',
    label: 'Library (Export)',
    steps: [
      {
        anchor: 'library.sidebar',
        title: 'Organize your Tracks',
        body: 'Choose a playlist here, or make one with + New…. Sets hold a planned running order; Sessions hold what you played.',
      },
      {
        anchor: 'library.search',
        title: 'Search and filters',
        body: 'Search by name, then narrow the results with BPM, Key or tags. Filters combine; the count shows matching Tracks / total.',
      },
      {
        anchor: 'library.table',
        title: 'Track table',
        body: 'Select a Track to inspect it below. Drag Tracks into a playlist or Set; drag column headers to arrange the table.',
      },
      {
        anchor: 'library.player',
        title: 'Listen and prepare',
        body: 'Preview the selected Track here, set Hot Cues, and edit its metadata. Close this Tour to try the controls.',
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
        body: 'Choose an outgoing and incoming Track to see their saved Transitions, or create a new one. The hands-on Transition Tutorial is in ? → Tutorials.',
      },
      {
        anchor: 'edit.main',
        title: 'Timeline',
        body: 'Waveforms show the audio; the lanes below shape volume and EQ over time. Slide changes audio alignment; moving a Track carries its automation along.',
      },
      {
        anchor: 'edit.transport',
        title: 'Transport',
        body: 'Play to audition the open mix. Undo and redo are beside the tempo. Edits save automatically; opening a new Transition alone saves nothing.',
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
        body: 'Start in Tracks to import music from disk or Rekordbox. Playlists handles playlist sync; Acquisition handles downloads.',
      },
      {
        anchor: 'sync.tracks',
        title: 'Track sync',
        body: 'Compare each Track across your Library and external sources. Import adds it to the Library; review the row status before choosing an action.',
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
        body: 'A Set is a planned running order. Create one with + New…, then add Tracks to its sidebar row.',
      },
      {
        anchor: 'sets.header',
        title: 'Set controls',
        body: 'Play the Set from here. You can also show its overview and choose Transitions between neighboring Tracks.',
      },
      {
        anchor: 'sets.entries',
        title: 'Entries',
        body: 'Arrange the Tracks in playing order. Pin a Transition between two neighbors to choose how the handover plays.',
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
        body: 'Sessions record your activity in PERFORM: which Tracks played and how you used the Decks. Open one to revisit a moment.',
      },
      {
        anchor: 'library.sessions-row',
        title: 'Getting back here',
        body: 'Return to Sessions from the Library sidebar, below Tracks.',
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
        body: 'A Take captures a handover you played in PERFORM. Takes are grouped by Track pair so you can compare attempts.',
      },
      {
        anchor: 'history.table',
        title: 'Takes',
        body: 'Listen to a Take or open its moment in the Session. Promote one to keep it as a Transition you can edit and reuse.',
      },
    ],
  },
];

export function tourSection(id: TourSectionId): TourSection | undefined {
  return TOUR_SECTIONS.find((s) => s.id === id);
}
