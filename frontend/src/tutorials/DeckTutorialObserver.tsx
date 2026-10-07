import { useEffect } from 'react';
import { useDecks } from '../hooks/useDeck';
import { useMixer } from '../hooks/useMixer';
import { CHANNEL_IDS } from '../playback/mixer';
import { audibleHolder } from '../playback/audibleSurface';
import { activeTourSection } from '../tour/tourState';
import { reportTutorialAction } from './engine';
import { acceptTutorialEvent, activeTutorial, startTutorial, tutorialProgress } from './tutorialState';

/** Subscribe to authoritative stores, not keys, optimistic cache, or capture's handler slot. */
export function DeckTutorialObserver() {
  const decks = useDecks();
  const mixer = useMixer();
  useEffect(() => {
    const stops = CHANNEL_IDS.flatMap(deck => {
      const { engine } = decks[deck];
      let previous = engine.getSnapshot();
      const send = (type: string) => reportTutorialAction({ type, deck });
      return [engine.subscribe(() => {
        const next = engine.getSnapshot();
        const old = previous; previous = next;
        if (activeTourSection() !== 'performance' || audibleHolder() !== 'shared' || next.loadState !== 'ready') return;
        if (next.trackId !== old.trackId || old.loadState !== 'ready') {
          const p = tutorialProgress('keyboard');
          if (activeTutorial() !== 'keyboard' && (!p || p.status === 'active')) {
            startTutorial('keyboard', deck, !p);
            // The triggering Load is real even when the orientation Tour is
            // still visible. Do not ask the user to perform it twice.
            acceptTutorialEvent({ type: 'load', deck });
          }
          send('load');
        }
        if (next.playing !== old.playing) send(next.playing ? 'play' : 'pause');
        if (old.previewing && !next.previewing && old.hotCuePreviewSlot === null) send('cue');
        if (next.pitchPercent !== old.pitchPercent) send('pitch');
        if (old.bendPercent !== 0 && next.bendPercent === 0) send('nudge');
        if (!old.loop && next.loop) send('loop');
        if (old.loop && !next.loop) send('loop-off');
      }), engine.addTransportEventListener(event => {
        if (activeTourSection() === 'performance' && audibleHolder() === 'shared') send(event.action === 'hotCue' ? 'hotcue' : event.action);
      })];
    });
    const group = decks.A.syncGroup;
    let sync = group.getSnapshot();
    stops.push(group.subscribe(() => {
      const next = group.getSnapshot(); const old = sync; sync = next;
      for (const deck of CHANNEL_IDS) if (old.decks[deck] !== 'synced' && next.decks[deck] === 'synced') reportTutorialAction({ type: 'sync', deck });
    }));
    stops.push(group.subscribeMatch(deck => reportTutorialAction({ type: 'match', deck })));
    let faders = CHANNEL_IDS.map(deck => mixer.getChannelState(deck).fader);
    stops.push(mixer.subscribe(() => {
      const next = CHANNEL_IDS.map(deck => mixer.getChannelState(deck).fader);
      CHANNEL_IDS.forEach((deck, i) => {
        const p = tutorialProgress('keyboard');
        const peer = p?.context.peer;
        if (next[i] < faders[i] && next[i] < 0.5 && peer && decks[peer].engine.getSnapshot().playing
          && mixer.getChannelState(peer).fader > 0.5) reportTutorialAction({ type: 'fader', deck });
      });
      faders = next;
    }));
    return () => stops.forEach(stop => stop());
  }, [decks, mixer]);
  return null;
}
