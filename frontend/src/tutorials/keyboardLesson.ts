import type { Lesson, LessonContext, TutorialStep } from './engine';

const left = (deck: string) => deck === 'A' || deck === 'C';
function task(id: string, title: string, instruction: (c: LessonContext) => string,
  key: (c: LessonContext) => string, control: string, peer = false, bonus = false): TutorialStep {
  return {
    id, bonus,
    copy: c => ({ title, instruction: instruction(c), key: key(c),
      target: control.startsWith('[data-tour=') ? control : `[data-tutorial-deck="${peer ? c.peer : c.deck}"] ${control}` }),
    accepts: (event, c) => event.type === id && (event.deck === undefined || event.deck === (peer ? c.peer : c.deck)),
  };
}
const play = (d: string) => left(d) ? 'D' : 'K';
const cue = (d: string) => left(d) ? 'F' : 'J';
const pads = (d: string) => left(d) ? 'Z X C V' : 'M , . /';

export const keyboardLesson: Lesson = {
  id: 'keyboard', title: 'Keyboard DJing', area: 'performance',
  steps: [
    task('load', 'Your first Track', c => `Load a Track onto Deck ${c.deck} from the browser below. Use your own music; Hot Cues you set here are saved. Keep the volume low.`, c => `Tab → ${c.deck}`, '[data-tour="performance.browse"]'),
    task('play', 'Start the music', c => `Return to the decks with Esc, then press ${play(c.deck)} to play Deck ${c.deck}. In four-deck view, [ selects A/C and ] selects B/D.`, c => play(c.deck), '.perf-transport-col'),
    task('pause', 'Stop on a beat', c => `Press ${play(c.deck)} again to pause Deck ${c.deck}.`, c => play(c.deck), '.perf-transport-col'),
    task('cue', 'Hold to listen', c => `Hold ${cue(c.deck)} to preview the Main Cue, then release. If you paused away from the cue, press once to set it, then hold again.`, c => cue(c.deck), '.perf-transport-col'),
    task('hotcue-set', 'Leave a marker', c => `Press an empty Hot Cue pad on Deck ${c.deck}. It saves this position. Use an empty on-screen pad if all four keyboard slots are occupied; do not erase a cue you want to keep.`, c => pads(c.deck), '.perf-pads'),
    task('hotcue', 'Jump to your marker', c => `Press a filled Hot Cue pad on Deck ${c.deck}. While paused, hold to preview and release to return.`, c => pads(c.deck), '.perf-pads'),
    task('browse', 'Find your next Track', () => 'Press Tab to give the browser the keyboard. Use J/K or ↓/↑ to select a different Track. Deck shortcuts wait while you browse.', () => 'Tab', '[data-tour="performance.browse"]'),
    task('load', 'Load the other Deck', c => `With the browser focused, select another Track and press ${c.peer} to load Deck ${c.peer}. Wait for the audio to load.`, c => c.peer, '[data-tour="performance.browse"]', true),
    task('play', 'Keep the first Track running', c => `Press Esc to return to the decks, then play Deck ${c.deck}. This is your tempo reference.`, c => play(c.deck), '.perf-transport-col'),
    task('pitch', 'Change the incoming tempo', c => `Drag Deck ${c.peer}'s PITCH value. Pitch changes the playback tempo; it has no dedicated key. Use Tracks with analyzed BPMs for the next tasks.`, () => 'Drag PITCH', '[title^="Pitch ("]', true),
    task('match', 'Match the tempo', c => `Click MATCH on Deck ${c.peer} while Deck ${c.deck} plays. MATCH copies the tempo once; it does not keep the decks linked. If unavailable, use two analyzed Tracks with nearby BPMs.`, () => 'MATCH', '.perf-match', true),
    task('play', 'Bring in the second Track', c => `Play Deck ${c.peer}. Both Tracks should now be running.`, c => play(c.peer), '.perf-transport-col', true),
    task('nudge', 'Line up the beats', c => `Hold ${left(c.peer) ? 'T' : 'Y'} and move the mouse horizontally to bend Deck ${c.peer}, then release. Listen for the beats to line up. Nudge changes speed only while held.`, c => left(c.peer) ? 'T + mouse' : 'Y + mouse', '.perf-nudge', true),
    task('sync', 'Keep tempos linked', c => `Enable SYNC on Deck ${c.peer}. If already enabled, turn it off and on. SYNC follows tempo changes; MATCH was a one-time adjustment.`, () => 'SYNC', '.perf-match', true),
    task('fader', 'Make the handover', c => `Lower Deck ${c.deck}'s VOL below halfway using ${left(c.deck) ? 'G' : 'H'} + mouse (left/down). Leave Deck ${c.peer} playing with its VOL up. You can also drag the fader. The mouse-only X-FADER is another way to blend assigned channels.`, c => left(c.deck) ? 'G + mouse' : 'H + mouse', '[title^="Channel volume:"]'),
    task('loop', 'Bonus: catch a loop', c => `Press ${left(c.peer) ? 'B' : 'N'} on Deck ${c.peer} to engage a beat loop. If one is already active, turn it off and on. A Beatgrid is required.`, c => left(c.peer) ? 'B' : 'N', '.deck-looprow', true, true),
    task('loop-off', 'Bonus: leave the loop', c => `Press ${left(c.peer) ? 'B' : 'N'} again to release the loop.`, c => left(c.peer) ? 'B' : 'N', '.deck-looprow', true, true),
    task('jumpBeats', 'Bonus: jump a phrase', c => `Press ${left(c.peer) ? 'S' : ';'} to jump forward by the displayed number of beats on Deck ${c.peer}. Your Tracks and Hot Cues remain yours after this lesson.`, c => left(c.peer) ? 'A / S' : 'L / ;', '.deck-jumprow', true, true),
  ],
};
